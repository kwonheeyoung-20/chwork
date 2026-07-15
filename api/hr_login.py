"""
POST /api/hr_login
body: {"password": "..."}
성공 시 {"ok": true}, 실패 시 401
프론트엔드는 이 결과를 sessionStorage에 저장해두고,
이후 모든 인사 API 요청에 X-HR-Password 헤더로 같이 보냅니다.
"""
from http.server import BaseHTTPRequestHandler
import json
from _supabase import check_password


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {}

        ok = check_password(str(payload.get("password", "")))
        status = 200 if ok else 401
        body = json.dumps({"ok": ok}).encode()

        self.send_response(status)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
