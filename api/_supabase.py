"""
Supabase REST(PostgREST) 접근 공용 헬퍼.
Vercel 환경변수 SUPABASE_URL / SUPABASE_SECRET_KEY 를 사용합니다.
(프론트엔드에는 절대 노출되지 않는, 서버 전용 코드입니다)
"""
import os
import json
import urllib.request
import urllib.error

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")


class SupabaseError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"Supabase error {status}: {body}")


def _headers(prefer=None):
    h = {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def rest_request(method, path, params=None, body=None, prefer=None):
    """
    path 예: 'employees', 'employees?select=*,salary_history(*)'
    """
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}{qs}"

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_headers(prefer))
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SupabaseError(e.code, e.read().decode("utf-8", "ignore"))


def check_password(candidate: str) -> bool:
    if not HR_PASSWORD:
        # 환경변수가 아직 설정 안 된 경우, 안전하게 항상 거부
        return False
    return candidate == HR_PASSWORD
