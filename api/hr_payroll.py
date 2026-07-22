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


def month_end_of(year_month):
    y, m = int(year_month[:4]), int(year_month[5:7])
    if m == 12:
        ny, nm = y + 1, 1
    else:
        ny, nm = y, m + 1
    import datetime
    return (datetime.date(ny, nm, 1) - datetime.timedelta(days=1)).isoformat()


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
            year_month = qs.get("year_month", [None])[0]

            if qs.get("locks", ["0"])[0] == "1":
                locks = rest_request("GET", "period_locks?module=eq.payroll&select=*&order=period_key.desc")
                return self._send(200, {"locks": locks})

            if qs.get("retro_log", ["0"])[0] == "1":
                logs = rest_request(
                    "GET",
                    "payroll_retroactive_log?select=*,employees(name,branch,department)&order=created_at.desc",
                )
                return self._send(200, {"logs": logs})

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

            if qs.get("leave_adjustments", ["0"])[0] == "1":
                emp_id = qs.get("employee_id", [None])[0]
                filt = f"employee_id=eq.{emp_id}&" if emp_id else ""
                items = rest_request(
                    "GET", f"leave_adjustments?{filt}select=*,employees(name,branch,department)&order=start_date.desc"
                )
                return self._send(200, {"adjustments": items})

            if not year_month:
                return self._send(400, {"error": "year_month는 필수입니다 (예: 2026-07-01)"})

            if qs.get("saved", ["0"])[0] == "1":
                data = rest_request(
                    "GET",
                    f"monthly_payroll?year_month=eq.{year_month}&select=*,employees(name,branch,department,position,hire_date)&order=created_at",
                )
                return self._send(200, {"payroll": data})

            employees = rest_request(
                "GET",
                f"employees?hire_date=lte.{month_end_of(year_month)}&or=(retire_date.is.null,retire_date.gte.{year_month})"
                f"&select=id,name,branch,department,position&order=hire_date.asc"
            ) or []

            results = []
            for emp in employees:
                calc = rpc("payroll_calc_prorated", {"p_employee_id": emp["id"], "p_year_month": year_month})
                row = calc[0] if calc else {
                    "base_pay": 0, "fixed_overtime_pay": 0,
                    "attendance_allowance": 0, "meal_allowance": 0, "total_pay": 0, "adjustment_note": None,
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

            # 재직자 조정 추가: {"type": "leave_adjustment", employee_id, reason_type, start_date, end_date, standard_hours, reduced_hours, note}
            if isinstance(payload, dict) and payload.get("type") == "leave_adjustment":
                emp_id = payload.get("employee_id")
                reason_type = payload.get("reason_type")
                start_date = payload.get("start_date")
                end_date = payload.get("end_date")
                if not emp_id or not reason_type or not start_date or not end_date:
                    return self._send(400, {"error": "employee_id, reason_type, start_date, end_date는 필수입니다"})
                created = rest_request("POST", "leave_adjustments", body={
                    "employee_id": emp_id,
                    "reason_type": reason_type,
                    "start_date": start_date,
                    "end_date": end_date,
                    "standard_hours": payload.get("standard_hours"),
                    "reduced_hours": payload.get("reduced_hours"),
                    "note": payload.get("note"),
                }, prefer="return=representation")
                return self._send(201, {"adjustment": created[0] if created else None})

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
                        calc = rpc("payroll_calc_prorated", {"p_employee_id": emp_id, "p_year_month": target_month})
                        row = calc[0] if calc else {
                            "base_pay": 0, "fixed_overtime_pay": 0,
                            "attendance_allowance": 0, "meal_allowance": 0, "total_pay": 0, "adjustment_note": None,
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
                            "adjustment_note": row.get("adjustment_note"),
                            "proration_note": row.get("proration_note"),
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
                "GET",
                f"employees?hire_date=lte.{month_end_of(year_month)}&or=(retire_date.is.null,retire_date.gte.{year_month})"
                f"&select=id"
            ) or []

            body = []
            for emp in employees:
                calc = rpc("payroll_calc_prorated", {"p_employee_id": emp["id"], "p_year_month": year_month})
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
                    "adjustment_note": row.get("adjustment_note"),
                    "proration_note": row.get("proration_note"),
                    "base_pay_before": row.get("base_pay_before"),
                    "fixed_overtime_pay_before": row.get("fixed_overtime_pay_before"),
                    "attendance_allowance_before": row.get("attendance_allowance_before"),
                    "meal_allowance_before": row.get("meal_allowance_before"),
                    "total_pay_before": row.get("total_pay_before"),
                    "calc_formula": row.get("calc_formula"),
                    "calc_note": "1단계 기본계산 (정상 재직자 기준)"
                        + (" + 재직자 조정 반영" if row.get("adjustment_note") else "")
                        + (" + 일할계산 반영" if row.get("proration_note") else ""),
                })

            if not body:
                return self._send(400, {"error": "계산된 대상이 없습니다"})

            created = rest_request(
                "POST", "monthly_payroll?on_conflict=employee_id,year_month", body=body,
                prefer="return=representation,resolution=merge-duplicates",
            )
            return self._send(201, {"count": len(created) if created else 0})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _revert_one_log(self, log_entry):
        """단일 소급 기록 되돌리기. 마감된 달이면 (False, 사유) 반환, 성공하면 (True, None)."""
        if is_period_locked(log_entry["target_month"][:7]):
            return False, f"{log_entry['target_month'][:7]}(마감됨)"

        payroll_row = rest_request(
            "GET",
            f"monthly_payroll?employee_id=eq.{log_entry['employee_id']}&year_month=eq.{log_entry['target_month']}&select=id,retroactive_adjustment",
        )
        if payroll_row:
            new_amount = (payroll_row[0].get("retroactive_adjustment") or 0) - log_entry["amount"]
            rest_request(
                "PATCH",
                f"monthly_payroll?employee_id=eq.{log_entry['employee_id']}&year_month=eq.{log_entry['target_month']}",
                body={"retroactive_adjustment": new_amount},
            )
        rest_request("DELETE", f"payroll_retroactive_log?id=eq.{log_entry['id']}")
        return True, None

    def do_DELETE(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)

            leave_adj_id = qs.get("leave_adjustment_id", [None])[0]
            if leave_adj_id:
                rest_request("DELETE", f"leave_adjustments?id=eq.{leave_adj_id}")
                return self._send(200, {"ok": True})

            revert_employee_id = qs.get("revert_employee_id", [None])[0]
            revert_all = qs.get("revert_all", ["0"])[0] == "1"

            if revert_employee_id or revert_all:
                filt = f"employee_id=eq.{revert_employee_id}&" if revert_employee_id else ""
                logs = rest_request("GET", f"payroll_retroactive_log?{filt}select=*") or []
                if not logs:
                    return self._send(200, {"reverted": 0, "skipped": []})
                reverted = 0
                skipped = []
                for log_entry in logs:
                    ok, reason = self._revert_one_log(log_entry)
                    if ok:
                        reverted += 1
                    else:
                        skipped.append(reason)
                return self._send(200, {"reverted": reverted, "skipped": skipped})

            log_id = qs.get("retro_log_id", [None])[0]
            if not log_id:
                return self._send(400, {"error": "retro_log_id는 필수입니다"})

            existing = rest_request("GET", f"payroll_retroactive_log?id=eq.{log_id}&select=*")
            if not existing:
                return self._send(404, {"error": "해당 기록을 찾을 수 없습니다"})

            ok, reason = self._revert_one_log(existing[0])
            if not ok:
                return self._send(423, {"error": f"{reason} 상태라 먼저 마감해제해주세요."})
            return self._send(200, {"ok": True})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
