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


def is_installment_locked(date_str):
    """차수(지급일자) 단위 마감 여부. 연도 마감(module=pension)과는 별개로,
    module=pension_installment / period_key=지급일자(YYYY-MM-DD)로 관리함."""
    if not date_str:
        return False
    date_str = date_str[:10]
    rows = rest_request(
        "GET", f"period_locks?module=eq.pension_installment&period_key=eq.{date_str}&select=locked"
    ) or []
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

            if qs.get("installment_locks", ["0"])[0] == "1":
                locks = rest_request(
                    "GET", "period_locks?module=eq.pension_installment&select=*&order=period_key.desc"
                )
                return self._send(200, {"locks": locks})

            # 특정 직원의 불입 내역 또는 보정 내역 또는 연도별 발생액 조회
            if employee_id:
                if qs.get("type", [None])[0] == "adjustment":
                    items = rest_request(
                        "GET",
                        f"pension_accrual_adjustments?employee_id=eq.{employee_id}&select=*&order=effective_date.desc",
                    )
                    return self._send(200, {"adjustments": items})
                if qs.get("type", [None])[0] == "yearly":
                    yearly = self._build_yearly_for_employee(employee_id)
                    return self._send(200, {"yearly": yearly})
                if qs.get("type", [None])[0] == "multiplier":
                    items = rest_request(
                        "GET",
                        f"pension_multiplier_history?employee_id=eq.{employee_id}&select=*&order=effective_date.desc",
                    )
                    return self._send(200, {"multipliers": items})
                items = rest_request(
                    "GET",
                    f"pension_contributions?employee_id=eq.{employee_id}&select=*&order=contribution_date.desc",
                )
                return self._send(200, {"contributions": items})

            if qs.get("print_installment", ["0"])[0] == "1":
                return self._get_pension_print_installment(qs)

            if qs.get("installment_list", ["0"])[0] == "1":
                return self._get_installment_list()

            data = rest_request("GET", "pension_status?select=*")
            if not isinstance(data, list):
                return self._send(502, {"error": "unexpected_response", "detail": str(data)})

            # 지정일자(as_of)를 안 골라도, "당해년도 발생액/불입액 합계"는 항상 오늘 기준으로 기본 표시됨
            import datetime
            kst_today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()
            effective_as_of = as_of or kst_today.isoformat()
            year_start = f"{effective_as_of[:4]}-01-01"
            view_year = int(effective_as_of[:4])

            # 퇴사한 해까지는 목록에 계속 남고, 그 다음 연도부터는 자동으로 목록에서 빠짐
            emp_status_rows = rest_request("GET", "employees?select=id,status,retire_date") or []
            exclude_ids = {
                e["id"] for e in emp_status_rows
                if e.get("status") == "퇴사" and e.get("retire_date") and int(e["retire_date"][:4]) < view_year
            }
            if exclude_ids:
                data = [emp for emp in data if emp["id"] not in exclude_ids]

            as_of_data = rpc("pension_status_as_of", {"p_as_of": effective_as_of}) or []
            as_of_map = {row["id"]: row for row in as_of_data}

            # 당해년도 발생액 = (오늘/지정일 기준 누적추계액) - (작년 12/31 기준 누적추계액)
            # — 기존에 쓰던 필드(period_accrual)가 값이 안 채워지는 경우가 있어, 더 확실하게 직접 차이로 계산
            year_start_prev = f"{view_year - 1}-12-31"
            as_of_data_start = rpc("pension_status_as_of", {"p_as_of": year_start_prev}) or []
            start_map = {row["id"]: row for row in as_of_data_start}

            ytd_contribs = rest_request(
                "GET",
                f"pension_contributions?contribution_date=gte.{year_start}&contribution_date=lte.{effective_as_of}&select=employee_id,amount",
            ) or []
            ytd_paid_map = {}
            for c in ytd_contribs:
                eid = c["employee_id"]
                ytd_paid_map[eid] = ytd_paid_map.get(eid, 0) + (c.get("amount") or 0)

            for emp in data:
                extra = as_of_map.get(emp["id"], {})
                now_cum = extra.get("as_of_cumulative_estimate", 0) or 0
                start_cum = start_map.get(emp["id"], {}).get("as_of_cumulative_estimate", 0) or 0
                emp["ytd_accrual"] = round(now_cum - start_cum)  # 당해년도(1월~기준일) 발생액 — 항상 계산됨
                emp["ytd_paid"] = ytd_paid_map.get(emp["id"], 0)  # 당해년도(1월~기준일) 불입액 합계 — 항상 계산됨
                if as_of:  # 사용자가 지정일자를 직접 고른 경우에만 아래 3개도 채워짐(기존 동작 유지)
                    emp["as_of_cumulative_estimate"] = extra.get("as_of_cumulative_estimate", 0)
                    emp["period_accrual"] = extra.get("period_accrual", 0)
                    emp["as_of_paid"] = extra.get("as_of_paid", 0)
                    emp["as_of_balance"] = extra.get("as_of_balance", 0)

            return self._send(200, {"pension": data, "ytd_as_of": effective_as_of})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _get_installment_list(self):
        """지금까지 저장된 불입 기록을 지급일자(차수) 기준으로 묶어서 보여줌 —
        '발생 및 불입 입력' 화면에서 지금까지 몇 차수를, 언제, 몇 명에게, 얼마씩 지급했는지 한눈에 보기 위함."""
        rows = rest_request(
            "GET", "pension_contributions?select=contribution_date,employee_id,amount,note&order=contribution_date.desc"
        ) or []
        grouped = {}
        for r in rows:
            d = (r["contribution_date"] or "")[:10]  # 혹시 시간까지 포함된 형태로 와도 날짜만 추출
            if not d:
                continue
            g = grouped.setdefault(d, {"date": d, "employee_ids": set(), "total_amount": 0, "notes": set()})
            g["employee_ids"].add(r["employee_id"])
            g["total_amount"] += r.get("amount") or 0
            if r.get("note"):
                g["notes"].add(r["note"])
        installments = [
            {
                "date": g["date"],
                "employee_count": len(g["employee_ids"]),
                "total_amount": g["total_amount"],
                "notes": sorted(g["notes"])[:3],
            }
            for g in grouped.values()
        ]
        installments.sort(key=lambda x: x["date"], reverse=True)
        return self._send(200, {"installments": installments})

    def _get_pension_print_installment(self, qs):
        """인쇄용: 화면 리스트와 같은 구분(이름/지사/부서/직급/가입일/누적추계액(현재기준)/
        실불입액 합계/잔액/당해년도 발생액/당해년도 불입액 합계/이번 차수 지급액)으로 반환.

        저장 시점에 남겨둔 스냅샷(pension_installment_snapshots)이 있으면 그걸 그대로 쓰고
        (그 처리시점 자료를 그대로 인쇄), 스냅샷이 없는 직원(2026-06-30 이전 이관 자료 등)만
        예전처럼 오늘 기준으로 재계산해서 채워줌 — 이 경우 어쩔 수 없이 오늘 기준 값이 됨."""
        from_date = qs.get("from", [None])[0]
        to_date = qs.get("to", [None])[0]
        if not from_date or not to_date:
            return self._send(400, {"error": "from, to는 필수입니다"})
        from_date = from_date[:10]
        to_date = to_date[:10]

        import datetime
        kst_today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()
        today_str = kst_today.isoformat()

        # 1) 저장 시점 스냅샷이 있으면 그대로 사용
        snap_rows = rest_request(
            "GET",
            f"pension_installment_snapshots?installment_date=gte.{from_date}&installment_date=lte.{to_date}&select=*",
        ) or []
        snapshot_by_emp = {}
        for s in snap_rows:
            eid = s["employee_id"]
            if eid not in snapshot_by_emp:
                snapshot_by_emp[eid] = dict(s)
            else:
                # 같은 직원이 그 기간 안에 여러 차수로 걸쳐 있으면 지급액만 합산(다른 값은 최신 걸로 덮어씀)
                snapshot_by_emp[eid]["installment_amount"] = (
                    (snapshot_by_emp[eid].get("installment_amount") or 0) + (s.get("installment_amount") or 0)
                )
        snapshot_employee_ids = set(snapshot_by_emp.keys())

        # 2) 스냅샷이 없는 직원은 예전 방식대로 오늘 기준으로 재계산해서 보완
        range_contribs = rest_request(
            "GET",
            f"pension_contributions?contribution_date=gte.{from_date}&contribution_date=lte.{to_date}&select=employee_id,amount",
        ) or []
        installment_map = {}
        for c in range_contribs:
            eid = c["employee_id"]
            installment_map[eid] = installment_map.get(eid, 0) + (c.get("amount") or 0)

        legacy_employee_ids = [eid for eid in installment_map.keys() if eid not in snapshot_employee_ids]

        legacy_rows_by_emp = {}
        if legacy_employee_ids:
            base = rest_request("GET", "pension_status?select=id,name,branch,department,hire_date") or []
            base_by_id = {b["id"]: b for b in base}
            emp_rows = rest_request("GET", "employees?select=id,position") or []
            position_by_id = {e["id"]: e.get("position") for e in emp_rows}

            year_of_to = to_date[:4]
            year_start = f"{year_of_to}-01-01"

            as_of_now = rpc("pension_status_as_of", {"p_as_of": today_str}) or []
            now_map = {r["id"]: r for r in as_of_now}
            as_of_prev_year = rpc("pension_status_as_of", {"p_as_of": f"{int(year_of_to) - 1}-12-31"}) or []
            prev_map = {r["id"]: r for r in as_of_prev_year}

            ytd_contribs = rest_request(
                "GET",
                f"pension_contributions?contribution_date=gte.{year_start}&contribution_date=lte.{today_str}&select=employee_id,amount",
            ) or []
            ytd_paid_map = {}
            for c in ytd_contribs:
                eid = c["employee_id"]
                ytd_paid_map[eid] = ytd_paid_map.get(eid, 0) + (c.get("amount") or 0)

            for eid in legacy_employee_ids:
                b = base_by_id.get(eid, {})
                now_cum = (now_map.get(eid, {}) or {}).get("as_of_cumulative_estimate", 0) or 0
                prev_cum = (prev_map.get(eid, {}) or {}).get("as_of_cumulative_estimate", 0) or 0
                total_contributed = (now_map.get(eid, {}) or {}).get("as_of_paid", 0) or 0
                legacy_rows_by_emp[eid] = {
                    "id": eid,
                    "name": b.get("name"),
                    "branch": b.get("branch"),
                    "department": b.get("department"),
                    "position": position_by_id.get(eid),
                    "hire_date": b.get("hire_date"),
                    "cumulative_estimate": round(now_cum),
                    "total_contributed": round(total_contributed),
                    "balance": round(now_cum - total_contributed),
                    "ytd_accrual": round(now_cum - prev_cum),
                    "ytd_paid": ytd_paid_map.get(eid, 0),
                    "installment_amount": installment_map.get(eid, 0),
                }

        rows = []
        for eid, s in snapshot_by_emp.items():
            rows.append({
                "id": eid,
                "name": s.get("name"),
                "branch": s.get("branch"),
                "department": s.get("department"),
                "position": s.get("position"),
                "hire_date": s.get("hire_date"),
                "cumulative_estimate": s.get("cumulative_estimate"),
                "total_contributed": s.get("total_contributed"),
                "balance": s.get("balance"),
                "ytd_accrual": s.get("ytd_accrual"),
                "ytd_paid": s.get("ytd_paid"),
                "installment_amount": s.get("installment_amount"),
            })
        rows.extend(legacy_rows_by_emp.values())

        if not rows:
            return self._send(200, {"rows": [], "from": from_date, "to": to_date, "as_of": today_str})

        if legacy_employee_ids and snapshot_employee_ids:
            snapshot_note = f"저장 시점 자료 기준 (일부 {len(legacy_employee_ids)}명은 스냅샷이 없어 오늘({today_str}) 기준으로 재계산됨)"
        elif legacy_employee_ids:
            snapshot_note = f"이관된 과거 자료라 저장 시점 스냅샷이 없어 오늘({today_str}) 기준으로 재계산됨"
        else:
            snapshot_note = "저장 시점(정산지급일 처리 당시) 자료 그대로 인쇄"

        return self._send(200, {
            "rows": rows, "from": from_date, "to": to_date, "as_of": today_str,
            "snapshot_note": snapshot_note,
        })

    def _refresh_installment_snapshot(self, date_str):
        """특정 지급일자(date_str)의 스냅샷을, 그 시점에 실제 존재하는 pension_contributions
        전체를 기준으로 다시 계산해서 덮어씀. 추가/수정/삭제 등 어떤 변경이 있었든 이 함수를
        호출하면 항상 '지금 이 순간의 최종 상태'가 스냅샷에 그대로 반영됨.
        (마감된 지급일자에는 애초에 쓰기 자체가 막혀있으므로, 이 함수는 항상 '마감 해제된
        상태에서의 변경 직후' 또는 '일괄저장/마감 처리 시점'에만 호출됨)
        해당 지급일자에 남은 불입 기록이 하나도 없으면(전부 삭제됐으면) 스냅샷도 전부 지움."""
        date_str = date_str[:10]
        import datetime
        kst_today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()
        today_str = kst_today.isoformat()

        current_rows = rest_request(
            "GET", f"pension_contributions?contribution_date=eq.{date_str}&select=employee_id,amount"
        ) or []
        current_amounts = {}
        for r in current_rows:
            eid = r["employee_id"]
            current_amounts[eid] = current_amounts.get(eid, 0) + (r.get("amount") or 0)

        # 기존 스냅샷 중, 더 이상 이 날짜에 불입 기록이 없는 직원의 스냅샷은 유령 데이터가
        # 되므로 지움(예: 유일한 기록이 삭제된 경우)
        existing_snap = rest_request(
            "GET", f"pension_installment_snapshots?installment_date=eq.{date_str}&select=employee_id"
        ) or []
        for s in existing_snap:
            if s["employee_id"] not in current_amounts:
                rest_request(
                    "DELETE",
                    f"pension_installment_snapshots?installment_date=eq.{date_str}&employee_id=eq.{s['employee_id']}",
                )

        if not current_amounts:
            return

        base = rest_request("GET", "pension_status?select=id,name,branch,department,hire_date") or []
        base_by_id = {b["id"]: b for b in base}
        emp_rows = rest_request("GET", "employees?select=id,position") or []
        position_by_id = {e["id"]: e.get("position") for e in emp_rows}

        as_of_now = rpc("pension_status_as_of", {"p_as_of": today_str}) or []
        now_map = {r["id"]: r for r in as_of_now}

        year_start = f"{date_str[:4]}-01-01"
        prev_year_end = f"{int(date_str[:4]) - 1}-12-31"
        as_of_prev_year = rpc("pension_status_as_of", {"p_as_of": prev_year_end}) or []
        prev_map = {r["id"]: r for r in as_of_prev_year}
        ytd_contribs = rest_request(
            "GET",
            f"pension_contributions?contribution_date=gte.{year_start}&contribution_date=lte.{today_str}&select=employee_id,amount",
        ) or []
        ytd_paid_map = {}
        for c in ytd_contribs:
            eid = c["employee_id"]
            ytd_paid_map[eid] = ytd_paid_map.get(eid, 0) + (c.get("amount") or 0)

        snapshot_body = []
        for eid, amount in current_amounts.items():
            b = base_by_id.get(eid, {})
            now_cum = (now_map.get(eid, {}) or {}).get("as_of_cumulative_estimate", 0) or 0
            total_contributed = (now_map.get(eid, {}) or {}).get("as_of_paid", 0) or 0
            prev_cum = (prev_map.get(eid, {}) or {}).get("as_of_cumulative_estimate", 0) or 0
            snapshot_body.append({
                "installment_date": date_str,
                "employee_id": eid,
                "name": b.get("name"),
                "branch": b.get("branch"),
                "department": b.get("department"),
                "position": position_by_id.get(eid),
                "hire_date": b.get("hire_date"),
                "cumulative_estimate": round(now_cum),
                "total_contributed": round(total_contributed),
                "balance": round(now_cum - total_contributed),
                "ytd_accrual": round(now_cum - prev_cum),
                "ytd_paid": ytd_paid_map.get(eid, 0),
                "installment_amount": amount,
            })

        if snapshot_body:
            rest_request(
                "POST", "pension_installment_snapshots?on_conflict=installment_date,employee_id",
                body=snapshot_body, prefer="resolution=merge-duplicates",
            )

    def _build_yearly_for_employee(self, employee_id):
        import datetime
        _kst_today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()
        emp = rest_request("GET", f"employees?id=eq.{employee_id}&select=hire_date,retire_date")
        if not emp:
            return []
        hire_date = emp[0]["hire_date"]
        retire_date = emp[0].get("retire_date")
        hire_year = int(hire_date[:4])
        end_year = int(retire_date[:4]) if retire_date else _kst_today.year

        history = rest_request(
            "GET", f"pension_cumulative_history?employee_id=eq.{employee_id}&select=year,cumulative_estimate"
        ) or []
        history_by_year = {h["year"]: h["cumulative_estimate"] for h in history}
        earliest_known_year = min(history_by_year.keys()) if history_by_year else 2026

        start_year = max(hire_year, earliest_known_year)
        today = _kst_today.isoformat()

        rows = []
        for y in range(start_year, end_year + 1):
            if y in history_by_year:
                cum_estimate = history_by_year[y]
            else:
                as_of = retire_date if (retire_date and y == end_year) else (today if y == end_year else f"{y}-12-31")
                cum_estimate = rpc("pension_cumulative_estimate", {"p_employee_id": employee_id, "p_as_of": as_of}) or 0

            as_of_paid = retire_date if (retire_date and y == end_year) else (today if y == end_year else f"{y}-12-31")
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

            # 적립배수 추가: {"type": "multiplier", employee_id, effective_date, multiplier,
            #   include_bonus1, include_bonus2, include_severance_bonus, include_other_allowance, include_annual_leave_pay, note}
            if isinstance(payload, dict) and payload.get("type") == "multiplier":
                emp_id = payload.get("employee_id")
                effective_date = payload.get("effective_date")
                multiplier = payload.get("multiplier")
                if not emp_id or not effective_date or multiplier is None:
                    return self._send(400, {"error": "employee_id, effective_date, multiplier는 필수입니다"})
                created = rest_request("POST", "pension_multiplier_history", body={
                    "employee_id": emp_id,
                    "effective_date": effective_date,
                    "multiplier": multiplier,
                    "include_bonus1": bool(payload.get("include_bonus1")),
                    "include_bonus2": bool(payload.get("include_bonus2")),
                    "include_severance_bonus": bool(payload.get("include_severance_bonus")),
                    "include_other_allowance": bool(payload.get("include_other_allowance")),
                    "include_annual_leave_pay": bool(payload.get("include_annual_leave_pay")),
                    "note": payload.get("note"),
                }, prefer="return=representation")
                return self._send(201, {"multiplier": created[0] if created else None})

            # 마감/마감해제: {"type": "lock", period_key: "2026", locked: true/false, note}  (연도 단위)
            if isinstance(payload, dict) and payload.get("type") == "lock":
                period_key = payload.get("period_key")
                locked = payload.get("locked", True)
                if not period_key:
                    return self._send(400, {"error": "period_key는 필수입니다"})
                rest_request(
                    "POST", "period_locks?on_conflict=module,period_key",
                    body={"module": "pension", "period_key": period_key, "locked": locked, "note": payload.get("note")},
                    prefer="resolution=merge-duplicates",
                )
                return self._send(200, {"ok": True})

            # 차수(지급일자) 단위 마감/마감해제: {"type": "lock_installment", period_key: "2026-09-30", locked: true/false}
            # 마감(locked=true) 시점에 그 지급일자의 최종 상태를 스냅샷으로 다시 굳혀둠(= 이 순간이 "확정본").
            if isinstance(payload, dict) and payload.get("type") == "lock_installment":
                date_str = payload.get("period_key")
                locked = payload.get("locked", True)
                if not date_str:
                    return self._send(400, {"error": "period_key(지급일자)는 필수입니다"})
                if locked:
                    try:
                        self._refresh_installment_snapshot(date_str)
                    except Exception:
                        pass
                rest_request(
                    "POST", "period_locks?on_conflict=module,period_key",
                    body={"module": "pension_installment", "period_key": date_str[:10], "locked": locked, "note": payload.get("note")},
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
            # "정산지급일로 일괄 저장"은 그 지급일자를 확정하는 행위이므로, 저장 성공 즉시
            # 그 지급일자를 자동으로 마감(차수 마감)하고 최종 상태를 스냅샷으로 굳혀둠.
            # 이미 마감된 지급일자에 추가로 넣으려면 먼저 마감해제해야 함.
            if isinstance(payload, dict) and "items" in payload:
                items = payload["items"]
                if not items:
                    return self._send(400, {"error": "items가 비어있습니다"})
                body = []
                locked_years = set()
                locked_dates = set()
                for it in items:
                    if not it.get("employee_id") or not it.get("contribution_date") or it.get("amount") is None:
                        continue
                    y = year_of(it["contribution_date"])
                    if is_period_locked(y):
                        locked_years.add(y)
                        continue
                    d = it["contribution_date"][:10]
                    if is_installment_locked(d):
                        locked_dates.add(d)
                        continue
                    body.append({
                        "employee_id": it["employee_id"],
                        "contribution_date": it["contribution_date"],
                        "amount": it["amount"],
                        "note": it.get("note"),
                    })
                if (locked_years or locked_dates) and not body:
                    msgs = []
                    if locked_years:
                        msgs.append(f"{', '.join(sorted(locked_years))}년이 마감되어")
                    if locked_dates:
                        msgs.append(f"{', '.join(sorted(locked_dates))} 차수가 마감되어")
                    return self._send(423, {"error": f"{' / '.join(msgs)} 저장할 항목이 없습니다. 먼저 마감해제해주세요."})
                if not body:
                    return self._send(400, {"error": "유효한 항목이 없습니다"})
                created = rest_request("POST", "pension_contributions", body=body, prefer="return=representation")
                result = {"contributions": created, "count": len(created) if created else 0}
                if locked_years:
                    result["skipped_locked_years"] = sorted(locked_years)
                if locked_dates:
                    result["skipped_locked_dates"] = sorted(locked_dates)
                affected_dates = sorted({it["contribution_date"][:10] for it in body})
                for d in affected_dates:
                    try:
                        self._refresh_installment_snapshot(d)
                        rest_request(
                            "POST", "period_locks?on_conflict=module,period_key",
                            body={"module": "pension_installment", "period_key": d, "locked": True,
                                  "note": "정산지급일 일괄 저장 시 자동 마감"},
                            prefer="resolution=merge-duplicates",
                        )
                    except Exception:
                        # 스냅샷/자동마감에 실패해도 불입 저장 자체는 이미 성공했으므로 조용히 넘어감
                        # (이 경우 "이 차수 인쇄"는 오늘 기준으로 재계산해서 보여주는 방식으로 자동 대체됨)
                        pass
                result["locked_dates"] = affected_dates
                return self._send(201, result)

            # 단건 저장 ("+ 불입 기록 추가"). 이것도 일괄 저장과 동일하게 그 지급일자의
            # 스냅샷을 즉시 갱신해두지만, 자동으로 마감하지는 않음(여러 명 나눠서 입력하는
            # 중간중간 잠기면 불편하므로) — 다 끝나면 목록에서 "마감" 버튼으로 직접 잠그면 됨.
            emp_id = payload.get("employee_id")
            contribution_date = payload.get("contribution_date")
            amount = payload.get("amount")
            if not emp_id or not contribution_date or amount is None:
                return self._send(400, {"error": "employee_id, contribution_date, amount는 필수입니다"})
            if is_period_locked(year_of(contribution_date)):
                return self._send(423, {"error": f"{year_of(contribution_date)}년은 마감되어 있습니다. 먼저 마감해제해주세요."})
            if is_installment_locked(contribution_date):
                return self._send(423, {"error": f"{contribution_date[:10]} 차수는 마감되어 있습니다. 먼저 마감해제해주세요."})

            created = rest_request("POST", "pension_contributions", body={
                "employee_id": emp_id,
                "contribution_date": contribution_date,
                "amount": amount,
                "note": payload.get("note"),
            }, prefer="return=representation")
            try:
                self._refresh_installment_snapshot(contribution_date)
            except Exception:
                pass
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
            old_date = existing[0]["contribution_date"] if existing else None
            if existing:
                check_date = payload.get("contribution_date") or existing[0]["contribution_date"]
                if is_pre_2026(year_of(existing[0]["contribution_date"])) or is_pre_2026(year_of(check_date)):
                    return self._send(423, {"error": "2025년 이전 확정자료는 수정할 수 없습니다."})
                if is_period_locked(year_of(check_date)) or is_period_locked(year_of(existing[0]["contribution_date"])):
                    return self._send(423, {"error": "마감된 연도의 데이터는 수정할 수 없습니다. 먼저 마감해제해주세요."})
                if is_installment_locked(check_date) or is_installment_locked(existing[0]["contribution_date"]):
                    return self._send(423, {"error": "마감된 차수(지급일자)의 데이터는 수정할 수 없습니다. 먼저 마감해제해주세요."})

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
            new_date = payload.get("contribution_date") or old_date
            try:
                if old_date:
                    self._refresh_installment_snapshot(old_date)
                if new_date and new_date != old_date:
                    self._refresh_installment_snapshot(new_date)
            except Exception:
                pass
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

            if qs.get("type", [None])[0] == "multiplier":
                rest_request("DELETE", f"pension_multiplier_history?id=eq.{item_id}")
                return self._send(200, {"ok": True})

            is_adjustment = qs.get("type", [None])[0] == "adjustment"
            table = "pension_accrual_adjustments" if is_adjustment else "pension_contributions"
            date_field = "effective_date" if is_adjustment else "contribution_date"

            existing = rest_request("GET", f"{table}?id=eq.{item_id}&select={date_field}")
            if existing and is_pre_2026(year_of(existing[0][date_field])):
                return self._send(423, {"error": "2025년 이전 확정자료는 삭제할 수 없습니다."})
            if existing and is_period_locked(year_of(existing[0][date_field])):
                return self._send(423, {"error": "마감된 연도의 데이터는 삭제할 수 없습니다. 먼저 마감해제해주세요."})
            if existing and not is_adjustment and is_installment_locked(existing[0][date_field]):
                return self._send(423, {"error": "마감된 차수(지급일자)의 데이터는 삭제할 수 없습니다. 먼저 마감해제해주세요."})

            rest_request("DELETE", f"{table}?id=eq.{item_id}")
            if existing and not is_adjustment:
                try:
                    self._refresh_installment_snapshot(existing[0][date_field])
                except Exception:
                    pass
            return self._send(200, {"ok": True})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
