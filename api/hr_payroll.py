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
import datetime
import traceback
import urllib.request
import urllib.parse
import urllib.error
from concurrent.futures import ThreadPoolExecutor
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

    def _fetch_settings_map(self):
        try:
            rows = rest_request("POST", "rpc/employees_current_employment_types", body={}) or []
            return {r["employee_id"]: r for r in rows}
        except SupabaseError:
            return {}

    def _get_salary_increase_report(self, year):
        # 성과급보고서(_get_bonus_report)와 같은 구조 — 전전년도/전년도 연봉+성과급(1,2차 합)은
        # 매번 실시간 조회(salary_history/other_payments), "결정"만 별도 테이블(salary_increase_reports)에 저장.
        y1, y2 = year - 1, year - 2

        with ThreadPoolExecutor(max_workers=5) as pool:
            employees_future = pool.submit(
                rest_request, "GET",
                "employees?status=eq.재직&select=id,name,branch,department,position,hire_date&order=hire_date.asc",
            )
            salary_future = pool.submit(
                rest_request, "GET",
                "salary_history?select=employee_id,effective_month,annual_salary_thousand&order=effective_month.asc",
            )
            # 연봉인상보고서는 전전년도/전년도 모두 "성과급 1차+2차 합계"가 필요함 —
            # 성과급보고서는 차수(1차 또는 2차) 하나만 보므로 payment_type을 특정 차수로 필터링했지만,
            # 여기서는 "성과급1차"/"성과급2차" 둘 다(like 검색) 가져와서 연도별로 합산함.
            bonus_future = pool.submit(
                rest_request, "GET",
                "other_payments?payment_type=like.성과급*차&select=employee_id,payment_date,amount",
            )
            decided_future = pool.submit(
                rest_request, "GET", f"salary_increase_reports?year=eq.{year}&select=*",
            )
            locked_future = pool.submit(is_period_locked, f"salary-increase-{year}")

            employees = employees_future.result() or []
            salary_rows = salary_future.result() or []
            bonus_rows = bonus_future.result() or []
            decided_rows = decided_future.result() or []
            locked = locked_future.result()

        salary_by_emp_year = {}
        for r in salary_rows:
            emp_id = r.get("employee_id")
            month = r.get("effective_month")
            if not emp_id or not month:
                continue
            yr = int(str(month)[:4])
            salary_by_emp_year[(emp_id, yr)] = r["annual_salary_thousand"]  # asc 정렬이라 마지막 값이 남음

        bonus_by_emp_year = {}
        for r in bonus_rows:
            emp_id = r.get("employee_id")
            pdate = r.get("payment_date")
            if not emp_id or not pdate:
                continue
            yr = int(str(pdate)[:4])
            key = (emp_id, yr)
            bonus_by_emp_year[key] = bonus_by_emp_year.get(key, 0) + (r.get("amount") or 0)

        decided_by_emp = {r["employee_id"]: r for r in decided_rows}

        def monthly(annual_thousand):
            return round(annual_thousand * 1000 / 12) if annual_thousand else None

        result = []
        for idx, emp in enumerate(employees, start=1):
            eid = emp["id"]
            decided = decided_by_emp.get(eid)
            salary_y2 = salary_by_emp_year.get((eid, y2))
            salary_y1 = salary_by_emp_year.get((eid, y1))
            salary_now = salary_by_emp_year.get((eid, year)) or salary_y1
            decided_salary = decided.get("decided_salary_thousand") if decided else None
            # 결정연봉의 인상액/인상률은 "당해년도 현재급여"(연봉인상 검토 시점 기준) 대비로 계산합니다.
            # (전년도 대비 인상률은 참고용 이력 칸(y1_increase_*)에 이미 별도로 있음 — 그건 그대로 전년도 기준 유지)
            increase_amount = (decided_salary - salary_now) if (decided_salary is not None and salary_now) else None
            increase_rate = (increase_amount / salary_now) if (increase_amount is not None and salary_now) else None
            # 전년도(y1) 자료 자체에도, 그 전해(y2) 대비 인상액/인상률을 참고용으로 같이 보여줌
            y1_increase_amount = (salary_y1 - salary_y2) if (salary_y1 and salary_y2) else None
            y1_increase_rate = (y1_increase_amount / salary_y2) if (y1_increase_amount is not None and salary_y2) else None
            result.append({
                "seq": idx,
                "employee_id": eid,
                "name": emp.get("name"), "branch": emp.get("branch"),
                "department": emp.get("department"), "position": emp.get("position"),
                "hire_date": emp.get("hire_date"),
                "salary_y2": salary_y2, "monthly_y2": monthly(salary_y2),
                "bonus_y2": bonus_by_emp_year.get((eid, y2), 0),
                "salary_y1": salary_y1, "monthly_y1": monthly(salary_y1),
                "bonus_y1": bonus_by_emp_year.get((eid, y1), 0),
                "y1_increase_amount": y1_increase_amount,
                "y1_increase_rate": y1_increase_rate,
                "salary_now": salary_now, "monthly_now": monthly(salary_now),
                "decided_salary": decided_salary,
                "applied_month": decided.get("applied_month") if decided else None,
                "increase_amount": increase_amount,
                "increase_rate": increase_rate,
                "note": decided.get("note") if decided else None,
            })

        return self._send(200, {
            "year": year, "y1": y1, "y2": y2,
            "locked": locked, "employees": result,
        })

    def do_GET(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            year_month = qs.get("year_month", [None])[0]

            if qs.get("locks", ["0"])[0] == "1":
                locks = rest_request("GET", "period_locks?module=eq.payroll&select=*&order=period_key.desc")
                return self._send(200, {"locks": locks})

            if qs.get("salary_increase_report", ["0"])[0] == "1":
                year = qs.get("year", [None])[0]
                if not year:
                    return self._send(400, {"error": "year는 필수입니다"})
                return self._get_salary_increase_report(int(year))

            if qs.get("contract_data", ["0"])[0] == "1":
                year = qs.get("year", [None])[0]
                if not year:
                    return self._send(400, {"error": "year는 필수입니다"})
                year = int(year)
                jan1 = f"{year}-01-01"

                employees = rest_request(
                    "GET",
                    f"employees?hire_date=lte.{year}-12-31&or=(retire_date.is.null,retire_date.gte.{year}-01-01)"
                    f"&select=id,name,hire_date&order=hire_date.asc,name.asc",
                ) or []

                def contract_terms_one(emp):
                    terms = rpc("payroll_contract_terms", {"p_employee_id": emp["id"], "p_year": year})
                    t = terms[0] if terms else None
                    if not t or not t.get("annual_salary"):
                        return None
                    hire_date = emp.get("hire_date")
                    is_mid_year_hire = bool(hire_date and hire_date > jan1)
                    contract_start_date = hire_date if is_mid_year_hire else jan1
                    return {
                        "name": emp["name"],
                        "position": t.get("emp_position") or "",
                        "branch": t.get("branch") or "",
                        "contract_year": year,
                        "contract_start_date": contract_start_date,
                        "is_mid_year_hire": is_mid_year_hire,
                        "annual_salary": t["annual_salary"],
                        "monthly_salary": t["monthly_salary"],
                        "base_pay": t["base_pay"],
                        "overtime_pay": t["overtime_pay"],
                        "attendance": t["attendance_allowance"],
                        "meal": t["meal_allowance"],
                        "fixed_overtime_hours_raw": t["fixed_overtime_hours_raw"],
                        "is_probation": t.get("is_probation"),
                        "probation_amount": t.get("probation_monthly_amount"),
                    }

                # 직원마다 순서대로 RPC 부르던 걸 병렬로 바꿈(직원 수만큼 왕복하던 게 1건 수준으로 줄어듦).
                # pool.map은 입력 순서를 그대로 보존하므로 정렬(hire_date asc)은 그대로 유지됨.
                with ThreadPoolExecutor(max_workers=8) as pool:
                    rows = [r for r in pool.map(contract_terms_one, employees) if r is not None]

                return self._send(200, {"year": year, "employees": rows})

            if qs.get("annual_summary_all", ["0"])[0] == "1":
                year = qs.get("year", [None])[0]
                if not year:
                    return self._send(400, {"error": "year는 필수입니다"})

                employees = rest_request(
                    "GET",
                    f"employees?hire_date=lte.{year}-12-31&or=(retire_date.is.null,retire_date.gte.{year}-01-01)"
                    f"&select=id,name,branch,department,position&order=hire_date.asc,name.asc",
                ) or []

                payroll_rows = rest_request(
                    "GET",
                    f"monthly_payroll?year_month=gte.{year}-01-01&year_month=lte.{year}-12-31"
                    f"&select=employee_id,total_pay,retroactive_adjustment",
                ) or []
                payroll_by_emp = {}
                for r in payroll_rows:
                    e = payroll_by_emp.setdefault(r["employee_id"], {"monthly_total": 0})
                    e["monthly_total"] += (r.get("total_pay") or 0) + (r.get("retroactive_adjustment") or 0)

                other_rows = rest_request(
                    "GET",
                    f"other_payments?payment_date=gte.{year}-01-01&payment_date=lte.{year}-12-31"
                    f"&select=employee_id,payment_type,amount",
                ) or []
                PAYMENT_TYPES = ["성과급1차", "성과급2차", "상여금", "기타수당", "연차수당"]
                other_by_emp = {}
                for r in other_rows:
                    e = other_by_emp.setdefault(r["employee_id"], {t: 0 for t in PAYMENT_TYPES})
                    ptype = r["payment_type"] if r["payment_type"] in PAYMENT_TYPES else "기타수당"
                    e[ptype] = e.get(ptype, 0) + (r["amount"] or 0)

                rows = []
                totals = {"monthly_total": 0, "grand_total": 0}
                for t in PAYMENT_TYPES:
                    totals[t] = 0

                for emp in employees:
                    p = payroll_by_emp.get(emp["id"], {"monthly_total": 0})
                    o = other_by_emp.get(emp["id"], {t: 0 for t in PAYMENT_TYPES})
                    monthly_total = p["monthly_total"]
                    other_sum = sum(o.values())
                    grand_total = monthly_total + other_sum
                    row = {**emp, "monthly_total": monthly_total, "grand_total": grand_total}
                    row.update(o)
                    rows.append(row)

                    totals["monthly_total"] += monthly_total
                    totals["grand_total"] += grand_total
                    for t in PAYMENT_TYPES:
                        totals[t] += o.get(t, 0)

                return self._send(200, {"year": int(year), "employees": rows, "totals": totals})

            if qs.get("annual_summary", ["0"])[0] == "1":
                emp_id = qs.get("employee_id", [None])[0]
                year = qs.get("year", [None])[0]
                if not emp_id or not year:
                    return self._send(400, {"error": "employee_id, year는 필수입니다"})

                emp = rest_request("GET", f"employees?id=eq.{emp_id}&select=id,name,branch,department,position")
                if not emp:
                    return self._send(404, {"error": "직원을 찾을 수 없습니다"})

                payroll_rows = rest_request(
                    "GET",
                    f"monthly_payroll?employee_id=eq.{emp_id}&year_month=gte.{year}-01-01&year_month=lte.{year}-12-31"
                    f"&select=year_month,base_pay,fixed_overtime_pay,attendance_allowance,meal_allowance,total_pay,retroactive_adjustment"
                    f"&order=year_month.asc",
                ) or []
                payroll_by_month = {r["year_month"][:7]: r for r in payroll_rows}

                other_rows = rest_request(
                    "GET",
                    f"other_payments?employee_id=eq.{emp_id}&payment_date=gte.{year}-01-01&payment_date=lte.{year}-12-31"
                    f"&select=payment_date,payment_type,amount",
                ) or []

                PAYMENT_TYPES = ["성과급1차", "성과급2차", "상여금", "기타수당", "연차수당"]
                other_by_month = {}
                for r in other_rows:
                    mo = r["payment_date"][:7]
                    other_by_month.setdefault(mo, {t: 0 for t in PAYMENT_TYPES})
                    ptype = r["payment_type"] if r["payment_type"] in PAYMENT_TYPES else "기타수당"
                    other_by_month[mo][ptype] = other_by_month[mo].get(ptype, 0) + (r["amount"] or 0)

                months = []
                totals = {"base_pay": 0, "fixed_overtime_pay": 0, "attendance_allowance": 0, "meal_allowance": 0,
                          "monthly_total": 0, "retroactive_adjustment": 0, "grand_total": 0}
                for t in PAYMENT_TYPES:
                    totals[t] = 0

                for m in range(1, 13):
                    mo_key = f"{year}-{m:02d}"
                    p = payroll_by_month.get(mo_key)
                    o = other_by_month.get(mo_key, {t: 0 for t in PAYMENT_TYPES})
                    base_pay = p["base_pay"] if p else 0
                    fixed_overtime_pay = p["fixed_overtime_pay"] if p else 0
                    attendance_allowance = p["attendance_allowance"] if p else 0
                    meal_allowance = p["meal_allowance"] if p else 0
                    retro = (p.get("retroactive_adjustment") or 0) if p else 0
                    monthly_total = (p["total_pay"] if p else 0) + retro
                    other_sum = sum(o.values())
                    grand_total = monthly_total + other_sum

                    row = {
                        "month": mo_key,
                        "has_payroll_data": p is not None,
                        "base_pay": base_pay,
                        "fixed_overtime_pay": fixed_overtime_pay,
                        "attendance_allowance": attendance_allowance,
                        "meal_allowance": meal_allowance,
                        "retroactive_adjustment": retro,
                        "monthly_total": monthly_total,
                        "grand_total": grand_total,
                    }
                    row.update(o)
                    months.append(row)

                    totals["base_pay"] += base_pay
                    totals["fixed_overtime_pay"] += fixed_overtime_pay
                    totals["attendance_allowance"] += attendance_allowance
                    totals["meal_allowance"] += meal_allowance
                    totals["retroactive_adjustment"] += retro
                    totals["monthly_total"] += monthly_total
                    totals["grand_total"] += grand_total
                    for t in PAYMENT_TYPES:
                        totals[t] += o.get(t, 0)

                return self._send(200, {"employee": emp[0], "year": int(year), "months": months, "totals": totals})

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
                    "GET", f"employees?status=eq.{quote('재직')}&select=id,name,branch,department,position&order=hire_date.asc,name.asc"
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

                def diff_one(pair):
                    emp, mo = pair
                    diff = rpc("payroll_retroactive_diff_month", {"p_employee_id": emp["id"], "p_month": mo}) or 0
                    return (emp, mo, diff) if diff != 0 else None

                # 직원 x 월 조합마다 순서대로 RPC 부르던 걸 병렬로 바꿈
                # (직원 30명 x 6개월이면 예전엔 왕복 180번이 순서대로 걸렸음)
                pairs = [(emp, mo) for emp in employees for mo in months]
                with ThreadPoolExecutor(max_workers=8) as pool:
                    computed = list(pool.map(diff_one, pairs))
                results = [
                    {**emp, "source_month": mo, "retroactive_diff": diff}
                    for item in computed if item is not None
                    for emp, mo, diff in [item]
                ]
                return self._send(200, {"employees": results})

            if qs.get("leave_adjustments", ["0"])[0] == "1":
                emp_id = qs.get("employee_id", [None])[0]
                filt = f"employee_id=eq.{emp_id}&" if emp_id else ""
                items = rest_request(
                    "GET", f"leave_adjustments?{filt}select=*,employees(name,branch,department)&order=start_date.desc"
                )
                return self._send(200, {"adjustments": items})

            if qs.get("current_settings", ["0"])[0] == "1":
                emp_id = qs.get("employee_id", [None])[0]
                if not emp_id:
                    return self._send(400, {"error": "employee_id는 필수입니다"})
                rows = rest_request(
                    "GET",
                    f"payroll_settings_history?employee_id=eq.{emp_id}&select=*&order=effective_month.desc&limit=1",
                )
                return self._send(200, {"settings": rows[0] if rows else None})

            if qs.get("settings_history", ["0"])[0] == "1":
                emp_id = qs.get("employee_id", [None])[0]
                if not emp_id:
                    return self._send(400, {"error": "employee_id는 필수입니다"})
                rows = rest_request(
                    "GET",
                    f"payroll_settings_history?employee_id=eq.{emp_id}&select=*&order=effective_month.desc",
                )
                return self._send(200, {"settings_history": rows})

            if not year_month:
                return self._send(400, {"error": "year_month는 필수입니다 (예: 2026-07-01)"})

            if qs.get("saved", ["0"])[0] == "1":
                data = rest_request(
                    "GET",
                    f"monthly_payroll?year_month=eq.{year_month}&select=*,employees(name,branch,department,position,hire_date)&order=created_at",
                ) or []
                settings_map = self._fetch_settings_map()
                for row in data:
                    info = settings_map.get(row.get("employee_id"))
                    row["current_settings"] = info
                return self._send(200, {"payroll": data})

            employees = rest_request(
                "GET",
                f"employees?hire_date=lte.{month_end_of(year_month)}&or=(retire_date.is.null,retire_date.gte.{year_month})"
                f"&select=id,name,branch,department,position&order=hire_date.asc,name.asc"
            ) or []

            settings_map = self._fetch_settings_map()

            # 직원마다 순서대로 RPC를 2번씩(급여계산+최저임금체크) 호출하던 걸 병렬로 바꿈 —
            # 직원이 36명이면 예전엔 왕복 72번이 순서대로 걸렸는데, 이제 가장 느린 1건 수준으로 줄어듦.
            def calc_one(emp):
                calc = rpc("payroll_calc_prorated", {"p_employee_id": emp["id"], "p_year_month": year_month})
                row = calc[0] if calc else {
                    "base_pay": 0, "fixed_overtime_pay": 0,
                    "attendance_allowance": 0, "meal_allowance": 0, "total_pay": 0, "adjustment_note": None,
                }
                mw = rpc("payroll_min_wage_status", {"p_employee_id": emp["id"], "p_year_month": year_month})
                if mw and mw[0].get("is_floored"):
                    existing_note = row.get("adjustment_note")
                    row["adjustment_note"] = (existing_note + " / " if existing_note else "") + mw[0]["note"]
                row["current_settings"] = settings_map.get(emp["id"])
                return {**emp, **row}

            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(calc_one, employees))

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

            # 연봉인상보고서 초안 저장: {"type": "salary_increase_save", "year": 2027, "items": [{employee_id, decided_salary, applied_month, note}, ...]}
            if isinstance(payload, dict) and payload.get("type") == "salary_increase_save":
                year = payload.get("year")
                items = payload.get("items") or []
                if not year:
                    return self._send(400, {"error": "year는 필수입니다"})
                if is_period_locked(f"salary-increase-{year}"):
                    return self._send(423, {"error": f"{year}년 연봉인상보고서는 이미 마감되어 있습니다. 먼저 마감해제해주세요."})
                body = []
                for it in items:
                    if not it.get("employee_id"):
                        continue
                    body.append({
                        "employee_id": it["employee_id"],
                        "year": year,
                        "decided_salary_thousand": it.get("decided_salary"),
                        "applied_month": it.get("applied_month"),
                        "note": it.get("note"),
                        "updated_at": "now()",
                    })
                if not body:
                    return self._send(400, {"error": "저장할 항목이 없습니다"})
                rest_request(
                    "POST", "salary_increase_reports?on_conflict=employee_id,year",
                    body=body, prefer="resolution=merge-duplicates",
                )
                return self._send(200, {"ok": True, "count": len(body)})

            # 연봉인상 확정 시 소급분 미리보기: {"type": "salary_increase_retro_preview", "year": 2027}
            # 결정연봉+적용월이 둘 다 입력된 직원마다, 적용월부터 이번달까지 이미 처리된 급여와
            # (새 연봉 기준으로 다시 계산했을 때의) 차액을 계산해서 보여줌. 아무것도 저장하지 않음.
            if isinstance(payload, dict) and payload.get("type") == "salary_increase_retro_preview":
                year = payload.get("year")
                if not year:
                    return self._send(400, {"error": "year는 필수입니다"})
                rows = rest_request(
                    "GET", f"salary_increase_reports?year=eq.{year}&decided_salary_thousand=not.is.null"
                    f"&applied_month=not.is.null&select=*,employees(name)"
                ) or []
                if not rows:
                    return self._send(200, {"items": [], "total": 0})

                this_month_str = datetime.date.today().replace(day=1).isoformat()

                def preview_one(row):
                    emp_id = row["employee_id"]
                    applied = row["applied_month"][:10]
                    # 새 함수 하나로 "임시로 새 연봉 넣고 계산 → 계산 끝나면 원상복구"까지 안전하게 처리됨
                    diff_rows = rpc("salary_increase_preview_diffs", {
                        "p_employee_id": emp_id,
                        "p_new_salary_thousand": row["decided_salary_thousand"],
                        "p_applied_month": applied,
                        "p_through_month": this_month_str,
                    }) or []
                    diffs = [{"source_month": d["source_month"], "amount": d["amount"]} for d in diff_rows]
                    return {
                        "employee_id": emp_id,
                        "name": (row.get("employees") or {}).get("name"),
                        "applied_month": applied,
                        "decided_salary": row["decided_salary_thousand"],
                        "months": diffs,
                        "subtotal": sum(d["amount"] for d in diffs),
                    }

                with ThreadPoolExecutor(max_workers=8) as pool:
                    items = list(pool.map(preview_one, rows))
                items = [it for it in items if it["months"]]  # 차액 없는 직원은 안 보여줌
                return self._send(200, {"items": items, "total": sum(it["subtotal"] for it in items)})

            # 연봉인상 확정 반영: {"type": "salary_increase_confirm_finalize", "year": 2027, "target_month": "2027-04-01"}
            # 미리보기를 사용자가 확인한 뒤 이 액션으로 실제 저장함 —
            #   1) salary_history에 새 연봉 행 추가(연봉인상보고서 연도 꼬리표 남김)
            #   2) 소급분을 target_month 급여에 합산 반영(payroll_retroactive_log에도 같은 꼬리표)
            #   3) 이 연도를 마감
            if isinstance(payload, dict) and payload.get("type") == "salary_increase_confirm_finalize":
                year = payload.get("year")
                target_month = payload.get("target_month")
                if not year or not target_month:
                    return self._send(400, {"error": "year, target_month은 필수입니다"})
                if is_period_locked(target_month[:7]):
                    return self._send(423, {"error": f"{target_month[:7]}은(는) 급여가 이미 마감되어 있습니다. 먼저 마감해제해주세요."})

                rows = rest_request(
                    "GET", f"salary_increase_reports?year=eq.{year}&decided_salary_thousand=not.is.null"
                    f"&applied_month=not.is.null&select=*"
                ) or []
                if not rows:
                    return self._send(400, {"error": "결정연봉+적용월이 입력된 직원이 없습니다"})

                this_month_str = datetime.date.today().replace(day=1).isoformat()

                def months_between(start, end):
                    result = []
                    y, m = int(start[:4]), int(start[5:7])
                    ey, em = int(end[:4]), int(end[5:7])
                    while (y, m) <= (ey, em):
                        result.append(f"{y:04d}-{m:02d}-01")
                        m += 1
                        if m > 12:
                            m = 1
                            y += 1
                    return result

                # 1) 직원마다 연봉이력 반영 (병렬) — 적용월에 이미 값이 있으면(예: 초기 데이터 이관)
                #    새로 추가하지 않고 고쳐씀(같은 날짜 중복 방지). 이때 원래 값을
                #    previous_salary_thousand에 남겨서 마감해제 시 되돌릴 수 있게 함.
                def add_salary_history(row):
                    applied = row["applied_month"][:10]
                    existing = rest_request(
                        "GET", f"salary_history?employee_id=eq.{row['employee_id']}"
                        f"&effective_month=eq.{applied}&select=id,annual_salary_thousand,reason"
                    )
                    if existing:
                        rest_request("PATCH", f"salary_history?id=eq.{existing[0]['id']}", body={
                            "annual_salary_thousand": row["decided_salary_thousand"],
                            "reason": f"{year}년 연봉인상보고서 확정",
                            "source_salary_increase_year": year,
                            "previous_salary_thousand": existing[0]["annual_salary_thousand"],
                            "previous_reason": existing[0].get("reason"),
                        })
                    else:
                        rest_request("POST", "salary_history", body={
                            "employee_id": row["employee_id"],
                            "effective_month": applied,
                            "annual_salary_thousand": row["decided_salary_thousand"],
                            "reason": f"{year}년 연봉인상보고서 확정",
                            "source_salary_increase_year": year,
                        })
                with ThreadPoolExecutor(max_workers=8) as pool:
                    list(pool.map(add_salary_history, rows))

                # 2) 새 연봉 기준으로 소급분 다시 계산 (연봉이력이 이미 반영된 뒤라 정확한 새 금액이 나옴)
                def calc_diffs(row):
                    emp_id = row["employee_id"]
                    applied = row["applied_month"][:10]
                    months = months_between(applied, this_month_str)
                    diffs = []
                    for mo in months:
                        diff = rpc("payroll_retroactive_diff_month", {"p_employee_id": emp_id, "p_month": mo}) or 0
                        if diff != 0:
                            diffs.append({"employee_id": emp_id, "source_month": mo, "amount": diff})
                    return diffs
                with ThreadPoolExecutor(max_workers=8) as pool:
                    diff_lists = list(pool.map(calc_diffs, rows))
                all_diffs = [d for sub in diff_lists for d in sub]

                # 3) 소급분을 target_month 급여에 합산 반영 (기존 "소급인상분 일괄 저장"과 동일한 방식)
                totals_by_employee = {}
                for d in all_diffs:
                    rest_request("POST", "payroll_retroactive_log", body={
                        "employee_id": d["employee_id"],
                        "source_month": d["source_month"],
                        "amount": d["amount"],
                        "target_month": target_month,
                        "source_salary_increase_year": year,
                    })
                    totals_by_employee[d["employee_id"]] = totals_by_employee.get(d["employee_id"], 0) + d["amount"]

                for emp_id, add_amount in totals_by_employee.items():
                    existing = rest_request(
                        "GET", f"monthly_payroll?employee_id=eq.{emp_id}&year_month=eq.{target_month}&select=id,retroactive_adjustment"
                    )
                    if existing:
                        new_total = (existing[0].get("retroactive_adjustment") or 0) + add_amount
                        rest_request(
                            "PATCH", f"monthly_payroll?employee_id=eq.{emp_id}&year_month=eq.{target_month}",
                            body={"retroactive_adjustment": new_total},
                        )
                    else:
                        calc = rpc("payroll_calc_prorated", {"p_employee_id": emp_id, "p_year_month": target_month})
                        calc_row = calc[0] if calc else {
                            "base_pay": 0, "fixed_overtime_pay": 0,
                            "attendance_allowance": 0, "meal_allowance": 0, "total_pay": 0, "adjustment_note": None,
                        }
                        rest_request("POST", "monthly_payroll", body={
                            "employee_id": emp_id, "year_month": target_month,
                            "base_pay": calc_row["base_pay"], "fixed_overtime_pay": calc_row["fixed_overtime_pay"],
                            "attendance_allowance": calc_row["attendance_allowance"], "meal_allowance": calc_row["meal_allowance"],
                            "total_pay": calc_row["total_pay"], "retroactive_adjustment": add_amount,
                            "adjustment_note": calc_row.get("adjustment_note"), "proration_note": calc_row.get("proration_note"),
                            "calc_note": f"{year}년 연봉인상보고서 소급분 반영",
                        })

                # 4) 마감
                rest_request(
                    "POST", "period_locks?on_conflict=module,period_key",
                    body={"module": "payroll", "period_key": f"salary-increase-{year}", "locked": True,
                          "note": f"{year}년 연봉인상보고서 확정 — 연봉이력 {len(rows)}건, 소급 {len(all_diffs)}건 반영"},
                    prefer="resolution=merge-duplicates",
                )
                return self._send(200, {"ok": True, "salary_history_count": len(rows), "retro_count": len(all_diffs)})

            # 연봉인상보고서 마감/마감해제: {"type": "salary_increase_lock", "year": 2027, "locked": true/false}
            # locked=false(마감해제)면, 이 보고서가 만들었던 연봉이력·소급기록을 전부 되돌린 뒤 잠금 해제함.
            if isinstance(payload, dict) and payload.get("type") == "salary_increase_lock":
                year = payload.get("year")
                locked = payload.get("locked", True)
                if not year:
                    return self._send(400, {"error": "year는 필수입니다"})

                if not locked:
                    # 이 보고서가 만든 소급기록부터 되돌림 (급여명세에서 빼고 장부 삭제)
                    tagged_logs = rest_request(
                        "GET", f"payroll_retroactive_log?source_salary_increase_year=eq.{year}&select=*"
                    ) or []
                    for log_entry in tagged_logs:
                        payroll_row = rest_request(
                            "GET", f"monthly_payroll?employee_id=eq.{log_entry['employee_id']}"
                            f"&year_month=eq.{log_entry['target_month']}&select=id,retroactive_adjustment"
                        )
                        if payroll_row:
                            new_amount = (payroll_row[0].get("retroactive_adjustment") or 0) - log_entry["amount"]
                            rest_request(
                                "PATCH", f"monthly_payroll?id=eq.{payroll_row[0]['id']}",
                                body={"retroactive_adjustment": new_amount},
                            )
                        rest_request("DELETE", f"payroll_retroactive_log?id=eq.{log_entry['id']}")

                    # 이 보고서가 만든 연봉이력 행 처리 — 원래 값을 고쳐썼던 행은 그 값으로 되돌리고
                    # (previous_salary_thousand가 있는 경우), 새로 추가했던 행은 통째로 삭제함.
                    tagged_salaries = rest_request(
                        "GET", f"salary_history?source_salary_increase_year=eq.{year}"
                        f"&select=id,previous_salary_thousand,previous_reason"
                    ) or []
                    for sal_row in tagged_salaries:
                        if sal_row.get("previous_salary_thousand") is not None:
                            rest_request("PATCH", f"salary_history?id=eq.{sal_row['id']}", body={
                                "annual_salary_thousand": sal_row["previous_salary_thousand"],
                                "reason": sal_row.get("previous_reason"),
                                "source_salary_increase_year": None,
                                "previous_salary_thousand": None,
                                "previous_reason": None,
                            })
                        else:
                            rest_request("DELETE", f"salary_history?id=eq.{sal_row['id']}")

                rest_request(
                    "POST", "period_locks?on_conflict=module,period_key",
                    body={"module": "payroll", "period_key": f"salary-increase-{year}", "locked": locked,
                          "note": f"{year}년 연봉인상보고서 확정" if locked else f"{year}년 연봉인상보고서 마감해제 — 반영분 되돌림"},
                    prefer="resolution=merge-duplicates",
                )
                return self._send(200, {"ok": True})

            # 수습요율 등 급여 설정 변경: {"type": "pay_rate", employee_id, effective_month, pay_rate, employment_type, contract_end_date, note}
            if isinstance(payload, dict) and payload.get("type") == "pay_rate":
                emp_id = payload.get("employee_id")
                effective_month = payload.get("effective_month")
                pay_rate = payload.get("pay_rate")
                if not emp_id or not effective_month or pay_rate is None:
                    return self._send(400, {"error": "employee_id, effective_month, pay_rate는 필수입니다"})

                existing = rest_request(
                    "GET",
                    f"payroll_settings_history?employee_id=eq.{emp_id}&select=*&order=effective_month.desc&limit=1",
                )
                base = existing[0] if existing else {
                    "standard_hours": 209, "fixed_overtime_hours": 0,
                    "attendance_allowance": 0, "meal_allowance": 0, "severance_included": False,
                }
                body = {
                    "employee_id": emp_id,
                    "effective_month": effective_month,
                    "standard_hours": base.get("standard_hours", 209),
                    "fixed_overtime_hours": base.get("fixed_overtime_hours", 0),
                    "attendance_allowance": base.get("attendance_allowance", 0),
                    "meal_allowance": base.get("meal_allowance", 0),
                    "severance_included": base.get("severance_included", False),
                    "employment_type": payload.get("employment_type") or base.get("employment_type"),
                    "pay_rate": pay_rate,
                    "note": payload.get("note"),
                }
                if payload.get("contract_end_date"):
                    body["contract_end_date"] = payload["contract_end_date"]
                if payload.get("fixed_monthly_amount") is not None:
                    body["fixed_monthly_amount"] = payload["fixed_monthly_amount"] or None
                if payload.get("proration_mode"):
                    body["proration_mode"] = payload["proration_mode"]
                created = rest_request("POST", "payroll_settings_history", body=body, prefer="return=representation")
                return self._send(201, {"settings": created[0] if created else None})

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
                    "POST", "period_locks?on_conflict=module,period_key",
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

            def calc_one_for_save(emp):
                calc = rpc("payroll_calc_prorated", {"p_employee_id": emp["id"], "p_year_month": year_month})
                row = calc[0] if calc else None
                if not row:
                    return None
                mw = rpc("payroll_min_wage_status", {"p_employee_id": emp["id"], "p_year_month": year_month})
                if mw and mw[0].get("is_floored"):
                    existing_note = row.get("adjustment_note")
                    row["adjustment_note"] = (existing_note + " / " if existing_note else "") + mw[0]["note"]
                return {
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
                }

            # 직원마다 순서대로 RPC 2번씩 부르던 걸 병렬로 바꿈(생성/저장 버튼 클릭 시 대기시간 단축)
            with ThreadPoolExecutor(max_workers=8) as pool:
                body = [r for r in pool.map(calc_one_for_save, employees) if r is not None]

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

            settings_id = qs.get("settings_id", [None])[0]
            if settings_id:
                rest_request("DELETE", f"payroll_settings_history?id=eq.{settings_id}")
                return self._send(200, {"ok": True})

            payroll_employee_id = qs.get("payroll_employee_id", [None])[0]
            payroll_month = qs.get("payroll_month", [None])[0]
            if payroll_employee_id and payroll_month:
                if is_period_locked(payroll_month[:7]):
                    return self._send(423, {"error": f"{payroll_month[:7]}은(는) 마감되어 있어 삭제할 수 없습니다. 먼저 마감해제해주세요."})
                rest_request(
                    "DELETE",
                    f"monthly_payroll?employee_id=eq.{payroll_employee_id}&year_month=eq.{payroll_month}",
                )
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
