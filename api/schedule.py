"""
/api/schedule

세무/업무 일정관리 (schedule.html 전용)

GET  ?upcoming=1&days=N     -> 다가오는/지난 미완료 일정 (알림 배너용)
GET  ?tasks=1               -> 업무 원본(반복 패턴 포함) 목록
GET  (기본)                  -> 기간별 일정 목록 (?from=&to=&status=)
POST (기본)                  -> 새 업무 등록
POST type=complete           -> occurrence 완료/완료취소 처리
POST type=skip                -> occurrence 건너뛰기 처리
PATCH ?id=<task_id>          -> 업무 원본 수정 (미래 미완료 occurrence만 재생성)
DELETE ?id=<task_id>         -> 업무 원본 삭제 (occurrence 전부 cascade 삭제)
DELETE ?occurrence_id=<id>   -> occurrence 단건 삭제

모든 요청에 X-HR-Password 헤더 필요.
(외부 모듈을 import하지 않는 독립형 파일)
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import traceback
import datetime
import urllib.request
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
    url = f"{SUPABASE_URL}/rest/v1/{path}"
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


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-HR-Password",
        "Content-Type": "application/json",
    }


def _ensure_occurrences_generated():
    try:
        rpc("generate_schedule_occurrences", {})
    except SupabaseError:
        # 생성이 실패해도 기존 조회는 계속 되도록 조용히 넘어감
        pass


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

            # 기본: 기간별 목록
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

            # 기본: 새 업무 등록
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

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def do_PATCH(self):
        try:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            qs = parse_qs(urlparse(self.path).query)
            task_id = qs.get("id", [None])[0]
            if not task_id:
                return self._send(400, {"error": "id는 필수입니다"})
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")

            update_fields = {}
            for key in ("title", "category", "recurrence_type", "interval_value", "anchor_date",
                        "day_mode", "end_date", "reminder_days_before", "note", "active"):
                if key in payload:
                    update_fields[key] = payload[key]
            if not update_fields:
                return self._send(400, {"error": "수정할 항목이 없습니다"})

            rest_request("PATCH", f"tax_schedule_tasks?id=eq.{task_id}", body=update_fields)

            # 앞으로 도래할(오늘 이후) 미완료 occurrence만 지우고 새 패턴으로 재생성.
            # 이미 완료/건너뛴 과거 기록은 절대 건드리지 않음.
            today = datetime.date.today().isoformat()
            rest_request(
                "DELETE",
                f"tax_schedule_occurrences?task_id=eq.{task_id}&status=eq.pending&due_date=gte.{today}",
            )
            _ensure_occurrences_generated()
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
            task_id = qs.get("id", [None])[0]
            occ_id = qs.get("occurrence_id", [None])[0]

            if task_id:
                rest_request("DELETE", f"tax_schedule_tasks?id=eq.{task_id}")
                return self._send(200, {"ok": True})

            if occ_id:
                rest_request("DELETE", f"tax_schedule_occurrences?id=eq.{occ_id}")
                return self._send(200, {"ok": True})

            return self._send(400, {"error": "id 또는 occurrence_id가 필요합니다"})

        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def log_message(self, *args):
        pass
