"""
/api/hr_backup

GET -> 전체 데이터(직원/급여/퇴직연금/성과급 등 모든 테이블)를 하나의 JSON 파일로
       내려받습니다. 관리자가 주기적으로 눌러서 다른 곳(구글드라이브 등)에
       보관해두는 수동 백업용입니다.

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
from concurrent.futures import ThreadPoolExecutor, as_completed

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")

# 백업 대상 테이블 전체 목록
BACKUP_TABLES = [
    "employees",
    "salary_history",
    "payroll_settings_history",
    "minimum_wage_history",
    "holidays",
    "leave_adjustments",
    "monthly_payroll",
    "payroll_retroactive_log",
    "other_payments",
    "pension_contributions",
    "pension_settlements",
    "pension_accrual_adjustments",
    "pension_cumulative_history",
    "pension_multiplier_history",
    "period_locks",
]


class SupabaseError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"Supabase error {status}: {body}")


def _sb_headers():
    return {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "Content-Type": "application/json",
    }


def rest_request(path):
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        raise SupabaseError(0, "SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 비어있습니다.")
    url = f"{SUPABASE_URL}/rest/v1/{urllib.parse.quote(path, safe='?&=,.*:()!~%/')}"
    req = urllib.request.Request(url, method="GET", headers=_sb_headers())
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        raise SupabaseError(e.code, e.read().decode("utf-8", "ignore"))
    except urllib.error.URLError as e:
        raise SupabaseError(0, f"URL 연결 실패: {e.reason}")


def check_password(candidate: str) -> bool:
    if not HR_PASSWORD:
        return False
    return candidate == HR_PASSWORD


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-HR-Password",
    }


class handler(BaseHTTPRequestHandler):
    def _authorized(self):
        return check_password(self.headers.get("X-HR-Password", ""))

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
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
                return self._send_json(401, {"error": "unauthorized"})

            backup = {
                "backup_created_at": datetime.datetime.utcnow().isoformat() + "Z",
                "tables": {},
            }
            errors = {}

            def fetch_one(table):
                try:
                    return table, rest_request(f"{table}?select=*"), None
                except SupabaseError as e:
                    return table, [], str(e)

            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(fetch_one, t) for t in BACKUP_TABLES]
                for fut in as_completed(futures):
                    table, rows, err = fut.result()
                    backup["tables"][table] = rows
                    if err:
                        errors[table] = err

            if errors:
                backup["_errors"] = errors

            filename = f"chwork_backup_{(datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date().isoformat()}.json"
            body = json.dumps(backup, ensure_ascii=False, default=str, indent=2).encode("utf-8")

            self.send_response(200)
            for k, v in _cors_headers().items():
                self.send_header(k, v)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except SupabaseError as e:
            return self._send_json(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send_json(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
