"""
/api/hr_employees

GET    -> 재직자 목록(기본) + 각자 최신 연봉. ?all=1 이면 퇴사자 포함 전체.
POST   -> 신규 직원 추가
PATCH  -> 기존 직원 정보 수정 (body에 id 포함)

모든 요청에 X-HR-Password 헤더 필요 (hr_login에서 확인한 비밀번호).

(외부 모듈을 import하지 않는 독립형 파일입니다 — Vercel 배포시
같은 폴더의 다른 .py 파일을 못 불러오는 문제를 피하기 위함)
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import traceback
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs, quote

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")


class SupabaseError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"Supabase error {status}: {body}")


def _sb_headers(prefer=None):
    h = {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def rest_request(method, path, body=None, prefer=None):
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        raise SupabaseError(0, "SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 비어있습니다.")
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_sb_headers(prefer))
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SupabaseError(e.code, e.read().decode("utf-8", "ignore"))
    except urllib.error.URLError as e:
        raise SupabaseError(0, f"URL 연결 실패: {e.reason} (SUPABASE_URL 값을 확인하세요: {SUPABASE_URL})")


def check_password(candidate: str) -> bool:
    if not HR_PASSWORD:
        return False
    return candidate == HR_PASSWORD


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-HR-Password",
        "Content-Type": "application/json",
    }


class handler(BaseHTTPRequestHandler):
    def _authorized(self):
        pw = self.headers.get("X-HR-Password", "")
        return check_password(pw)

    def _send(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)

            if qs.get("salary_history", ["0"])[0] == "1":
                emp_id = qs.get("employee_id", [None])[0]
                if not emp_id:
                    return self._send(400, {"error": "employee_id는 필수입니다"})
                items = rest_request(
                    "GET", f"salary_history?employee_id=eq.{emp_id}&select=*&order=effective_month.desc"
                )
                return self._send(200, {"salary_history": items})

            show_all = qs.get("all", ["0"])[0] == "1"

            select = "select=*,salary_history(effective_month,annual_salary_thousand,reason)"
            filt = "" if show_all else f"&status=eq.{quote('재직')}"
            data = rest_request("GET", f"employees?{select}{filt}&order=hire_date.asc")

            if not isinstance(data, list):
                return self._send(502, {"error": "unexpected_response", "detail": str(data)})

            for emp in data:
                hist = sorted(emp.get("salary_history") or [], key=lambda h: h["effective_month"])
                emp["current_salary_thousand"] = hist[-1]["annual_salary_thousand"] if hist else None

            return self._send(200, {"employees": data})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def do_POST(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")

            # 일괄 연봉 인상: {"type": "bulk_salary", "items": [{employee_id, effective_month, annual_salary_thousand, reason}]}
            if isinstance(payload, dict) and payload.get("type") == "bulk_salary":
                items = payload.get("items") or []
                body = []
                for it in items:
                    if not it.get("employee_id") or not it.get("effective_month") or it.get("annual_salary_thousand") is None:
                        continue
                    body.append({
                        "employee_id": it["employee_id"],
                        "effective_month": it["effective_month"],
                        "annual_salary_thousand": it["annual_salary_thousand"],
                        "reason": it.get("reason") or "일괄 연봉 인상",
                    })
                if not body:
                    return self._send(400, {"error": "유효한 항목이 없습니다"})
                created = rest_request("POST", "salary_history", body=body, prefer="return=representation")
                return self._send(201, {"count": len(created) if created else 0})

            emp_fields = {k: payload.get(k) for k in (
                "name", "position", "branch", "department", "hire_date", "retire_date",
                "status", "employment_type", "contract_fixed_salary", "unused_leave_days",
                "pension_enrolled", "pension_enrollment_date", "note"
            ) if payload.get(k) is not None}
            emp_fields.setdefault("status", "재직")

            created = rest_request("POST", "employees", body=emp_fields, prefer="return=representation")
            new_emp = created[0]
            if payload.get("annual_salary_thousand") is not None:
                rest_request("POST", "salary_history", body={
                    "employee_id": new_emp["id"],
                    "effective_month": payload.get("effective_month") or payload.get("hire_date"),
                    "annual_salary_thousand": payload["annual_salary_thousand"],
                    "reason": "신규입사",
                })
            return self._send(201, {"employee": new_emp})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def do_PATCH(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")

            # 연봉 이력 항목 자체 수정: PATCH ?salary_history_id=xxx
            sh_id = qs.get("salary_history_id", [None])[0]
            if sh_id:
                update_fields = {}
                if payload.get("effective_month"):
                    update_fields["effective_month"] = payload["effective_month"]
                if payload.get("annual_salary_thousand") is not None:
                    update_fields["annual_salary_thousand"] = payload["annual_salary_thousand"]
                if "reason" in payload:
                    update_fields["reason"] = payload["reason"]
                if not update_fields:
                    return self._send(400, {"error": "수정할 항목이 없습니다"})
                rest_request("PATCH", f"salary_history?id=eq.{sh_id}", body=update_fields)
                return self._send(200, {"ok": True})

            emp_id = payload.get("id")
            if not emp_id:
                return self._send(400, {"error": "id required"})

            update_fields = {k: v for k, v in payload.items() if k != "id" and k not in (
                "new_salary_thousand", "new_salary_effective_month", "new_salary_reason"
            )}

            if update_fields:
                rest_request("PATCH", f"employees?id=eq.{emp_id}", body=update_fields)
            if payload.get("new_salary_thousand") is not None:
                rest_request("POST", "salary_history", body={
                    "employee_id": emp_id,
                    "effective_month": payload.get("new_salary_effective_month"),
                    "annual_salary_thousand": payload["new_salary_thousand"],
                    "reason": payload.get("new_salary_reason") or "연봉 변경",
                })
            return self._send(200, {"ok": True})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def do_DELETE(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            sh_id = qs.get("salary_history_id", [None])[0]
            if not sh_id:
                return self._send(400, {"error": "salary_history_id는 필수입니다"})
            rest_request("DELETE", f"salary_history?id=eq.{sh_id}")
            return self._send(200, {"ok": True})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
