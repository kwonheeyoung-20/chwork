"""
/api/hr_payroll

GET  ?year_month=2026-07-01           -> 그 달 급여명세 미리보기(전 직원, 저장 안 함)
GET  ?year_month=...&save_list=1      -> 저장된(생성된) 월별 급여명세 조회
POST                                    -> 그 달 급여명세 생성/저장 (전 직원 일괄)

모든 요청에 X-HR-Password 헤더 필요.
(외부 모듈을 import하지 않는 독립형 파일)
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
        raise SupabaseError(0, f"URL 연결 실패: {e.reason}")


def rpc(fn_name, params):
    return rest_request("POST", f"rpc/{fn_name}", body=params)


def check_password(candidate: str) -> bool:
    if not HR_PASSWORD:
        return False
    return candidate == HR_PASSWORD


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-HR-Password",
        "Content-Type": "application/json",
    }


class handler(BaseHTTPRequestHandler):
    def _authorized(self):
        return check_password(self.headers.get("X-HR-Password", ""))

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
            year_month = qs.get("year_month", [None])[0]
            if not year_month:
                return self._send(400, {"error": "year_month는 필수입니다 (예: 2026-07-01)"})

            if qs.get("saved", ["0"])[0] == "1":
                data = rest_request(
                    "GET",
                    f"monthly_payroll?year_month=eq.{year_month}&select=*,employees(name,branch,department,position)&order=created_at",
                )
                return self._send(200, {"payroll": data})

            employees = rest_request(
                "GET", f"employees?status=eq.{quote('재직')}&select=id,name,branch,department,position&order=hire_date.asc"
            ) or []

            results = []
            for emp in employees:
                calc = rpc("payroll_calc_base", {"p_employee_id": emp["id"], "p_year_month": year_month})
                row = calc[0] if calc else {
                    "base_pay": 0, "fixed_overtime_pay": 0,
                    "attendance_allowance": 0, "meal_allowance": 0, "total_pay": 0,
                }
                results.append({**emp, **row})

            return self._send(200, {"payroll": results})
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
            year_month = payload.get("year_month")
            if not year_month:
                return self._send(400, {"error": "year_month는 필수입니다"})

            employees = rest_request(
                "GET", f"employees?status=eq.{quote('재직')}&select=id"
            ) or []

            body = []
            for emp in employees:
                calc = rpc("payroll_calc_base", {"p_employee_id": emp["id"], "p_year_month": year_month})
                row = calc[0] if calc else None
                if not row:
                    continue
                body.append({
                    "employee_id": emp["id"],
                    "year_month": year_month,
                    "base_pay": row["base_pay"],
                    "fixed_overtime_pay": row["fixed_overtime_pay"],
                    "attendance_allowance": row["attendance_allowance"],
                    "meal_allowance": row["meal_allowance"],
                    "total_pay": row["total_pay"],
                    "calc_note": "1단계 기본계산 (정상 재직자 기준)",
                })

            if not body:
                return self._send(400, {"error": "계산된 대상이 없습니다"})

            created = rest_request(
                "POST", "monthly_payroll", body=body,
                prefer="return=representation,resolution=merge-duplicates",
            )
            return self._send(201, {"count": len(created) if created else 0})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
