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
    remarks_override: dict | None = None,
) -> bytes:
    """
    uploaded_files: {"재무상태표": <파일경로 or BytesIO>, "손익계산서": ..., "기간별손익계산서": ..., "기간별손익계산서(전년동기)": ...}
    없는 키는 건너뛰고 기존 데이터를 그대로 둔다.

    base_date: 결산기준일 — 이 월의 실적을 다루는지(예: 2026-07-31)
    prepared_date: 작성일자 — 실제로 이 보고서를 작성/보고한 날짜(예: 2026-09-05, 기준일자와 다를 수 있음)
    remarks_override: {account_key: note} — 재무상태표(내역) D열(내역/비고)에 덮어쓸 값들
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

    if remarks_override:
        apply_remarks_to_bs_naeyeok(wb, remarks_override)

    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def normalize_key(name) -> str:
    if name is None:
        return ""
    return "".join(str(name).split())


NAEYEOK_ROW_RANGE = (9, 80)  # 재무상태표(내역) 시트에서 계정과목이 있는 행 범위


def extract_bs_naeyeok_remarks(wb_or_path) -> list[dict]:
    """재무상태표(내역) 시트에서 계정과목별 현재 "내역"(D열) 값을 그대로 뽑아옴.
    (매달 새로 생성해도 이 값들은 그대로 유지되므로, 화면 수정 폼을 채우는 용도)"""
    wb = wb_or_path if hasattr(wb_or_path, "sheetnames") else openpyxl.load_workbook(wb_or_path, data_only=True)
    ws = wb['재무상태표(내역)']
    rows = []
    for r in range(NAEYEOK_ROW_RANGE[0], NAEYEOK_ROW_RANGE[1] + 1):
        label = ws.cell(row=r, column=1).value
        if not label or not str(label).strip() or str(label).strip().startswith('='):
            continue
        note = ws.cell(row=r, column=4).value
        rows.append({
            "row": r,
            "account_key": normalize_key(label),
            "account_label": str(label).strip(),
            "note": note if isinstance(note, str) else (str(note) if note is not None else None),
        })
    return rows


def apply_remarks_to_bs_naeyeok(wb, remarks_map: dict) -> None:
    """remarks_map: {account_key(정규화된 계정과목명): note} — 재무상태표(내역) D열에 덮어씀."""
    ws = wb['재무상태표(내역)']
    for r in range(NAEYEOK_ROW_RANGE[0], NAEYEOK_ROW_RANGE[1] + 1):
        label = ws.cell(row=r, column=1).value
        if not label or not str(label).strip() or str(label).strip().startswith('='):
            continue
        key = normalize_key(label)
        if key in remarks_map:
            ws.cell(row=r, column=4).value = remarks_map[key] or None


# 미리보기용 핵심지표 — 라이브러리(LibreOffice) 없이도 바로 계산해서 보여주기 위해
# 백데이터 파일을 직접 읽어서 계정명으로 찾음 (엑셀 수식과 동일한 매칭 방식)
_IS_TARGETS = {
    "매출액": "Ⅰ.매출액",
    "매출원가": "Ⅱ.매출원가",
    "매출총이익": "Ⅲ.매출총이익",
    "판매관리비": "Ⅳ.판매관리비",
    "영업이익": "Ⅴ.영업이익",
    "영업외수익": "Ⅵ.영업외수익",
    "영업외비용": "Ⅶ.영업외비용",
    "법인세차감전순이익": "Ⅷ.법인세비용차감전순이익",
    "당기순이익": "Ⅹ.당기순이익",
}
_BS_TARGETS = {
    "자산총계": "자산총계",
    "부채총계": "부채총계",
    "자본총계": "자본총계",
}


def _to_number(v):
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if s in ("", "-"):
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _first_nonzero(*values):
    nums = [_to_number(v) for v in values]
    for n in nums:
        if n is not None and n != 0:
            return n
    for n in nums:
        if n is not None:
            return n
    return 0


def _scan_raw_sheet_for_targets(file_obj, targets: dict, value_cols=(2, 3)) -> dict:
    """file_obj: 업로드된 원본 파일(재무상태표 또는 손익계산서 형식, A=과목, B/C 또는 지정된 컬럼이 당기 금액).
    targets: {친숙한이름: 정규화된 계정명}"""
    wb = openpyxl.load_workbook(file_obj, data_only=True)
    ws = wb.worksheets[0]
    key_to_friendly = {v: k for k, v in targets.items()}
    result = {}
    for row in ws.iter_rows():
        label = row[0].value if row else None
        if not label:
            continue
        key = normalize_key(label)
        if key in key_to_friendly:
            b = row[value_cols[0] - 1].value if len(row) >= value_cols[0] else None
            c = row[value_cols[1] - 1].value if len(row) >= value_cols[1] else None
            result[key_to_friendly[key]] = _first_nonzero(b, c)
    return result


def compute_preview_summary(uploaded_files: dict) -> dict:
    """업로드된 손익계산서/재무상태표 원본 파일에서 핵심지표를 직접 계산 (재계산 없이 바로 미리보기용)."""
    summary = {}
    if uploaded_files.get("손익계산서"):
        try:
            summary.update(_scan_raw_sheet_for_targets(uploaded_files["손익계산서"], _IS_TARGETS, value_cols=(2, 3)))
        except Exception:
            pass
    if uploaded_files.get("재무상태표"):
        try:
            summary.update(_scan_raw_sheet_for_targets(uploaded_files["재무상태표"], _BS_TARGETS, value_cols=(2, 3)))
        except Exception:
            pass
    return summary
