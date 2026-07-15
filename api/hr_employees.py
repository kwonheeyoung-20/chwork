"""
/api/hr_employees

GET    -> 재직자 목록(기본) + 각자 최신 연봉. ?all=1 이면 퇴사자 포함 전체.
POST   -> 신규 직원 추가
PATCH  -> 기존 직원 정보 수정 (body에 id 포함)

모든 요청에 X-HR-Password 헤더 필요 (hr_login에서 확인한 비밀번호).
"""
from http.server import BaseHTTPRequestHandler
import json
from urllib.parse import urlparse, parse_qs, quote
from _supabase import rest_request, SupabaseError, check_password


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        qs = parse_qs(urlparse(self.path).query)
        show_all = qs.get("all", ["0"])[0] == "1"

        try:
            select = "select=*,salary_history(effective_month,annual_salary_thousand,reason)"
            filt = "" if show_all else f"&status=eq.{quote('재직')}"
            data = rest_request("GET", f"employees?{select}{filt}&order=hire_date.asc")
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "detail": e.body})

        # 각 직원의 최신 연봉만 뽑아서 편의 필드로 추가
        for emp in data:
            hist = sorted(emp.get("salary_history") or [], key=lambda h: h["effective_month"])
            emp["current_salary_thousand"] = hist[-1]["annual_salary_thousand"] if hist else None

        return self._send(200, {"employees": data})

    def do_POST(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        payload = json.loads(raw or b"{}")

        emp_fields = {k: payload.get(k) for k in (
            "name", "position", "branch", "department", "hire_date", "retire_date",
            "status", "employment_type", "contract_fixed_salary", "unused_leave_days",
            "pension_enrolled", "note"
        ) if payload.get(k) is not None}
        emp_fields.setdefault("status", "재직")

        try:
            created = rest_request("POST", "employees", body=emp_fields, prefer="return=representation")
            new_emp = created[0]
            if payload.get("annual_salary_thousand") is not None:
                rest_request("POST", "salary_history", body={
                    "employee_id": new_emp["id"],
                    "effective_month": payload.get("effective_month") or payload.get("hire_date"),
                    "annual_salary_thousand": payload["annual_salary_thousand"],
                    "reason": "신규입사",
                })
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "detail": e.body})

        return self._send(201, {"employee": new_emp})

    def do_PATCH(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        payload = json.loads(raw or b"{}")
        emp_id = payload.get("id")
        if not emp_id:
            return self._send(400, {"error": "id required"})

        update_fields = {k: v for k, v in payload.items() if k != "id" and k not in (
            "new_salary_thousand", "new_salary_effective_month", "new_salary_reason"
        )}

        try:
            if update_fields:
                rest_request("PATCH", f"employees?id=eq.{emp_id}", body=update_fields)
            if payload.get("new_salary_thousand") is not None:
                rest_request("POST", "salary_history", body={
                    "employee_id": emp_id,
                    "effective_month": payload.get("new_salary_effective_month"),
                    "annual_salary_thousand": payload["new_salary_thousand"],
                    "reason": payload.get("new_salary_reason") or "연봉 변경",
                })
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "detail": e.body})

        return self._send(200, {"ok": True})

    def log_message(self, *args):
        pass
