"""
/api/hr_backup

GET -> 앱이 사용하는 전체 업무 데이터(인사/급여/퇴직연금/일정/계약/연락처/
       개인일정/시간표/보고서 등)를 하나의 JSON 파일로 내려받습니다.
       관리자가 주기적으로 눌러서 별도 저장소에 보관하는 수동 백업용입니다.

주의: Supabase Storage의 실제 첨부파일 바이트는 이 JSON에 포함하지 않습니다.
      첨부파일의 경로와 메타데이터는 관련 테이블에 포함되며 실제 파일은
      Storage 버킷을 별도로 백업해야 합니다.

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

# 앱 코드에서 읽거나 쓰는 public 스키마의 업무 데이터 테이블 전체 목록.
# 새 기능에서 테이블을 추가하면 반드시 이 목록에도 추가합니다.
BACKUP_TABLES = [
    # 인사·급여
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
    # 성과급·인사기록 보고서
    "bonus_reports",
    "bonus_report_notes",
    "position_history",
    "position_pay_standards",
    "promotion_reports",
    # 업무 일정
    "tax_schedule_tasks",
    "tax_schedule_occurrences",
    # 거래처·계약·증빙
    "vendor_contacts",
    "contract_documents",
    "contract_document_files",
    "contract_renewals",
    # 대시보드·매뉴얼
    "daily_todos",
    "module_manuals",
    # 개인 일정·가족 공유
    "personal_schedule_members",
    "personal_schedule_tasks",
    "personal_schedule_occurrences",
    "family_notes",
    # 학교 시간표
    "timetable_period_times",
    "timetable_teachers",
    "timetable_entries",
    "pension_installment_snapshots",
    # 월마감 보고서
    "monthly_closing_remarks",
    "monthly_closing_reports",
]

# 실제 파일은 별도 백업이 필요하다는 점을 백업 파일 자체에도 남깁니다.
STORAGE_BUCKETS = ["contracts"]
BACKUP_FORMAT_VERSION = 2
PAGE_SIZE = 1000
# 이 테이블은 관련 기능의 마이그레이션을 아직 적용하지 않은 프로젝트에서도
# 앱이 정상 동작하도록 설계되어 있습니다. 없으면 경고만 남기고 백업은 완료로 봅니다.
OPTIONAL_TABLES = {"bonus_report_notes"}


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


def fetch_all_rows(table):
    """PostgREST의 기본 최대 반환 건수(보통 1,000건)를 넘어도 전부 조회합니다."""
    rows = []
    offset = 0
    while True:
        separator = "&" if "?" in table else "?"
        batch = rest_request(
            f"{table}{separator}select=*&limit={PAGE_SIZE}&offset={offset}"
        ) or []
        if not isinstance(batch, list):
            raise SupabaseError(0, f"{table} 응답이 목록 형식이 아닙니다.")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


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

            created_at_utc = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
            backup = {
                "backup_format_version": BACKUP_FORMAT_VERSION,
                "backup_created_at": created_at_utc,
                "backup_scope": "chwork_all_application_tables",
                "source": {
                    "git_commit_sha": os.environ.get("VERCEL_GIT_COMMIT_SHA"),
                    "git_branch": os.environ.get("VERCEL_GIT_COMMIT_REF"),
                },
                "storage_files_included": False,
                "storage_buckets_to_backup_separately": STORAGE_BUCKETS,
                "tables": {},
                "summary": {
                    "requested_table_count": len(BACKUP_TABLES),
                    "successful_table_count": 0,
                    "failed_table_count": 0,
                    "warning_table_count": 0,
                    "total_row_count": 0,
                    "row_counts": {},
                    "complete": False,
                },
            }
            errors = {}
            warnings = {}

            def fetch_one(table):
                try:
                    return table, fetch_all_rows(table), None
                except SupabaseError as e:
                    return table, [], str(e)

            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(fetch_one, t) for t in BACKUP_TABLES]
                for fut in as_completed(futures):
                    table, rows, err = fut.result()
                    backup["tables"][table] = rows
                    backup["summary"]["row_counts"][table] = len(rows)
                    if err:
                        if table in OPTIONAL_TABLES:
                            warnings[table] = err
                        else:
                            errors[table] = err

            # 비동기 완료 순서와 관계없이 파일 내부 순서를 항상 일정하게 유지합니다.
            backup["tables"] = {
                table: backup["tables"].get(table, []) for table in BACKUP_TABLES
            }
            backup["summary"]["row_counts"] = {
                table: backup["summary"]["row_counts"].get(table, 0)
                for table in BACKUP_TABLES
            }
            backup["summary"]["failed_table_count"] = len(errors)
            backup["summary"]["warning_table_count"] = len(warnings)
            backup["summary"]["successful_table_count"] = (
                len(BACKUP_TABLES) - len(errors) - len(warnings)
            )
            backup["summary"]["total_row_count"] = sum(
                backup["summary"]["row_counts"].values()
            )
            backup["summary"]["complete"] = not errors

            if errors:
                backup["_errors"] = errors
            if warnings:
                backup["_warnings"] = warnings

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
