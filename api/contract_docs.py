"""
/api/contract_docs

계약/증빙 서류 관리 (hr.html "계약/증빙관리" 탭)

파일은 Supabase Storage "contracts" 버킷(비공개)에 저장하고,
DB에는 메타데이터 + 저장 경로만 저장합니다. 조회시마다 짧은 유효기간의
서명된 URL을 새로 발급해서 응답에 담아 보냅니다.

GET  ?upcoming=1&days=N -> 만료 임박/경과 서류 (알림 배너용)
GET  (기본)              -> 전체 목록 (서명된 보기 URL 포함)
POST                    -> 신규 업로드 (file_base64로 파일 전송)
POST type=dismiss        -> 만료 알림 그만 보기 처리
PATCH ?id=<id>           -> 메타데이터 수정 (파일 자체는 교체 불가, 새로 업로드 필요)
DELETE ?id=<id>          -> 서류 삭제 (Storage 파일도 함께 삭제)

모든 요청에 X-HR-Password 헤더 필요.
파일은 base64로 인코딩해서 전송하며, Vercel 요청 크기 제한상
원본 파일 기준 대략 4MB 이하를 권장합니다.
"""
from http.server import BaseHTTPRequestHandler
import os
import re
import json
import uuid
import base64
import traceback
import datetime
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs, quote

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")
BUCKET = "contracts"


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


def storage_upload(path, data_bytes, content_type):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path)}"
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
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path)}"
    req = urllib.request.Request(url, method="DELETE", headers={
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "apikey": SUPABASE_SECRET_KEY,
    })
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError:
        pass  # 이미 지워졌거나 없어도 DB 행 삭제는 계속 진행
    except urllib.error.URLError:
        pass


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


def safe_filename(name: str) -> str:
    name = name or "file"
    base = re.sub(r"[^\w\.\-가-힣]", "_", name)
    return f"{uuid.uuid4()}_{base}"


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
                    "&terminated_date=is.null&select=*&order=contract_end_date.asc",
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

            rows = rest_request("GET", "contract_documents?select=*&order=contract_end_date.asc.nullslast") or []
            for r in rows:
                r["view_url"] = storage_sign_url(r.get("storage_path"))
            return self._send(200, {"documents": rows})

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

            file_b64 = payload.get("file_base64")
            file_name = payload.get("file_name")
            if not file_b64 or not file_name:
                return self._send(400, {"error": "file_base64, file_name은 필수입니다"})

            try:
                file_bytes = base64.b64decode(file_b64)
            except Exception:
                return self._send(400, {"error": "파일 데이터를 해독할 수 없습니다"})

            if len(file_bytes) > 8 * 1024 * 1024:
                return self._send(413, {"error": "파일이 너무 큽니다 (8MB 이하로 올려주세요)"})

            storage_path = safe_filename(file_name)
            storage_upload(storage_path, file_bytes, payload.get("content_type"))

            body = {
                "doc_type": payload.get("doc_type"),
                "vendor_name": payload.get("vendor_name"),
                "contract_title": payload.get("contract_title"),
                "contract_start_date": payload.get("contract_start_date") or None,
                "contract_end_date": payload.get("contract_end_date") or None,
                "reminder_days_before": int(payload.get("reminder_days_before") or 14),
                "auto_renew": bool(payload.get("auto_renew", False)),
                "file_name": file_name,
                "storage_path": storage_path,
                "file_size": len(file_bytes),
                "content_type": payload.get("content_type"),
                "note": payload.get("note"),
            }
            created = rest_request("POST", "contract_documents", body=body, prefer="return=representation")
            return self._send(201, {"ok": True, "id": created[0]["id"] if created else None})

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def do_PATCH(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            doc_id = qs.get("id", [None])[0]
            if not doc_id:
                return self._send(400, {"error": "id는 필수입니다"})
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")

            update_fields = {}
            for key in ("doc_type", "vendor_name", "contract_title", "contract_start_date",
                        "contract_end_date", "reminder_days_before", "note", "alert_dismissed", "auto_renew"):
                if key in payload:
                    update_fields[key] = payload[key]
            if not update_fields:
                return self._send(400, {"error": "수정할 항목이 없습니다"})
            update_fields["updated_at"] = datetime.datetime.utcnow().isoformat()

            rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body=update_fields)
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
            doc_id = qs.get("id", [None])[0]
            if not doc_id:
                return self._send(400, {"error": "id는 필수입니다"})

            existing = rest_request("GET", f"contract_documents?id=eq.{doc_id}&select=storage_path")
            if existing and existing[0].get("storage_path"):
                storage_delete(existing[0]["storage_path"])

            rest_request("DELETE", f"contract_documents?id=eq.{doc_id}")
            return self._send(200, {"ok": True})

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
