"""
POST /api/hr_login
body: {"password": "..."}
성공 시 {"ok": true}, 실패 시 401

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


def check_password(candidate: str) -> bool:
    hr_password = os.environ.get("HR_PASSWORD", "")
    if not hr_password:
        return False
    return candidate == hr_password


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
