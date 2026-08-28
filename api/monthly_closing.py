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
import urllib.parse
import urllib.error
from urllib.parse import urlparse, parse_qs, quote
from pathlib import Path
from http.server import BaseHTTPRequestHandler

TMP = Path(tempfile.gettempdir())
ROOT = Path(__file__).parent.parent
TEMPLATE_PATH = ROOT / "monthly_closing_template.xlsx"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
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
    url = f"{SUPABASE_URL}/rest/v1/{urllib.parse.quote(path, safe='?&=,.*:()!~%/')}"
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


def storage_delete(path):
    if not path:
        return
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path)}"
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


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    }


def _get_saved_remarks_map():
    """DB에 저장된 최신 내역(비고) 값들을 {account_key: note} 형태로 가져옴.
    예전에는 키가 "계정명"만이었는데, 지금은 같은 이름이 여러 번 나오는 경우를 구분하려고
    "계정명|몇번째" 형식으로 바뀜 — 예전 방식으로 저장해두셨던 값도 잃어버리지 않도록,
    새 키(예: "임차보증금|1")로 못 찾으면 예전 순수 이름 키("임차보증금")도 같이 봐줌."""
    rows = rest_request("GET", "monthly_closing_remarks?select=account_key,note") or []
    result = {r["account_key"]: r.get("note") for r in rows}
    legacy_map = {k: v for k, v in result.items() if "|" not in k}
    for key in list(result.keys()):
        if "|" in key:
            base = key.rsplit("|", 1)[0]
            if base in legacy_map and key not in result:
                result[key] = legacy_map[base]
    return result


def _save_remarks_map(remarks_list):
    """remarks_list: [{account_key, account_label, note}, ...] — DB에 upsert.
    같은 계정과목명이 여러 시트(재무상태표(내역)/전월대비증감 등)나 한 시트 안에서
    중복으로 들어올 수 있는데, 한 번의 upsert 요청 안에 같은 키가 두 번 이상 있으면
    PostgreSQL이 "ON CONFLICT DO UPDATE command cannot affect row a second time" 오류를
    내므로, 저장 직전에 계정과목명 기준으로 중복을 미리 걸러냄(나중 값이 최종 반영됨)."""
    if not remarks_list:
        return
    deduped = {}
    for r in remarks_list:
        key = r.get("account_key")
        if not key:
            continue
        deduped[key] = {
            "account_key": key,
            "account_label": r.get("account_label") or key,
            "note": r.get("note") or None,
            "updated_at": datetime.datetime.utcnow().isoformat(),
        }
    body = list(deduped.values())
    if body:
        rest_request(
            "POST", "monthly_closing_remarks?on_conflict=account_key",
            body=body, prefer="resolution=merge-duplicates",
        )


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

            if qs.get("remarks", ["0"])[0] == "1":
                sys.path.insert(0, str(ROOT))
                from monthly_closing_builder import extract_all_remarks
                if not TEMPLATE_PATH.exists():
                    return self._json(500, {"ok": False, "message": "템플릿 파일을 찾을 수 없습니다."})
                base_remarks_by_sheet = extract_all_remarks(str(TEMPLATE_PATH))
                saved_map = _get_saved_remarks_map()
                for sheet_name, rows in base_remarks_by_sheet.items():
                    for r in rows:
                        if r["account_key"] in saved_map:
                            r["note"] = saved_map[r["account_key"]]
                special_note = saved_map.get("summary_special_note", "")
                return self._json(200, {
                    "ok": True,
                    "remarks_by_sheet": base_remarks_by_sheet,
                    "special_notes": {"summary_special_note": special_note},
                })

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

            return self._json(400, {"ok": False, "message": "list=1, remarks=1 또는 period_key 파라미터가 필요합니다."})
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

        mode = fs.getvalue("mode") or "preview"  # "preview" 또는 "finalize"

        # finalize일 때만 수정된 내역(비고)을 함께 전달받음: JSON 문자열
        # [{"account_key":..., "account_label":..., "note":...}, ...]
        remarks_list = None
        remarks_raw = fs.getvalue("remarks_json")
        if remarks_raw:
            try:
                remarks_list = json.loads(remarks_raw)
            except Exception:
                self._json(400, {"ok": False, "message": "remarks_json 형식이 올바르지 않습니다."})
                return

        special_note_text = fs.getvalue("summary_special_note")  # 요약 시트 "특이사항" 수기 입력란

        if not uploaded:
            self._json(400, {"ok": False, "message": "최소 1개 이상의 백데이터 파일을 업로드해주세요."})
            return

        if not TEMPLATE_PATH.exists():
            self._json(500, {"ok": False, "message": "월결산서 템플릿 파일을 찾을 수 없습니다."})
            return

        try:
            sys.path.insert(0, str(ROOT))
            from monthly_closing_builder import build_monthly_closing, compute_preview_summary, compute_full_report_summary

            # finalize 단계에서 사용자가 수정한 내역/특이사항을 먼저 DB에 저장해두고,
            # 그 값(=최신 내역)을 이번 생성에도 그대로 반영
            if mode == "finalize" and remarks_list:
                _save_remarks_map(remarks_list)
            if mode == "finalize" and special_note_text is not None:
                _save_remarks_map([{"account_key": "summary_special_note", "account_label": "특이사항", "note": special_note_text}])

            remarks_override = _get_saved_remarks_map()
            special_notes = {"summary_special_note": remarks_override.get("summary_special_note", "")}

            result_bytes = build_monthly_closing(
                str(TEMPLATE_PATH), uploaded, base_date, prepared_date, remarks_override, special_notes,
            )

            summary = {}
            full_summary = {"income": {}, "balance": {}, "trend": {}}
            if uploaded:
                summary = compute_preview_summary(uploaded)
                full_summary = compute_full_report_summary(uploaded)
        except Exception as exc:
            self._json(500, {"ok": False, "message": f"보고서 생성 실패: {exc}"})
            return

        filename = f"월결산서_{base_date.isoformat()}.xlsx"
        period_key = f"{base_date.year:04d}-{base_date.month:02d}"
        xlsx_b64 = base64.b64encode(result_bytes).decode()

        if mode == "preview":
            self._json(200, {
                "ok": True,
                "message": "미리보기 생성 완료",
                "xlsx_b64": xlsx_b64,
                "filename": filename,
                "period_key": period_key,
                "summary": summary,
                "full_summary": full_summary,
                "base_date": base_date.isoformat(),
                "prepared_date": (prepared_date or datetime.date.today()).isoformat(),
            })
            return

        # mode == "finalize" — 저장소에 업로드 + 목록에 등록(확정)
        # 같은 period_key(예: "2026-06")를 여러 번 재확정하면 매번 새 UUID로 파일이
        # 새로 생성되는데, DB 행은 upsert라 최신 파일 하나만 가리키게 되고 예전 파일들은
        # 스토리지에 그대로 남아 고아 파일로 쌓임 — 그래서 새로 올리기 전에 기존
        # storage_path를 먼저 확인해두고, 새 파일 저장이 끝난 뒤 예전 파일을 지움.
        old_storage_path = None
        try:
            existing_rows = rest_request(
                "GET", f"monthly_closing_reports?period_key=eq.{period_key}&select=storage_path"
            ) or []
            if existing_rows:
                old_storage_path = existing_rows[0].get("storage_path")
        except SupabaseError:
            old_storage_path = None

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
            if old_storage_path and old_storage_path != storage_path:
                storage_delete(old_storage_path)
        except Exception as exc:
            save_warning = f"파일은 생성됐지만 목록 확정 저장에 실패했습니다: {exc}"

        result = {
            "ok": True,
            "message": "확정 완료",
            "xlsx_b64": xlsx_b64,
            "filename": filename,
            "period_key": period_key,
            "summary": summary,
            "full_summary": full_summary,
            "base_date": base_date.isoformat(),
            "prepared_date": (prepared_date or datetime.date.today()).isoformat(),
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
