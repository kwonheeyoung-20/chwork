"""
/api/hr_backup

두 가지 백업을 한 함수로 처리합니다 (Vercel 함수 개수 절약용 통합):

  ?mode=full (기본값, /api/hr_backup 경로) ->
      앱이 사용하는 전체 업무 데이터(인사/급여/퇴직연금/일정/계약/연락처/
      개인일정/시간표/알림장·앨범/보고서 등)를 하나의 JSON 파일로 내려받습니다.

  ?mode=zip (/api/hr_storage_backup 경로) ->
      Supabase Storage(contracts 버킷)의 실제 첨부파일 목록 + 1시간짜리 임시
      다운로드 주소를 돌려줍니다. 실제 zip 압축은 브라우저(JSZip)가 합니다.

기존 두 URL(/api/hr_backup, /api/hr_storage_backup)은 vercel.json에서
이 파일 하나로 mode만 다르게 라우팅되므로, 프론트엔드는 전혀 안 바뀝니다.

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
from urllib.parse import urlparse, parse_qs

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")
STORAGE_BUCKET = "contracts"
SIGNED_URL_TTL = 3600

# ────────────────────────────────────────────────────────────
# mode=full 전용 설정
# ────────────────────────────────────────────────────────────
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
    "personal_media",
    # 월마감 보고서
    "monthly_closing_remarks",
    "monthly_closing_reports",
]
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


def rest_get(path):
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


def rest_request(method, url, body=None, timeout=25):
    """mode=zip 쪽에서 쓰는 범용 요청(스토리지 API 등 REST 이외의 절대경로 호출용)."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_sb_headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise SupabaseError(exc.code, exc.read().decode("utf-8", "ignore"))
    except urllib.error.URLError as exc:
        raise SupabaseError(0, f"Supabase 연결 실패: {exc.reason}")


def fetch_all_rows(table):
    """PostgREST의 기본 최대 반환 건수(보통 1,000건)를 넘어도 전부 조회합니다."""
    rows = []
    offset = 0
    while True:
        separator = "&" if "?" in table else "?"
        batch = rest_get(f"{table}{separator}select=*&limit={PAGE_SIZE}&offset={offset}") or []
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


# ────────────────────────────────────────────────────────────
# mode=zip 전용 함수 (Storage 첨부파일 목록 + 서명 URL)
# ────────────────────────────────────────────────────────────
def _storage_rest_rows():
    # contract_document_files(계약/증빙 첨부파일)뿐 아니라 monthly_closing_reports(월결산서
    # 산출물)도 같은 버킷(monthly_closing/ 하위경로)을 쓰므로 같이 조회해서
    # storage_path -> 원래 파일명 매핑에 포함시킴.
    contract_path = "contract_document_files?select=id,document_id,file_name,storage_path,file_size,content_type&order=id.asc"
    monthly_path = "monthly_closing_reports?select=id,file_name,storage_path&order=id.asc"
    rows = []
    for path in (contract_path, monthly_path):
        safe = urllib.parse.quote(path, safe="?&=,.*:()!~%")
        rows.extend(rest_request("GET", f"{SUPABASE_URL}/rest/v1/{safe}") or [])
    return rows


def _list_storage_objects(prefix=""):
    """버킷을 페이지 단위로 순회합니다. 폴더가 있으면 재귀적으로 포함합니다."""
    found = []
    offset = 0
    limit = 1000
    while True:
        rows = rest_request(
            "POST",
            f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
            {"prefix": prefix, "limit": limit, "offset": offset,
             "sortBy": {"column": "name", "order": "asc"}},
        ) or []
        for row in rows:
            name = row.get("name")
            if not name:
                continue
            full_path = f"{prefix}/{name}" if prefix else name
            if row.get("id") is None and row.get("metadata") is None:
                found.extend(_list_storage_objects(full_path))
            else:
                found.append({"storage_path": full_path, "metadata": row.get("metadata") or {}})
        if len(rows) < limit:
            break
        offset += limit
    return found


def _signed_url(path):
    encoded = urllib.parse.quote(path, safe="/")
    result = rest_request(
        "POST",
        f"{SUPABASE_URL}/storage/v1/object/sign/{STORAGE_BUCKET}/{encoded}",
        {"expiresIn": SIGNED_URL_TTL},
    ) or {}
    signed_path = result.get("signedURL") or result.get("signedUrl")
    if not signed_path:
        raise SupabaseError(0, f"임시 다운로드 주소 생성 실패: {path}")
    if signed_path.startswith("http"):
        return signed_path
    return f"{SUPABASE_URL}/storage/v1{signed_path}"


def _safe_name(name, fallback):
    name = (name or fallback).replace("\\", "_").replace("/", "_").strip()
    return name or fallback


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
            qs = parse_qs(urlparse(self.path).query)
            mode = qs.get("mode", ["full"])[0]

            if mode == "zip":
                return self._do_zip_backup()
            return self._do_full_backup()
        except SupabaseError as e:
            return self._send_json(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send_json(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _do_full_backup(self):
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

        backup["tables"] = {table: backup["tables"].get(table, []) for table in BACKUP_TABLES}
        backup["summary"]["row_counts"] = {
            table: backup["summary"]["row_counts"].get(table, 0) for table in BACKUP_TABLES
        }
        backup["summary"]["failed_table_count"] = len(errors)
        backup["summary"]["warning_table_count"] = len(warnings)
        backup["summary"]["successful_table_count"] = len(BACKUP_TABLES) - len(errors) - len(warnings)
        backup["summary"]["total_row_count"] = sum(backup["summary"]["row_counts"].values())
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

    def _do_zip_backup(self):
        if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
            return self._send_json(500, {"error": "Supabase 환경변수가 비어있습니다."})
        db_rows = _storage_rest_rows()
        by_path = {row.get("storage_path"): row for row in db_rows if row.get("storage_path")}
        objects = _list_storage_objects()
        used_names = set()
        files = []
        for obj in objects:
            path = obj["storage_path"]
            row = by_path.get(path, {})
            base_name = _safe_name(row.get("file_name"), path.rsplit("/", 1)[-1])
            zip_name = base_name
            counter = 2
            while zip_name.lower() in used_names:
                stem, dot, ext = base_name.rpartition(".")
                zip_name = f"{stem or base_name} ({counter}){dot + ext if dot else ''}"
                counter += 1
            used_names.add(zip_name.lower())
            metadata = obj.get("metadata") or {}
            files.append({
                "storage_path": path,
                "file_name": base_name,
                "zip_name": zip_name,
                "document_id": row.get("document_id"),
                "size": metadata.get("size"),
                "mimetype": metadata.get("mimetype"),
            })

        with ThreadPoolExecutor(max_workers=8) as pool:
            signed_urls = list(pool.map(_signed_url, [item["storage_path"] for item in files]))
        for item, signed_url in zip(files, signed_urls):
            item["signed_url"] = signed_url

        known_paths = {obj["storage_path"] for obj in objects}
        missing = [row.get("storage_path") for row in db_rows if row.get("storage_path") not in known_paths]
        return self._send_json(200, {
            "bucket": STORAGE_BUCKET,
            "created_at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "expires_in_seconds": SIGNED_URL_TTL,
            "file_count": len(files),
            "total_size": sum(int(item.get("size") or 0) for item in files),
            "missing_storage_paths": missing,
            "files": files,
        })

    def log_message(self, *args):
        pass
