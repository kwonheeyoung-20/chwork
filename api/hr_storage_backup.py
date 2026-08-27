"""contracts Storage 첨부파일 백업용 임시 다운로드 목록 API.

실제 파일을 Vercel 함수가 중계하지 않고, 관리자 인증 후 1시간짜리 signed URL과
원래 파일명을 반환합니다. 브라우저가 이 목록을 읽어 ZIP을 생성합니다.
"""
from http.server import BaseHTTPRequestHandler
import datetime
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")
BUCKET = "contracts"
SIGNED_URL_TTL = 3600


class SupabaseError(Exception):
    pass


def _headers():
    return {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "Content-Type": "application/json",
    }


def _request(method, url, body=None, timeout=25):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")
        raise SupabaseError(f"Supabase 오류 {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise SupabaseError(f"Supabase 연결 실패: {exc.reason}")


def _rest_rows():
    # 운영 테이블에는 created_at 컬럼이 없으므로 실제 저장에 사용하는 열만 조회합니다.
    path = "contract_document_files?select=id,document_id,file_name,storage_path,file_size,content_type&order=id.asc"
    safe = urllib.parse.quote(path, safe="?&=,.*:()!~%")
    return _request("GET", f"{SUPABASE_URL}/rest/v1/{safe}") or []


def _list_objects(prefix=""):
    """버킷을 페이지 단위로 순회합니다. 폴더가 있으면 재귀적으로 포함합니다."""
    found = []
    offset = 0
    limit = 1000
    while True:
        rows = _request(
            "POST",
            f"{SUPABASE_URL}/storage/v1/object/list/{BUCKET}",
            {"prefix": prefix, "limit": limit, "offset": offset,
             "sortBy": {"column": "name", "order": "asc"}},
        ) or []
        for row in rows:
            name = row.get("name")
            if not name:
                continue
            full_path = f"{prefix}/{name}" if prefix else name
            # Storage API의 가상 폴더는 id가 없고 metadata도 없습니다.
            if row.get("id") is None and row.get("metadata") is None:
                found.extend(_list_objects(full_path))
            else:
                found.append({"storage_path": full_path, "metadata": row.get("metadata") or {}})
        if len(rows) < limit:
            break
        offset += limit
    return found


def _signed_url(path):
    encoded = urllib.parse.quote(path, safe="/")
    result = _request(
        "POST",
        f"{SUPABASE_URL}/storage/v1/object/sign/{BUCKET}/{encoded}",
        {"expiresIn": SIGNED_URL_TTL},
    ) or {}
    signed_path = result.get("signedURL") or result.get("signedUrl")
    if not signed_path:
        raise SupabaseError(f"임시 다운로드 주소 생성 실패: {path}")
    if signed_path.startswith("http"):
        return signed_path
    return f"{SUPABASE_URL}/storage/v1{signed_path}"


def _safe_name(name, fallback):
    name = (name or fallback).replace("\\", "_").replace("/", "_").strip()
    return name or fallback


class handler(BaseHTTPRequestHandler):
    def _send(self, status, obj):
        raw = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-HR-Password")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self._send(200, {"ok": True})

    def do_GET(self):
        if not HR_PASSWORD or self.headers.get("X-HR-Password", "") != HR_PASSWORD:
            return self._send(401, {"error": "unauthorized"})
        if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
            return self._send(500, {"error": "Supabase 환경변수가 비어있습니다."})
        try:
            db_rows = _rest_rows()
            by_path = {row.get("storage_path"): row for row in db_rows if row.get("storage_path")}
            objects = _list_objects()
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

            # 파일 수가 많아도 Vercel 함수가 시간초과되지 않도록 임시 주소를 병렬 생성합니다.
            with ThreadPoolExecutor(max_workers=8) as pool:
                signed_urls = list(pool.map(_signed_url, [item["storage_path"] for item in files]))
            for item, signed_url in zip(files, signed_urls):
                item["signed_url"] = signed_url

            known_paths = {obj["storage_path"] for obj in objects}
            missing = [row.get("storage_path") for row in db_rows if row.get("storage_path") not in known_paths]
            return self._send(200, {
                "bucket": BUCKET,
                "created_at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                "expires_in_seconds": SIGNED_URL_TTL,
                "file_count": len(files),
                "total_size": sum(int(item.get("size") or 0) for item in files),
                "missing_storage_paths": missing,
                "files": files,
            })
        except Exception as exc:
            return self._send(502, {"error": "storage_backup_error", "detail": str(exc)})

    def log_message(self, *args):
        pass
