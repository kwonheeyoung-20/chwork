"""
월결산서 생성기 — 기존에 쓰던 "손익자료분석" 엑셀 구조를 그대로 재사용.

이 파일(monthly_closing_template.xlsx)에는 이미:
- 백데이터 시트 4개: 재무상태표 / 손익계산서 / 기간별손익계산서 / 기간별손익계산서(전년동기)
- 보고서 시트 5개: 인덱스 / 요약 / 재무상태표(내역) / 매출액대비 비율분석 / 전월대비증감
이렇게 구성되어 있고, 보고서 시트들은 백데이터 시트를 INDEX/MATCH 수식으로 참조한다.

매달 할 일은: 백데이터 시트 4개의 "내용"만 새로 업로드된 파일로 교체하고,
각 행마다 있는 매칭용 키 수식(과목명 정제 + 중복순번)을 새 행 개수에 맞게 다시 세팅하는 것.
보고서 시트는 손대지 않으므로 수기로 입력해둔 "내역"(비고) 칸도 그대로 보존된다.
"""
from __future__ import annotations
from io import BytesIO
import datetime
import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string

# 백데이터 시트별 설정: 어느 열까지가 실제 값이고, 이름/키 수식이 어느 열에 들어가는지, 몇 행부터 시작하는지
RAW_SHEET_CONFIG = {
    '재무상태표': {'data_start_col': 'A', 'data_end_col': 'E', 'name_col': 'F', 'key_col': 'G', 'start_row': 3},
    '손익계산서': {'data_start_col': 'A', 'data_end_col': 'E', 'name_col': 'F', 'key_col': 'G', 'start_row': 3},
    '기간별손익계산서': {'data_start_col': 'A', 'data_end_col': 'N', 'name_col': 'P', 'key_col': 'Q', 'start_row': 2},
    '기간별손익계산서(전년동기)': {'data_start_col': 'A', 'data_end_col': 'N', 'name_col': 'O', 'key_col': 'P', 'start_row': 2},
}


def _clear_and_fill(dst_ws, cfg, src_ws):
    start_row = cfg['start_row']
    start_col = column_index_from_string(cfg['data_start_col'])
    end_col = column_index_from_string(cfg['data_end_col'])
    name_col = column_index_from_string(cfg['name_col'])
    key_col = column_index_from_string(cfg['key_col'])
    name_letter = cfg['name_col']
    a_letter = cfg['data_start_col']

    # 1) 기존 데이터/이름/키 영역 클리어 (넉넉하게 300행까지)
    clear_until = max(dst_ws.max_row, 300)
    for r in range(start_row, clear_until + 1):
        for c in range(start_col, end_col + 1):
            dst_ws.cell(row=r, column=c).value = None
        dst_ws.cell(row=r, column=name_col).value = None
        dst_ws.cell(row=r, column=key_col).value = None

    # 2) 새 파일의 값을 그대로 복사 + 이름/키 수식 재생성
    src_max_row = src_ws.max_row
    out_row = start_row
    for r in range(start_row, src_max_row + 1):
        row_has_value = any(
            src_ws.cell(row=r, column=c).value not in (None, '')
            for c in range(start_col, end_col + 1)
        )
        if not row_has_value:
            # 원본에서도 완전 빈 행은 건너뛰지 않고 그대로 유지(행 정렬 보존을 위해 값만 비움)
            out_row += 1
            continue
        for c in range(start_col, end_col + 1):
            dst_ws.cell(row=out_row, column=c).value = src_ws.cell(row=r, column=c).value
        dst_ws.cell(row=out_row, column=name_col).value = (
            f'=IF({a_letter}{out_row}="","",SUBSTITUTE({a_letter}{out_row}," ",""))'
        )
        dst_ws.cell(row=out_row, column=key_col).value = (
            f'=IF({a_letter}{out_row}="","",{name_letter}{out_row}&"|"&COUNTIF(${name_letter}${start_row}:{name_letter}{out_row},{name_letter}{out_row}))'
        )
        out_row += 1


def build_monthly_closing(
    template_path: str,
    uploaded_files: dict,
    base_date: datetime.date,
    prepared_date: datetime.date | None = None,
) -> bytes:
    """
    uploaded_files: {"재무상태표": <파일경로 or BytesIO>, "손익계산서": ..., "기간별손익계산서": ..., "기간별손익계산서(전년동기)": ...}
    없는 키는 건너뛰고 기존 데이터를 그대로 둔다.

    base_date: 결산기준일 — 이 월의 실적을 다루는지(예: 2026-07-31)
    prepared_date: 작성일자 — 실제로 이 보고서를 작성/보고한 날짜(예: 2026-09-05, 기준일자와 다를 수 있음)
    """
    wb = openpyxl.load_workbook(template_path)

    for sheet_name, cfg in RAW_SHEET_CONFIG.items():
        if sheet_name not in uploaded_files or uploaded_files[sheet_name] is None:
            continue
        src_wb = openpyxl.load_workbook(uploaded_files[sheet_name], data_only=True)
        src_ws = src_wb.worksheets[0]
        dst_ws = wb[sheet_name]
        _clear_and_fill(dst_ws, cfg, src_ws)

    # 기준일 갱신 — 이 값 하나로 인덱스/요약/재무상태표(내역)/매출액대비 비율분석/전월대비증감의
    # 모든 기간 문구가 자동으로 바뀜
    wb['인덱스']['K1'] = base_date
    # 작성일자 — 실제 보고서를 작성/보고한 날짜(기준일자와 다를 수 있음). 안 주면 오늘 날짜로.
    wb['인덱스']['K2'] = prepared_date or datetime.date.today()

    out = BytesIO()
    wb.save(out)
    return out.getvalue()
