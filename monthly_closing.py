from __future__ import annotations

import os
import uuid
import tempfile
import json
import io
import cgi
import base64
import sys
import datetime
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs, quote
from pathlib import Path
from http.server import BaseHTTPRequestHandler

TMP = Path(tempfile.gettempdir())
ROOT = Path(__file__).parent.parent
TEMPLATE_PATH = ROOT / "monthly_closing_template.xlsx"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")
BUCKET = "contracts"  # 계약서류와 같은 버킷을 재사용, monthly_closing/ 하위 경로만 다르게

SHEET_FIELD_MAP = {
    "bs_file": "재무상태표",
    "is_file": "손익계산서",
    "pl_current_file": "기간별손익계산서",
    "pl_prior_file": "기간별손익계산서(전년동기)",
}


class SupabaseError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"Supabase error {status}: {body}")


def rest_request(method, path, body=None, prefer=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SupabaseError(e.code, e.read().decode("utf-8", "ignore"))
    except urllib.error.URLError as e:
        raise SupabaseError(0, f"URL 연결 실패: {e.reason}")


def storage_upload(path, data_bytes, content_type):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path)}"
    req = urllib.request.Request(url, data=data_bytes, method="POST", headers={
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "apikey": SUPABASE_SECRET_KEY,
        "Content-Type": content_type or "application/octet-stream",
        "x-upsert": "true",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def storage_sign_url(path, expires_in=3600):
    if not path:
        return None
    url = f"{SUPABASE_URL}/storage/v1/object/sign/{BUCKET}/{quote(path)}"
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


def check_password(candidate: str) -> bool:
    if not HR_PASSWORD:
        return False
    return candidate == HR_PASSWORD


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-HR-Password",
        "Content-Type": "application/json",
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)

            if qs.get("list", ["0"])[0] == "1":
                rows = rest_request(
                    "GET", "monthly_closing_reports?select=*&order=period_key.desc"
                ) or []
                return self._json(200, {"ok": True, "reports": rows})

            period_key = qs.get("period_key", [None])[0]
            if period_key:
                rows = rest_request(
                    "GET", f"monthly_closing_reports?period_key=eq.{period_key}&select=*"
                ) or []
                if not rows:
                    return self._json(404, {"ok": False, "message": "해당 월의 저장된 보고서가 없습니다."})
                signed = storage_sign_url(rows[0]["storage_path"])
                if not signed:
                    return self._json(500, {"ok": False, "message": "다운로드 링크 생성 실패"})
                return self._json(200, {"ok": True, "url": signed, "file_name": rows[0]["file_name"]})

            return self._json(400, {"ok": False, "message": "list=1 또는 period_key 파라미터가 필요합니다."})
        except SupabaseError as e:
            return self._json(502, {"ok": False, "message": f"supabase_error: {e.body}"})
        except Exception as exc:
            return self._json(500, {"ok": False, "message": str(exc)})

    def do_POST(self):
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        environ = {
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": content_type,
            "CONTENT_LENGTH": str(length),
        }
        fs = cgi.FieldStorage(fp=io.BytesIO(body), environ=environ, keep_blank_values=True)

        def save_field(name):
            if name not in fs:
                return None
            item = fs[name]
            if not hasattr(item, "filename") or not item.filename:
                return None
            suffix = Path(item.filename).suffix or ".xlsx"
            tmp_path = TMP / f"{uuid.uuid4().hex}{suffix}"
            tmp_path.write_bytes(item.file.read())
            return tmp_path

        uploaded = {}
        for field_name, sheet_name in SHEET_FIELD_MAP.items():
            p = save_field(field_name)
            if p is not None:
                uploaded[sheet_name] = str(p)

        base_date_str = fs.getvalue("base_date")
        if not base_date_str:
            self._json(400, {"ok": False, "message": "기준일자는 필수입니다."})
            return
        try:
            base_date = datetime.date.fromisoformat(base_date_str)
        except ValueError:
            self._json(400, {"ok": False, "message": "기준일자 형식이 올바르지 않습니다 (YYYY-MM-DD)."})
            return

        prepared_date_str = fs.getvalue("prepared_date")
        prepared_date = None
        if prepared_date_str:
            try:
                prepared_date = datetime.date.fromisoformat(prepared_date_str)
            except ValueError:
                self._json(400, {"ok": False, "message": "작성일자 형식이 올바르지 않습니다 (YYYY-MM-DD)."})
                return

        if not uploaded:
            self._json(400, {"ok": False, "message": "최소 1개 이상의 백데이터 파일을 업로드해주세요."})
            return

        if not TEMPLATE_PATH.exists():
            self._json(500, {"ok": False, "message": "월결산서 템플릿 파일을 찾을 수 없습니다."})
            return

        output_path = TMP / f"chwork_monthly_closing_{uuid.uuid4().hex}.xlsx"

        try:
            sys.path.insert(0, str(ROOT))
            from monthly_closing_builder import build_monthly_closing
            result_bytes = build_monthly_closing(str(TEMPLATE_PATH), uploaded, base_date, prepared_date)
            output_path.write_bytes(result_bytes)
        except Exception as exc:
            self._json(500, {"ok": False, "message": f"보고서 생성 실패: {exc}"})
            return

        filename = f"월결산서_{base_date.isoformat()}.xlsx"
        period_key = f"{base_date.year:04d}-{base_date.month:02d}"

        # 같은 달 보고서가 이미 있으면 스토리지의 예전 파일은 남아있어도 무해(경로가 새 uuid라 안 겹침),
        # DB 레코드만 upsert로 최신 파일 경로를 가리키게 갱신
        save_warning = None
        try:
            storage_path = f"monthly_closing/{uuid.uuid4()}.xlsx"
            storage_upload(
                storage_path, result_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            rest_request(
                "POST", "monthly_closing_reports?on_conflict=period_key",
                body={
                    "period_key": period_key,
                    "base_date": base_date.isoformat(),
                    "prepared_date": (prepared_date or datetime.date.today()).isoformat(),
                    "file_name": filename,
                    "storage_path": storage_path,
                    "updated_at": datetime.datetime.utcnow().isoformat(),
                },
                prefer="resolution=merge-duplicates",
            )
        except Exception as exc:
            save_warning = f"생성은 됐지만 목록 저장에 실패했습니다: {exc}"

        xlsx_b64 = base64.b64encode(result_bytes).decode()
        result = {
            "ok": True,
            "message": "생성 완료",
            "xlsx_b64": xlsx_b64,
            "filename": filename,
            "period_key": period_key,
        }
        if save_warning:
            result["save_warning"] = save_warning
        self._json(200, result)

    def _json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
