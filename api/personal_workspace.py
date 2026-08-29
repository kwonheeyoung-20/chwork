"""
/api/personal_workspace

개인 영역(개인일정관리) 전용 API. workspace.py에서 회사 업무 리소스와
분리했습니다 — 개인 영역만 따로 작업할 때 실수로 회사 쪽을 건드릴 위험을
줄이고, 파일 하나당 길이도 줄이기 위함입니다. (Vercel 함수 개수는
hr_backup.py + hr_storage_backup.py를 하나로 합쳐서 확보한 자리를 써서
12개 그대로 유지)

- resource=personal       -> 개인 일정관리 (가족 일정)
- resource=family_notes   -> 가족 공유 메모
- resource=timetable      -> 학교 시간표
- resource=personal_media -> 하진이 알림장 / 사진 앨범

모든 요청에 X-HR-Password 헤더 필요.
관리자(admin) 비밀번호 또는 가족(family) 비밀번호로 접근 가능 —
가족 비밀번호는 이 4개 리소스만 허용됩니다.
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import uuid
import base64
import traceback
import datetime
import urllib.request
import urllib.parse
import urllib.error
from urllib.parse import urlparse, parse_qs


def kst_today():
    """서버(Vercel)는 UTC 기준으로 동작하는데, 한국은 UTC+9시간이라
    kst_today()를 그냥 쓰면 한국시간 새벽 0시~오전 9시 사이에
    "오늘"이 하루 전날짜로 잘못 계산되는 문제가 있었음(D-day 알림 등에 영향).
    항상 한국시간 기준 오늘 날짜를 반환하도록 보정."""
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()


# ── 음력 변환 (korean_lunar_calendar 0.4.0, MIT License, usingsky@gmail.com) ──
    KOREAN_LUNAR_MIN_VALUE = 10000101
    KOREAN_LUNAR_MAX_VALUE = 20501118
    KOREAN_SOLAR_MIN_VALUE = 10000213
    KOREAN_SOLAR_MAX_VALUE = 20501231
    
    KOREAN_LUNAR_BASE_YEAR = 1000
    SOLAR_LUNAR_DAY_DIFF = 43
    
    LUNAR_SMALL_MONTH_DAY = 29
    LUNAR_BIG_MONTH_DAY = 30
    SOLAR_SMALL_YEAR_DAY = 365
    SOLAR_BIG_YEAR_DAY = 366

    SOLAR_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 29]
    KOREAN_CHEONGAN = [0xac11, 0xc744, 0xbcd1, 0xc815, 0xbb34, 0xae30, 0xacbd, 0xc2e0, 0xc784, 0xacc4]
    KOREAN_GANJI = [0xc790, 0xcd95, 0xc778, 0xbb18, 0xc9c4, 0xc0ac, 0xc624, 0xbbf8, 0xc2e0, 0xc720, 0xc220, 0xd574]
    KOREAN_GAPJA_UNIT = [0xb144, 0xc6d4, 0xc77c]

    CHINESE_CHEONGAN = [0x7532, 0x4e59, 0x4e19, 0x4e01, 0x620a, 0x5df1, 0x5e9a, 0x8f9b, 0x58ec, 0x7678]
    CHINESE_GANJI = [0x5b50, 0x4e11, 0x5bc5, 0x536f, 0x8fb0, 0x5df3, 0x5348, 0x672a, 0x7533, 0x9149, 0x620c, 0x4ea5]
    CHINESE_GAPJA_UNIT = [0x5e74, 0x6708, 0x65e5]

    INTERCALATION_STR = [0xc724, 0x958f]

    # Offsets that anchor the sexagenary cycle to the base year (1000): the
    # cheongan (10) and ganji (12) wheels each start at a fixed position.
    GAPJA_YEAR_CHEONGAN_OFFSET = 6
    GAPJA_YEAR_GANJI_OFFSET = 0
    GAPJA_MONTH_CHEONGAN_OFFSET = 3
    GAPJA_MONTH_GANJI_OFFSET = 1
    GAPJA_DAY_CHEONGAN_OFFSET = 4
    GAPJA_DAY_GANJI_OFFSET = 2

    KOREAN_LUNAR_DATA = [
            0x82c60a57, 0x82fec52b, 0x82c40d2a, 0x82c60d55, 0xc30095ad, 0x82c4056a, 0x82c6096d, 0x830054dd, 0xc2c404ad, 0x82c40a4d,
            0x83002e4d, 0x82c40b26, 0xc300ab56, 0x82c60ad5, 0x82c4035a, 0x8300697a, 0xc2c6095b, 0x82c4049b, 0x83004a9b, 0x82c40a4b,
            0xc301caa5, 0x82c406aa, 0x82c60ad5, 0x830092dd, 0xc2c402b5, 0x82c60957, 0x82fe54ae, 0x82c60c97, 0xc2c4064b, 0x82ff254a,
            0x82c60da9, 0x8300a6b6, 0xc2c6066d, 0x82c4026e, 0x8301692e, 0x82c4092e, 0xc2c40c96, 0x83004d95, 0x82c40d4a, 0x8300cd69,
            0xc2c40b58, 0x82c80d6b, 0x8301926b, 0x82c4025d, 0xc2c4092b, 0x83005aab, 0x82c40a95, 0x82c40b4a, 0xc3021eab, 0x82c402d5,
            0x8301b55a, 0x82c604bb, 0xc2c4025b, 0x83007537, 0x82c4052b, 0x82c40695, 0xc3003755, 0x82c406aa, 0x8303cab5, 0x82c40275,
            0xc2c404b6, 0x83008a5e, 0x82c40a56, 0x82c40d26, 0xc3005ea6, 0x82c60d55, 0x82c405aa, 0x83001d6a, 0xc2c6096d, 0x8300b4af,
            0x82c4049d, 0x82c40a4d, 0xc3007d2d, 0x82c40aa6, 0x82c60b55, 0x830045d5, 0xc2c4035a, 0x82c6095d, 0x83011173, 0x82c4045b,
            0xc3009a4f, 0x82c4064b, 0x82c40aa5, 0x83006b69, 0xc2c606b5, 0x82c402da, 0x83002ab6, 0x82c60937, 0xc2fec497, 0x82c60c97,
            0x82c4064b, 0x82fe86aa, 0xc2c60da5, 0x82c405b4, 0x83034a6d, 0x82c402ae, 0xc2c40e61, 0x83002d2e, 0x82c40c96, 0x83009d4d,
            0x82c40d4a, 0x82c60d65, 0x83016595, 0x82c6055d, 0xc2c4026d, 0x83002a5d, 0x82c4092b, 0x8300aa97, 0xc2c40a95, 0x82c40b4a,
            0x83008b5a, 0x82c60ad5, 0xc2c6055b, 0x830042b7, 0x82c40457, 0x82c4052b, 0xc3001d2b, 0x82c40695, 0x8300972d, 0x82c405aa,
            0xc2c60ab5, 0x830054ed, 0x82c404b6, 0x82c60a57, 0xc2ff344e, 0x82c40d26, 0x8301be92, 0x82c60d55, 0xc2c405aa, 0x830089ba,
            0x82c6096d, 0x82c404ae, 0xc3004a9d, 0x82c40a4d, 0x82c40d25, 0x83002f25, 0xc2c40b54, 0x8303ad69, 0x82c402da, 0x82c6095d,
            0xc301649b, 0x82c4049b, 0x82c40a4b, 0x83004b4b, 0xc2c406a5, 0x8300bb53, 0x82c406b4, 0x82c60ab6, 0xc3018956, 0x82c60997,
            0x82c40497, 0x83004697, 0xc2c4054b, 0x82fec6a5, 0x82c60da5, 0x82c405ac, 0xc303aab5, 0x82c4026e, 0x82c4092e, 0x83006cae,
            0xc2c40c96, 0x82c40d4a, 0x83002f4a, 0x82c60d55, 0xc300b56b, 0x82c6055b, 0x82c4025d, 0x8300793d, 0xc2c40927, 0x82c40a95,
            0x83015d15, 0x82c40b4a, 0xc2c60b55, 0x830112d5, 0x82c604db, 0x82fe925e, 0xc2c60a57, 0x82c4052b, 0x83006aab, 0x82c40695,
            0xc2c406aa, 0x83003baa, 0x82c60ab5, 0x8300b4b7, 0xc2c404ae, 0x82c60a57, 0x82fe752e, 0x82c40d26, 0xc2c60e93, 0x830056d5,
            0x82c405aa, 0x82c609b5, 0xc300256d, 0x82c404ae, 0x8301aa4d, 0x82c40a4d, 0xc2c40d26, 0x83006d65, 0x82c40b52, 0x82c60d6a,
            0xc30026da, 0x82c6095d, 0x8301c49d, 0x82c4049b, 0xc2c40a4b, 0x83008aab, 0x82c406a5, 0x82c40b54, 0xc3004bb4, 0x82c60ab6,
            0x82c6095b, 0x83002537, 0xc2c40497, 0x8300964f, 0x82c4054b, 0x82c406a5, 0xc30176c5, 0x82c405ac, 0x82c60ab6, 0x8301386e,
            0xc2c4092e, 0x8300cc97, 0x82c40c96, 0x82c40d4a, 0xc3008daa, 0x82c60b55, 0x82c4056a, 0x83025adb, 0xc2c4025d, 0x82c4092e,
            0x83002d2b, 0x82c40a95, 0xc3009d4d, 0x82c40b2a, 0x82c60b55, 0x83007575, 0xc2c404da, 0x82c60a5b, 0x83004557, 0x82c4052b,
            0xc301ca93, 0x82c40693, 0x82c406aa, 0x83008ada, 0xc2c60ae5, 0x82c404b6, 0x83004aae, 0x82c60a57, 0xc2c40527, 0x82ff2526,
            0x82c60e53, 0x8300a6cb, 0xc2c405aa, 0x82c605ad, 0x830164ad, 0x82c404ae, 0xc2c40a4e, 0x83004d4d, 0x82c40d26, 0x8300bd53,
            0xc2c40b52, 0x82c60b6a, 0x8301956a, 0x82c60557, 0xc2c4049d, 0x83015a1b, 0x82c40a4b, 0x82c40aa5, 0xc3001ea5, 0x82c40b52,
            0x8300bb5a, 0x82c60ab6, 0xc2c6095b, 0x830064b7, 0x82c40497, 0x82c4064b, 0xc300374b, 0x82c406a5, 0x8300b6b3, 0x82c405ac,
            0xc2c60ab6, 0x830182ad, 0x82c4049e, 0x82c40a4d, 0xc3005d4b, 0x82c40b25, 0x82c40b52, 0x83012e52, 0xc2c60b5a, 0x8300a95e,
            0x82c6095b, 0x82c4049b, 0xc3006a57, 0x82c40a4b, 0x82c40aa5, 0x83004ba5, 0xc2c406d4, 0x8300cad6, 0x82c60ab6, 0x82c60937,
            0x8300849f, 0x82c40497, 0x82c4064b, 0x82fe56ca, 0xc2c60da5, 0x82c405aa, 0x83001d6c, 0x82c60a6e, 0xc300b92f, 0x82c4092e,
            0x82c40c96, 0x83007d55, 0xc2c40d4a, 0x82c60d55, 0x83013555, 0x82c4056a, 0xc2c60a6d, 0x83001a5d, 0x82c4092b, 0x83008a5b,
            0xc2c40a95, 0x82c40b2a, 0x83015b2a, 0x82c60ad5, 0xc2c404da, 0x83001cba, 0x82c60a57, 0x8300952f, 0xc2c40527, 0x82c40693,
            0x830076b3, 0x82c406aa, 0xc2c60ab5, 0x83003575, 0x82c404b6, 0x8300ca67, 0xc2c40a2e, 0x82c40d16, 0x83008e96, 0x82c40d4a,
            0xc2c60daa, 0x830055ea, 0x82c6056d, 0x82c404ae, 0xc301285d, 0x82c40a2d, 0x8300ad17, 0x82c40aa5, 0xc2c40b52, 0x83007d74,
            0x82c60ada, 0x82c6055d, 0xc300353b, 0x82c4045b, 0x82c40a2b, 0x83011a2b, 0xc2c40aa5, 0x83009b55, 0x82c406b2, 0x82c60ad6,
            0xc3015536, 0x82c60937, 0x82c40457, 0x83003a57, 0xc2c4052b, 0x82feaaa6, 0x82c60d95, 0x82c405aa, 0xc3017aac, 0x82c60a6e,
            0x82c4052e, 0x83003cae, 0xc2c40a56, 0x8300bd2b, 0x82c40d2a, 0x82c60d55, 0xc30095ad, 0x82c4056a, 0x82c60a6d, 0x8300555d,
            0xc2c4052b, 0x82c40a8d, 0x83002e55, 0x82c40b2a, 0xc300ab56, 0x82c60ad5, 0x82c404da, 0x83006a7a, 0xc2c60a57, 0x82c4051b,
            0x83014a17, 0x82c40653, 0xc301c6a9, 0x82c405aa, 0x82c60ab5, 0x830092bd, 0xc2c402b6, 0x82c60a37, 0x82fe552e, 0x82c40d16,
            0x82c60e4b, 0x82fe3752, 0x82c60daa, 0x8301b5b4, 0xc2c6056d, 0x82c402ae, 0x83007a3d, 0x82c40a2d, 0xc2c40d15, 0x83004d95,
            0x82c40b52, 0x8300cb69, 0xc2c60ada, 0x82c6055d, 0x8301925b, 0x82c4045b, 0xc2c40a2b, 0x83005aab, 0x82c40a95, 0x82c40b52,
            0xc3001eaa, 0x82c60ab6, 0x8300c55b, 0x82c604b7, 0xc2c40457, 0x83007537, 0x82c4052b, 0x82c40695, 0xc3014695, 0x82c405aa,
            0x8300cab5, 0x82c60a6e, 0xc2c404ae, 0x83008a5e, 0x82c40a56, 0x82c40d2a, 0xc3006eaa, 0x82c60d55, 0x82c4056a, 0x8301295a,
            0xc2c6095d, 0x8300b4af, 0x82c4049b, 0x82c40a4d, 0xc3007d2d, 0x82c40b2a, 0x82c60b55, 0x830045d5, 0xc2c402da, 0x82c6095b,
            0x83011157, 0x82c4049b, 0xc3009a4f, 0x82c4064b, 0x82c406a9, 0x83006aea, 0xc2c606b5, 0x82c402b6, 0x83002aae, 0x82c60937,
            0xc2ffb496, 0x82c40c96, 0x82c60e4b, 0x82fe76b2, 0xc2c60daa, 0x82c605ad, 0x8300336d, 0x82c4026e, 0xc2c4092e, 0x83002d2d,
            0x82c40c95, 0x83009d4d, 0xc2c40b4a, 0x82c60b69, 0x8301655a, 0x82c6055b, 0xc2c4025d, 0x83002a5b, 0x82c4092b, 0x8300aa97,
            0xc2c40695, 0x82c4074a, 0x83008b5a, 0x82c60ab6, 0xc2c6053b, 0x830042b7, 0x82c40257, 0x82c4052b, 0xc3001d2b, 0x82c40695,
            0x830096ad, 0x82c405aa, 0xc2c60ab5, 0x830054ed, 0x82c404ae, 0x82c60a57, 0xc2ff344e, 0x82c40d2a, 0x8301bd94, 0x82c60b55,
            0x82c4056a, 0x8300797a, 0x82c6095d, 0x82c404ae, 0xc3004a9b, 0x82c40a4d, 0x82c40d25, 0x83011aaa, 0xc2c60b55, 0x8300956d,
            0x82c402da, 0x82c6095b, 0xc30054b7, 0x82c40497, 0x82c40a4b, 0x83004b4b, 0xc2c406a9, 0x8300cad5, 0x82c605b5, 0x82c402b6,
            0xc300895e, 0x82c6092f, 0x82c40497, 0x82fe4696, 0xc2c40d4a, 0x8300cea5, 0x82c60d69, 0x82c6056d, 0xc301a2b5, 0x82c4026e,
            0x82c4092e, 0x83006cad, 0xc2c40c95, 0x82c40d4a, 0x83002f4a, 0x82c60b59, 0xc300c56d, 0x82c6055b, 0x82c4025d, 0x8300793b,
            0xc2c4092b, 0x82c40a95, 0x83015b15, 0x82c406ca, 0xc2c60ad5, 0x830112b6, 0x82c604bb, 0x8300925f, 0xc2c40257, 0x82c4052b,
            0x82fe6aaa, 0x82c60e95, 0xc2c406aa, 0x83003baa, 0x82c60ab5, 0x8300b4b7, 0xc2c404ae, 0x82c60a57, 0x82fe752d, 0x82c40d26,
            0xc2c60d95, 0x830055d5, 0x82c4056a, 0x82c6096d, 0xc300255d, 0x82c404ae, 0x8300aa4f, 0x82c40a4d, 0xc2c40d25, 0x83006d69,
            0x82c60b55, 0x82c4035a, 0xc3002aba, 0x82c6095b, 0x8301c49b, 0x82c40497, 0xc2c40a4b, 0x83008b2b, 0x82c406a5, 0x82c406d4,
            0xc3034ab5, 0x82c402b6, 0x82c60937, 0x8300252f, 0xc2c40497, 0x82fe964e, 0x82c40d4a, 0x82c60ea5, 0xc30166a9, 0x82c6056d,
            0x82c402b6, 0x8301385e, 0xc2c4092e, 0x8300bc97, 0x82c40a95, 0x82c40d4a, 0xc3008daa, 0x82c60b4d, 0x82c6056b, 0x830042db,
            0xc2c4025d, 0x82c4092d, 0x83002d2b, 0x82c40a95, 0xc3009b4d, 0x82c406aa, 0x82c60ad5, 0x83006575, 0xc2c604bb, 0x82c4025b,
            0x83013457, 0x82c4052b, 0xc2ffba94, 0x82c60e95, 0x82c406aa, 0x83008ada, 0xc2c609b5, 0x82c404b6, 0x83004aae, 0x82c60a4f,
            0xc2c20526, 0x83012d26, 0x82c60d55, 0x8301a5a9, 0xc2c4056a, 0x82c6096d, 0x8301649d, 0x82c4049e, 0xc2c40a4d, 0x83004d4d,
            0x82c40d25, 0x8300bd53, 0xc2c40b54, 0x82c60b5a, 0x8301895a, 0x82c6095b, 0xc2c4049b, 0x83004a97, 0x82c40a4b, 0x82c40aa5,
            0xc3001ea5, 0x82c406d4, 0x8302badb, 0x82c402b6, 0xc2c60937, 0x830064af, 0x82c40497, 0x82c4064b, 0xc2fe374a, 0x82c60da5,
            0x8300b6b5, 0x82c6056d, 0xc2c402ae, 0x8300793e, 0x82c4092e, 0x82c40c96, 0xc3015d15, 0x82c40d4a, 0x82c60da5, 0x83013555,
            0xc2c4056a, 0x83007a7a, 0x82c60a5d, 0x82c4092d, 0xc3006aab, 0x82c40a95, 0x82c40b4a, 0x83004baa, 0xc2c60ad5, 0x82c4055a,
            0x830128ba, 0x82c60a5b, 0xc3007537, 0x82c4052b, 0x82c40693, 0x83015715, 0xc2c406aa, 0x82c60ad5, 0x830035b5, 0x82c404b6,
            0xc3008a5e, 0x82c40a4e, 0x82c40d26, 0x83006ea6, 0xc2c40d52, 0x82c60daa, 0x8301466a, 0x82c6056d, 0xc2c404ae, 0x83003a9d,
            0x82c40a4d, 0x83007d2b, 0xc2c40b25, 0x82c40d52, 0x83015d54, 0x82c60b5a, 0xc2c6055d, 0x8300355b, 0x82c4049b, 0x83007657,
            0x82c40a4b, 0x82c40aa5, 0x83006b65, 0x82c406d2, 0xc2c60ada, 0x830045b6, 0x82c60937, 0x82c40497, 0xc3003697, 0x82c4064d,
            0x82fe76aa, 0x82c60da5, 0xc2c405aa, 0x83005aec, 0x82c60aae, 0x82c4092e, 0xc3003d2e, 0x82c40c96, 0x83018d45, 0x82c40d4a,
            0xc2c60d55, 0x83016595, 0x82c4056a, 0x82c60a6d, 0xc300455d, 0x82c4052d, 0x82c40a95, 0x83013c95, 0xc2c40b4a, 0x83017b4a,
            0x82c60ad5, 0x82c4055a, 0xc3015a3a, 0x82c60a5b, 0x82c4052b, 0x83014a17, 0xc2c40693, 0x830096ab, 0x82c406aa, 0x82c60ab5,
            0xc30064f5, 0x82c404b6, 0x82c60a57, 0x82fe452e, 0xc2c40d16, 0x82c60e93, 0x82fe3752, 0x82c60daa, 0xc30175aa, 0x82c6056d,
            0x82c404ae, 0x83015a1d, 0xc2c40a2d, 0x82c40d15, 0x83004da5, 0x82c40b52, 0xc3009d6a, 0x82c60ada, 0x82c6055d, 0x8301629b,
            0xc2c4045b, 0x82c40a2b, 0x83005b2b, 0x82c40a95, 0xc2c40b52, 0x83012ab2, 0x82c60ad6, 0x83017556, 0xc2c60537, 0x82c40457,
            0x83005657, 0x82c4052b, 0xc2c40695, 0x83003795, 0x82c405aa, 0x8300aab6, 0xc2c60a6d, 0x82c404ae, 0x83006a6e, 0x82c40a56,
            0xc2c40d2a, 0x83005eaa, 0x82c60d55, 0x82c405aa, 0xc3003b6a, 0x82c60a6d, 0x830074bd, 0x82c404ab, 0xc2c40a8d, 0x83005d55,
            0x82c40b2a, 0x82c60b55, 0xc30045d5, 0x82c404da, 0x82c6095d, 0x83002557, 0xc2c4049b, 0x83006a97, 0x82c4064b, 0x82c406a9,
            0x83004baa, 0x82c606b5, 0x82c402ba, 0x83002ab6, 0xc2c60937, 0x82fe652e, 0x82c40d16, 0x82c60e4b, 0xc2fe56d2, 0x82c60da9,
            0x82c605b5, 0x8300336d, 0xc2c402ae, 0x82c40a2e, 0x83002e2d, 0x82c40c95, 0xc3006d55, 0x82c40b52, 0x82c60b69, 0x830045da,
            0xc2c6055d, 0x82c4025d, 0x83003a5b, 0x82c40a2b, 0xc3017a8b, 0x82c40a95, 0x82c40b4a, 0x83015b2a, 0xc2c60ad5, 0x82c6055b,
            0x830042b7, 0x82c40257, 0xc300952f, 0x82c4052b, 0x82c40695, 0x830066d5, 0xc2c405aa, 0x82c60ab5, 0x8300456d, 0x82c404ae,
            0xc2c60a57, 0x82ff3456, 0x82c40d2a, 0x83017e8a, 0xc2c60d55, 0x82c405aa, 0x83005ada, 0x82c6095d, 0xc2c404ae, 0x83004aab,
            0x82c40a4d, 0x83008d2b, 0xc2c40b29, 0x82c60b55, 0x83007575, 0x82c402da, 0xc2c6095d, 0x830054d7, 0x82c4049b, 0x82c40a4b,
            0xc3013a4b, 0x82c406a9, 0x83008ad9, 0x82c606b5, 0xc2c402b6, 0x83015936, 0x82c60937, 0x82c40497, 0xc2fe4696, 0x82c40e4a,
            0x8300aea6, 0x82c60da9, 0xc2c605ad, 0x830162ad, 0x82c402ae, 0x82c4092e, 0xc3005cad, 0x82c40c95, 0x82c40d4a, 0x83013d4a,
            0xc2c60b69, 0x8300757a, 0x82c6055b, 0x82c4025d, 0xc300595b, 0x82c4092b, 0x82c40a95, 0x83004d95, 0xc2c40b4a, 0x82c60b55,
            0x830026d5, 0x82c6055b, 0xc3006277, 0x82c40257, 0x82c4052b, 0x82fe5aaa, 0xc2c60e95, 0x82c406aa, 0x83003baa, 0x82c60ab5,
            0x830084bd, 0x82c404ae, 0x82c60a57, 0x82fe554d, 0xc2c40d26, 0x82c60d95, 0x83014655, 0x82c4056a, 0xc2c609ad, 0x8300255d,
            0x82c404ae, 0x83006a5b, 0xc2c40a4d, 0x82c40d25, 0x83005da9, 0x82c60b55, 0xc2c4056a, 0x83002ada, 0x82c6095d, 0x830074bb,
            0xc2c4049b, 0x82c40a4b, 0x83005b4b, 0x82c406a9, 0xc2c40ad4, 0x83024bb5, 0x82c402b6, 0x82c6095b, 0xc3002537, 0x82c40497,
            0x82fe6656, 0x82c40e4a, 0xc2c60ea5, 0x830156a9, 0x82c605b5, 0x82c402b6, 0xc30138ae, 0x82c4092e, 0x83017c8d, 0x82c40c95,
            0xc2c40d4a, 0x83016d8a, 0x82c60b69, 0x82c6056d, 0xc301425b, 0x82c4025d, 0x82c4092d, 0x83002d2b, 0xc2c40a95, 0x83007d55,
            0x82c40b4a, 0x82c60b55, 0xc3015555, 0x82c604db, 0x82c4025b, 0x83013857, 0xc2c4052b, 0x83008a9b, 0x82c40695, 0x82c406aa,
            0xc3006aea, 0x82c60ab5, 0x82c404b6, 0x83004aae, 0xc2c60a57, 0x82c40527, 0x82fe3726, 0x82c60d95, 0xc30076b5, 0x82c4056a,
            0x82c609ad, 0x830054dd, 0xc2c404ae, 0x82c40a4e, 0x83004d4d, 0x82c40d25, 0xc3008d59, 0x82c40b54, 0x82c60d6a, 0x8301695a,
            0xc2c6095b, 0x82c4049b, 0x83004a9b, 0x82c40a4b, 0xc300ab27, 0x82c406a5, 0x82c406d4, 0x83026b75, 0xc2c402b6, 0x82c6095b,
            0x830054b7, 0x82c40497, 0xc2c4064b, 0x82fe374a, 0x82c60ea5, 0x830086d9, 0xc2c605ad, 0x82c402b6, 0x8300596e, 0x82c4092e,
            0xc2c40c96, 0x83004e95, 0x82c40d4a, 0x82c60da5, 0xc3002755, 0x82c4056c, 0x83027abb, 0x82c4025d, 0xc2c4092d, 0x83005cab,
            0x82c40a95, 0x82c40b4a, 0xc3013b4a, 0x82c60b55, 0x8300955d, 0x82c404ba, 0xc2c60a5b, 0x83005557, 0x82c4052b, 0x82c40a95,
            0xc3004b95, 0x82c406aa, 0x82c60ad5, 0x830026b5, 0xc2c404b6, 0x83006a6e, 0x82c60a57, 0x82c40527, 0xc2fe56a6, 0x82c60d93,
            0x82c405aa, 0x83003b6a, 0xc2c6096d, 0x8300b4af, 0x82c404ae, 0x82c40a4d, 0xc3016d0d, 0x82c40d25, 0x82c40d52, 0x83005dd4,
            0xc2c60b6a, 0x82c6096d, 0x8300255b, 0x82c4049b, 0xc3007a57, 0x82c40a4b, 0x82c40b25, 0x83015b25, 0xc2c406d4, 0x82c60ada,
            0x830138b6]
    
    def __init__(self):
        self.lunarYear = 0
        self.lunarMonth = 0
        self.lunarDay = 0
        self.isIntercalation = False

        self.solarYear = 0
        self.solarMonth = 0
        self.solarDay = 0

        # Memoized cumulative day counts from the base year, so the repeated
        # lookups inside the month-search loops don't re-sum ~1000 years.
        self.__cumulativeLunarDays = {}
        self.__cumulativeSolarDays = {}

        # Default to today's solar date until an explicit date is set.
        today = kst_today()
        self.setSolarDate(today.year, today.month, today.day)


    def LunarIsoFormat(self):
        dateStr = "%04d-%02d-%02d" % (self.lunarYear, self.lunarMonth, self.lunarDay)
        if self.isIntercalation :
            dateStr += " Intercalation"
        return dateStr

    def SolarIsoFormat(self):
        return "%04d-%02d-%02d" % (self.solarYear, self.solarMonth, self.solarDay)

    def __getLunarData(self, year):
        return self.KOREAN_LUNAR_DATA[year - self.KOREAN_LUNAR_BASE_YEAR]

    def __getLunarIntercalationMonth(self, lunarData):
        return (lunarData >> 12) & 0x000F

    def __getLunarDays(self, year, month=None, isIntercalation=None):
        lunarData = self.__getLunarData(year)

        if month is not None and isIntercalation is not None :
            if (isIntercalation == True) and (self.__getLunarIntercalationMonth(lunarData) == month):
                days = self.LUNAR_BIG_MONTH_DAY if ((lunarData >>16) & 0x01) > 0 else self.LUNAR_SMALL_MONTH_DAY
            else:
                days = self.LUNAR_BIG_MONTH_DAY if ((lunarData >> (12 - month)) & 0x01) > 0 else self.LUNAR_SMALL_MONTH_DAY
        else:
            days = (lunarData >> 17) & 0x01FF
        return days

    def __accumulateYearDays(self, year, cache, perYearFn):
        # Sum of per-year day counts from the base year through `year`, memoized.
        # Extends the previous year's cached sum when available (amortized O(1)),
        # otherwise sums from the base year once and caches the total.
        if year in cache:
            return cache[year]
        if (year - 1) in cache and year > self.KOREAN_LUNAR_BASE_YEAR:
            days = cache[year - 1] + perYearFn(year)
        else:
            days = 0
            for baseYear in range(self.KOREAN_LUNAR_BASE_YEAR, year+1):
                days += perYearFn(baseYear)
        cache[year] = days
        return days

    def __getLunarDaysBeforeBaseYear(self, year):
        return self.__accumulateYearDays(year, self.__cumulativeLunarDays, lambda y: self.__getLunarDays(y))

    def __getLunarDaysBeforeBaseMonth(self, year, month, isIntercalation):
        days = 0
        if (year >= self.KOREAN_LUNAR_BASE_YEAR) and (month > 0):
            for baseMonth in range(1, month+1):
                days += self.__getLunarDays(year, baseMonth, False)

            if isIntercalation == True:
                intercalationMonth = self.__getLunarIntercalationMonth(self.__getLunarData(year))
                if (intercalationMonth > 0) and intercalationMonth < month+1:
                    days += self.__getLunarDays(year, intercalationMonth, True)
        return days

    def __getLunarAbsDays(self, year, month, day, isIntercalation):
        days = self.__getLunarDaysBeforeBaseYear(year-1) + self.__getLunarDaysBeforeBaseMonth(year, month-1, True) + day
        if (isIntercalation == True) and (self.__getLunarIntercalationMonth(self.__getLunarData(year)) == month):
            days += self.__getLunarDays(year, month, False)
        return days

    def __isSolarIntercalationYear(self, lunarData):
        return ((lunarData >> 30) & 0x01) > 0

    def __getSolarDays(self, year, month=None):
        lunarData = self.__getLunarData(year)
        if month is not None :
            days = self.SOLAR_DAYS[12] if (month == 2) and self.__isSolarIntercalationYear(lunarData) else self.SOLAR_DAYS[month - 1]
        else:
            days = self.SOLAR_BIG_YEAR_DAY if self.__isSolarIntercalationYear(lunarData) else self.SOLAR_SMALL_YEAR_DAY
        return days

    def __getSolarDaysBeforeBaseYear(self, year):
        return self.__accumulateYearDays(year, self.__cumulativeSolarDays, lambda y: self.__getSolarDays(y))

    def __getSolarDaysBeforeBaseMonth(self, year, month):
        days = 0
        for baseMonth in range(1, month+1):
            days += self.__getSolarDays(year, baseMonth)
        return days
    
    def __getSolarAbsDays(self, year, month, day):
        days = self.__getSolarDaysBeforeBaseYear(year-1) + self.__getSolarDaysBeforeBaseMonth(year, month-1) + day
        days -= self.SOLAR_LUNAR_DAY_DIFF
        return days

    def __setSolarDateByLunarDate(self, lunarYear, lunarMonth, lunarDay, isIntercalation):
        absDays = self.__getLunarAbsDays(lunarYear, lunarMonth, lunarDay, isIntercalation)
        solarYear = 0
        solarMonth = 0
        solarDay = 0

        solarYear = lunarYear if (absDays < self.__getSolarAbsDays(lunarYear+1, 1, 1)) else lunarYear+1

        for month in range(12, 0, -1) :
            absDaysByMonth = self.__getSolarAbsDays(solarYear, month, 1)
            if (absDays >= absDaysByMonth) :
                solarMonth = month
                solarDay = absDays - absDaysByMonth +1
                break

        self.solarYear = solarYear
        self.solarMonth = solarMonth
        self.solarDay  = solarDay

    def __setLunarDateBySolarDate(self, solarYear, solarMonth, solarDay):
        absDays = self.__getSolarAbsDays(solarYear, solarMonth, solarDay)
        lunarYear = solarYear if (absDays >= self.__getLunarAbsDays(solarYear, 1, 1, False)) else solarYear-1
        lunarMonth = 0
        lunarDay = 0
        isIntercalation = False
        
        for month in range(12, 0, -1) :
            absDaysByMonth = self.__getLunarAbsDays(lunarYear, month, 1, False)
            if absDays >= absDaysByMonth:
                lunarMonth = month
                if self.__getLunarIntercalationMonth(self.__getLunarData(lunarYear)) == month :
                    isIntercalation = absDays >= self.__getLunarAbsDays(lunarYear, month, 1, True)
                
                lunarDay = absDays - self.__getLunarAbsDays(lunarYear, lunarMonth, 1, isIntercalation) + 1
                break

        self.lunarYear = lunarYear
        self.lunarMonth = lunarMonth
        self.lunarDay = lunarDay        
        self.isIntercalation = isIntercalation

    def __checkValidDate(self, isLunar, isIntercalation, year, month, day):
        isValid = False
        # Reject non-integer inputs before they corrupt the bitfield/index math.
        if not all(isinstance(value, numbers.Integral) for value in (year, month, day)):
            return isValid
        dateValue = year*10000 + month*100 + day
        #1582. 10. 5 ~ 1582. 10. 14 is not valid
        minValue = self.KOREAN_LUNAR_MIN_VALUE if isLunar else self.KOREAN_SOLAR_MIN_VALUE
        maxValue = self.KOREAN_LUNAR_MAX_VALUE if isLunar else self.KOREAN_SOLAR_MAX_VALUE

        if minValue <= dateValue and maxValue >= dateValue :
            if month > 0 and month < 13 and day > 0 :
                # A leap-month request is only valid when this year's actual
                # intercalation month matches the requested month.
                if isLunar and isIntercalation and (self.__getLunarIntercalationMonth(self.__getLunarData(year)) != month) :
                    return isValid
                dayLimit = self.__getLunarDays(year, month, isIntercalation) if isLunar else self.__getSolarDays(year, month)
                # 1582.10.5 ~ 1582.10.14 were skipped by the Gregorian reform; the
                # month still ends at day 31, so only those 10 days are rejected.
                if isLunar == False and year == 1582 and month == 10 and day > 4 and day < 15 :
                    return isValid

                if day <= dayLimit :
                    isValid = True

        return isValid

    def setLunarDate(self, lunarYear, lunarMonth, lunarDay, isIntercalation) :
        isValid = False
        if self.__checkValidDate(True, isIntercalation, lunarYear, lunarMonth, lunarDay):
            self.lunarYear = lunarYear
            self.lunarMonth = lunarMonth
            self.lunarDay = lunarDay
            self.isIntercalation = isIntercalation and (self.__getLunarIntercalationMonth(self.__getLunarData(lunarYear)) == lunarMonth)
            self.__setSolarDateByLunarDate(lunarYear, lunarMonth, lunarDay, isIntercalation)
            isValid = True
        return isValid

    def setSolarDate(self, solarYear, solarMonth, solarDay):
        isValid = False
        if self.__checkValidDate(False, False, solarYear, solarMonth, solarDay) :
            self.solarYear = solarYear
            self.solarMonth = solarMonth
            self.solarDay = solarDay
            self.__setLunarDateBySolarDate(solarYear, solarMonth, solarDay)
            isValid = True
        return isValid

    def __getGapJa(self):
        # Sexagenary-cycle indices for the current lunar date as
        # ((yearCheongan, yearGanji), (monthCheongan, monthGanji), (dayCheongan, dayGanji)).
        # Pure: returns a fresh tuple instead of mutating instance state. When no
        # valid date is set (absDays <= 0) it returns the zero indices, preserving
        # the historical default for an unset converter.
        absDays = self.__getLunarAbsDays(self.lunarYear, self.lunarMonth, self.lunarDay, self.isIntercalation)
        if absDays <= 0 :
            return ((0, 0), (0, 0), (0, 0))

        cheonganLen = len(self.KOREAN_CHEONGAN)
        ganjiLen = len(self.KOREAN_GANJI)
        monthCount = self.lunarMonth + 12 * (self.lunarYear - self.KOREAN_LUNAR_BASE_YEAR)

        yearInx = (((self.lunarYear + self.GAPJA_YEAR_CHEONGAN_OFFSET) - self.KOREAN_LUNAR_BASE_YEAR) % cheonganLen,
                   ((self.lunarYear + self.GAPJA_YEAR_GANJI_OFFSET) - self.KOREAN_LUNAR_BASE_YEAR) % ganjiLen)
        monthInx = ((monthCount + self.GAPJA_MONTH_CHEONGAN_OFFSET) % cheonganLen,
                    (monthCount + self.GAPJA_MONTH_GANJI_OFFSET) % ganjiLen)
        dayInx = ((absDays + self.GAPJA_DAY_CHEONGAN_OFFSET) % cheonganLen,
                  (absDays + self.GAPJA_DAY_GANJI_OFFSET) % ganjiLen)
        return (yearInx, monthInx, dayInx)

    def getGapJaString(self) :
        (yearInx, monthInx, dayInx) = self.__getGapJa()
        gapjaStr = "%c%c%c %c%c%c %c%c%c" % (chr(self.KOREAN_CHEONGAN[yearInx[0]]), chr(self.KOREAN_GANJI[yearInx[1]]), chr(self.KOREAN_GAPJA_UNIT[0]),
        chr(self.KOREAN_CHEONGAN[monthInx[0]]), chr(self.KOREAN_GANJI[monthInx[1]]), chr(self.KOREAN_GAPJA_UNIT[1]),
        chr(self.KOREAN_CHEONGAN[dayInx[0]]), chr(self.KOREAN_GANJI[dayInx[1]]), chr(self.KOREAN_GAPJA_UNIT[2]))

        if self.isIntercalation == True :
            gapjaStr += " (%c%c)" % (chr(self.INTERCALATION_STR[0]), chr(self.KOREAN_GAPJA_UNIT[1]))
        return gapjaStr


    def getChineseGapJaString(self) :
        (yearInx, monthInx, dayInx) = self.__getGapJa()
        gapjaStr = "%c%c%c %c%c%c %c%c%c" % (chr(self.CHINESE_CHEONGAN[yearInx[0]]), chr(self.CHINESE_GANJI[yearInx[1]]), chr(self.CHINESE_GAPJA_UNIT[0]),
        chr(self.CHINESE_CHEONGAN[monthInx[0]]), chr(self.CHINESE_GANJI[monthInx[1]]), chr(self.CHINESE_GAPJA_UNIT[1]),
        chr(self.CHINESE_CHEONGAN[dayInx[0]]), chr(self.CHINESE_GANJI[dayInx[1]]), chr(self.CHINESE_GAPJA_UNIT[2]))

        if self.isIntercalation == True :
            gapjaStr += " (%c%c)" % (chr(self.INTERCALATION_STR[1]), chr(self.CHINESE_GAPJA_UNIT[1]))
        return gapjaStr


def solar_to_lunar(y, m, d):
    """양력 날짜 -> (음력년, 음력월, 음력일, 윤달여부). 변환 실패 시 None."""
    try:
        cal = KoreanLunarCalendar()
        cal.setSolarDate(y, m, d)
        return cal.lunarYear, cal.lunarMonth, cal.lunarDay, cal.isIntercalation
    except Exception:
        return None


def lunar_to_solar(y, m, d, leap=False):
    """(음력년, 음력월, 음력일) -> 양력 날짜 문자열(YYYY-MM-DD). 변환 실패 시 None."""
    try:
        cal = KoreanLunarCalendar()
        cal.setLunarDate(y, m, d, leap)
        return f"{cal.solarYear:04d}-{cal.solarMonth:02d}-{cal.solarDay:02d}"
    except Exception:
        return None




SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
HR_PASSWORD = os.environ.get("HR_PASSWORD", "")
FAMILY_PASSWORD = os.environ.get("FAMILY_PASSWORD", "")

# 가족용 비밀번호는 "개인 일정관리(personal)", "가족 공유 메모(family_notes)", "학교 시간표(timetable)"만 열 수 있음
FAMILY_ALLOWED_RESOURCES = {"personal", "family_notes", "timetable", "personal_media"}
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
    url = f"{SUPABASE_URL}/rest/v1/{urllib.parse.quote(path, safe='?&=,.*:()!~%/')}"
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


def auth_role(candidate: str) -> str:
    """비밀번호로 role 판별: 'admin' | 'family' | None(불일치)"""
    if HR_PASSWORD and candidate == HR_PASSWORD:
        return "admin"
    if FAMILY_PASSWORD and candidate == FAMILY_PASSWORD:
        return "family"
    return None


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
    """저장소 경로(키)용 이름 생성. Supabase Storage는 키에 한글 등 비-ASCII
    문자가 들어가면 'InvalidKey' 오류를 내므로, 경로는 순수 영문/숫자
    조합(UUID+확장자)만 쓰고, 원래 파일명(한글 포함)은 DB의 file_name
    컬럼에 별도로 저장해서 화면 표시·다운로드에 사용합니다."""
    name = name or "file"
    ext = ""
    if "." in name:
        raw_ext = name.rsplit(".", 1)[-1]
        ext = "." + re.sub(r"[^A-Za-z0-9]", "", raw_ext)[:10]
    return f"{uuid.uuid4()}{ext}"


# ────────────────────────────────────────────────────────────
# promotions 전용 유틸 — 근속년수(N년M월D일) 계산
# ────────────────────────────────────────────────────────────


class handler(BaseHTTPRequestHandler):
    def _authorized(self, qs=None):
        role = auth_role(self.headers.get("X-HR-Password", ""))
        if role is None:
            return False
        if role == "family":
            resource = self._resource(qs) if qs is not None else None
            if resource not in FAMILY_ALLOWED_RESOURCES:
                return False
        return True

    def _role(self):
        return auth_role(self.headers.get("X-HR-Password", ""))

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

    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)
            if resource == "personal":
                return self._get_personal(qs)
            if resource == "family_notes":
                return self._get_family_notes(qs)
            if resource == "timetable":
                return self._get_timetable(qs)
            if resource == "personal_media":
                return self._get_personal_media(qs)
            return self._send(400, {"error": "알 수 없는 resource입니다"})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _generate_lunar_occurrences(self):
        """date_type='lunar'인 매년 반복 일정을, 매년 실제 양력 날짜로 환산해서 발생일자를 채워넣음.
        예전에는 (음력 일정 수 × 연도 수)만큼 건마다 개별 POST를 보내서 왕복이 여러 번 발생했는데,
        전부 모았다가 배열 하나로 한 번에 upsert하도록 바꿔서 왕복을 1번으로 줄임."""
        tasks = rest_request(
            "GET", "personal_schedule_tasks?date_type=eq.lunar&active=eq.true&select=*"
        ) or []
        if not tasks:
            return
        today = kst_today()
        horizon_year = (today + datetime.timedelta(days=400)).year
        rows_to_upsert = []
        for t in tasks:
            if t.get("lunar_month") is None or t.get("lunar_day") is None:
                continue
            start_year = int(t["anchor_date"][:4])
            end_year = int(t["end_date"][:4]) if t.get("end_date") else horizon_year
            for y in range(start_year, min(horizon_year, end_year) + 1):
                solar_date = lunar_to_solar(y, t["lunar_month"], t["lunar_day"], t.get("lunar_leap", False))
                if not solar_date:
                    continue
                if t.get("end_date") and solar_date > t["end_date"]:
                    continue
                rows_to_upsert.append({"task_id": t["id"], "due_date": solar_date})
        if not rows_to_upsert:
            return
        rest_request(
            "POST", "personal_schedule_occurrences?on_conflict=task_id,due_date",
            body=rows_to_upsert,
            prefer="resolution=merge-duplicates",
        )

    def _get_personal(self, qs):
        role = self._role()
        if qs.get("members", ["0"])[0] == "1":
            rows = rest_request("GET", "personal_schedule_members?select=*&order=sort_order.asc")
            return self._send(200, {"members": rows})

        if qs.get("prepare", ["0"])[0] == "1":
            rpc("generate_personal_schedule_occurrences", {})
            self._generate_lunar_occurrences()
            return self._send(200, {"ok": True})

        # 첫 화면에서는 prepare=1로 한 번만 생성한 뒤, 나머지 병렬 조회가
        # skip_prepare=1을 사용해 같은 생성 작업을 반복하지 않습니다.
        if qs.get("skip_prepare", ["0"])[0] != "1":
            rpc("generate_personal_schedule_occurrences", {})
            self._generate_lunar_occurrences()

        if qs.get("tasks", ["0"])[0] == "1":
            rows = rest_request(
                "GET", "personal_schedule_tasks?select=*&order=active.desc,member_name.asc,anchor_date.asc"
            ) or []
            if role == "family":
                rows = [r for r in rows if not r.get("is_private")]
            return self._send(200, {"tasks": rows})

        if qs.get("upcoming", ["0"])[0] == "1":
            today = kst_today()
            horizon = (today + datetime.timedelta(days=60)).isoformat()
            rows = rest_request(
                "GET",
                "personal_schedule_occurrences?status=eq.pending&due_date=lte." + horizon
                + "&select=*,personal_schedule_tasks(title,category,member_name,reminder_days_before,note,is_private)&order=due_date.asc",
            ) or []
            result = []
            for r in rows:
                due = datetime.date.fromisoformat(r["due_date"])
                task = r.get("personal_schedule_tasks") or {}
                if role == "family" and task.get("is_private"):
                    continue
                category = task.get("category")
                reminder_days = task.get("reminder_days_before") or 1
                days_left = (due - today).days
                # 결제일이 아니면 "지난 일정(확인 필요)"로 계속 남기지 않고, 다가올 때만 안내
                if category != "결제일" and days_left < 0:
                    continue
                if days_left < 0 or days_left <= reminder_days:
                    result.append({
                        "occurrence_id": r["id"], "task_id": r["task_id"], "due_date": r["due_date"],
                        "days_left": days_left, "title": task.get("title"),
                        "category": category, "member_name": task.get("member_name"),
                    })
            return self._send(200, {"upcoming": result})

        today = kst_today()
        default_from = (today.replace(day=1) - datetime.timedelta(days=31)).replace(day=1).isoformat()
        default_to = (today + datetime.timedelta(days=90)).isoformat()
        from_date = qs.get("from", [None])[0] or default_from
        to_date = qs.get("to", [None])[0] or default_to
        status_filter = qs.get("status", [None])[0]
        member_filter = qs.get("member", [None])[0]

        path = (
            "personal_schedule_occurrences?due_date=gte." + from_date + "&due_date=lte." + to_date
            + "&select=*,personal_schedule_tasks(title,category,member_name,recurrence_type,anchor_date,end_date,note,date_type,is_private,created_by_role)&order=due_date.asc"
        )
        if status_filter and status_filter != "all":
            path += "&status=eq." + status_filter
        rows = rest_request("GET", path) or []
        # 이전 달에 시작해 조회 월까지 이어지는 일회성 기간 일정도 달력에 포함합니다.
        spanning_tasks = rest_request(
            "GET", "personal_schedule_tasks?recurrence_type=eq.once&end_date=gte." + from_date
            + "&anchor_date=lt." + from_date
            + "&select=id,title,category,member_name,recurrence_type,anchor_date,end_date,note,date_type,is_private,created_by_role"
        ) or []
        if spanning_tasks:
            task_ids = ",".join(t["id"] for t in spanning_tasks)
            spanning_occurrences = rest_request(
                "GET", f"personal_schedule_occurrences?task_id=in.({task_ids})&select=*&order=due_date.asc"
            ) or []
            task_by_id = {t["id"]: t for t in spanning_tasks}
            existing_ids = {r.get("id") for r in rows}
            for occurrence in spanning_occurrences:
                if occurrence.get("id") in existing_ids:
                    continue
                if status_filter and status_filter != "all" and occurrence.get("status") != status_filter:
                    continue
                occurrence["personal_schedule_tasks"] = task_by_id.get(occurrence.get("task_id")) or {}
                rows.append(occurrence)
        if role == "family":
            rows = [r for r in rows if not (r.get("personal_schedule_tasks") or {}).get("is_private")]
        if member_filter:
            rows = [r for r in rows if (r.get("personal_schedule_tasks") or {}).get("member_name") == member_filter]
        if status_filter == "pending":
            # 결제일 외(생일 등)는 "완료" 개념이 없어서 지나도 계속 미확인 상태로 남는데,
            # 미확인 목록을 볼 때는 이미 지난 것까지 계속 보일 필요는 없으니 자동으로 뺌.
            # (결제일은 실제 확인/처리해야 하니 지났어도 계속 보여줘야 함 — 그건 그대로 둠)
            today_iso = kst_today().isoformat()
            rows = [
                r for r in rows
                if not (
                    (r.get("personal_schedule_tasks") or {}).get("category") != "결제일"
                    and r["due_date"] < today_iso
                )
            ]
        rows.sort(key=lambda r: (r.get("due_date") or "", r.get("id") or ""))
        return self._send(200, {"occurrences": rows})

    def _post_personal(self, payload):
        action = payload.get("type")
        role = self._role()

        if action == "save_member":
            name = payload.get("name")
            if not name:
                return self._send(400, {"error": "name은 필수입니다"})
            rest_request("POST", "personal_schedule_members?on_conflict=name", body={
                "name": name,
                "color": payload.get("color") or "#888888",
                "sort_order": int(payload.get("sort_order") or 99),
            }, prefer="resolution=merge-duplicates")
            return self._send(200, {"ok": True})

        if action == "complete":
            occ_id = payload.get("occurrence_id")
            if not occ_id:
                return self._send(400, {"error": "occurrence_id는 필수입니다"})
            occ_owner = self._occurrence_owner_role(occ_id)
            if self._blocked_by_ownership(occ_owner, role):
                return self._send(403, {"error": "이 일정은 처음 등록하신 분(계정)만 처리할 수 있습니다"})
            done = payload.get("done", True)
            rest_request("PATCH", f"personal_schedule_occurrences?id=eq.{occ_id}", body={
                "status": "done" if done else "pending",
                "completed_at": datetime.datetime.utcnow().isoformat() if done else None,
                "completed_note": payload.get("note") if done else None,
            })
            return self._send(200, {"ok": True})

        if action == "skip":
            occ_id = payload.get("occurrence_id")
            if not occ_id:
                return self._send(400, {"error": "occurrence_id는 필수입니다"})
            occ_owner = self._occurrence_owner_role(occ_id)
            if self._blocked_by_ownership(occ_owner, role):
                return self._send(403, {"error": "이 일정은 처음 등록하신 분(계정)만 처리할 수 있습니다"})
            rest_request("PATCH", f"personal_schedule_occurrences?id=eq.{occ_id}", body={"status": "skipped"})
            return self._send(200, {"ok": True})

        member_name = payload.get("member_name")
        title = payload.get("title")
        anchor_date = payload.get("anchor_date")
        recurrence_type = payload.get("recurrence_type", "once")
        if not member_name or not title or not anchor_date:
            return self._send(400, {"error": "member_name, title, anchor_date는 필수입니다"})
        if recurrence_type not in ("once", "weekly", "monthly"):
            return self._send(400, {"error": "recurrence_type이 올바르지 않습니다"})

        # 음력 기준(예: 음력 생일) — 입력하신 기준일자(양력)를 음력으로 환산해서
        # 음력 월/일을 저장해두고, 해마다 그 음력 월/일에 해당하는 양력 날짜로 발생시킴
        is_lunar = payload.get("date_type") == "lunar"
        lunar_month = lunar_day = None
        if is_lunar:
            try:
                solar_dt = datetime.date.fromisoformat(anchor_date)
                cal = KoreanLunarCalendar()
                cal.setSolarDate(solar_dt.year, solar_dt.month, solar_dt.day)
                lunar_month, lunar_day = cal.lunarMonth, cal.lunarDay
            except Exception as e:
                return self._send(400, {"error": f"음력 변환에 실패했습니다: {type(e).__name__}: {e}"})

        body = {
            "member_name": member_name,
            "category": payload.get("category") or "일정",
            "title": title,
            "recurrence_type": recurrence_type,
            "interval_value": int(payload.get("interval_value") or 1),
            "anchor_date": anchor_date,
            "day_mode": payload.get("day_mode", "fixed"),
            "end_date": payload.get("end_date") or None,
            "reminder_days_before": int(payload.get("reminder_days_before") or 1),
            "note": payload.get("note"),
            "active": True,
            "date_type": "lunar" if is_lunar else "solar",
            "lunar_month": lunar_month,
            "lunar_day": lunar_day,
            "is_private": bool(payload.get("is_private")),
            "created_by_role": role,
        }
        created = rest_request("POST", "personal_schedule_tasks", body=body, prefer="return=representation")
        rpc("generate_personal_schedule_occurrences", {})
        self._generate_lunar_occurrences()
        return self._send(201, {"task": created[0] if created else None})


    def do_POST(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)
            payload = self._read_json_body()
            if resource == "personal":
                return self._post_personal(payload)
            if resource == "family_notes":
                return self._post_family_notes(payload)
            if resource == "timetable":
                return self._post_timetable(payload)
            if resource == "personal_media":
                return self._post_personal_media(payload)
            return self._send(400, {"error": "알 수 없는 resource입니다"})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _get_family_notes(self, qs):
        status_filter = qs.get("status", [None])[0]
        path = "family_notes?select=*&order=status.asc,created_at.desc"
        if status_filter == "active":
            # 완료 처리 전까지(미확인+확인함) — 기본으로 보여주는 값
            path += "&status=neq.done"
        elif status_filter and status_filter != "all":
            path += "&status=eq." + status_filter
        rows = rest_request("GET", path) or []
        return self._send(200, {"notes": rows})

    def _post_family_notes(self, payload):
        target_member = payload.get("target_member")
        content = payload.get("content")
        if not target_member or not content:
            return self._send(400, {"error": "target_member, content는 필수입니다"})
        body = {
            "target_member": target_member,
            "content": content,
            "created_by_role": self._role(),
            "status": "pending",
        }
        created = rest_request("POST", "family_notes", body=body, prefer="return=representation")
        return self._send(201, {"note": created[0] if created else None})

    def _patch_family_notes(self, note_id, payload):
        # 상태(확인함/완료)는 가족 누구나 바꿀 수 있음(공유 게시판이니까).
        # 내용(content) 수정은 작성한 본인(계정)만 가능.
        if "content" in payload or "target_member" in payload:
            rows = rest_request("GET", f"family_notes?id=eq.{note_id}&select=created_by_role")
            owner_role = rows[0]["created_by_role"] if rows else None
            if self._blocked_by_ownership(owner_role, self._role()):
                return self._send(403, {"error": "이 메모는 작성하신 분(계정)만 수정할 수 있습니다"})

        update_fields = {}
        for key in ("target_member", "content"):
            if key in payload:
                update_fields[key] = payload[key]
        if "status" in payload:
            status = payload["status"]
            if status not in ("pending", "checked", "done"):
                return self._send(400, {"error": "status 값이 올바르지 않습니다"})
            update_fields["status"] = status
            update_fields["checked_at"] = datetime.datetime.utcnow().isoformat() if status != "pending" else None

        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})
        rest_request("PATCH", f"family_notes?id=eq.{note_id}", body=update_fields)
        return self._send(200, {"ok": True})

    def _delete_family_notes(self, qs):
        note_id = qs.get("id", [None])[0]
        if not note_id:
            return self._send(400, {"error": "id는 필수입니다"})
        rows = rest_request("GET", f"family_notes?id=eq.{note_id}&select=created_by_role")
        owner_role = rows[0]["created_by_role"] if rows else None
        if self._blocked_by_ownership(owner_role, self._role()):
            return self._send(403, {"error": "이 메모는 작성하신 분(계정)만 삭제할 수 있습니다"})
        rest_request("DELETE", f"family_notes?id=eq.{note_id}")
        return self._send(200, {"ok": True})

    def _blocked_by_ownership(self, owner_role, current_role):
        """'나'(admin) 계정은 누가 입력했든 관리자 권한으로 전부 수정/삭제 가능.
        '가족'(family) 계정은 본인이 입력한 것만 가능."""
        if current_role == "admin":
            return False
        return bool(owner_role) and owner_role != current_role

    def _task_owner_role(self, task_id):
        rows = rest_request("GET", f"personal_schedule_tasks?id=eq.{task_id}&select=created_by_role")
        return rows[0]["created_by_role"] if rows else None

    def _occurrence_owner_role(self, occ_id):
        rows = rest_request(
            "GET",
            f"personal_schedule_occurrences?id=eq.{occ_id}&select=personal_schedule_tasks(created_by_role)",
        )
        if not rows:
            return None
        task = rows[0].get("personal_schedule_tasks") or {}
        return task.get("created_by_role")

    def _patch_personal(self, task_id, payload):
        owner_role = self._task_owner_role(task_id)
        if self._blocked_by_ownership(owner_role, self._role()):
            return self._send(403, {"error": "이 일정은 처음 등록하신 분(계정)만 수정할 수 있습니다"})

        update_fields = {}
        for key in ("member_name", "category", "title", "recurrence_type", "interval_value",
                    "anchor_date", "day_mode", "end_date", "reminder_days_before", "note", "active"):
            if key in payload:
                update_fields[key] = payload[key]
        if "is_private" in payload:
            update_fields["is_private"] = bool(payload["is_private"])

        if "date_type" in payload:
            is_lunar = payload.get("date_type") == "lunar"
            update_fields["date_type"] = "lunar" if is_lunar else "solar"
            if is_lunar:
                anchor = payload.get("anchor_date")
                if not anchor:
                    existing = rest_request("GET", f"personal_schedule_tasks?id=eq.{task_id}&select=anchor_date")
                    anchor = existing[0]["anchor_date"] if existing else None
                if anchor:
                    solar_dt = datetime.date.fromisoformat(anchor)
                    converted = solar_to_lunar(solar_dt.year, solar_dt.month, solar_dt.day)
                    if converted:
                        _, lm, ld, _ = converted
                        update_fields["lunar_month"] = lm
                        update_fields["lunar_day"] = ld
            else:
                update_fields["lunar_month"] = None
                update_fields["lunar_day"] = None

        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        rest_request("PATCH", f"personal_schedule_tasks?id=eq.{task_id}", body=update_fields)
        today = kst_today().isoformat()
        rest_request(
            "DELETE",
            f"personal_schedule_occurrences?task_id=eq.{task_id}&status=eq.pending&due_date=gte.{today}",
        )
        rpc("generate_personal_schedule_occurrences", {})
        self._generate_lunar_occurrences()
        return self._send(200, {"ok": True})

    def _delete_personal(self, qs):
        task_id = qs.get("id", [None])[0]
        occ_id = qs.get("occurrence_id", [None])[0]
        member_id = qs.get("member_id", [None])[0]
        role = self._role()

        if member_id:
            rest_request("DELETE", f"personal_schedule_members?id=eq.{member_id}")
            return self._send(200, {"ok": True})
        if task_id:
            owner_role = self._task_owner_role(task_id)
            if self._blocked_by_ownership(owner_role, role):
                return self._send(403, {"error": "이 일정은 처음 등록하신 분(계정)만 삭제할 수 있습니다"})
            rest_request("DELETE", f"personal_schedule_tasks?id=eq.{task_id}")
            return self._send(200, {"ok": True})
        if occ_id:
            occ_owner = self._occurrence_owner_role(occ_id)
            if self._blocked_by_ownership(occ_owner, role):
                return self._send(403, {"error": "이 일정은 처음 등록하신 분(계정)만 삭제할 수 있습니다"})
            rest_request("DELETE", f"personal_schedule_occurrences?id=eq.{occ_id}")
            return self._send(200, {"ok": True})
        return self._send(400, {"error": "id, occurrence_id 또는 member_id가 필요합니다"})

    # ────────────────────────────────────────────────────────
    # timetable (학교 시간표)
    # ────────────────────────────────────────────────────────
    # ────────────────────────────────────────────────────────
    # 급여/퇴직급여 업무 매뉴얼
    # ────────────────────────────────────────────────────────

    def do_PATCH(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)
            item_id = qs.get("id", [None])[0]
            payload = self._read_json_body()
            if resource == "personal":
                if not item_id:
                    return self._send(400, {"error": "id는 필수입니다"})
                return self._patch_personal(item_id, payload)
            if resource == "family_notes":
                if not item_id:
                    return self._send(400, {"error": "id는 필수입니다"})
                return self._patch_family_notes(item_id, payload)
            if resource == "timetable":
                if not item_id:
                    return self._send(400, {"error": "id는 필수입니다"})
                return self._patch_timetable(item_id, payload)
            return self._send(400, {"error": "알 수 없는 resource입니다"})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

    def _get_personal_media(self, qs):
        category = qs.get("category", [None])[0]
        if category not in ("notice", "album"):
            return self._send(400, {"error": "category는 notice 또는 album이어야 합니다"})

        file_id = qs.get("file_id", [None])[0]
        if file_id:
            # 이미지 외(문서/PDF 등)는 목록에서 바로 서명 URL을 안 만들고, 실제로 열 때만 생성
            rows = rest_request(
                "GET", f"personal_media?id=eq.{file_id}&select=file_name,storage_path,content_type"
            ) or []
            if not rows:
                return self._send(404, {"error": "파일을 찾을 수 없습니다"})
            row = rows[0]
            view_url = storage_sign_url(row.get("storage_path"))
            if not view_url:
                return self._send(502, {"error": "열람 주소를 만들지 못했습니다"})
            return self._send(200, {"file_name": row.get("file_name"), "view_url": view_url})

        rows = rest_request(
            "GET", f"personal_media?category=eq.{category}&select=*&order=created_at.desc"
        ) or []
        # 이미지는 목록에서 바로 미리보기가 필요해서, 이미지 항목에 한해서만 서명 URL을 같이 만들어 내려줌
        for r in rows:
            if (r.get("content_type") or "").startswith("image/"):
                r["view_url"] = storage_sign_url(r.get("storage_path"))
        return self._send(200, {"items": rows})

    def _post_personal_media(self, payload):
        category = payload.get("category")
        if category not in ("notice", "album"):
            return self._send(400, {"error": "category는 notice 또는 album이어야 합니다"})
        fb64 = payload.get("file_base64")
        fname = payload.get("file_name")
        if not fb64 or not fname:
            return self._send(400, {"error": "file_base64, file_name은 필수입니다"})
        try:
            fbytes = base64.b64decode(fb64)
        except Exception:
            return self._send(400, {"error": "파일 데이터를 해독할 수 없습니다"})
        if len(fbytes) > 8 * 1024 * 1024:
            return self._send(413, {"error": "파일이 너무 큽니다 (8MB 이하로 올려주세요)"})

        subfolder = "notices" if category == "notice" else "album"
        spath = f"personal/{subfolder}/{safe_filename(fname)}"
        storage_upload(spath, fbytes, payload.get("content_type"))

        role = self._role()
        created = rest_request("POST", "personal_media", body={
            "category": category,
            "file_name": fname,
            "storage_path": spath,
            "content_type": payload.get("content_type"),
            "file_size": len(fbytes),
            "note": payload.get("note"),
            "uploaded_by_role": role,
        }, prefer="return=representation")
        return self._send(201, {"item": created[0] if created else None})

    def _delete_personal_media(self, qs):
        item_id = qs.get("id", [None])[0]
        if not item_id:
            return self._send(400, {"error": "id는 필수입니다"})
        rows = rest_request("GET", f"personal_media?id=eq.{item_id}&select=storage_path,uploaded_by_role") or []
        if not rows:
            return self._send(404, {"error": "파일을 찾을 수 없습니다"})
        owner_role = rows[0].get("uploaded_by_role")
        role = self._role()
        # "나"(admin) 계정은 누가 올렸든 삭제 가능. "가족" 계정은 본인이 올린 것만 삭제 가능.
        if role != "admin" and owner_role != role:
            return self._send(403, {"error": "이 자료는 등록하신 분(계정)만 삭제할 수 있습니다"})
        storage_delete(rows[0]["storage_path"])
        rest_request("DELETE", f"personal_media?id=eq.{item_id}")
        return self._send(200, {"ok": True})

    def _get_timetable(self, qs):
        child = qs.get("child", ["하진"])[0]

        if qs.get("bundle", ["0"])[0] == "1":
            with ThreadPoolExecutor(max_workers=3) as pool:
                periods_future = pool.submit(
                    rest_request, "GET",
                    f"timetable_period_times?child_name=eq.{quote(child)}&select=*&order=sort_order.asc",
                )
                entries_future = pool.submit(
                    rest_request, "GET", f"timetable_entries?child_name=eq.{quote(child)}&select=*"
                )
                teachers_future = pool.submit(
                    rest_request, "GET",
                    f"timetable_teachers?child_name=eq.{quote(child)}&select=*&order=subject_name.asc",
                )
                periods = periods_future.result() or []
                entries = entries_future.result() or []
                teachers = teachers_future.result() or []
            teacher_by_subject = {t["subject_name"]: t for t in teachers}
            for e in entries:
                t = teacher_by_subject.get(e["subject_name"])
                e["teacher_name"] = t.get("teacher_name") if t else None
                e["teacher_phone"] = t.get("teacher_phone") if t else None
            return self._send(200, {"periods": periods, "entries": entries, "teachers": teachers})

        if qs.get("periods", ["0"])[0] == "1":
            rows = rest_request(
                "GET",
                f"timetable_period_times?child_name=eq.{quote(child)}&select=*&order=sort_order.asc",
            )
            return self._send(200, {"periods": rows})

        if qs.get("teachers", ["0"])[0] == "1":
            rows = rest_request(
                "GET", f"timetable_teachers?child_name=eq.{quote(child)}&select=*&order=subject_name.asc"
            )
            return self._send(200, {"teachers": rows})

        entries = rest_request(
            "GET", f"timetable_entries?child_name=eq.{quote(child)}&select=*"
        ) or []

        # 과목명 기준으로 선생님 정보를 붙여줌 (칸마다 반복입력 안 해도 되도록)
        teacher_rows = rest_request(
            "GET", f"timetable_teachers?child_name=eq.{quote(child)}&select=*"
        ) or []
        teacher_by_subject = {t["subject_name"]: t for t in teacher_rows}
        for e in entries:
            t = teacher_by_subject.get(e["subject_name"])
            e["teacher_name"] = t.get("teacher_name") if t else None
            e["teacher_phone"] = t.get("teacher_phone") if t else None

        return self._send(200, {"entries": entries})

    def _post_timetable(self, payload):
        kind = payload.get("type")

        if kind == "period":
            label = payload.get("period_label")
            if not label or not payload.get("start_time") or not payload.get("end_time"):
                return self._send(400, {"error": "교시명, 시작/종료시간은 필수입니다"})
            created = rest_request("POST", "timetable_period_times?on_conflict=child_name,period_label", body={
                "child_name": payload.get("child_name") or "하진",
                "period_label": label,
                "sort_order": int(payload.get("sort_order") or 0),
                "start_time": payload["start_time"],
                "end_time": payload["end_time"],
            }, prefer="return=representation,resolution=merge-duplicates")
            return self._send(201, {"period": created[0] if created else None})

        if kind == "teacher":
            subject_name = payload.get("subject_name")
            if not subject_name:
                return self._send(400, {"error": "subject_name은 필수입니다"})
            rest_request("POST", "timetable_teachers?on_conflict=child_name,subject_name", body={
                "child_name": payload.get("child_name") or "하진",
                "subject_name": subject_name,
                "teacher_name": payload.get("teacher_name"),
                "teacher_phone": payload.get("teacher_phone"),
                "note": payload.get("note"),
            }, prefer="resolution=merge-duplicates")
            return self._send(200, {"ok": True})

        # 기본: 과목 배정(요일/교시별)
        required = ("weekday", "period_label", "subject_name")
        if any(not payload.get(k) for k in required):
            return self._send(400, {"error": f"{', '.join(required)}는 필수입니다"})
        created = rest_request("POST", "timetable_entries?on_conflict=child_name,weekday,period_label", body={
            "child_name": payload.get("child_name") or "하진",
            "weekday": int(payload["weekday"]),
            "period_label": payload["period_label"],
            "subject_name": payload["subject_name"],
            "subject_type": payload.get("subject_type") or "regular",
            "note": payload.get("note"),
        }, prefer="return=representation,resolution=merge-duplicates")
        return self._send(201, {"entry": created[0] if created else None})

    def _patch_timetable(self, item_id, payload):
        kind = payload.get("type")
        if kind == "teacher":
            fields = ("subject_name", "teacher_name", "teacher_phone", "note")
            update_fields = {k: payload[k] for k in fields if k in payload}
            if not update_fields:
                return self._send(400, {"error": "수정할 항목이 없습니다"})
            try:
                rest_request("PATCH", f"timetable_teachers?id=eq.{item_id}", body=update_fields)
            except SupabaseError as e:
                return self._send(409, {"error": f"저장 실패: {e.body}"})
            return self._send(200, {"ok": True})

        if kind == "period":
            fields = ("period_label", "start_time", "end_time", "sort_order")
        else:
            fields = ("weekday", "period_label", "subject_name", "subject_type", "note")
        update_fields = {k: payload[k] for k in fields if k in payload}
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})
        table = "timetable_period_times" if kind == "period" else "timetable_entries"
        rest_request("PATCH", f"{table}?id=eq.{item_id}", body=update_fields)
        return self._send(200, {"ok": True})

    def _delete_timetable(self, qs):
        item_id = qs.get("id", [None])[0]
        if not item_id:
            return self._send(400, {"error": "id는 필수입니다"})
        kind = qs.get("type", [None])[0]
        table = "timetable_period_times" if kind == "period" else ("timetable_teachers" if kind == "teacher" else "timetable_entries")
        rest_request("DELETE", f"{table}?id=eq.{item_id}")
        return self._send(200, {"ok": True})

    def log_message(self, *args):
        pass

    def do_DELETE(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)
            if resource == "personal":
                return self._delete_personal(qs)
            if resource == "family_notes":
                return self._delete_family_notes(qs)
            if resource == "timetable":
                return self._delete_timetable(qs)
            if resource == "personal_media":
                return self._delete_personal_media(qs)
            return self._send(400, {"error": "알 수 없는 resource입니다"})
        except SupabaseError as e:
            return self._send(502, {"error": "supabase_error", "status": e.status, "detail": e.body})
        except Exception as e:
            return self._send(500, {"error": "server_error", "detail": str(e), "trace": traceback.format_exc()})

