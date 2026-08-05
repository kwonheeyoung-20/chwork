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
import traceback
import datetime
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs, quote

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")
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
    name = name or "file"
    base = re.sub(r"[^\w\.\-가-힣]", "_", name)
    return f"{uuid.uuid4()}_{base}"


# ════════════════════════════════════════════════════════════
# 메인 핸들러
# ════════════════════════════════════════════════════════════
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
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            resource = self._resource(qs)

            if resource == "schedule":
                return self._get_schedule(qs)
            if resource == "contacts":
                return self._get_contacts(qs)
            if resource == "contractdocs":
                return self._get_contractdocs(qs)
            if resource == "todos":
                return self._get_todos(qs)
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

    def _get_todos(self, qs):
        date_str = qs.get("date", [None])[0] or datetime.date.today().isoformat()
        rows = rest_request(
            "GET", f"daily_todos?todo_date=eq.{date_str}&select=*&order=created_at.asc"
        )
        return self._send(200, {"todos": rows, "date": date_str})

    # ────────────────────────────────────────────────────────
    # POST
    # ────────────────────────────────────────────────────────
    def do_POST(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
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

    def _post_todos(self, payload):
        content = payload.get("content")
        todo_date = payload.get("todo_date") or datetime.date.today().isoformat()
        if not content:
            return self._send(400, {"error": "content는 필수입니다"})

        created = rest_request("POST", "daily_todos", body={
            "todo_date": todo_date,
            "content": content,
            "done": False,
        }, prefer="return=representation")
        return self._send(201, {"todo": created[0] if created else None})

    # ────────────────────────────────────────────────────────
    # PATCH
    # ────────────────────────────────────────────────────────
    def do_PATCH(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
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
        for key in ("doc_type", "vendor_name", "contract_title", "contract_start_date",
                    "contract_end_date", "reminder_days_before", "note", "alert_dismissed", "auto_renew"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})
        update_fields["updated_at"] = datetime.datetime.utcnow().isoformat()

        rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body=update_fields)
        return self._send(200, {"ok": True})

    def _patch_todos(self, todo_id, payload):
        update_fields = {}
        for key in ("content", "done"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        rest_request("PATCH", f"daily_todos?id=eq.{todo_id}", body=update_fields)
        return self._send(200, {"ok": True})

    # ────────────────────────────────────────────────────────
    # DELETE
    # ────────────────────────────────────────────────────────
    def do_DELETE(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            resource = self._resource(qs)

            if resource == "schedule":
                return self._delete_schedule(qs)
            if resource == "contacts":
                return self._delete_contacts(qs)
            if resource == "contractdocs":
                return self._delete_contractdocs(qs)
            if resource == "todos":
                return self._delete_todos(qs)
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
        doc_id = qs.get("id", [None])[0]
        if not doc_id:
            return self._send(400, {"error": "id는 필수입니다"})
        existing = rest_request("GET", f"contract_documents?id=eq.{doc_id}&select=storage_path")
        if existing and existing[0].get("storage_path"):
            storage_delete(existing[0]["storage_path"])
        rest_request("DELETE", f"contract_documents?id=eq.{doc_id}")
        return self._send(200, {"ok": True})

    def _delete_todos(self, qs):
        todo_id = qs.get("id", [None])[0]
        if not todo_id:
            return self._send(400, {"error": "id는 필수입니다"})
        rest_request("DELETE", f"daily_todos?id=eq.{todo_id}")
        return self._send(200, {"ok": True})

    def log_message(self, *args):
        pass
