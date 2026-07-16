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


def is_period_locked(period_key):
    rows = rest_request("GET", f"period_locks?module=eq.payroll&period_key=eq.{period_key}&select=locked") or []
    return bool(rows) and rows[0].get("locked", False)


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

            if qs.get("locks", ["0"])[0] == "1":
                locks = rest_request("GET", "period_locks?module=eq.payroll&select=*&order=period_key.desc")
                return self._send(200, {"locks": locks})

            if qs.get("retro_preview", ["0"])[0] == "1":
                from_month = qs.get("from_month", [None])[0]
                to_month = qs.get("to_month", [None])[0]
                if not from_month or not to_month:
                    return self._send(400, {"error": "from_month, to_month은 필수입니다"})
                employees = rest_request(
                    "GET", f"employees?status=eq.{quote('재직')}&select=id,name,branch,department,position&order=hire_date.asc"
                ) or []

                # from_month ~ to_month 사이의 월 목록 생성
                months = []
                y, m = int(from_month[:4]), int(from_month[5:7])
                ey, em = int(to_month[:4]), int(to_month[5:7])
                while (y, m) <= (ey, em):
                    months.append(f"{y:04d}-{m:02d}-01")
                    m += 1
                    if m > 12:
                        m = 1
                        y += 1

                results = []
                for emp in employees:
                    for mo in months:
                        diff = rpc("payroll_retroactive_diff_month", {"p_employee_id": emp["id"], "p_month": mo})
                        diff = diff or 0
                        if diff != 0:
                            results.append({**emp, "source_month": mo, "retroactive_diff": diff})
                return self._send(200, {"employees": results})

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

            # 마감/마감해제: {"type": "lock", period_key: "2026-07", locked: true/false, note}
            if isinstance(payload, dict) and payload.get("type") == "lock":
                period_key = payload.get("period_key")
                locked = payload.get("locked", True)
                if not period_key:
                    return self._send(400, {"error": "period_key는 필수입니다"})
                rest_request(
                    "POST", "period_locks",
                    body={"module": "payroll", "period_key": period_key, "locked": locked, "note": payload.get("note")},
                    prefer="resolution=merge-duplicates",
                )
                return self._send(200, {"ok": True})

            # 소급인상분 일괄 저장: {"type": "retroactive", target_month, items: [{employee_id, source_month, amount}]}
            if isinstance(payload, dict) and payload.get("type") == "retroactive":
                target_month = payload.get("target_month")
                items = payload.get("items") or []
                if not target_month or not items:
                    return self._send(400, {"error": "target_month, items는 필수입니다"})
                if is_period_locked(target_month[:7]):
                    return self._send(423, {"error": f"{target_month[:7]}은(는) 마감되어 있습니다. 먼저 마감해제해주세요."})

                # 직원별 합계 (여러 달치가 한 target_month로 합산됨)
                totals_by_employee = {}
                for it in items:
                    emp_id = it.get("employee_id")
                    source_month = it.get("source_month")
                    amount = it.get("amount")
                    if not emp_id or not source_month or amount is None:
                        continue
                    totals_by_employee[emp_id] = totals_by_employee.get(emp_id, 0) + amount
                    # 장부에 기록 (다음번 소급 계산 시 중복 방지용)
                    rest_request("POST", "payroll_retroactive_log", body={
                        "employee_id": emp_id,
                        "source_month": source_month,
                        "amount": amount,
                        "target_month": target_month,
                    })

                count = 0
                for emp_id, add_amount in totals_by_employee.items():
                    existing = rest_request(
                        "GET", f"monthly_payroll?employee_id=eq.{emp_id}&year_month=eq.{target_month}&select=id,retroactive_adjustment"
                    )
                    if existing:
                        new_total = (existing[0].get("retroactive_adjustment") or 0) + add_amount
                        rest_request(
                            "PATCH",
                            f"monthly_payroll?employee_id=eq.{emp_id}&year_month=eq.{target_month}",
                            body={"retroactive_adjustment": new_total},
                        )
                    else:
                        calc = rpc("payroll_calc_base", {"p_employee_id": emp_id, "p_year_month": target_month})
                        row = calc[0] if calc else {
                            "base_pay": 0, "fixed_overtime_pay": 0,
                            "attendance_allowance": 0, "meal_allowance": 0, "total_pay": 0,
                        }
                        rest_request("POST", "monthly_payroll", body={
                            "employee_id": emp_id,
                            "year_month": target_month,
                            "base_pay": row["base_pay"],
                            "fixed_overtime_pay": row["fixed_overtime_pay"],
                            "attendance_allowance": row["attendance_allowance"],
                            "meal_allowance": row["meal_allowance"],
                            "total_pay": row["total_pay"],
                            "retroactive_adjustment": add_amount,
                            "calc_note": "소급인상분 반영",
                        })
                    count += 1
                return self._send(200, {"count": count})

            year_month = payload.get("year_month")
            if not year_month:
                return self._send(400, {"error": "year_month는 필수입니다"})
            if is_period_locked(year_month[:7]):
                return self._send(423, {"error": f"{year_month[:7]}은(는) 마감되어 있습니다. 먼저 마감해제해주세요."})

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
