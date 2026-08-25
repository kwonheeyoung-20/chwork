"""
/api/hr_settlement

GET  ?employee_id=&retire_date=   -> 정산 미리보기 계산 (저장 안 함)
GET  ?list=1                      -> 확정 저장된 정산 이력 목록
POST                               -> 정산 확정 저장 (퇴사자 이력에 기록)

모든 요청에 X-HR-Password 헤더 필요.
(외부 모듈을 import하지 않는 독립형 파일)
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import traceback
import urllib.request
import urllib.parse
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
    url = f"{SUPABASE_URL}/rest/v1/{urllib.parse.quote(path, safe='?&=,.*:()!~%/')}"
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


def is_period_locked(year_str):
    rows = rest_request("GET", f"period_locks?module=eq.pension&period_key=eq.{year_str}&select=locked") or []
    return bool(rows) and rows[0].get("locked", False)


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

            if qs.get("list", ["0"])[0] == "1":
                data = rest_request(
                    "GET",
                    "pension_settlements?select=*,employees(name,branch,department)&order=retire_date.desc",
                )
                return self._send(200, {"settlements": data})

            employee_id = qs.get("employee_id", [None])[0]
            retire_date = qs.get("retire_date", [None])[0]
            if not employee_id or not retire_date:
                return self._send(400, {"error": "employee_id, retire_date는 필수입니다"})

            cumulative_estimate = rpc("pension_cumulative_estimate", {
                "p_employee_id": employee_id, "p_as_of": retire_date,
            })
            total_contributed = rpc("pension_contributed_as_of", {
                "p_employee_id": employee_id, "p_as_of": retire_date,
            })
            cumulative_estimate = cumulative_estimate or 0
            total_contributed = total_contributed or 0
            additional_payment = round(cumulative_estimate - total_contributed)

            emp_row = rest_request("GET", f"employees?id=eq.{employee_id}&select=hire_date")
            hire_date = emp_row[0]["hire_date"] if emp_row else None

            yearly = self._build_yearly_breakdown(employee_id, retire_date)

            return self._send(200, {
                "hire_date": hire_date,
                "cumulative_estimate": cumulative_estimate,
                "total_contributed": total_contributed,
                "additional_payment": additional_payment,
                "yearly": yearly,
            })
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _build_yearly_breakdown(self, employee_id, retire_date):
        emp = rest_request("GET", f"employees?id=eq.{employee_id}&select=hire_date")
        if not emp:
            return []
        hire_date = emp[0]["hire_date"]
        hire_year = int(hire_date[:4])
        retire_year = int(retire_date[:4])

        history = rest_request(
            "GET", f"pension_cumulative_history?employee_id=eq.{employee_id}&select=year,cumulative_estimate"
        ) or []
        history_by_year = {h["year"]: h["cumulative_estimate"] for h in history}
        earliest_known_year = min(history_by_year.keys()) if history_by_year else 2026

        start_year = max(hire_year, earliest_known_year)

        rows = []
        for y in range(start_year, retire_year + 1):
            if y in history_by_year:
                cum_estimate = history_by_year[y]
            else:
                as_of = retire_date if y == retire_year else f"{y}-12-31"
                cum_estimate = rpc("pension_cumulative_estimate", {"p_employee_id": employee_id, "p_as_of": as_of}) or 0

            as_of_paid = retire_date if y == retire_year else f"{y}-12-31"
            cum_paid = rpc("pension_contributed_as_of", {"p_employee_id": employee_id, "p_as_of": as_of_paid}) or 0

            rows.append({
                "year": y,
                "cumulative_estimate": round(cum_estimate),
                "cumulative_paid": round(cum_paid),
                "balance": round(cum_estimate - cum_paid),
            })
        return rows

    def do_POST(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")

            required = ("employee_id", "retire_date", "cumulative_estimate", "total_contributed", "additional_payment", "net_payment")
            if any(payload.get(k) is None for k in required):
                return self._send(400, {"error": f"다음 필드는 필수입니다: {', '.join(required)}"})

            body = {
                "employee_id": payload["employee_id"],
                "retire_date": payload["retire_date"],
                "cumulative_estimate": payload["cumulative_estimate"],
                "total_contributed": payload["total_contributed"],
                "additional_payment": payload["additional_payment"],
                "deduction_total": payload.get("deduction_total", 0),
                "year_end_tax_refund": payload.get("year_end_tax_refund", 0),
                "other_payment": payload.get("other_payment", 0),
                "net_payment": payload["net_payment"],
                "note": payload.get("note"),
            }
            created = rest_request("POST", "pension_settlements", body=body, prefer="return=representation")
            settlement = created[0] if created else None

            # 정산 확정 시 직원 재직상태도 자동으로 '퇴사' 처리
            rest_request("PATCH", f"employees?id=eq.{payload['employee_id']}", body={
                "status": "퇴사", "retire_date": payload["retire_date"],
            })

            # 추가불입액이 있으면 불입 기록에도 자동 등록하고, 이 정산 건과 확실히 연결해둠
            # (나중에 정산을 되돌릴 때 이 기록도 같이 정확하게 지우기 위함)
            contrib_warning = None
            add = payload["additional_payment"]
            if add and add > 0 and settlement:
                pay_date = payload.get("pay_date") or payload["retire_date"]
                pay_year = pay_date[:4] if pay_date else None
                if pay_year and is_period_locked(pay_year):
                    contrib_warning = f"{pay_year}년 퇴직연금이 마감되어 있어 불입기록이 자동등록되지 않았습니다. 마감해제 후 '발생 및 불입 입력' 탭에서 직접 추가해주세요."
                else:
                    try:
                        rest_request("POST", "pension_contributions", body={
                            "employee_id": payload["employee_id"],
                            "contribution_date": pay_date,
                            "amount": add,
                            "note": "퇴사자 정산 - 추가불입액(자동기록)",
                            "settlement_id": settlement["id"],
                        })
                    except SupabaseError:
                        contrib_warning = "불입기록 자동등록 중 오류가 발생했습니다. '발생 및 불입 입력' 탭에서 직접 추가해주세요."

            result = {"settlement": settlement}
            if contrib_warning:
                result["contrib_warning"] = contrib_warning
            return self._send(201, result)
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def do_DELETE(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            settlement_id = qs.get("id", [None])[0]
            if not settlement_id:
                return self._send(400, {"error": "id는 필수입니다"})

            existing = rest_request("GET", f"pension_settlements?id=eq.{settlement_id}&select=employee_id")

            # 이 정산 건에서 자동 등록됐던 불입기록도 같이 삭제 (마감된 연도면 건너뛰고 안내)
            linked = rest_request(
                "GET", f"pension_contributions?settlement_id=eq.{settlement_id}&select=id,contribution_date"
            ) or []
            skipped_locked = []
            for c in linked:
                year = c["contribution_date"][:4] if c.get("contribution_date") else None
                if year and is_period_locked(year):
                    skipped_locked.append(year)
                    continue
                rest_request("DELETE", f"pension_contributions?id=eq.{c['id']}")

            rest_request("DELETE", f"pension_settlements?id=eq.{settlement_id}")

            # 되돌리기: 다른 확정 정산 기록이 더 없으면 재직 상태로 복구
            if existing:
                emp_id = existing[0]["employee_id"]
                remaining = rest_request("GET", f"pension_settlements?employee_id=eq.{emp_id}&select=id")
                if not remaining:
                    rest_request("PATCH", f"employees?id=eq.{emp_id}", body={
                        "status": "재직", "retire_date": None,
                    })

            result = {"ok": True}
            if skipped_locked:
                result["warning"] = f"{', '.join(sorted(set(skipped_locked)))}년이 마감되어 있어 연동된 불입기록은 삭제하지 못했습니다. 마감해제 후 직접 삭제해주세요."
            return self._send(200, result)
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
