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
import calendar
import traceback
import datetime
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs, quote


def kst_today():
    """서버(Vercel)는 UTC 기준으로 동작하는데, 한국은 UTC+9시간이라
    kst_today()를 그냥 쓰면 한국시간 새벽 0시~오전 9시 사이에
    "오늘"이 하루 전날짜로 잘못 계산되는 문제가 있었음(D-day 알림 등에 영향).
    항상 한국시간 기준 오늘 날짜를 반환하도록 보정."""
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()


# ── 음력 변환 (korean_lunar_calendar 0.4.0, MIT License, usingsky@gmail.com) ──
# 외부 pip 설치에 의존하지 않도록 라이브러리 전체를 직접 포함시켰습니다.
# -*- coding: utf-8 -*-

"""
KoreanLunarCalendar
Here is a library to convert Korean lunar-calendar to Gregorian calendar.
Korean calendar and Chinese calendar is same lunar calendar but have different date.
This follow the KARI(Korea Astronomy and Space Science Institute)
@author : usingsky@gmail.com
"""

import datetime
import numbers
class KoreanLunarCalendar(object) :
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

# 가족용 비밀번호는 "개인 일정관리(personal)"와 "학교 시간표(timetable)"만 열 수 있음
FAMILY_ALLOWED_RESOURCES = {"personal", "timetable"}
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
def _calc_tenure(start, end):
    if not start or not end or end < start:
        return (0, 0, 0)
    years = end.year - start.year
    months = end.month - start.month
    days = end.day - start.day
    if days < 0:
        months -= 1
        prev_month = end.month - 1
        prev_year = end.year
        if prev_month == 0:
            prev_month = 12
            prev_year -= 1
        days += calendar.monthrange(prev_year, prev_month)[1]
    if months < 0:
        years -= 1
        months += 12
    return (years, months, days)


def _format_tenure(t):
    if t is None:
        return None
    return f"{t[0]}년{t[1]}월{t[2]}일"


# ════════════════════════════════════════════════════════════
# 메인 핸들러
# ════════════════════════════════════════════════════════════
class handler(BaseHTTPRequestHandler):
    def _authorized(self, qs=None):
        """role을 확인하고, family 계정이면 personal/timetable 외 접근을 차단"""
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

    # ────────────────────────────────────────────────────────
    # GET
    # ────────────────────────────────────────────────────────
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)

            if resource == "schedule":
                return self._get_schedule(qs)
            if resource == "contacts":
                return self._get_contacts(qs)
            if resource == "contractdocs":
                return self._get_contractdocs(qs)
            if resource == "todos":
                return self._get_todos(qs)
            if resource == "promotions":
                return self._get_promotions(qs)
            if resource == "annualleave":
                return self._get_annualleave(qs)
            if resource == "personal":
                return self._get_personal(qs)
            if resource == "timetable":
                return self._get_timetable(qs)
            if resource == "manuals":
                return self._get_manuals(qs)
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
            today = kst_today()
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

        today = kst_today()
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
            today = kst_today()
            rows = rest_request(
                "GET",
                "contract_documents?alert_dismissed=eq.false&contract_end_date=not.is.null"
                "&terminated_date=is.null&doc_group=neq.reference&select=*&order=contract_end_date.asc",
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

        rows = rest_request(
            "GET", "contract_documents?select=*,contract_document_files(*)&order=contract_end_date.asc.nullslast"
        ) or []
        for r in rows:
            files = r.get("contract_document_files") or []
            for f in files:
                f["view_url"] = storage_sign_url(f.get("storage_path"))
            r["files"] = files
        return self._send(200, {"documents": rows})

    def _get_todos(self, qs):
        date_str = qs.get("date", [None])[0] or kst_today().isoformat()
        rows = rest_request(
            "GET", f"daily_todos?todo_date=eq.{date_str}&select=*&order=created_at.asc"
        )
        return self._send(200, {"todos": rows, "date": date_str})

    def _get_annualleave(self, qs):
        """연차수당 자동계산용 — 기준일 시점 (기본급+식대)/209 통상시급을 직원별로 계산.
        기본급/식대는 매달 확정 저장되는 monthly_payroll의 실제 값을 그대로 씁니다
        (설정 테이블이 아니라, 그 달 실제로 지급 확정된 급여명세 기준).
        기준일 이전 중 가장 최근에 '생성/저장'된 달의 급여명세를 사용합니다.
        단, 그 달이 육아기근로시간단축 등으로 기본급/식대가 일시적으로 줄어든 달이면
        (base_pay_before/meal_allowance_before가 저장되어 있으면) 그 "조정 전 정상 금액"을
        우선 사용합니다 — 연차수당은 정상 통상임금 기준이어야 하므로.
        연차수당 = 잔여일수 × 통상시급 × 8시간, 백원단위 올림은 화면(hr.js)에서 처리."""
        as_of_str = qs.get("asof", [None])[0] or kst_today().isoformat()
        include_all = qs.get("all", ["0"])[0] == "1"

        emp_path = "employees?select=id,name,branch,department&order=hire_date.asc"
        if not include_all:
            emp_path += f"&status=eq.{quote('재직')}"
        employees = rest_request("GET", emp_path) or []

        payroll_rows = rest_request(
            "GET",
            f"monthly_payroll?year_month=lte.{as_of_str}"
            "&select=employee_id,year_month,base_pay,meal_allowance,base_pay_before,meal_allowance_before"
            "&order=employee_id.asc,year_month.desc",
        ) or []
        latest_payroll = {}
        for r in payroll_rows:
            eid = r["employee_id"]
            if eid not in latest_payroll:
                latest_payroll[eid] = r

        result = []
        for e in employees:
            pr = latest_payroll.get(e["id"])
            if not pr or pr.get("base_pay") is None:
                continue
            # base_pay_before는 조정 없을 때도 base_pay와 같은 값으로 채워져 있을 수 있어서,
            # "값이 있냐"가 아니라 "조정 전후 값이 실제로 다르냐"로 판단해야 정확함
            was_adjusted = (
                pr.get("base_pay_before") is not None
                and pr["base_pay_before"] != pr["base_pay"]
            )
            base_pay_monthly = pr["base_pay_before"] if was_adjusted else pr["base_pay"]
            meal = (pr.get("meal_allowance_before") if was_adjusted else pr.get("meal_allowance")) or 0
            hourly_wage = (base_pay_monthly + meal) / 209
            daily_wage = hourly_wage * 8
            result.append({
                "employee_id": e["id"],
                "name": e["name"],
                "branch": e.get("branch"),
                "department": e.get("department"),
                "base_pay_monthly": round(base_pay_monthly),
                "meal_allowance": meal,
                "source_month": pr.get("year_month"),
                "adjusted_month": was_adjusted,
                "hourly_wage": round(hourly_wage, 2),
                "daily_wage": round(daily_wage, 2),
            })
        return self._send(200, {"employees": result, "as_of": as_of_str})

    def _compute_promotion_snapshot(self, as_of, prior_year_end, include_all=False):
        emp_path = "employees?select=id,name,branch,department,position,hire_date,status&order=hire_date.asc"
        if not include_all:
            emp_path += f"&status=eq.{quote('재직')}"
        employees = rest_request("GET", emp_path) or []

        hist_rows = rest_request("GET", "position_history?select=*&order=effective_date.asc") or []
        hist_by_emp = {}
        for h in hist_rows:
            hist_by_emp.setdefault(h["employee_id"], []).append(h)

        result = []
        for e in employees:
            hire = datetime.date.fromisoformat(e["hire_date"]) if e.get("hire_date") else None
            hist = [
                h for h in hist_by_emp.get(e["id"], [])
                if datetime.date.fromisoformat(h["effective_date"]) <= as_of
            ]
            last = hist[-1] if hist else None
            tenure_now = _calc_tenure(hire, as_of) if hire else None
            tenure_prior = _calc_tenure(hire, prior_year_end) if hire and hire <= prior_year_end else None
            result.append({
                "employee_id": e["id"],
                "name": e["name"],
                "branch": e.get("branch"),
                "department": e.get("department"),
                "position": e.get("position"),
                "status": e.get("status"),
                "hire_date": e.get("hire_date"),
                "last_promotion_date": last["effective_date"] if last else None,
                "last_promotion_position": last["position"] if last else None,
                "history": [{"date": h["effective_date"], "position": h["position"]} for h in hist],
                "tenure_current": _format_tenure(tenure_now),
                "tenure_prior_year_end": _format_tenure(tenure_prior),
            })
        return result

    def _get_promotions(self, qs):
        if qs.get("standards", ["0"])[0] == "1":
            rows = rest_request("GET", "position_pay_standards?select=*&order=attendance_allowance.desc")
            return self._send(200, {"standards": rows})

        if qs.get("reports", ["0"])[0] == "1":
            rows = rest_request(
                "GET",
                "promotion_reports?select=id,report_year,as_of_date,prior_year_end_date,note,generated_at"
                "&order=report_year.desc,generated_at.desc",
            )
            return self._send(200, {"reports": rows})

        report_id = qs.get("report_id", [None])[0]
        if report_id:
            rows = rest_request("GET", f"promotion_reports?id=eq.{report_id}&select=*")
            if not rows:
                return self._send(404, {"error": "not_found"})
            return self._send(200, {"report": rows[0]})

        if qs.get("history", ["0"])[0] == "1":
            emp_id = qs.get("employee_id", [None])[0]
            if not emp_id:
                return self._send(400, {"error": "employee_id는 필수입니다"})
            rows = rest_request(
                "GET", f"position_history?employee_id=eq.{emp_id}&select=*&order=effective_date.asc"
            )
            return self._send(200, {"history": rows})

        # 미리보기(라이브 계산, 저장 안 됨)
        as_of_str = qs.get("asof", [None])[0] or kst_today().isoformat()
        as_of = datetime.date.fromisoformat(as_of_str)
        prior_year_end = datetime.date(as_of.year - 1, 12, 31)
        include_all = qs.get("all", ["0"])[0] == "1"

        employees = self._compute_promotion_snapshot(as_of, prior_year_end, include_all)
        return self._send(200, {
            "employees": employees,
            "as_of": as_of.isoformat(),
            "prior_year_end": prior_year_end.isoformat(),
        })

    # ────────────────────────────────────────────────────────
    # POST
    # ────────────────────────────────────────────────────────
    def do_POST(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
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
            if resource == "promotions":
                return self._post_promotions(payload)
            if resource == "personal":
                return self._post_personal(payload)
            if resource == "timetable":
                return self._post_timetable(payload)
            if resource == "manuals":
                if self._role() == "family":
                    return self._send(403, {"error": "가족 계정은 접근할 수 없습니다"})
                return self._post_manuals(payload)
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
            terminated_date = payload.get("terminated_date") or kst_today().isoformat()
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

        files_payload = payload.get("files") or []
        if not files_payload and payload.get("file_base64") and payload.get("file_name"):
            # 하위호환: 예전 방식(파일 1개)으로 온 요청도 지원
            files_payload = [{
                "file_base64": payload["file_base64"],
                "file_name": payload["file_name"],
                "content_type": payload.get("content_type"),
            }]
        if not files_payload:
            return self._send(400, {"error": "최소 1개의 파일이 필요합니다"})

        uploaded = []
        for f in files_payload:
            fb64 = f.get("file_base64")
            fname = f.get("file_name")
            if not fb64 or not fname:
                continue
            try:
                fbytes = base64.b64decode(fb64)
            except Exception:
                return self._send(400, {"error": f"'{fname}' 파일 데이터를 해독할 수 없습니다"})
            if len(fbytes) > 8 * 1024 * 1024:
                return self._send(413, {"error": f"'{fname}' 파일이 너무 큽니다 (8MB 이하로 올려주세요)"})
            spath = safe_filename(fname)
            storage_upload(spath, fbytes, f.get("content_type"))
            uploaded.append({
                "file_name": fname, "storage_path": spath,
                "file_size": len(fbytes), "content_type": f.get("content_type"),
            })

        body = {
            "doc_group": payload.get("doc_group") or "contract",
            "doc_type": payload.get("doc_type"),
            "vendor_name": payload.get("vendor_name"),
            "contract_title": payload.get("contract_title"),
            "contract_start_date": payload.get("contract_start_date") or None,
            "contract_end_date": payload.get("contract_end_date") or None,
            "reminder_days_before": int(payload.get("reminder_days_before") or 14),
            "auto_renew": bool(payload.get("auto_renew", False)),
            "account_number": payload.get("account_number"),
            "investment_amount": payload.get("investment_amount"),
            "return_rate": payload.get("return_rate"),
            "note": payload.get("note"),
        }
        created = rest_request("POST", "contract_documents", body=body, prefer="return=representation")
        doc_id = created[0]["id"] if created else None
        if doc_id:
            for uf in uploaded:
                rest_request("POST", "contract_document_files", body={
                    "document_id": doc_id,
                    "file_name": uf["file_name"],
                    "storage_path": uf["storage_path"],
                    "file_size": uf["file_size"],
                    "content_type": uf["content_type"],
                })
        return self._send(201, {"ok": True, "id": doc_id})

    def _post_todos(self, payload):
        content = payload.get("content")
        todo_date = payload.get("todo_date") or kst_today().isoformat()
        if not content:
            return self._send(400, {"error": "content는 필수입니다"})

        created = rest_request("POST", "daily_todos", body={
            "todo_date": todo_date,
            "content": content,
            "done": False,
            "category": payload.get("category") or "work",
        }, prefer="return=representation")
        return self._send(201, {"todo": created[0] if created else None})

    def _post_promotions(self, payload):
        action = payload.get("type")

        if action == "apply_standard":
            return self._post_apply_standard(payload)

        if action == "save_standard":
            position = payload.get("position")
            if not position:
                return self._send(400, {"error": "position은 필수입니다"})
            body = {
                "position": position,
                "attendance_allowance": payload.get("attendance_allowance") or 0,
                "fixed_overtime_hours": payload.get("fixed_overtime_hours") or 0,
                "meal_allowance": payload.get("meal_allowance") or 0,
                "note": payload.get("note"),
                "updated_at": datetime.datetime.utcnow().isoformat(),
            }
            rest_request(
                "POST", "position_pay_standards?on_conflict=position", body=body, prefer="resolution=merge-duplicates"
            )
            return self._send(200, {"ok": True})

        if action == "save_report":
            report_year = payload.get("report_year")
            if not report_year:
                return self._send(400, {"error": "report_year은 필수입니다"})
            as_of_str = payload.get("as_of") or f"{report_year}-01-30"
            as_of = datetime.date.fromisoformat(as_of_str)
            prior_year_end = datetime.date(as_of.year - 1, 12, 31)
            include_all = bool(payload.get("include_all", False))

            snapshot = self._compute_promotion_snapshot(as_of, prior_year_end, include_all)

            created = rest_request("POST", "promotion_reports", body={
                "report_year": int(report_year),
                "as_of_date": as_of.isoformat(),
                "prior_year_end_date": prior_year_end.isoformat(),
                "snapshot": snapshot,
                "note": payload.get("note"),
            }, prefer="return=representation")
            return self._send(201, {"report": created[0] if created else None})

        # 기본: 직급이력(승진기록) 추가
        # 기본: 직급이력(승진기록) 추가 — 이건 "직급이 바뀐 사실"만 기록합니다.
        # 실제 급여(만근수당 등) 반영은 자동으로 하지 않고, 아래 "apply_standard"를
        # 별도로 호출해야 반영됩니다. 승진일과 급여 반영일이 다른 경우(예: 직급은
        # 즉시 바뀌지만 급여는 다음 연봉재계약 시점에 반영)를 구분하기 위함입니다.
        employee_id = payload.get("employee_id")
        effective_date = payload.get("effective_date")
        position = payload.get("position")
        if not employee_id or not effective_date or not position:
            return self._send(400, {"error": "employee_id, effective_date, position은 필수입니다"})
        created = rest_request("POST", "position_history", body={
            "employee_id": employee_id,
            "effective_date": effective_date,
            "position": position,
            "note": payload.get("note"),
        }, prefer="return=representation")
        return self._send(201, {"history": created[0] if created else None})

    def _post_apply_standard(self, payload):
        """급여기준 반영 — 직급이력과 별개로, 실제 급여(만근수당 등)를
        반영할 시점을 직접 지정해서 payroll_settings_history에 적용."""
        employee_id = payload.get("employee_id")
        effective_month = payload.get("effective_month")
        position = payload.get("position")
        if not employee_id or not effective_month or not position:
            return self._send(400, {"error": "employee_id, effective_month, position은 필수입니다"})

        standard_rows = rest_request(
            "GET", f"position_pay_standards?position=eq.{quote(position)}&select=*"
        )
        if not standard_rows:
            return self._send(404, {"error": f"급여기준표에 '{position}' 직급이 없습니다. 먼저 급여기준표에 추가해주세요."})
        standard = standard_rows[0]

        prev_rows = rest_request(
            "GET",
            f"payroll_settings_history?employee_id=eq.{employee_id}&select=*"
            f"&order=effective_month.desc&limit=1",
        )
        prev = prev_rows[0] if prev_rows else {}

        rest_request("POST", "payroll_settings_history", body={
            "employee_id": employee_id,
            "effective_month": effective_month,
            "standard_hours": prev.get("standard_hours", 209),
            "fixed_overtime_hours": standard["fixed_overtime_hours"],
            "attendance_allowance": standard["attendance_allowance"],
            "meal_allowance": standard["meal_allowance"],
            "employment_type": prev.get("employment_type", "정규직"),
            "pay_rate": prev.get("pay_rate", 1.0),
            "contract_end_date": prev.get("contract_end_date"),
            "note": payload.get("note") or f"급여기준 반영({position}) — 직급기준표 적용",
        })
        # 이 시점부터는 이 직급이 "급여직급"이 되므로 직원마스터에도 반영
        rest_request("PATCH", f"employees?id=eq.{employee_id}", body={"pay_position": position})
        return self._send(201, {"ok": True})

    # ────────────────────────────────────────────────────────
    # PATCH
    # ────────────────────────────────────────────────────────
    def do_PATCH(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
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
            if resource == "promotions":
                return self._patch_promotions(item_id, payload)
            if resource == "personal":
                return self._patch_personal(item_id, payload)
            if resource == "timetable":
                return self._patch_timetable(item_id, payload)
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

        today = kst_today().isoformat()
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
        for key in ("doc_group", "doc_type", "vendor_name", "contract_title", "contract_start_date",
                    "contract_end_date", "reminder_days_before", "note", "alert_dismissed", "auto_renew",
                    "account_number", "investment_amount", "return_rate"):
            if key in payload:
                update_fields[key] = payload[key]

        new_files = payload.get("new_files") or []
        if not update_fields and not new_files:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        if update_fields:
            update_fields["updated_at"] = datetime.datetime.utcnow().isoformat()
            rest_request("PATCH", f"contract_documents?id=eq.{doc_id}", body=update_fields)

        for f in new_files:
            fb64 = f.get("file_base64")
            fname = f.get("file_name")
            if not fb64 or not fname:
                continue
            try:
                fbytes = base64.b64decode(fb64)
            except Exception:
                return self._send(400, {"error": f"'{fname}' 파일 데이터를 해독할 수 없습니다"})
            if len(fbytes) > 8 * 1024 * 1024:
                return self._send(413, {"error": f"'{fname}' 파일이 너무 큽니다 (8MB 이하로 올려주세요)"})
            spath = safe_filename(fname)
            storage_upload(spath, fbytes, f.get("content_type"))
            rest_request("POST", "contract_document_files", body={
                "document_id": doc_id,
                "file_name": fname,
                "storage_path": spath,
                "file_size": len(fbytes),
                "content_type": f.get("content_type"),
            })

        return self._send(200, {"ok": True})

    def _patch_todos(self, todo_id, payload):
        update_fields = {}
        for key in ("content", "done", "category"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})

        rest_request("PATCH", f"daily_todos?id=eq.{todo_id}", body=update_fields)
        return self._send(200, {"ok": True})

    def _patch_promotions(self, item_id, payload):
        update_fields = {}
        for key in ("effective_date", "position", "note"):
            if key in payload:
                update_fields[key] = payload[key]
        if not update_fields:
            return self._send(400, {"error": "수정할 항목이 없습니다"})
        rest_request("PATCH", f"position_history?id=eq.{item_id}", body=update_fields)
        return self._send(200, {"ok": True})

    # ────────────────────────────────────────────────────────
    # DELETE
    # ────────────────────────────────────────────────────────
    def do_DELETE(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            if not self._authorized(qs):
                return self._send(401, {"error": "unauthorized"})
            resource = self._resource(qs)

            if resource == "schedule":
                return self._delete_schedule(qs)
            if resource == "contacts":
                return self._delete_contacts(qs)
            if resource == "contractdocs":
                return self._delete_contractdocs(qs)
            if resource == "todos":
                return self._delete_todos(qs)
            if resource == "promotions":
                return self._delete_promotions(qs)
            if resource == "personal":
                return self._delete_personal(qs)
            if resource == "timetable":
                return self._delete_timetable(qs)
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
        file_id = qs.get("file_id", [None])[0]
        if file_id:
            existing = rest_request("GET", f"contract_document_files?id=eq.{file_id}&select=storage_path")
            if existing and existing[0].get("storage_path"):
                storage_delete(existing[0]["storage_path"])
            rest_request("DELETE", f"contract_document_files?id=eq.{file_id}")
            return self._send(200, {"ok": True})

        doc_id = qs.get("id", [None])[0]
        if not doc_id:
            return self._send(400, {"error": "id는 필수입니다"})
        files = rest_request("GET", f"contract_document_files?document_id=eq.{doc_id}&select=storage_path") or []
        for f in files:
            if f.get("storage_path"):
                storage_delete(f["storage_path"])
        rest_request("DELETE", f"contract_documents?id=eq.{doc_id}")
        return self._send(200, {"ok": True})

    def _delete_todos(self, qs):
        todo_id = qs.get("id", [None])[0]
        if not todo_id:
            return self._send(400, {"error": "id는 필수입니다"})
        rest_request("DELETE", f"daily_todos?id=eq.{todo_id}")
        return self._send(200, {"ok": True})

    def _delete_promotions(self, qs):
        item_id = qs.get("id", [None])[0]
        if not item_id:
            return self._send(400, {"error": "id는 필수입니다"})
        item_type = qs.get("type", [None])[0]
        if item_type == "report":
            rest_request("DELETE", f"promotion_reports?id=eq.{item_id}")
        elif item_type == "standard":
            rest_request("DELETE", f"position_pay_standards?id=eq.{item_id}")
        else:
            rest_request("DELETE", f"position_history?id=eq.{item_id}")
        return self._send(200, {"ok": True})

    # ────────────────────────────────────────────────────────
    # personal (개인 스케줄 - 가족 일정)
    # ────────────────────────────────────────────────────────
    def _generate_lunar_occurrences(self):
        """date_type='lunar'인 매년 반복 일정을, 매년 실제 양력 날짜로 환산해서 발생일자를 채워넣음."""
        tasks = rest_request(
            "GET", "personal_schedule_tasks?date_type=eq.lunar&active=eq.true&select=*"
        ) or []
        if not tasks:
            return
        today = kst_today()
        horizon_year = (today + datetime.timedelta(days=400)).year
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
                rest_request(
                    "POST", "personal_schedule_occurrences?on_conflict=task_id,due_date",
                    body={"task_id": t["id"], "due_date": solar_date},
                    prefer="resolution=merge-duplicates",
                )

    def _get_personal(self, qs):
        role = self._role()
        if qs.get("members", ["0"])[0] == "1":
            rows = rest_request("GET", "personal_schedule_members?select=*&order=sort_order.asc")
            return self._send(200, {"members": rows})

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
            + "&select=*,personal_schedule_tasks(title,category,member_name,recurrence_type,note,date_type,is_private)&order=due_date.asc"
        )
        if status_filter and status_filter != "all":
            path += "&status=eq." + status_filter
        rows = rest_request("GET", path) or []
        if role == "family":
            rows = [r for r in rows if not (r.get("personal_schedule_tasks") or {}).get("is_private")]
        if member_filter:
            rows = [r for r in rows if (r.get("personal_schedule_tasks") or {}).get("member_name") == member_filter]
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
            if role == "family" and self._occurrence_is_mine(occ_id):
                return self._send(403, {"error": "이 일정은 가족 계정으로 처리할 수 없습니다"})
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
            if role == "family" and self._occurrence_is_mine(occ_id):
                return self._send(403, {"error": "이 일정은 가족 계정으로 처리할 수 없습니다"})
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
        }
        created = rest_request("POST", "personal_schedule_tasks", body=body, prefer="return=representation")
        rpc("generate_personal_schedule_occurrences", {})
        self._generate_lunar_occurrences()
        return self._send(201, {"task": created[0] if created else None})

    def _task_member_name(self, task_id):
        rows = rest_request("GET", f"personal_schedule_tasks?id=eq.{task_id}&select=member_name")
        return rows[0]["member_name"] if rows else None

    def _occurrence_is_mine(self, occ_id):
        rows = rest_request(
            "GET",
            f"personal_schedule_occurrences?id=eq.{occ_id}&select=personal_schedule_tasks(member_name)",
        )
        if not rows:
            return False
        task = rows[0].get("personal_schedule_tasks") or {}
        return task.get("member_name") == "나"

    def _patch_personal(self, task_id, payload):
        if self._role() == "family" and self._task_member_name(task_id) == "나":
            return self._send(403, {"error": "이 일정은 가족 계정으로 수정할 수 없습니다"})

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
            if role == "family" and self._task_member_name(task_id) == "나":
                return self._send(403, {"error": "이 일정은 가족 계정으로 삭제할 수 없습니다"})
            rest_request("DELETE", f"personal_schedule_tasks?id=eq.{task_id}")
            return self._send(200, {"ok": True})
        if occ_id:
            if role == "family" and self._occurrence_is_mine(occ_id):
                return self._send(403, {"error": "이 일정은 가족 계정으로 삭제할 수 없습니다"})
            rest_request("DELETE", f"personal_schedule_occurrences?id=eq.{occ_id}")
            return self._send(200, {"ok": True})
        return self._send(400, {"error": "id, occurrence_id 또는 member_id가 필요합니다"})

    # ────────────────────────────────────────────────────────
    # timetable (학교 시간표)
    # ────────────────────────────────────────────────────────
    # ────────────────────────────────────────────────────────
    # 급여/퇴직급여 업무 매뉴얼
    # ────────────────────────────────────────────────────────
    def _get_manuals(self, qs):
        module = qs.get("module", [None])[0]
        if module:
            if module not in ("payroll", "pension"):
                return self._send(400, {"error": "module은 payroll 또는 pension이어야 합니다"})
            rows = rest_request("GET", f"module_manuals?module=eq.{module}&select=*")
            return self._send(200, {"manual": rows[0] if rows else None})
        rows = rest_request("GET", "module_manuals?select=*&order=module.asc")
        return self._send(200, {"manuals": rows})

    def _post_manuals(self, payload):
        module = payload.get("module")
        content = payload.get("content")
        if module not in ("payroll", "pension"):
            return self._send(400, {"error": "module은 payroll 또는 pension이어야 합니다"})
        if content is None:
            return self._send(400, {"error": "content는 필수입니다"})
        rest_request("PATCH", f"module_manuals?module=eq.{module}", body={
            "content": content,
            "updated_at": datetime.datetime.utcnow().isoformat(),
        })
        return self._send(200, {"ok": True})

    def _get_timetable(self, qs):
        child = qs.get("child", ["하진"])[0]

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
            fields = ("teacher_name", "teacher_phone", "note")
            update_fields = {k: payload[k] for k in fields if k in payload}
            if not update_fields:
                return self._send(400, {"error": "수정할 항목이 없습니다"})
            rest_request("PATCH", f"timetable_teachers?id=eq.{item_id}", body=update_fields)
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
