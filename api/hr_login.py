"""
POST /api/hr_login
body: {"password": "..."}
성공 시 {"ok": true, "role": "admin" | "family"}, 실패 시 401
(외부 모듈을 import하지 않는 독립형 파일입니다 — Vercel 배포시
같은 폴더의 다른 .py 파일을 못 불러오는 문제를 피하기 위함)
"""
from http.server import BaseHTTPRequestHandler
import os
import json


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    }


def auth_role(candidate: str):
    """비밀번호로 role 판별: 'admin' | 'family' | None(불일치)"""
    hr_password = os.environ.get("HR_PASSWORD", "")
    family_password = os.environ.get("FAMILY_PASSWORD", "")
    if hr_password and candidate == hr_password:
        return "admin"
    if family_password and candidate == family_password:
        return "family"
    return None


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
        role = auth_role(str(payload.get("password", "")))
        ok = role is not None
        status = 200 if ok else 401
        body = json.dumps({"ok": ok, "role": role}).encode()
        self.send_response(status)
        for k, v in _cors_headers().items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
