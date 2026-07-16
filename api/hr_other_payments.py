"""
/api/hr_other_payments

GET  ?employee_id=&year=       -> 특정 직원(또는 전체)의 급여 외 지급 내역 조회
POST                            -> 지급 내역 추가
PATCH ?id=                      -> 수정
DELETE ?id=                     -> 삭제

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


def year_of(date_str):
    return date_str[:4] if date_str else None


def is_period_locked(period_key):
    rows = rest_request("GET", f"period_locks?module=eq.other_payments&period_key=eq.{period_key}&select=locked") or []
    return bool(rows) and rows[0].get("locked", False)


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

            if qs.get("locks", ["0"])[0] == "1":
                locks = rest_request("GET", "period_locks?module=eq.other_payments&select=*&order=period_key.desc")
                return self._send(200, {"locks": locks})

            employee_id = qs.get("employee_id", [None])[0]
            year = qs.get("year", [None])[0]

            filt = "select=*,employees(name,branch,department,position)"
            if employee_id:
                filt += f"&employee_id=eq.{employee_id}"
            if year:
                filt += f"&payment_date=gte.{year}-01-01&payment_date=lte.{year}-12-31"
            data = rest_request("GET", f"other_payments?{filt}&order=payment_date.desc")
            return self._send(200, {"payments": data})
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

            if isinstance(payload, dict) and payload.get("type") == "lock":
                period_key = payload.get("period_key")
                locked = payload.get("locked", True)
                if not period_key:
                    return self._send(400, {"error": "period_key는 필수입니다"})
                rest_request(
                    "POST", "period_locks",
                    body={"module": "other_payments", "period_key": period_key, "locked": locked, "note": payload.get("note")},
                    prefer="resolution=merge-duplicates",
                )
                return self._send(200, {"ok": True})

            # 목록형(일괄 저장)
            if isinstance(payload, dict) and "items" in payload:
                items = payload["items"]
                body = []
                locked_years = set()
                for it in items:
                    if not it.get("employee_id") or not it.get("payment_date") or it.get("amount") is None:
                        continue
                    y = year_of(it["payment_date"])
                    if is_period_locked(y):
                        locked_years.add(y)
                        continue
                    body.append({
                        "employee_id": it["employee_id"],
                        "payment_type": it.get("payment_type") or "기타수당",
                        "payment_date": it["payment_date"],
                        "amount": it["amount"],
                        "note": it.get("note"),
                    })
                if not body:
                    return self._send(400 if not locked_years else 423, {"error": "저장할 유효한 항목이 없습니다" + (f" ({', '.join(sorted(locked_years))}년 마감됨)" if locked_years else "")})
                created = rest_request("POST", "other_payments", body=body, prefer="return=representation")
                return self._send(201, {"payments": created, "count": len(created) if created else 0})

            emp_id = payload.get("employee_id")
            payment_type = payload.get("payment_type")
            payment_date = payload.get("payment_date")
            amount = payload.get("amount")
            if not emp_id or not payment_type or not payment_date or amount is None:
                return self._send(400, {"error": "employee_id, payment_type, payment_date, amount는 필수입니다"})
            if is_period_locked(year_of(payment_date)):
                return self._send(423, {"error": f"{year_of(payment_date)}년은 마감되어 있습니다. 먼저 마감해제해주세요."})

            created = rest_request("POST", "other_payments", body={
                "employee_id": emp_id,
                "payment_type": payment_type,
                "payment_date": payment_date,
                "amount": amount,
                "note": payload.get("note"),
            }, prefer="return=representation")
            return self._send(201, {"payment": created[0] if created else None})
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

            existing = rest_request("GET", f"other_payments?id=eq.{item_id}&select=payment_date")
            if existing:
                check_date = payload.get("payment_date") or existing[0]["payment_date"]
                if is_period_locked(year_of(check_date)) or is_period_locked(year_of(existing[0]["payment_date"])):
                    return self._send(423, {"error": "마감된 연도의 데이터는 수정할 수 없습니다. 먼저 마감해제해주세요."})

            update_fields = {}
            for f in ("payment_type", "payment_date", "amount", "note"):
                if f in payload and payload[f] is not None:
                    update_fields[f] = payload[f]
            if not update_fields:
                return self._send(400, {"error": "수정할 항목이 없습니다"})

            rest_request("PATCH", f"other_payments?id=eq.{item_id}", body=update_fields)
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

            existing = rest_request("GET", f"other_payments?id=eq.{item_id}&select=payment_date")
            if existing and is_period_locked(year_of(existing[0]["payment_date"])):
                return self._send(423, {"error": "마감된 연도의 데이터는 삭제할 수 없습니다. 먼저 마감해제해주세요."})

            rest_request("DELETE", f"other_payments?id=eq.{item_id}")
            return self._send(200, {"ok": True})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
