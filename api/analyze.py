from __future__ import annotations

import os
import uuid
import tempfile
import json
import io
import cgi
import base64
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler

TMP = Path(tempfile.gettempdir())


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
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        environ = {
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": content_type,
            "CONTENT_LENGTH": str(length),
        }
        fs = cgi.FieldStorage(
            fp=io.BytesIO(body),
            environ=environ,
            keep_blank_values=True,
        )

        def save_field(name):
            if name not in fs:
                return None
            item = fs[name]
            if not hasattr(item, 'filename') or not item.filename:
                return None
            suffix = Path(item.filename).suffix or ".xlsx"
            tmp_path = TMP / f"{uuid.uuid4().hex}{suffix}"
            tmp_path.write_bytes(item.file.read())
            return tmp_path

        gl_path    = save_field("gl_file")
        tb_path    = save_field("tb_file")
        dept_path  = save_field("dept_file")
        extra_path = save_field("extra_file")

        if gl_path is None or tb_path is None:
            self._json(400, {"ok": False, "message": "ACA0090 원장 파일과 ACB0021 합계잔액시산표 파일은 필수입니다."})
            return

        report_path = TMP / f"chwork_report_{uuid.uuid4().hex}.xlsx"

        try:
            sys.path.insert(0, str(Path(__file__).parent.parent))
            from report_builder import build_report
            summary = build_report(
                gl_path=gl_path,
                tb_path=tb_path,
                dept_path=dept_path,
                extra_path=extra_path,
                output_path=report_path,
            )
        except Exception as exc:
            self._json(500, {"ok": False, "message": f"분석 실패: {exc}"})
            return

        xlsx_b64 = base64.b64encode(report_path.read_bytes()).decode()
        self._json(200, {
            "ok": True,
            "message": "분석 완료",
            "summary": summary,
            "xlsx_b64": xlsx_b64,
            "filename": "창현_기업손익분석_보고서.xlsx",
        })

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
