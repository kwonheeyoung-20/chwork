"""
/api/workspace

Vercel Hobby 플랜의 서버리스 함수 개수 제한(최대 12개) 때문에,
아래 4개 기능을 한 파일로 통합했습니다. 화면(schedule.js/dashboard.js/hr.js)의
호출 주소는 예전 그대로(/api/schedule, /api/contacts, /api/contract_docs,
/api/daily_todos) 두고, vercel.json의 routes 설정에서 각 주소를
"?resource=xxx" 파라미터를 붙여 이 파일 하나로 몰아줍니다.

- resource=schedule      -> 세무/업무 일정관리 (구 api/schedule.py)
- resource=contacts      -> 거래처 연락처 (구 api/contacts.py)
- resource=contractdocs  -> 계약/증빙 서류 관리 (구 api/contract_docs.py)
- resource=todos         -> 일자별 할일 메모 (구 api/daily_todos.py)

모든 요청에 X-HR-Password 헤더 필요.
"""
from http.server import BaseHTTPRequestHandler
import os
import re
import json
import uuid
import base64
import calendar
import traceback
import datetime
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs, quote

try:
    from korean_lunar_calendar import KoreanLunarCalendar
except ImportError:
    KoreanLunarCalendar = None


def solar_to_lunar(y, m, d):
    """양력 날짜 -> (음력년, 음력월, 음력일, 윤달여부). 변환 실패 시 None."""
    if KoreanLunarCalendar is None:
        return None
    try:
        cal = KoreanLunarCalendar()
        cal.setSolarDate(y, m, d)
        return cal.lunarYear, cal.lunarMonth, cal.lunarDay, cal.isIntercalation
    except Exception:
        return None


def lunar_to_solar(y, m, d, leap=False):
    """(음력년, 음력월, 음력일) -> 양력 날짜 문자열(YYYY-MM-DD). 변환 실패 시 None."""
    if KoreanLunarCalendar is None:
        return None
    try:
        cal = KoreanLunarCalendar()
        cal.setLunarDate(y, m, d, leap)
        return f"{cal.solarYear:04d}-{cal.solarMonth:02d}-{cal.solarDay:02d}"
    except Exception:
        return None


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")
FAMILY_PASSWORD = os.environ.get("FAMILY_PASSWORD", "")

# 가족용 비밀번호는 "개인 일정관리(personal)"와 "학교 시간표(timetable)"만 열 수 있음
FAMILY_ALLOWED_RESOURCES = {"personal", "timetable"}
CONTRACT_BUCKET = "contracts"


# ────────────────────────────────────────────────────────────
# 공통 유틸 (4개 파일 공통으로 쓰던 것들)
# ────────────────────────────────────────────────────────────
class SupabaseError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"Supabase error {status}: {body}")


def _sb_headers(prefer=None, content_type="application/json"):
    h = {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "Content-Type": content_type,
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
        with urllib.request.urlopen(req, timeout=15) as resp:
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


def auth_role(candidate: str) -> str:
    """비밀번호로 role 판별: 'admin' | 'family' | None(불일치)"""
    if HR_PASSWORD and candidate == HR_PASSWORD:
        return "admin"
    if FAMILY_PASSWORD and candidate == FAMILY_PASSWORD:
        return "family"
    return None


def rpc(fn_name, params):
    return rest_request("POST", f"rpc/{fn_name}", body=params)


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-HR-Password",
        "Content-Type": "application/json",
    }


# ────────────────────────────────────────────────────────────
# schedule 전용 유틸
# ────────────────────────────────────────────────────────────
def _ensure_occurrences_generated():
    try:
        rpc("generate_schedule_occurrences", {})
    except SupabaseError:
        pass


# ────────────────────────────────────────────────────────────
# contractdocs 전용 유틸 (Supabase Storage)
# ────────────────────────────────────────────────────────────
def storage_upload(path, data_bytes, content_type):
    url = f"{SUPABASE_URL}/storage/v1/object/{CONTRACT_BUCKET}/{quote(path)}"
    req = urllib.request.Request(url, data=data_bytes, method="POST", headers={
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "apikey": SUPABASE_SECRET_KEY,
        "Content-Type": content_type or "application/octet-stream",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SupabaseError(e.code, e.read().decode("utf-8", "ignore"))
    except urllib.error.URLError as e:
        raise SupabaseError(0, f"파일 업로드 연결 실패: {e.reason}")


def storage_delete(path):
    url = f"{SUPABASE_URL}/storage/v1/object/{CONTRACT_BUCKET}/{quote(path)}"
    req = urllib.request.Request(url, method="DELETE", headers={
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "apikey": SUPABASE_SECRET_KEY,
    })
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError:
        pass
    except urllib.error.URLError:
        pass


def storage_sign_url(path, expires_in=3600):
    if not path:
        return None
    url = f"{SUPABASE_URL}/storage/v1/object/sign/{CONTRACT_BUCKET}/{quote(path)}"
    body = json.dumps({"expiresIn": expires_in}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "apikey": SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
        signed_path = result.get("signedURL", "")
        return f"{SUPABASE_URL}/storage/v1{signed_path}" if signed_path else None
    except Exception:
        return None


def safe_filename(name: str) -> str:
    """저장소 경로(키)용 이름 생성. Supabase Storage는 키에 한글 등 비-ASCII
    문자가 들어가면 'InvalidKey' 오류를 내므로, 경로는 순수 영문/숫자
    조합(UUID+확장자)만 쓰고, 원래 파일명(한글 포함)은 DB의 file_name
    컬럼에 별도로 저장해서 화면 표시·다운로드에 사용합니다."""
    name = name or "file"
    ext = ""
    if "." in name:
        raw_ext = name.rsplit(".", 1)[-1]
        ext = "." + re.sub(r"[^A-Za-z0-9]", "", raw_ext)[:10]
    return f"{uuid.uuid4()}{ext}"


# ────────────────────────────────────────────────────────────
# promotions 전용 유틸 — 근속년수(N년M월D일) 계산
# ────────────────────────────────────────────────────────────
def _calc_tenure(start, end):
    if not start or not end or end < start:
        return (0, 0, 0)
    years = end.year - start.year
    months = end.month - start.month
    days = end.day - start.day
    if days < 0:
        months -= 1
        prev_month = end.month - 1
        prev_year = end.year
        if prev_month == 0:
            prev_month = 12
            prev_year -= 1
        days += calendar.monthrange(prev_year, prev_month)[1]
    if months < 0:
        years -= 1
        months += 12
    return (years, months, days)


def _format_tenure(t):
    if t is None:
        return None
    return f"{t[0]}년{t[1]}월{t[2]}일"


# ════════════════════════════════════════════════════════════
# 메인 핸들러
# ════════════════════════════════════════════════════════════
class handler(BaseHTTPRequestHandler):
    def _authorized(self, qs=None):
        """role을 확인하고, family 계정이면 personal/timetable 외 접근을 차단"""
        role = auth_role(self.headers.get("X-HR-Password", ""))
        if role is None:
            return False
        if role == "family":
            resource = self._resource(qs) if qs is not None else None
            if resource not in FAMILY_ALLOWED_RESOURCES:
                return False
        return True

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

    def _resource(self, qs):
        return (qs.get("resource", [None])[0] or "").strip()

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw or b"{}")

    # ────────────────────────────────────────────────────────
    # GET
    # ────────────────────────────────────────────────────────
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)

            if resource == "schedule":
                return self._get_schedule(qs)
            if resource == "contacts":
                return self._get_contacts(qs)
            if resource == "contractdocs":
                return self._get_contractdocs(qs)
            if resource == "todos":
                return self._get_todos(qs)
            if resource == "promotions":
                return self._get_promotions(qs)
            if resource == "annualleave":
                return self._get_annualleave(qs)
            if resource == "personal":
                return self._get_personal(qs)
            if resource == "timetable":
                return self._get_timetable(qs)
            return self._send(400, {"error": "알 수 없는 resource입니다"})

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _get_schedule(self, qs):
        _ensure_occurrences_generated()

        if qs.get("tasks", ["0"])[0] == "1":
            tasks = rest_request(
                "GET", "tax_schedule_tasks?select=*&order=active.desc,category.asc,anchor_date.asc"
            )
            return self._send(200, {"tasks": tasks})

        if qs.get("upcoming", ["0"])[0] == "1":
            today = datetime.date.today()
            days_override = qs.get("days", [None])[0]
            lookahead = int(days_override) if days_override else 60
            horizon = (today + datetime.timedelta(days=lookahead)).isoformat()
            rows = rest_request(
                "GET",
                "tax_schedule_occurrences?status=eq.pending&due_date=lte." + horizon
                + "&select=*,tax_schedule_tasks(title,category,reminder_days_before,note)&order=due_date.asc",
            )
            result = []
            for r in rows or []:
                due = datetime.date.fromisoformat(r["due_date"])
                task = r.get("tax_schedule_tasks") or {}
                reminder_days = task.get("reminder_days_before") or 5
                days_left = (due - today).days
                include = days_left <= lookahead if days_override else (days_left < 0 or days_left <= reminder_days)
                if include:
                    result.append({
                        "occurrence_id": r["id"],
                        "task_id": r["task_id"],
                        "due_date": r["due_date"],
                        "days_left": days_left,
                        "title": task.get("title"),
                        "category": task.get("category"),
                        "note": task.get("note"),
                    })
            return self._send(200, {"upcoming": result})

        today = datetime.date.today()
        default_from = (today.replace(day=1) - datetime.timedelta(days=31)).replace(day=1).isoformat()
        default_to = (today + datetime.timedelta(days=90)).isoformat()
        from_date = qs.get("from", [None])[0] or default_from
        to_date = qs.get("to", [None])[0] or default_to
        status_filter = qs.get("status", [None])[0]

        path = (
            "tax_schedule_occurrences?due_date=gte." + from_date
            + "&due_date=lte." + to_date
            + "&select=*,tax_schedule_tasks(title,category,recurrence_type,interval_value,note,reminder_days_before)"
            + "&order=due_date.asc"
        )
        if status_filter and status_filter != "all":
            path += "&status=eq." + status_filter
        rows = rest_request("GET", path)
        return self._send(200, {"occurrences": rows})

    def _get_contacts(self, qs):
        rows = rest_request("GET", "vendor_contacts?select=*&order=category.asc,company_name.asc")
        return self._send(200, {"contacts": rows})

    def _get_contractdocs(self, qs):
        if qs.get("history", ["0"])[0] == "1":
            doc_id = qs.get("id", [None])[0]
            if not doc_id:
                return self._send(400, {"error": "id는 필수입니다"})
            rows = rest_request(
                "GET", f"contract_renewals?document_id=eq.{doc_id}&select=*&order=created_at.desc"
            )
            return self._send(200, {"renewals": rows})

        if qs.get("upcoming", ["0"])[0] == "1":
            today = datetime.date.today()
            rows = rest_request(
                "GET",
                "contract_documents?alert_dismissed=eq.false&contract_end_date=not.is.null"
                "&terminated_date=is.null&doc_group=neq.reference&select=*&order=contract_end_date.asc",
            ) or []
            result = []
            for r in rows:
                if not r.get("contract_end_date"):
                    continue
                end = datetime.date.fromisoformat(r["contract_end_date"])
                days_left = (end - today).days
                reminder_days = r.get("reminder_days_before") or 14
                if days_left < 0 or days_left <= reminder_days:
                    result.append({
                        "id": r["id"],
                        "doc_type": r.get("doc_type"),
                        "vendor_name": r.get("vendor_name"),
                        "contract_title": r.get("contract_title"),
                        "contract_end_date": r["contract_end_date"],
                        "days_left": days_left,
                    })
            return self._send(200, {"upcoming": result})

        rows = rest_request(
            "GET", "contract_documents?select=*,contract_document_files(*)&order=contract_end_date.asc.nullslast"
        ) or []
        for r in rows:
            files = r.get("contract_document_files") or []
            for f in files:
                f["view_url"] = storage_sign_url(f.get("storage_path"))
            r["files"] = files
        return self._send(200, {"documents": rows})

    def _get_todos(self, qs):
        date_str = qs.get("date", [None])[0] or datetime.date.today().isoformat()
        rows = rest_request(
            "GET", f"daily_todos?todo_date=eq.{date_str}&select=*&order=created_at.asc"
        )
        return self._send(200, {"todos": rows, "date": date_str})

    def _get_annualleave(self, qs):
        """연차수당 자동계산용 — 기준일 시점 (기본급+식대)/209 통상시급을 직원별로 계산.
        기본급/식대는 매달 확정 저장되는 monthly_payroll의 실제 값을 그대로 씁니다
        (설정 테이블이 아니라, 그 달 실제로 지급 확정된 급여명세 기준).
        기준일 이전 중 가장 최근에 '생성/저장'된 달의 급여명세를 사용합니다.
        단, 그 달이 육아기근로시간단축 등으로 기본급/식대가 일시적으로 줄어든 달이면
        (base_pay_before/meal_allowance_before가 저장되어 있으면) 그 "조정 전 정상 금액"을
        우선 사용합니다 — 연차수당은 정상 통상임금 기준이어야 하므로.
        연차수당 = 잔여일수 × 통상시급 × 8시간, 백원단위 올림은 화면(hr.js)에서 처리."""
        as_of_str = qs.get("asof", [None])[0] or datetime.date.today().isoformat()
        include_all = qs.get("all", ["0"])[0] == "1"

        emp_path = "employees?select=id,name,branch,department&order=hire_date.asc"
        if not include_all:
            emp_path += f"&status=eq.{quote('재직')}"
        employees = rest_request("GET", emp_path) or []

        payroll_rows = rest_request(
            "GET",
            f"monthly_payroll?year_month=lte.{as_of_str}"
            "&select=employee_id,year_month,base_pay,meal_allowance,base_pay_before,meal_allowance_before"
            "&order=employee_id.asc,year_month.desc",
        ) or []
        latest_payroll = {}
        for r in payroll_rows:
            eid = r["employee_id"]
            if eid not in latest_payroll:
                latest_payroll[eid] = r

        result = []
        for e in employees:
            pr = latest_payroll.get(e["id"])
            if not pr or pr.get("base_pay") is None:
                continue
            # base_pay_before는 조정 없을 때도 base_pay와 같은 값으로 채워져 있을 수 있어서,
            # "값이 있냐"가 아니라 "조정 전후 값이 실제로 다르냐"로 판단해야 정확함
            was_adjusted = (
                pr.get("base_pay_before") is not None
                and pr["base_pay_before"] != pr["base_pay"]
            )
            base_pay_monthly = pr["base_pay_before"] if was_adjusted else pr["base_pay"]
            meal = (pr.get("meal_allowance_before") if was_adjusted else pr.get("meal_allowance")) or 0
            hourly_wage = (base_pay_monthly + meal) / 209
            daily_wage = hourly_wage * 8
            result.append({
                "employee_id": e["id"],
                "name": e["name"],
                "branch": e.get("branch"),
                "department": e.get("department"),
                "base_pay_monthly": round(base_pay_monthly),
                "meal_allowance": meal,
                "source_month": pr.get("year_month"),
                "adjusted_month": was_adjusted,
                "hourly_wage": round(hourly_wage, 2),
                "daily_wage": round(daily_wage, 2),
            })
        return self._send(200, {"employees": result, "as_of": as_of_str})

    def _compute_promotion_snapshot(self, as_of, prior_year_end, include_all=False):
        emp_path = "employees?select=id,name,branch,department,position,hire_date,status&order=hire_date.asc"
        if not include_all:
            emp_path += f"&status=eq.{quote('재직')}"
        employees = rest_request("GET", emp_path) or []

        hist_rows = rest_request("GET", "position_history?select=*&order=effective_date.asc") or []
        hist_by_emp = {}
        for h in hist_rows:
            hist_by_emp.setdefault(h["employee_id"], []).append(h)

        result = []
        for e in employees:
            hire = datetime.date.fromisoformat(e["hire_date"]) if e.get("hire_date") else None
            hist = [
                h for h in hist_by_emp.get(e["id"], [])
                if datetime.date.fromisoformat(h["effective_date"]) <= as_of
            ]
            last = hist[-1] if hist else None
            tenure_now = _calc_tenure(hire, as_of) if hire else None
            tenure_prior = _calc_tenure(hire, prior_year_end) if hire and hire <= prior_year_end else None
            result.append({
                "employee_id": e["id"],
                "name": e["name"],
                "branch": e.get("branch"),
                "department": e.get("department"),
                "position": e.get("position"),
                "status": e.get("status"),
                "hire_date": e.get("hire_date"),
                "last_promotion_date": last["effective_date"] if last else None,
                "last_promotion_position": last["position"] if last else None,
                "history": [{"date": h["effective_date"], "position": h["position"]} for h in hist],
                "tenure_current": _format_tenure(tenure_now),
                "tenure_prior_year_end": _format_tenure(tenure_prior),
            })
        return result

    def _get_promotions(self, qs):
        if qs.get("standards", ["0"])[0] == "1":
            rows = rest_request("GET", "position_pay_standards?select=*&order=attendance_allowance.desc")
            return self._send(200, {"standards": rows})

        if qs.get("reports", ["0"])[0] == "1":
            rows = rest_request(
                "GET",
                "promotion_reports?select=id,report_year,as_of_date,prior_year_end_date,note,generated_at"
                "&order=report_year.desc,generated_at.desc",
            )
            return self._send(200, {"reports": rows})

        report_id = qs.get("report_id", [None])[0]
        if report_id:
            rows = rest_request("GET", f"promotion_reports?id=eq.{report_id}&select=*")
            if not rows:
                return self._send(404, {"error": "not_found"})
            return self._send(200, {"report": rows[0]})

        if qs.get("history", ["0"])[0] == "1":
            emp_id = qs.get("employee_id", [None])[0]
            if not emp_id:
                return self._send(400, {"error": "employee_id는 필수입니다"})
            rows = rest_request(
                "GET", f"position_history?employee_id=eq.{emp_id}&select=*&order=effective_date.asc"
            )
            return self._send(200, {"history": rows})

        # 미리보기(라이브 계산, 저장 안 됨)
        as_of_str = qs.get("asof", [None])[0] or datetime.date.today().isoformat()
        as_of = datetime.date.fromisoformat(as_of_str)
        prior_year_end = datetime.date(as_of.year - 1, 12, 31)
        include_all = qs.get("all", ["0"])[0] == "1"

        employees = self._compute_promotion_snapshot(as_of, prior_year_end, include_all)
        return self._send(200, {
            "employees": employees,
            "as_of": as_of.isoformat(),
            "prior_year_end": prior_year_end.isoformat(),
        })

    # ────────────────────────────────────────────────────────
    # POST
    # ────────────────────────────────────────────────────────
    def do_POST(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)
            payload = self._read_json_body()

            if resource == "schedule":
                return self._post_schedule(payload)
            if resource == "contacts":
                return self._post_contacts(payload)
            if resource == "contractdocs":
                return self._post_contractdocs(payload)
            if resource == "todos":
                return self._post_todos(payload)
            if resource == "promotions":
                return self._post_promotions(payload)
            if resource == "personal":
                return self._post_personal(payload)
            if resource == "timetable":
                return self._post_timetable(payload)
            return self._send(400, {"error": "알 수 없는 resource입니다"})

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _post_schedule(self, payload):
        action = payload.get("type")

        if action == "complete":
            occ_id = payload.get("occurrence_id")
            if not occ_id:
                return self._send(400, {"error": "occurrence_id는 필수입니다"})
            done = payload.get("done", True)
            update = {
                "status": "done" if done else "pending",
                "completed_at": datetime.datetime.utcnow().isoformat() if done else None,
                "completed_note": payload.get("note") if done else None,
            }
            rest_request("PATCH", f"tax_schedule_occurrences?id=eq.{occ_id}", body=update)
            return self._send(200, {"ok": True})

        if action == "skip":
            occ_id = payload.get("occurrence_id")
            if not occ_id:
                return self._send(400, {"error": "occurrence_id는 필수입니다"})
            rest_request("PATCH", f"tax_schedule_occurrences?id=eq.{occ_id}", body={"status": "skipped"})
            return self._send(200, {"ok": True})

        if isinstance(payload, dict) and "items" in payload:
            items = payload.get("items") or []
            if not items:
                return self._send(400, {"error": "items가 비어있습니다"})
            valid = []
            skipped = []
            for idx, it in enumerate(items):
                title = it.get("title")
                anchor_date = it.get("anchor_date")
                recurrence_type = it.get("recurrence_type", "once")
                if not title or not anchor_date or recurrence_type not in ("once", "weekly", "monthly"):
                    skipped.append(f"{idx + 1}번째 항목({title or '제목없음'}): 필수값 누락 또는 형식 오류")
                    continue
                valid.append({
                    "title": title,
                    "category": it.get("category"),
                    "recurrence_type": recurrence_type,
                    "interval_value": int(it.get("interval_value") or 1),
                    "anchor_date": anchor_date,
                    "day_mode": it.get("day_mode", "fixed"),
                    "end_date": it.get("end_date") or None,
                    "reminder_days_before": int(it.get("reminder_days_before") or 5),
                    "note": it.get("note"),
                    "active": True,
                })
            if not valid:
                return self._send(400, {"error": "유효한 항목이 없습니다", "skipped": skipped})
            created = rest_request("POST", "tax_schedule_tasks", body=valid, prefer="return=representation")
            _ensure_occurrences_generated()
            result = {"count": len(created) if created else 0}
            if skipped:
                result["skipped"] = skipped
            return self._send(201, result)

        title = payload.get("title")
        anchor_date = payload.get("anchor_date")
        recurrence_type = payload.get("recurrence_type", "once")
        if not title or not anchor_date:
            return self._send(400, {"error": "title, anchor_date는 필수입니다"})
        if recurrence_type not in ("once", "weekly", "monthly"):
            return self._send(400, {"error": "recurrence_type이 올바르지 않습니다"})

        body = {
            "title": title,
            "category": payload.get("category"),
            "recurrence_type": recurrence_type,
            "interval_value": int(payload.get("interval_value") or 1),
            "anchor_date": anchor_date,
            "day_mode": payload.get("day_mode", "fixed"),
            "end_date": payload.get("end_date") or None,
            "reminder_days_before": int(payload.get("reminder_days_before") or 5),
            "note": payload.get("note"),
            "active": True,
        }
        created = rest_request("POST", "tax_schedule_tasks", body=body, prefer="return=representation")
        _ensure_occurrences_generated()
        return self._send(201, {"task": created[0] if created else None})

    def _post_contacts(self, payload):
        company_name = payload.get("company_name")
        if not company_name:
            return self._send(400, {"error": "company_name은 필수입니다"})

        body = {
            "company_name": company_name,
            "category": payload.get("category"),
            "contact_name": payload.get("contact_name"),
            "phones": payload.get("phones") or [],
            "fax": payload.get("fax"),
            "email": payload.get("email"),
            "address": payload.get("address"),
            "note": payload.get("note"),
        }
        created = rest_request("POST", "vendor_contacts", body=body, prefer="return=representation")
        return self._send(201, {"contact": created[0] if created else None})

    def _post_contractdocs(self, payload):
        if payload.get("type") == "dismiss":
            doc_id = payload.get("id")
            if not doc_id:
                return self._send(400, {"error": "id는 필수입니다"})
            rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body={"alert_dismissed": True})
            return self._send(200, {"ok": True})

        if payload.get("type") == "terminate":
            doc_id = payload.get("id")
            if not doc_id:
                return self._send(400, {"error": "id는 필수입니다"})
            terminated_date = payload.get("terminated_date") or datetime.date.today().isoformat()
            rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body={
                "terminated_date": terminated_date,
                "termination_note": payload.get("note"),
            })
            return self._send(200, {"ok": True})

        if payload.get("type") == "reactivate":
            doc_id = payload.get("id")
            if not doc_id:
                return self._send(400, {"error": "id는 필수입니다"})
            rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body={
                "terminated_date": None,
                "termination_note": None,
            })
            return self._send(200, {"ok": True})

        if payload.get("type") == "renew":
            doc_id = payload.get("id")
            new_end_date = payload.get("new_end_date")
            if not doc_id or not new_end_date:
                return self._send(400, {"error": "id, new_end_date는 필수입니다"})
            existing = rest_request("GET", f"contract_documents?id=eq.{doc_id}&select=contract_end_date")
            previous_end_date = existing[0]["contract_end_date"] if existing else None

            rest_request("POST", "contract_renewals", body={
                "document_id": doc_id,
                "previous_end_date": previous_end_date,
                "new_end_date": new_end_date,
                "note": payload.get("note"),
            })
            rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body={
                "contract_end_date": new_end_date,
                "alert_dismissed": False,
            })
            return self._send(200, {"ok": True})

        files_payload = payload.get("files") or []
        if not files_payload and payload.get("file_base64") and payload.get("file_name"):
            # 하위호환: 예전 방식(파일 1개)으로 온 요청도 지원
            files_payload = [{
                "file_base64": payload["file_base64"],
                "file_name": payload["file_name"],
                "content_type": payload.get("content_type"),
            }]
        if not files_payload:
            return self._send(400, {"error": "최소 1개의 파일이 필요합니다"})

        uploaded = []
        for f in files_payload:
            fb64 = f.get("file_base64")
            fname = f.get("file_name")
            if not fb64 or not fname:
                continue
            try:
                fbytes = base64.b64decode(fb64)
            except Exception:
                return self._send(400, {"error": f"'{fname}' 파일 데이터를 해독할 수 없습니다"})
            if len(fbytes) > 8 * 1024 * 1024:
                return self._send(413, {"error": f"'{fname}' 파일이 너무 큽니다 (8MB 이하로 올려주세요)"})
            spath = safe_filename(fname)
            storage_upload(spath, fbytes, f.get("content_type"))
            uploaded.append({
                "file_name": fname, "storage_path": spath,
                "file_size": len(fbytes), "content_type": f.get("content_type"),
            })

        body = {
            "doc_group": payload.get("doc_group") or "contract",
            "doc_type": payload.get("doc_type"),
            "vendor_name": payload.get("vendor_name"),
            "contract_title": payload.get("contract_title"),
            "contract_start_date": payload.get("contract_start_date") or None,
            "contract_end_date": payload.get("contract_end_date") or None,
            "reminder_days_before": int(payload.get("reminder_days_before") or 14),
            "auto_renew": bool(payload.get("auto_renew", False)),
            "account_number": payload.get("account_number"),
            "investment_amount": payload.get("investment_amount"),
            "return_rate": payload.get("return_rate"),
            "note": payload.get("note"),
        }
        created = rest_request("POST", "contract_documents", body=body, prefer="return=representation")
        doc_id = created[0]["id"] if created else None
        if doc_id:
            for uf in uploaded:
                rest_request("POST", "contract_document_files", body={
                    "document_id": doc_id,
                    "file_name": uf["file_name"],
                    "storage_path": uf["storage_path"],
                    "file_size": uf["file_size"],
                    "content_type": uf["content_type"],
                })
        return self._send(201, {"ok": True, "id": doc_id})

    def _post_todos(self, payload):
        content = payload.get("content")
        todo_date = payload.get("todo_date") or datetime.date.today().isoformat()
        if not content:
            return self._send(400, {"error": "content는 필수입니다"})

        created = rest_request("POST", "daily_todos", body={
            "todo_date": todo_date,
            "content": content,
            "done": False,
            "category": payload.get("category") or "work",
        }, prefer="return=representation")
        return self._send(201, {"todo": created[0] if created else None})

    def _post_promotions(self, payload):
        action = payload.get("type")

        if action == "apply_standard":
            return self._post_apply_standard(payload)

        if action == "save_standard":
            position = payload.get("position")
            if not position:
                return self._send(400, {"error": "position은 필수입니다"})
            body = {
                "position": position,
                "attendance_allowance": payload.get("attendance_allowance") or 0,
                "fixed_overtime_hours": payload.get("fixed_overtime_hours") or 0,
                "meal_allowance": payload.get("meal_allowance") or 0,
                "note": payload.get("note"),
                "updated_at": datetime.datetime.utcnow().isoformat(),
            }
            rest_request(
                "POST", "position_pay_standards", body=body, prefer="resolution=merge-duplicates"
            )
            return self._send(200, {"ok": True})

        if action == "save_report":
            report_year = payload.get("report_year")
            if not report_year:
                return self._send(400, {"error": "report_year은 필수입니다"})
            as_of_str = payload.get("as_of") or f"{report_year}-01-30"
            as_of = datetime.date.fromisoformat(as_of_str)
            prior_year_end = datetime.date(as_of.year - 1, 12, 31)
            include_all = bool(payload.get("include_all", False))

            snapshot = self._compute_promotion_snapshot(as_of, prior_year_end, include_all)

            created = rest_request("POST", "promotion_reports", body={
                "report_year": int(report_year),
                "as_of_date": as_of.isoformat(),
                "prior_year_end_date": prior_year_end.isoformat(),
                "snapshot": snapshot,
                "note": payload.get("note"),
            }, prefer="return=representation")
            return self._send(201, {"report": created[0] if created else None})

        # 기본: 직급이력(승진기록) 추가
        # 기본: 직급이력(승진기록) 추가 — 이건 "직급이 바뀐 사실"만 기록합니다.
        # 실제 급여(만근수당 등) 반영은 자동으로 하지 않고, 아래 "apply_standard"를
        # 별도로 호출해야 반영됩니다. 승진일과 급여 반영일이 다른 경우(예: 직급은
        # 즉시 바뀌지만 급여는 다음 연봉재계약 시점에 반영)를 구분하기 위함입니다.
        employee_id = payload.get("employee_id")
        effective_date = payload.get("effective_date")
        position = payload.get("position")
        if not employee_id or not effective_date or not position:
            return self._send(400, {"error": "employee_id, effective_date, position은 필수입니다"})
        created = rest_request("POST", "position_history", body={
            "employee_id": employee_id,
            "effective_date": effective_date,
            "position": position,
            "note": payload.get("note"),
        }, prefer="return=representation")
        return self._send(201, {"history": created[0] if created else None})

    def _post_apply_standard(self, payload):
        """급여기준 반영 — 직급이력과 별개로, 실제 급여(만근수당 등)를
        반영할 시점을 직접 지정해서 payroll_settings_history에 적용."""
        employee_id = payload.get("employee_id")
        effective_month = payload.get("effective_month")
        position = payload.get("position")
        if not employee_id or not effective_month or not position:
            return self._send(400, {"error": "employee_id, effective_month, position은 필수입니다"})

        standard_rows = rest_request(
            "GET", f"position_pay_standards?position=eq.{quote(position)}&select=*"
        )
        if not standard_rows:
            return self._send(404, {"error": f"급여기준표에 '{position}' 직급이 없습니다. 먼저 급여기준표에 추가해주세요."})
        standard = standard_rows[0]

        prev_rows = rest_request(
            "GET",
            f"payroll_settings_history?employee_id=eq.{employee_id}&select=*"
            f"&order=effective_month.desc&limit=1",
        )
        prev = prev_rows[0] if prev_rows else {}

        rest_request("POST", "payroll_settings_history", body={
            "employee_id": employee_id,
            "effective_month": effective_month,
            "standard_hours": prev.get("standard_hours", 209),
            "fixed_overtime_hours": standard["fixed_overtime_hours"],
            "attendance_allowance": standard["attendance_allowance"],
            "meal_allowance": standard["meal_allowance"],
            "employment_type": prev.get("employment_type", "정규직"),
            "pay_rate": prev.get("pay_rate", 1.0),
            "contract_end_date": prev.get("contract_end_date"),
            "note": payload.get("note") or f"급여기준 반영({position}) — 직급기준표 적용",
        })
        # 이 시점부터는 이 직급이 "급여직급"이 되므로 직원마스터에도 반영
        rest_request("PATCH", f"employees?id=eq.{employee_id}", body={"pay_position": position})
        return self._send(201, {"ok": True})

    # ────────────────────────────────────────────────────────
    # PATCH
    # ────────────────────────────────────────────────────────
    def do_PATCH(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)
            item_id = qs.get("id", [None])[0]
            if not item_id:
                return self._send(400, {"error": "id는 필수입니다"})
            payload = self._read_json_body()

            if resource == "schedule":
                return self._patch_schedule(item_id, payload)
            if resource == "contacts":
                return self._patch_contacts(item_id, payload)
            if resource == "contractdocs":
                return self._patch_contractdocs(item_id, payload)
            if resource == "todos":
                return self._patch_todos(item_id, payload)
            if resource == "promotions":
                return self._patch_promotions(item_id, payload)
            if resource == "personal":
                return self._patch_personal(item_id, payload)
            if resource == "timetable":
                return self._patch_timetable(item_id, payload)
            return self._send(400, {"error": "알 수 없는 resource입니다"})

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _patch_schedule(self, task_id, payload):
        update_fields = {}
        for key in ("title", "category", "recurrence_type", "interval_value", "anchor_date",
                    "day_mode", "end_date", "reminder_days_before", "note", "active"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        rest_request("PATCH", f"tax_schedule_tasks?id=eq.{task_id}", body=update_fields)

        today = datetime.date.today().isoformat()
        rest_request(
            "DELETE",
            f"tax_schedule_occurrences?task_id=eq.{task_id}&status=eq.pending&due_date=gte.{today}",
        )
        _ensure_occurrences_generated()
        return self._send(200, {"ok": True})

    def _patch_contacts(self, contact_id, payload):
        update_fields = {}
        for key in ("company_name", "category", "contact_name", "phones", "fax", "email", "address", "note"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})
        update_fields["updated_at"] = datetime.datetime.utcnow().isoformat()

        rest_request("PATCH", f"vendor_contacts?id=eq.{contact_id}", body=update_fields)
        return self._send(200, {"ok": True})

    def _patch_contractdocs(self, doc_id, payload):
        update_fields = {}
        for key in ("doc_group", "doc_type", "vendor_name", "contract_title", "contract_start_date",
                    "contract_end_date", "reminder_days_before", "note", "alert_dismissed", "auto_renew",
                    "account_number", "investment_amount", "return_rate"):
            if key in payload:
                update_fields[key] = payload[key]

        new_files = payload.get("new_files") or []
        if not update_fields and not new_files:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        if update_fields:
            update_fields["updated_at"] = datetime.datetime.utcnow().isoformat()
            rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body=update_fields)

        for f in new_files:
            fb64 = f.get("file_base64")
            fname = f.get("file_name")
            if not fb64 or not fname:
                continue
            try:
                fbytes = base64.b64decode(fb64)
            except Exception:
                return self._send(400, {"error": f"'{fname}' 파일 데이터를 해독할 수 없습니다"})
            if len(fbytes) > 8 * 1024 * 1024:
                return self._send(413, {"error": f"'{fname}' 파일이 너무 큽니다 (8MB 이하로 올려주세요)"})
            spath = safe_filename(fname)
            storage_upload(spath, fbytes, f.get("content_type"))
            rest_request("POST", "contract_document_files", body={
                "document_id": doc_id,
                "file_name": fname,
                "storage_path": spath,
                "file_size": len(fbytes),
                "content_type": f.get("content_type"),
            })

        return self._send(200, {"ok": True})

    def _patch_todos(self, todo_id, payload):
        update_fields = {}
        for key in ("content", "done", "category"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        rest_request("PATCH", f"daily_todos?id=eq.{todo_id}", body=update_fields)
        return self._send(200, {"ok": True})

    def _patch_promotions(self, item_id, payload):
        update_fields = {}
        for key in ("effective_date", "position", "note"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})
        rest_request("PATCH", f"position_history?id=eq.{item_id}", body=update_fields)
        return self._send(200, {"ok": True})

    # ────────────────────────────────────────────────────────
    # DELETE
    # ────────────────────────────────────────────────────────
    def do_DELETE(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)

            if resource == "schedule":
                return self._delete_schedule(qs)
            if resource == "contacts":
                return self._delete_contacts(qs)
            if resource == "contractdocs":
                return self._delete_contractdocs(qs)
            if resource == "todos":
                return self._delete_todos(qs)
            if resource == "promotions":
                return self._delete_promotions(qs)
            if resource == "personal":
                return self._delete_personal(qs)
            if resource == "timetable":
                return self._delete_timetable(qs)
            return self._send(400, {"error": "알 수 없는 resource입니다"})

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _delete_schedule(self, qs):
        task_id = qs.get("id", [None])[0]
        occ_id = qs.get("occurrence_id", [None])[0]

        if task_id:
            rest_request("DELETE", f"tax_schedule_tasks?id=eq.{task_id}")
            return self._send(200, {"ok": True})
        if occ_id:
            rest_request("DELETE", f"tax_schedule_occurrences?id=eq.{occ_id}")
            return self._send(200, {"ok": True})
        return self._send(400, {"error": "id 또는 occurrence_id가 필요합니다"})

    def _delete_contacts(self, qs):
        contact_id = qs.get("id", [None])[0]
        if not contact_id:
            return self._send(400, {"error": "id는 필수입니다"})
        rest_request("DELETE", f"vendor_contacts?id=eq.{contact_id}")
        return self._send(200, {"ok": True})

    def _delete_contractdocs(self, qs):
        file_id = qs.get("file_id", [None])[0]
        if file_id:
            existing = rest_request("GET", f"contract_document_files?id=eq.{file_id}&select=storage_path")
            if existing and existing[0].get("storage_path"):
                storage_delete(existing[0]["storage_path"])
            rest_request("DELETE", f"contract_document_files?id=eq.{file_id}")
            return self._send(200, {"ok": True})

        doc_id = qs.get("id", [None])[0]
        if not doc_id:
            return self._send(400, {"error": "id는 필수입니다"})
        files = rest_request("GET", f"contract_document_files?document_id=eq.{doc_id}&select=storage_path") or []
        for f in files:
            if f.get("storage_path"):
                storage_delete(f["storage_path"])
        rest_request("DELETE", f"contract_documents?id=eq.{doc_id}")
        return self._send(200, {"ok": True})

    def _delete_todos(self, qs):
        todo_id = qs.get("id", [None])[0]
        if not todo_id:
            return self._send(400, {"error": "id는 필수입니다"})
        rest_request("DELETE", f"daily_todos?id=eq.{todo_id}")
        return self._send(200, {"ok": True})

    def _delete_promotions(self, qs):
        item_id = qs.get("id", [None])[0]
        if not item_id:
            return self._send(400, {"error": "id는 필수입니다"})
        item_type = qs.get("type", [None])[0]
        if item_type == "report":
            rest_request("DELETE", f"promotion_reports?id=eq.{item_id}")
        elif item_type == "standard":
            rest_request("DELETE", f"position_pay_standards?id=eq.{item_id}")
        else:
            rest_request("DELETE", f"position_history?id=eq.{item_id}")
        return self._send(200, {"ok": True})

    # ────────────────────────────────────────────────────────
    # personal (개인 스케줄 - 가족 일정)
    # ────────────────────────────────────────────────────────
    def _generate_lunar_occurrences(self):
        """date_type='lunar'인 매년 반복 일정을, 매년 실제 양력 날짜로 환산해서 발생일자를 채워넣음."""
        tasks = rest_request(
            "GET", "personal_schedule_tasks?date_type=eq.lunar&active=eq.true&select=*"
        ) or []
        if not tasks:
            return
        today = datetime.date.today()
        horizon_year = (today + datetime.timedelta(days=400)).year
        for t in tasks:
            if t.get("lunar_month") is None or t.get("lunar_day") is None:
                continue
            start_year = int(t["anchor_date"][:4])
            end_year = int(t["end_date"][:4]) if t.get("end_date") else horizon_year
            for y in range(start_year, min(horizon_year, end_year) + 1):
                solar_date = lunar_to_solar(y, t["lunar_month"], t["lunar_day"], t.get("lunar_leap", False))
                if not solar_date:
                    continue
                if t.get("end_date") and solar_date > t["end_date"]:
                    continue
                rest_request(
                    "POST", "personal_schedule_occurrences",
                    body={"task_id": t["id"], "due_date": solar_date},
                    prefer="resolution=merge-duplicates",
                )

    def _get_personal(self, qs):
        if qs.get("members", ["0"])[0] == "1":
            rows = rest_request("GET", "personal_schedule_members?select=*&order=sort_order.asc")
            return self._send(200, {"members": rows})

        rpc("generate_personal_schedule_occurrences", {})
        self._generate_lunar_occurrences()

        if qs.get("tasks", ["0"])[0] == "1":
            rows = rest_request(
                "GET", "personal_schedule_tasks?select=*&order=active.desc,member_name.asc,anchor_date.asc"
            )
            return self._send(200, {"tasks": rows})

        if qs.get("upcoming", ["0"])[0] == "1":
            today = datetime.date.today()
            horizon = (today + datetime.timedelta(days=60)).isoformat()
            rows = rest_request(
                "GET",
                "personal_schedule_occurrences?status=eq.pending&due_date=lte." + horizon
                + "&select=*,personal_schedule_tasks(title,category,member_name,reminder_days_before,note)&order=due_date.asc",
            ) or []
            result = []
            for r in rows:
                due = datetime.date.fromisoformat(r["due_date"])
                task = r.get("personal_schedule_tasks") or {}
                category = task.get("category")
                reminder_days = task.get("reminder_days_before") or 1
                days_left = (due - today).days
                # 결제일이 아니면 "지난 일정(확인 필요)"로 계속 남기지 않고, 다가올 때만 안내
                if category != "결제일" and days_left < 0:
                    continue
                if days_left < 0 or days_left <= reminder_days:
                    result.append({
                        "occurrence_id": r["id"], "task_id": r["task_id"], "due_date": r["due_date"],
                        "days_left": days_left, "title": task.get("title"),
                        "category": category, "member_name": task.get("member_name"),
                    })
            return self._send(200, {"upcoming": result})

        today = datetime.date.today()
        default_from = (today.replace(day=1) - datetime.timedelta(days=31)).replace(day=1).isoformat()
        default_to = (today + datetime.timedelta(days=90)).isoformat()
        from_date = qs.get("from", [None])[0] or default_from
        to_date = qs.get("to", [None])[0] or default_to
        status_filter = qs.get("status", [None])[0]
        member_filter = qs.get("member", [None])[0]

        path = (
            "personal_schedule_occurrences?due_date=gte." + from_date + "&due_date=lte." + to_date
            + "&select=*,personal_schedule_tasks(title,category,member_name,recurrence_type,note,date_type)&order=due_date.asc"
        )
        if status_filter and status_filter != "all":
            path += "&status=eq." + status_filter
        rows = rest_request("GET", path) or []
        if member_filter:
            rows = [r for r in rows if (r.get("personal_schedule_tasks") or {}).get("member_name") == member_filter]
        return self._send(200, {"occurrences": rows})

    def _post_personal(self, payload):
        action = payload.get("type")

        if action == "save_member":
            name = payload.get("name")
            if not name:
                return self._send(400, {"error": "name은 필수입니다"})
            rest_request("POST", "personal_schedule_members", body={
                "name": name,
                "color": payload.get("color") or "#888888",
                "sort_order": int(payload.get("sort_order") or 99),
            }, prefer="resolution=merge-duplicates")
            return self._send(200, {"ok": True})

        if action == "complete":
            occ_id = payload.get("occurrence_id")
            if not occ_id:
                return self._send(400, {"error": "occurrence_id는 필수입니다"})
            done = payload.get("done", True)
            rest_request("PATCH", f"personal_schedule_occurrences?id=eq.{occ_id}", body={
                "status": "done" if done else "pending",
                "completed_at": datetime.datetime.utcnow().isoformat() if done else None,
                "completed_note": payload.get("note") if done else None,
            })
            return self._send(200, {"ok": True})

        if action == "skip":
            occ_id = payload.get("occurrence_id")
            if not occ_id:
                return self._send(400, {"error": "occurrence_id는 필수입니다"})
            rest_request("PATCH", f"personal_schedule_occurrences?id=eq.{occ_id}", body={"status": "skipped"})
            return self._send(200, {"ok": True})

        member_name = payload.get("member_name")
        title = payload.get("title")
        anchor_date = payload.get("anchor_date")
        recurrence_type = payload.get("recurrence_type", "once")
        if not member_name or not title or not anchor_date:
            return self._send(400, {"error": "member_name, title, anchor_date는 필수입니다"})
        if recurrence_type not in ("once", "weekly", "monthly"):
            return self._send(400, {"error": "recurrence_type이 올바르지 않습니다"})

        # 음력 기준(예: 음력 생일) — 입력하신 기준일자(양력)를 음력으로 환산해서
        # 음력 월/일을 저장해두고, 해마다 그 음력 월/일에 해당하는 양력 날짜로 발생시킴
        is_lunar = payload.get("date_type") == "lunar"
        lunar_month = lunar_day = None
        if is_lunar:
            if KoreanLunarCalendar is None:
                return self._send(400, {"error": "음력 변환 라이브러리가 서버에 설치되지 않았습니다(requirements.txt 재배포 필요)."})
            try:
                solar_dt = datetime.date.fromisoformat(anchor_date)
                cal = KoreanLunarCalendar()
                cal.setSolarDate(solar_dt.year, solar_dt.month, solar_dt.day)
                lunar_month, lunar_day = cal.lunarMonth, cal.lunarDay
            except Exception as e:
                return self._send(400, {"error": f"음력 변환에 실패했습니다: {type(e).__name__}: {e}"})

        body = {
            "member_name": member_name,
            "category": payload.get("category") or "일정",
            "title": title,
            "recurrence_type": recurrence_type,
            "interval_value": int(payload.get("interval_value") or 1),
            "anchor_date": anchor_date,
            "day_mode": payload.get("day_mode", "fixed"),
            "end_date": payload.get("end_date") or None,
            "reminder_days_before": int(payload.get("reminder_days_before") or 1),
            "note": payload.get("note"),
            "active": True,
            "date_type": "lunar" if is_lunar else "solar",
            "lunar_month": lunar_month,
            "lunar_day": lunar_day,
        }
        created = rest_request("POST", "personal_schedule_tasks", body=body, prefer="return=representation")
        rpc("generate_personal_schedule_occurrences", {})
        self._generate_lunar_occurrences()
        return self._send(201, {"task": created[0] if created else None})

    def _patch_personal(self, task_id, payload):
        update_fields = {}
        for key in ("member_name", "category", "title", "recurrence_type", "interval_value",
                    "anchor_date", "day_mode", "end_date", "reminder_days_before", "note", "active"):
            if key in payload:
                update_fields[key] = payload[key]

        if "date_type" in payload:
            is_lunar = payload.get("date_type") == "lunar"
            update_fields["date_type"] = "lunar" if is_lunar else "solar"
            if is_lunar:
                anchor = payload.get("anchor_date")
                if not anchor:
                    existing = rest_request("GET", f"personal_schedule_tasks?id=eq.{task_id}&select=anchor_date")
                    anchor = existing[0]["anchor_date"] if existing else None
                if anchor:
                    solar_dt = datetime.date.fromisoformat(anchor)
                    converted = solar_to_lunar(solar_dt.year, solar_dt.month, solar_dt.day)
                    if converted:
                        _, lm, ld, _ = converted
                        update_fields["lunar_month"] = lm
                        update_fields["lunar_day"] = ld
            else:
                update_fields["lunar_month"] = None
                update_fields["lunar_day"] = None

        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        rest_request("PATCH", f"personal_schedule_tasks?id=eq.{task_id}", body=update_fields)
        today = datetime.date.today().isoformat()
        rest_request(
            "DELETE",
            f"personal_schedule_occurrences?task_id=eq.{task_id}&status=eq.pending&due_date=gte.{today}",
        )
        rpc("generate_personal_schedule_occurrences", {})
        self._generate_lunar_occurrences()
        return self._send(200, {"ok": True})

    def _delete_personal(self, qs):
        task_id = qs.get("id", [None])[0]
        occ_id = qs.get("occurrence_id", [None])[0]
        member_id = qs.get("member_id", [None])[0]

        if member_id:
            rest_request("DELETE", f"personal_schedule_members?id=eq.{member_id}")
            return self._send(200, {"ok": True})
        if task_id:
            rest_request("DELETE", f"personal_schedule_tasks?id=eq.{task_id}")
            return self._send(200, {"ok": True})
        if occ_id:
            rest_request("DELETE", f"personal_schedule_occurrences?id=eq.{occ_id}")
            return self._send(200, {"ok": True})
        return self._send(400, {"error": "id, occurrence_id 또는 member_id가 필요합니다"})

    # ────────────────────────────────────────────────────────
    # timetable (학교 시간표)
    # ────────────────────────────────────────────────────────
    def _get_timetable(self, qs):
        child = qs.get("child", ["하진"])[0]

        if qs.get("periods", ["0"])[0] == "1":
            rows = rest_request(
                "GET",
                f"timetable_period_times?child_name=eq.{quote(child)}&select=*&order=sort_order.asc",
            )
            return self._send(200, {"periods": rows})

        if qs.get("teachers", ["0"])[0] == "1":
            rows = rest_request(
                "GET", f"timetable_teachers?child_name=eq.{quote(child)}&select=*&order=subject_name.asc"
            )
            return self._send(200, {"teachers": rows})

        entries = rest_request(
            "GET", f"timetable_entries?child_name=eq.{quote(child)}&select=*"
        ) or []

        # 과목명 기준으로 선생님 정보를 붙여줌 (칸마다 반복입력 안 해도 되도록)
        teacher_rows = rest_request(
            "GET", f"timetable_teachers?child_name=eq.{quote(child)}&select=*"
        ) or []
        teacher_by_subject = {t["subject_name"]: t for t in teacher_rows}
        for e in entries:
            t = teacher_by_subject.get(e["subject_name"])
            e["teacher_name"] = t.get("teacher_name") if t else None
            e["teacher_phone"] = t.get("teacher_phone") if t else None

        return self._send(200, {"entries": entries})

    def _post_timetable(self, payload):
        kind = payload.get("type")

        if kind == "period":
            label = payload.get("period_label")
            if not label or not payload.get("start_time") or not payload.get("end_time"):
                return self._send(400, {"error": "교시명, 시작/종료시간은 필수입니다"})
            created = rest_request("POST", "timetable_period_times", body={
                "child_name": payload.get("child_name") or "하진",
                "period_label": label,
                "sort_order": int(payload.get("sort_order") or 0),
                "start_time": payload["start_time"],
                "end_time": payload["end_time"],
            }, prefer="return=representation,resolution=merge-duplicates")
            return self._send(201, {"period": created[0] if created else None})

        if kind == "teacher":
            subject_name = payload.get("subject_name")
            if not subject_name:
                return self._send(400, {"error": "subject_name은 필수입니다"})
            rest_request("POST", "timetable_teachers", body={
                "child_name": payload.get("child_name") or "하진",
                "subject_name": subject_name,
                "teacher_name": payload.get("teacher_name"),
                "teacher_phone": payload.get("teacher_phone"),
                "note": payload.get("note"),
            }, prefer="resolution=merge-duplicates")
            return self._send(200, {"ok": True})

        # 기본: 과목 배정(요일/교시별)
        required = ("weekday", "period_label", "subject_name")
        if any(not payload.get(k) for k in required):
            return self._send(400, {"error": f"{', '.join(required)}는 필수입니다"})
        created = rest_request("POST", "timetable_entries", body={
            "child_name": payload.get("child_name") or "하진",
            "weekday": int(payload["weekday"]),
            "period_label": payload["period_label"],
            "subject_name": payload["subject_name"],
            "subject_type": payload.get("subject_type") or "regular",
            "note": payload.get("note"),
        }, prefer="return=representation,resolution=merge-duplicates")
        return self._send(201, {"entry": created[0] if created else None})

    def _patch_timetable(self, item_id, payload):
        kind = payload.get("type")
        if kind == "teacher":
            fields = ("teacher_name", "teacher_phone", "note")
            update_fields = {k: payload[k] for k in fields if k in payload}
            if not update_fields:
                return self._send(400, {"error": "수정할 항목이 없습니다"})
            rest_request("PATCH", f"timetable_teachers?id=eq.{item_id}", body=update_fields)
            return self._send(200, {"ok": True})

        if kind == "period":
            fields = ("period_label", "start_time", "end_time", "sort_order")
        else:
            fields = ("weekday", "period_label", "subject_name", "subject_type", "note")
        update_fields = {k: payload[k] for k in fields if k in payload}
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})
        table = "timetable_period_times" if kind == "period" else "timetable_entries"
        rest_request("PATCH", f"{table}?id=eq.{item_id}", body=update_fields)
        return self._send(200, {"ok": True})

    def _delete_timetable(self, qs):
        item_id = qs.get("id", [None])[0]
        if not item_id:
            return self._send(400, {"error": "id는 필수입니다"})
        kind = qs.get("type", [None])[0]
        table = "timetable_period_times" if kind == "period" else ("timetable_teachers" if kind == "teacher" else "timetable_entries")
        rest_request("DELETE", f"{table}?id=eq.{item_id}")
        return self._send(200, {"ok": True})

    def log_message(self, *args):
        pass
