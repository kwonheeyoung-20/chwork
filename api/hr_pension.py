"""
/api/hr_pension

GET  -> pension_status 뷰 조회 (직원별 누적추계액/실불입액/잔액)
POST -> 불입 내역 추가 (pension_contributions)

모든 요청에 X-HR-Password 헤더 필요.
(외부 모듈을 import하지 않는 독립형 파일)
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import traceback
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs

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


def check_password(candidate: str) -> bool:
    if not HR_PASSWORD:
        return False
    return candidate == HR_PASSWORD


def rpc(fn_name, params):
    return rest_request("POST", f"rpc/{fn_name}", body=params)


def year_of(date_str):
    return date_str[:4] if date_str else None


def is_period_locked(period_key):
    rows = rest_request("GET", f"period_locks?module=eq.pension&period_key=eq.{period_key}&select=locked") or []
    return bool(rows) and rows[0].get("locked", False)


def is_pre_2026(year_str):
    return bool(year_str) and year_str < "2026"


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
            as_of = qs.get("as_of", [None])[0]
            employee_id = qs.get("employee_id", [None])[0]

            if qs.get("locks", ["0"])[0] == "1":
                locks = rest_request("GET", "period_locks?module=eq.pension&select=*&order=period_key.desc")
                return self._send(200, {"locks": locks})

            # 특정 직원의 불입 내역 또는 보정 내역 조회
            if employee_id:
                if qs.get("type", [None])[0] == "adjustment":
                    items = rest_request(
                        "GET",
                        f"pension_accrual_adjustments?employee_id=eq.{employee_id}&select=*&order=effective_date.desc",
                    )
                    return self._send(200, {"adjustments": items})
                items = rest_request(
                    "GET",
                    f"pension_contributions?employee_id=eq.{employee_id}&select=*&order=contribution_date.desc",
                )
                return self._send(200, {"contributions": items})

            data = rest_request("GET", "pension_status?select=*")
            if not isinstance(data, list):
                return self._send(502, {"error": "unexpected_response", "detail": str(data)})

            if as_of:
                as_of_data = rpc("pension_status_as_of", {"p_as_of": as_of}) or []
                as_of_map = {row["id"]: row for row in as_of_data}
                for emp in data:
                    extra = as_of_map.get(emp["id"], {})
                    emp["as_of_cumulative_estimate"] = extra.get("as_of_cumulative_estimate", 0)
                    emp["period_accrual"] = extra.get("period_accrual", 0)
                    emp["as_of_paid"] = extra.get("as_of_paid", 0)
                    emp["as_of_balance"] = extra.get("as_of_balance", 0)

            return self._send(200, {"pension": data})
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

            # 마감/마감해제: {"type": "lock", period_key: "2026", locked: true/false, note}
            if isinstance(payload, dict) and payload.get("type") == "lock":
                period_key = payload.get("period_key")
                locked = payload.get("locked", True)
                if not period_key:
                    return self._send(400, {"error": "period_key는 필수입니다"})
                rest_request(
                    "POST", "period_locks",
                    body={"module": "pension", "period_key": period_key, "locked": locked, "note": payload.get("note")},
                    prefer="resolution=merge-duplicates",
                )
                return self._send(200, {"ok": True})

            # 보정(조정) 추가: {"type": "adjustment", employee_id, effective_date, adjustment_amount, note}
            if isinstance(payload, dict) and payload.get("type") == "adjustment":
                emp_id = payload.get("employee_id")
                effective_date = payload.get("effective_date")
                adjustment_amount = payload.get("adjustment_amount")
                if not emp_id or not effective_date or adjustment_amount is None:
                    return self._send(400, {"error": "employee_id, effective_date, adjustment_amount는 필수입니다"})
                if is_period_locked(year_of(effective_date)):
                    return self._send(423, {"error": f"{year_of(effective_date)}년은 마감되어 있습니다. 먼저 마감해제해주세요."})
                created = rest_request("POST", "pension_accrual_adjustments", body={
                    "employee_id": emp_id,
                    "effective_date": effective_date,
                    "adjustment_amount": adjustment_amount,
                    "note": payload.get("note"),
                }, prefer="return=representation")
                return self._send(201, {"adjustment": created[0] if created else None})

            # 목록형(일괄 저장): {"items": [{employee_id, contribution_date, amount, note}, ...]}
            if isinstance(payload, dict) and "items" in payload:
                items = payload["items"]
                if not items:
                    return self._send(400, {"error": "items가 비어있습니다"})
                body = []
                locked_years = set()
                for it in items:
                    if not it.get("employee_id") or not it.get("contribution_date") or it.get("amount") is None:
                        continue
                    y = year_of(it["contribution_date"])
                    if is_period_locked(y):
                        locked_years.add(y)
                        continue
                    body.append({
                        "employee_id": it["employee_id"],
                        "contribution_date": it["contribution_date"],
                        "amount": it["amount"],
                        "note": it.get("note"),
                    })
                if locked_years and not body:
                    return self._send(423, {"error": f"{', '.join(sorted(locked_years))}년이 마감되어 저장할 항목이 없습니다."})
                if not body:
                    return self._send(400, {"error": "유효한 항목이 없습니다"})
                created = rest_request("POST", "pension_contributions", body=body, prefer="return=representation")
                result = {"contributions": created, "count": len(created) if created else 0}
                if locked_years:
                    result["skipped_locked_years"] = sorted(locked_years)
                return self._send(201, result)

            # 단건 저장
            emp_id = payload.get("employee_id")
            contribution_date = payload.get("contribution_date")
            amount = payload.get("amount")
            if not emp_id or not contribution_date or amount is None:
                return self._send(400, {"error": "employee_id, contribution_date, amount는 필수입니다"})
            if is_period_locked(year_of(contribution_date)):
                return self._send(423, {"error": f"{year_of(contribution_date)}년은 마감되어 있습니다. 먼저 마감해제해주세요."})

            created = rest_request("POST", "pension_contributions", body={
                "employee_id": emp_id,
                "contribution_date": contribution_date,
                "amount": amount,
                "note": payload.get("note"),
            }, prefer="return=representation")
            return self._send(201, {"contribution": created[0] if created else None})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def do_PATCH(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            item_id = qs.get("id", [None])[0]
            if not item_id:
                return self._send(400, {"error": "id는 필수입니다"})
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")

            if qs.get("type", [None])[0] == "adjustment":
                existing = rest_request("GET", f"pension_accrual_adjustments?id=eq.{item_id}&select=effective_date")
                if existing:
                    check_date = payload.get("effective_date") or existing[0]["effective_date"]
                    if is_pre_2026(year_of(existing[0]["effective_date"])) or is_pre_2026(year_of(check_date)):
                        return self._send(423, {"error": "2025년 이전 확정자료는 수정할 수 없습니다."})
                    if is_period_locked(year_of(check_date)) or is_period_locked(year_of(existing[0]["effective_date"])):
                        return self._send(423, {"error": "마감된 연도의 데이터는 수정할 수 없습니다. 먼저 마감해제해주세요."})
                update_fields = {}
                if payload.get("effective_date"):
                    update_fields["effective_date"] = payload["effective_date"]
                if payload.get("adjustment_amount") is not None:
                    update_fields["adjustment_amount"] = payload["adjustment_amount"]
                if "note" in payload:
                    update_fields["note"] = payload["note"]
                if not update_fields:
                    return self._send(400, {"error": "수정할 항목이 없습니다"})
                rest_request("PATCH", f"pension_accrual_adjustments?id=eq.{item_id}", body=update_fields)
                return self._send(200, {"ok": True})

            existing = rest_request("GET", f"pension_contributions?id=eq.{item_id}&select=contribution_date")
            if existing:
                check_date = payload.get("contribution_date") or existing[0]["contribution_date"]
                if is_pre_2026(year_of(existing[0]["contribution_date"])) or is_pre_2026(year_of(check_date)):
                    return self._send(423, {"error": "2025년 이전 확정자료는 수정할 수 없습니다."})
                if is_period_locked(year_of(check_date)) or is_period_locked(year_of(existing[0]["contribution_date"])):
                    return self._send(423, {"error": "마감된 연도의 데이터는 수정할 수 없습니다. 먼저 마감해제해주세요."})

            update_fields = {}
            if payload.get("contribution_date"):
                update_fields["contribution_date"] = payload["contribution_date"]
            if payload.get("amount") is not None:
                update_fields["amount"] = payload["amount"]
            if "note" in payload:
                update_fields["note"] = payload["note"]
            if not update_fields:
                return self._send(400, {"error": "수정할 항목이 없습니다"})

            rest_request("PATCH", f"pension_contributions?id=eq.{item_id}", body=update_fields)
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
            item_id = qs.get("id", [None])[0]
            if not item_id:
                return self._send(400, {"error": "id는 필수입니다"})
            is_adjustment = qs.get("type", [None])[0] == "adjustment"
            table = "pension_accrual_adjustments" if is_adjustment else "pension_contributions"
            date_field = "effective_date" if is_adjustment else "contribution_date"

            existing = rest_request("GET", f"{table}?id=eq.{item_id}&select={date_field}")
            if existing and is_pre_2026(year_of(existing[0][date_field])):
                return self._send(423, {"error": "2025년 이전 확정자료는 삭제할 수 없습니다."})
            if existing and is_period_locked(year_of(existing[0][date_field])):
                return self._send(423, {"error": "마감된 연도의 데이터는 삭제할 수 없습니다. 먼저 마감해제해주세요."})

            rest_request("DELETE", f"{table}?id=eq.{item_id}")
            return self._send(200, {"ok": True})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
