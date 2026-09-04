/* ───────── hr.js ───────── */

const $ = id => document.getElementById(id);
const fmt = n => (n == null || isNaN(n)) ? '-' : Math.round(n).toLocaleString('ko-KR');

function apiBase() { return window.location.origin; }
function hrPassword() { return sessionStorage.getItem('chwork_hr_pw') || ''; }

/* ── 로그인 ── */
/* ── 전체 데이터 백업 ── */
function refreshLastBackupLabel() {
  const saved = localStorage.getItem('chwork_last_backup');
  const label = $('lastBackupLabel');
  if (label) label.textContent = saved ? `마지막 백업: ${saved}` : '아직 백업한 적 없음';
}

function openDataBackupModal() {
  if (sessionStorage.getItem('chwork_hr_role') !== 'admin') return;
  refreshLastBackupLabel();
  $('dataBackupModal').style.display = 'flex';
}

function closeDataBackupModal() {
  $('dataBackupModal').style.display = 'none';
}

async function downloadFullBackup() {
  const btn = $('backupBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '백업 생성 중…';
  try {
    const res = await fetch(`${apiBase()}/api/hr_backup`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) {
      let detail = `상태코드 ${res.status}`;
      try {
        const data = await res.json();
        detail = data.error ? `${data.error}${data.detail ? ' — ' + data.detail : ''}` : detail;
      } catch (parseErr) {
        detail += ' (서버가 JSON이 아닌 응답을 반환함 — 시간초과일 가능성)';
      }
      throw new Error(detail);
    }
    const blob = await res.blob();
    let backupInfo = null;
    try {
      backupInfo = JSON.parse(await blob.text());
    } catch (parseErr) {
      throw new Error('백업 파일 검증 실패 — 내려받은 자료가 올바른 JSON 형식이 아닙니다.');
    }
    if (!backupInfo || !backupInfo.tables || !backupInfo.summary) {
      throw new Error('백업 파일 검증 실패 — 전체 데이터 백업 요약정보가 없습니다.');
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `chwork_backup_${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const summary = backupInfo.summary;
    const warningCount = Number(summary.warning_table_count || 0);
    const statusText = summary.complete
      ? `완료 ${summary.successful_table_count}개 테이블, 총 ${Number(summary.total_row_count || 0).toLocaleString('ko-KR')}건${warningCount ? `, 선택항목 경고 ${warningCount}개` : ''}`
      : `일부 오류 ${summary.failed_table_count}개 테이블`;
    localStorage.setItem('chwork_last_backup', `${stamp} · ${statusText}`);
    refreshLastBackupLabel();

    if (summary.complete) {
      alert(`전체 데이터 백업이 완료되었습니다.\n\n정상 테이블: ${summary.successful_table_count}개\n데이터: 총 ${Number(summary.total_row_count || 0).toLocaleString('ko-KR')}건${warningCount ? `\n선택항목 경고: ${warningCount}개` : ''}\n\n※ Storage의 실제 첨부파일은 별도로 백업해야 합니다.`);
    } else {
      const failedNames = Object.keys(backupInfo._errors || {}).join(', ') || '확인 불가';
      alert(`백업 파일은 내려받았지만 일부 테이블을 읽지 못했습니다.\n\n실패: ${summary.failed_table_count}개\n대상: ${failedNames}\n\n이 파일만으로는 완전한 백업이 아니므로 오류를 확인해주세요.`);
    }
  } catch (e) {
    alert('백업 다운로드 중 오류가 발생했습니다: ' + (e.message || ''));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ── contracts Storage 실제 첨부파일 ZIP 백업 ── */
function storageBackupCrc32(bytes) {
  if (!storageBackupCrc32.table) {
    storageBackupCrc32.table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = storageBackupCrc32.table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storageBackupDosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function storageBackupZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = storageBackupDosTime(new Date());
  const u16 = (view, pos, value) => view.setUint16(pos, value, true);
  const u32 = (view, pos, value) => view.setUint32(pos, value >>> 0, true);

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const crc = storageBackupCrc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0);
    u16(lv, 10, now.time); u16(lv, 12, now.date); u32(lv, 14, crc);
    u32(lv, 18, data.length); u32(lv, 22, data.length); u16(lv, 26, name.length); u16(lv, 28, 0);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0);
    u16(cv, 12, now.time); u16(cv, 14, now.date); u32(cv, 16, crc);
    u32(cv, 20, data.length); u32(cv, 24, data.length); u16(cv, 28, name.length);
    u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0);
  u16(ev, 8, entries.length); u16(ev, 10, entries.length); u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

async function downloadStorageBackup() {
  const btn = $('storageBackupBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '첨부파일 확인 중…';
  try {
    const res = await fetch(`${apiBase()}/api/hr_storage_backup`, {
      headers: { 'X-HR-Password': hrPassword() },
      cache: 'no-store',
    });
    const responseText = await res.text();
    let info;
    try {
      info = JSON.parse(responseText);
    } catch (parseErr) {
      throw new Error(`백업 API 응답 오류 (상태코드 ${res.status}). Vercel 배포에서 hr_storage_backup API 등록 여부를 확인해주세요.`);
    }
    if (!res.ok) throw new Error(info.detail || info.error || `상태코드 ${res.status}`);
    if (!Array.isArray(info.files) || !info.files.length) throw new Error('contracts 버킷에 백업할 파일이 없습니다.');
    if ((info.missing_storage_paths || []).length) {
      throw new Error(`DB 기록 중 Storage에서 찾지 못한 파일이 ${info.missing_storage_paths.length}개 있습니다.`);
    }

    const entries = [];
    for (let i = 0; i < info.files.length; i++) {
      const file = info.files[i];
      btn.textContent = `첨부파일 받는 중 ${i + 1}/${info.files.length}`;
      const fileRes = await fetch(file.signed_url, { cache: 'no-store' });
      if (!fileRes.ok) throw new Error(`${file.file_name} 다운로드 실패 (${fileRes.status})`);
      entries.push({ name: `contracts/${file.zip_name}`, data: new Uint8Array(await fileRes.arrayBuffer()) });
    }

    const manifest = { ...info, files: info.files.map(({ signed_url, ...file }) => file) };
    entries.push({
      name: 'contracts_backup_manifest.json',
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    });
    btn.textContent = 'ZIP 만드는 중…';
    const blob = storageBackupZip(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `chwork_contracts_files_${today}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alert(`첨부파일 ZIP 백업이 완료되었습니다.\n\n파일: ${info.file_count}개\n용량: ${formatStorageBackupBytes(blob.size)}\n\nZIP 파일을 회사 보안 저장공간에 보관해주세요.`);
  } catch (e) {
    alert('첨부파일 백업 중 오류가 발생했습니다: ' + (e.message || ''));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function formatStorageBackupBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes || 0), unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

async function hrLogin() {
  const pw = $('pwInput').value;
  $('loginMsg').textContent = '';
  try {
    const res = await fetch(`${apiBase()}/api/hr_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json();
    if (data.ok && data.role === 'admin') {
      sessionStorage.setItem('chwork_hr_pw', pw);
      sessionStorage.setItem('chwork_hr_role', data.role);
      window.location.href = 'index.html'; // 로그인 직후엔 대시보드(알림 모음)로 먼저 이동
    } else if (data.ok && data.role === 'family') {
      $('loginMsg').textContent = '이 계정은 개인 일정관리만 이용 가능합니다. 개인 일정관리로 이동합니다.';
      sessionStorage.setItem('chwork_hr_pw', pw);
      sessionStorage.setItem('chwork_hr_role', data.role);
      setTimeout(() => { window.location.href = 'personal.html'; }, 1200);
    } else {
      $('loginMsg').textContent = '비밀번호가 올바르지 않습니다.';
    }
  } catch (e) {
    $('loginMsg').textContent = '서버 연결에 실패했습니다.';
  }
}

function showMain() {
  $('mainSidebar').style.display = '';
  $('loginPanel').style.display = 'none';
  $('hrMain').style.display = 'flex';
  const validGroups = ['home', 'payroll', 'pension', 'contacts', 'contractdocs'];
  const hashGroup = (window.location.hash || '').replace('#', '');
  if (hashGroup === 'data-backup') {
    // 다른 화면(분석및보고/업무일정 등)의 설정에서 "데이터 백업"을 눌렀을 때
    // hr.html#data-backup으로 넘어오는 경우 — 여기서 바로 백업 모달을 열어줌
    switchMenuGroup('home');
    setTimeout(() => { if (typeof openDataBackupModal === 'function') openDataBackupModal(); }, 0);
  } else {
    switchMenuGroup(validGroups.includes(hashGroup) ? hashGroup : 'home');
  }
  loadEmployees();
}

/* ── 탭 전환 ── */
const MENU_GROUPS = {
  home: { label: null, tabs: [{ id: 'employees', label: '직원마스터' }] },
  payroll: {
    label: '급여관리',
    tabs: [
      { id: 'payroll', label: '월별 급여명세', group: '입력' },
      { id: 'otherpay', label: '성과급/기타지급', group: '입력' },
      { id: 'annual', label: '직원별 연간 급여 종합', group: '자료' },
      { id: 'contracts', label: '연봉계약서', group: '자료' },
      { id: 'promotions', label: '인사기록보고서', group: '보고' },
      { id: 'bonus_report', label: '성과급보고서', group: '보고' },
      { id: 'salary_increase_report', label: '연봉인상보고서', group: '보고' },
    ],
  },
  pension: {
    label: '퇴직급여관리',
    tabs: [
      { id: 'pension', label: '퇴직연금 현황', group: '자료' },
      { id: 'pension_input', label: '퇴직연금 발생 및 불입 입력', group: '입력' },
      { id: 'settlement', label: '퇴사자 정산', group: '입력' },
    ],
  },
  contacts: { label: null, tabs: [{ id: 'contacts', label: '거래처 연락처' }] },
  contractdocs: { label: null, tabs: [{ id: 'contractdocs', label: '계약/증빙관리' }] },
};

let currentMenuGroup = 'home';
let currentManualModule = null;

const MANUAL_TITLES = { payroll: '급여관리 매뉴얼', pension: '퇴직급여관리 매뉴얼' };

async function openManualModal() {
  if (!currentManualModule) return;
  $('manualModalTitle').textContent = MANUAL_TITLES[currentManualModule];
  $('manualViewBody').textContent = '불러오는 중…';
  $('manualViewBody').style.display = 'block';
  $('manualEditBody').style.display = 'none';
  $('manualEditBtn').style.display = 'none';
  $('manualSaveBtn').style.display = 'none';
  $('manualCancelBtn').style.display = 'none';
  $('manualUpdatedLabel').textContent = '';
  $('manualModal').style.display = 'flex';
  try {
    const res = await fetch(`${apiBase()}/api/manuals?module=${currentManualModule}`, { headers: { 'X-HR-Password': hrPassword() } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || `불러오기 실패 (상태코드 ${res.status})`);
    }
    const data = await res.json();
    const m = data.manual;
    const content = (m && m.content) || '';
    $('manualViewBody').innerHTML = content ? esc(content).replace(/\n/g, '<br>') : '<span style="color:var(--text-muted);">아직 작성된 매뉴얼이 없습니다. "수정" 버튼을 눌러 작성해주세요.</span>';
    $('manualEditTextarea').value = content;
    if (m && m.updated_at) {
      $('manualUpdatedLabel').textContent = `마지막 수정: ${new Date(m.updated_at).toLocaleString('ko-KR')}`;
    }
    $('manualEditBtn').style.display = 'inline-flex';
  } catch (e) {
    $('manualViewBody').textContent = '불러오기 실패: ' + (e.message || '');
  }
}
function closeManualModal() { $('manualModal').style.display = 'none'; }

function startManualEdit() {
  $('manualViewBody').style.display = 'none';
  $('manualEditBody').style.display = 'block';
  $('manualEditBtn').style.display = 'none';
  $('manualSaveBtn').style.display = 'inline-flex';
  $('manualCancelBtn').style.display = 'inline-flex';
}
function cancelManualEdit() {
  $('manualViewBody').style.display = 'block';
  $('manualEditBody').style.display = 'none';
  $('manualEditBtn').style.display = 'inline-flex';
  $('manualSaveBtn').style.display = 'none';
  $('manualCancelBtn').style.display = 'none';
}
async function saveManual() {
  const content = $('manualEditTextarea').value;
  try {
    const res = await fetch(`${apiBase()}/api/manuals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ module: currentManualModule, content }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || `저장 실패 (상태코드 ${res.status})`);
    }
    openManualModal();
  } catch (e) {
    alert('저장 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

function switchMenuGroup(group) {
  currentMenuGroup = group;
  const g = MENU_GROUPS[group];
  if (window.location.hash !== `#${group}`) {
    history.replaceState(null, '', `#${group}`);
  }

  // 사이드바 활성 표시
  document.querySelectorAll('.nav-sub a').forEach(a => a.classList.toggle('active', a.textContent === g.label));
  $('navHrHome').classList.toggle('active', group === 'home');
  $('navContacts').classList.toggle('active', group === 'contacts');
  $('navContractDocs').classList.toggle('active', group === 'contractdocs');

  // 상단 타이틀/설명 — 메뉴명과 일치시킴
  const TOPBAR_TEXT = {
    home: { title: '인사/급여관리[직원마스터]', desc: '급여관리·퇴직연금 공통 직원 기준정보를 관리합니다.' },
    payroll: { title: '급여관리', desc: '월별 급여명세, 성과급/기타지급, 연봉계약서, 인사기록보고서를 관리합니다.' },
    pension: { title: '퇴직급여관리', desc: '퇴직연금(DC형) 현황과 퇴사자 정산을 관리합니다.' },
    contacts: { title: '거래처 연락처', desc: '거래처별 담당자와 연락처를 관리합니다.' },
    contractdocs: { title: '계약/증빙관리', desc: '금융상품, 계약/보증서, 증빙/백데이터 자료를 관리합니다.' },
  };
  const topText = TOPBAR_TEXT[group] || TOPBAR_TEXT.home;
  $('topbarTitle').textContent = topText.title;
  $('topbarDesc').textContent = topText.desc;

  // 매뉴얼 버튼 — 급여/퇴직급여 화면에서만 표시. 매뉴얼이 없는 화면(직원마스터 등)에서는
  // 빈 "도구" 상자만 남아있지 않도록, 감싸는 박스(manualToolsWrap)째로 같이 숨김/표시함
  currentManualModule = (group === 'payroll') ? 'payroll' : (group === 'pension') ? 'pension' : null;
  $('manualBtn').style.display = currentManualModule ? 'inline-flex' : 'none';
  $('manualToolsWrap').style.display = currentManualModule ? 'flex' : 'none';

  // 상단 탭바 렌더링 — "입력" 그룹과 "자료(조회)" 그룹 사이에 라벨+구분선을 넣어 구분
  const bar = $('hrTabBar');
  if (g.tabs.length <= 1) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    let lastGroup = null;
    bar.innerHTML = g.tabs.map((t, i) => {
      let prefix = '';
      if (t.group && t.group !== lastGroup) {
        if (lastGroup !== null) prefix += `<span style="width:1px; align-self:stretch; background:var(--border-strong); margin:0 8px;"></span>`;
        const groupLabel = t.group === '입력' ? '✏️ 입력' : t.group === '보고' ? '📑 보고' : '📊 조회';
        prefix += `<span style="font-size:10px; color:var(--text-muted); font-weight:600; margin-right:6px; white-space:nowrap;">${groupLabel}</span>`;
        lastGroup = t.group;
      }
      return `${prefix}<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.id}" onclick="switchHrTab('${t.id}')">${t.label}</button>`;
    }).join('');
  }

  switchHrTab(g.tabs[0].id);
}

function switchHrTab(name) {
  document.querySelectorAll('#hrTabBar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('tab-employees').style.display = name === 'employees' ? 'block' : 'none';
  $('tab-pension').style.display = name === 'pension' ? 'block' : 'none';
  $('tab-pension_input').style.display = name === 'pension_input' ? 'block' : 'none';
  $('tab-settlement').style.display = name === 'settlement' ? 'block' : 'none';
  $('tab-payroll').style.display = name === 'payroll' ? 'block' : 'none';
  $('tab-otherpay').style.display = name === 'otherpay' ? 'block' : 'none';
  $('tab-annual').style.display = name === 'annual' ? 'block' : 'none';
  $('tab-contracts').style.display = name === 'contracts' ? 'block' : 'none';
  $('tab-promotions').style.display = name === 'promotions' ? 'block' : 'none';
  $('tab-bonus_report').style.display = name === 'bonus_report' ? 'block' : 'none';
  $('tab-salary_increase_report').style.display = name === 'salary_increase_report' ? 'block' : 'none';
  $('tab-contacts').style.display = name === 'contacts' ? 'block' : 'none';
  $('tab-contractdocs').style.display = name === 'contractdocs' ? 'block' : 'none';
  if (name === 'pension') { loadPensionStatus(); }
  if (name === 'pension_input') { populateYearSelect('pensionLockYear'); loadPension(); refreshPensionLockStatus(); loadPensionInstallmentList(); }
  if (name === 'settlement') { populateSettlementEmployeeSelect(); loadSettlementHistory(); }
  if (name === 'payroll') {
    if (!$('payrollMonth').value) {
      const now = new Date();
      $('payrollMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    }
    loadRetroLog();
    populateLeaveAdjustEmployeeSelect();
    loadLeaveAdjustments();
  }
  if (name === 'otherpay') {
    populateYearSelect('otherpayYear');
    populateOtherPayEmployeeSelect();
    loadOtherPayments();
  }
  if (name === 'annual') {
    populateEmployeeSelectById('annualEmployeeId');
    populateYearSelect('annualYear');
    populateYearSelect('annualAllYear');
  }
  if (name === 'contracts') {
    populateYearSelect('contractYear');
  }
  if (name === 'promotions') {
    initPromotionsTab();
  }
  if (name === 'bonus_report') {
    initBonusReportTab();
  }
  if (name === 'salary_increase_report') {
    initSalaryIncreaseReportTab();
  }
  if (name === 'contacts') {
    loadContacts();
  }
  if (name === 'contractdocs') {
    loadContractDocs();
  }
}

function switchAnnualSubTab(name) {
  document.querySelectorAll('[data-annualsub]').forEach(b => b.classList.toggle('active', b.dataset.annualsub === name));
  $('annualPersonalView').style.display = name === 'personal' ? 'block' : 'none';
  $('annualAllView').style.display = name === 'all' ? 'block' : 'none';
}

function populateYearSelect(elId) {
  const sel = $(elId);
  if (sel.dataset.loaded === '1') return;
  const thisYear = new Date().getFullYear();
  let opts = '';
  for (let y = thisYear + 1; y >= 2026; y--) opts += `<option value="${y}">${y}년</option>`;
  sel.innerHTML = opts;
  sel.value = thisYear;
  sel.dataset.loaded = '1';
}

/* 페이지 로드시 이미 로그인된 세션이면 바로 목록 표시 */
window.addEventListener('DOMContentLoaded', () => {
  if (hrPassword() && sessionStorage.getItem('chwork_hr_role') !== 'family') { showMain(); }
  else if (hrPassword()) { window.location.href = 'personal.html'; return; }
  else { $('loginPanel').style.display = 'block'; }
  $('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') hrLogin(); });
  refreshLastBackupLabel();
});

/* ── 직원 목록 ── */
async function loadEmployees() {
  const showAll = $('showAllToggle').checked;
  const tbody = $('empTbody');
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;

  try {
    const res = await fetch(`${apiBase()}/api/hr_employees${showAll ? '?all=1' : ''}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (res.status === 401) {
      sessionStorage.removeItem('chwork_hr_pw');
      $('loginPanel').style.display = 'block';
      $('hrMain').style.display = 'none';
      $('loginMsg').textContent = '세션이 만료되었습니다. 다시 로그인해주세요.';
      return;
    }
    const data = await res.json();
    renderEmployees(data.employees || []);
    loadContractExpiring();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

async function loadContractExpiring() {
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?upcoming=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) {
      $('contractExpiryBox').style.display = 'none';
      return;
    }
    $('contractExpiryBox').style.display = 'block';
    $('contractExpiryList').innerHTML = list.map(e => {
      let actions = '';
      if (e.kind === '수습종료' || e.kind === '계약만료') {
        actions += `<a class="hr-edit-link" onclick="convertContractToRegular('${e.employee_id}', '${esc(e.name)}', '${e.scheduled_date || ''}')">정규직 전환</a>`;
      }
      if (e.kind === '수습종료') {
        actions += `<a class="hr-edit-link" style="margin-left:8px;" onclick="openExtendProbationModal('${e.employee_id}', '${esc(e.name)}')">수습연장</a>`;
      }
      if (e.kind === '계약만료') {
        actions += `<a class="hr-edit-link" style="margin-left:8px;" onclick="openExtendContractModal('${e.employee_id}', '${esc(e.name)}')">계약연장</a>`;
        actions += `<a class="hr-edit-link" style="margin-left:8px;" onclick="openEditModal('${e.employee_id}')">퇴사처리</a>`;
      } else {
        actions += `<a class="hr-edit-link" style="margin-left:8px;" onclick="openEditModal('${e.employee_id}')">직원정보 수정</a>`;
      }
      const overdue = e.days_left < 0;
      return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:12px;">
        <span>${esc(e.title)} ${overdue ? `<b style="color:var(--red);">(D+${Math.abs(e.days_left)})</b>` : `(D-${e.days_left})`}</span>
        <span>${actions}</span>
      </div>
    `;
    }).join('');
  } catch (e) {
    $('contractExpiryBox').style.display = 'none';
  }
}

let convertRegularEmpId = null;

function convertContractToRegular(empId, name, scheduledDate) {
  convertRegularEmpId = empId;
  $('convertRegularTitle').textContent = `${name} 님 — 정규직 전환`;
  $('cr_date').value = scheduledDate || '';
  $('cr_salary').value = '';
  $('convertRegularModalMsg').textContent = '';
  $('convertRegularModal').style.display = 'flex';
}

function closeConvertRegularModal() {
  $('convertRegularModal').style.display = 'none';
}

async function confirmConvertRegular() {
  const dateVal = $('cr_date').value;
  if (!dateVal) {
    $('convertRegularModalMsg').className = 'hr-msg';
    $('convertRegularModalMsg').textContent = '정규직 전환일을 선택해주세요.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'convert_to_regular', employee_id: convertRegularEmpId, effective_month: dateVal,
        annual_salary_thousand: $('cr_salary').value ? Number($('cr_salary').value) : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'convert failed');
    $('convertRegularModalMsg').className = 'hr-msg success';
    $('convertRegularModalMsg').textContent = `정규직으로 전환되었습니다. (${dateVal}부터 적용 — 월 중간이면 그 달 급여는 자동으로 일할계산됩니다)`;
    loadContractExpiring();
    if (typeof loadEmployees === 'function') loadEmployees();
    setTimeout(closeConvertRegularModal, 1800);
  } catch (e) {
    $('convertRegularModalMsg').className = 'hr-msg';
    $('convertRegularModalMsg').textContent = '전환 중 오류가 발생했습니다: ' + (e.message || '');
  }
}

let extendProbationEmpId = null;

function openExtendProbationModal(empId, name) {
  extendProbationEmpId = empId;
  $('extendProbationTitle').textContent = `${name} 님 — 수습연장`;
  $('ep_months').value = '';
  $('extendProbationModalMsg').textContent = '';
  $('extendProbationModal').style.display = 'flex';
}

function closeExtendProbationModal() {
  $('extendProbationModal').style.display = 'none';
}

async function confirmExtendProbation() {
  const months = $('ep_months').value;
  if (!months || Number(months) < 1) {
    $('extendProbationModalMsg').className = 'hr-msg';
    $('extendProbationModalMsg').textContent = '연장할 개월수를 입력해주세요.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'extend_probation', employee_id: extendProbationEmpId, additional_months: Number(months) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '연장 실패');
    $('extendProbationModalMsg').className = 'hr-msg success';
    $('extendProbationModalMsg').textContent = `연장되었습니다. (새 정규직 전환 예정일: ${data.new_date})`;
    loadContractExpiring();
    if (typeof loadEmployees === 'function') loadEmployees();  // 직원마스터·이력수정 화면도 최신 상태로
    setTimeout(closeExtendProbationModal, 1800);
  } catch (e) {
    $('extendProbationModalMsg').className = 'hr-msg';
    $('extendProbationModalMsg').textContent = '연장 중 오류가 발생했습니다: ' + (e.message || '');
  }
}

let extendContractEmpId = null;

function openExtendContractModal(empId, name) {
  extendContractEmpId = empId;
  $('extendContractTitle').textContent = `${name} 님 — 계약연장(재계약)`;
  $('ec_months').value = '';
  $('ec_salary').value = '';
  $('ec_rate').value = '100';
  $('ec_fixed_amount').value = '';
  $('ec_proration_mode').value = 'daily';
  $('ec_change_terms').checked = false;
  $('ecTermsFields').style.display = 'none';
  $('extendContractModalMsg').textContent = '';
  $('extendContractModal').style.display = 'flex';
}

function closeExtendContractModal() {
  $('extendContractModal').style.display = 'none';
}

async function confirmExtendContract() {
  const months = $('ec_months').value;
  if (!months || Number(months) < 1) {
    $('extendContractModalMsg').className = 'hr-msg';
    $('extendContractModalMsg').textContent = '연장할 개월수를 입력해주세요.';
    return;
  }
  const changeTerms = $('ec_change_terms').checked;
  const body = { type: 'extend_contract', employee_id: extendContractEmpId, additional_months: Number(months) };
  if (changeTerms) {
    body.annual_salary_thousand = $('ec_salary').value ? Number($('ec_salary').value) : null;
    body.contract_rate = $('ec_rate').value ? Number($('ec_rate').value) : 100;
    body.contract_fixed_amount = $('ec_fixed_amount').value ? Number($('ec_fixed_amount').value) : null;
    body.contract_proration_mode = $('ec_proration_mode').value;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '연장 실패');
    $('extendContractModalMsg').className = 'hr-msg success';
    $('extendContractModalMsg').textContent = `연장되었습니다. (새 계약종료일: ${data.new_end_date})`;
    loadContractExpiring();
    if (typeof loadEmployees === 'function') loadEmployees();
    setTimeout(closeExtendContractModal, 1800);
  } catch (e) {
    $('extendContractModalMsg').className = 'hr-msg';
    $('extendContractModalMsg').textContent = '연장 중 오류가 발생했습니다: ' + (e.message || '');
  }
}

let employeesCache = [];

function renderEmployees(list) {
  employeesCache = list;
  $('empCount').textContent = `총 ${list.length}명`;
  populateFieldDatalists(list);
  const tbody = $('empTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:24px;">직원이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(emp => `
    <tr>
      <td>${esc(emp.name)}</td>
      <td>${esc(emp.computed_position || emp.position || '-')}${emp.computed_position && emp.computed_position !== emp.pay_position ? ` <span style="color:var(--red); font-size:11px; font-weight:600;" title="급여기준은 아직 '${esc(emp.pay_position || '-')}' 직급 그대로예요 — 직급이력 관리에서 '급여반영'을 누르면 바뀝니다.">⚠ 급여 미반영</span>` : ''}</td>
      <td>${esc(emp.branch || '-')}</td>
      <td>${esc(emp.department || '-')}</td>
      <td>${esc(emp.hire_date || '-')}</td>
      <td><span class="hr-badge ${emp.status === '재직' ? 'active' : 'retired'}">${esc(emp.status)}</span></td>
      <td>${esc(emp.current_employment_type || '-')}${emp.current_pay_rate != null && emp.current_pay_rate != 1 ? ` (${Math.round(emp.current_pay_rate*100)}%)` : ''}</td>
      <td class="num">${fmt(emp.current_salary_thousand)}</td>
      <td><span class="hr-badge ${emp.pension_enrolled ? 'yes' : 'no'}">${emp.pension_enrolled ? '가입' : '미가입'}</span></td>
      <td><a class="hr-edit-link" onclick="openEditModal('${emp.id}')">수정</a> <a class="hr-edit-link" onclick="deleteEmployee('${emp.id}', '${esc(emp.name)}')">삭제</a></td>
    </tr>
  `).join('');

  const totalSalary = list.reduce((s, e) => s + (Number(e.current_salary_thousand) || 0), 0);
  tbody.innerHTML += `
    <tr class="hr-total-row">
      <td colspan="7">합계 (${list.length}명)</td>
      <td class="num">${fmt(totalSalary)}</td>
      <td colspan="2"></td>
    </tr>
  `;

  // 지사별 합계 (전체 합계 아래에 별도 섹션으로)
  const byBranch = {};
  const branchOrder = [];
  list.forEach(e => {
    const b = e.branch || '(미지정)';
    if (!byBranch[b]) { byBranch[b] = []; branchOrder.push(b); }
    byBranch[b].push(e);
  });
  tbody.innerHTML += `
    <tr><td colspan="10" style="padding:14px 4px 6px; font-size:12px; color:var(--text-muted); font-weight:500;">지사별 합계</td></tr>
  `;
  branchOrder.forEach(b => {
    const arr = byBranch[b];
    const branchTotal = arr.reduce((s, e) => s + (Number(e.current_salary_thousand) || 0), 0);
    tbody.innerHTML += `
      <tr class="hr-total-row">
        <td colspan="7">${esc(b)} (${arr.length}명)</td>
        <td class="num">${fmt(branchTotal)}</td>
        <td colspan="2"></td>
      </tr>
    `;
  });
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── 추가/수정 모달 ── */
let editingId = null;

function populateFieldDatalists(list) {
  const uniq = (key) => [...new Set(list.map(e => e[key]).filter(Boolean))].sort();
  $('positionList').innerHTML = uniq('position').map(v => `<option value="${esc(v)}">`).join('');
  $('branchList').innerHTML = uniq('branch').map(v => `<option value="${esc(v)}">`).join('');
  $('departmentList').innerHTML = uniq('department').map(v => `<option value="${esc(v)}">`).join('');
}

async function deleteEmployee(id, name) {
  if (!confirm(`${name} 님을 삭제하시겠습니까?\n\n(이미 급여·연봉·퇴직연금 등 처리된 기록이 있으면 서버에서 자동으로 삭제가 거부됩니다. 완전히 빈 상태(예: 실수로 중복 등록)인 경우에만 실제로 삭제됩니다.)`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?employee_id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '삭제 중 오류가 발생했습니다.');
      return;
    }
    loadEmployees();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

function toggleSettingsOverview() {
  const wrap = $('settingsOverviewWrap');
  const isHidden = wrap.style.display === 'none';
  wrap.style.display = isHidden ? 'block' : 'none';
  $('settingsOverviewToggleBtn').textContent = isHidden ? '접기' : '펼치기';
  if (isHidden) renderSettingsOverview();
}

function renderSettingsOverview() {
  const tbody = $('settingsOverviewTbody');
  if (!employeesCache || employeesCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:16px;">직원 목록을 먼저 불러와주세요.</td></tr>`;
    return;
  }
  tbody.innerHTML = employeesCache.map(e => `
    <tr>
      <td>${esc(e.name)}</td>
      <td>${esc(e.branch || '-')}</td>
      <td>${esc(e.department || '-')}</td>
      <td>${esc(e.position || '-')}</td>
      <td>${esc(e.current_employment_type || '-')}</td>
      <td class="num">${e.current_pay_rate != null ? Math.round(e.current_pay_rate*100)+'%' : '-'}</td>
      <td class="num">${e.current_standard_hours != null ? fmt(e.current_standard_hours) : '-'}</td>
      <td class="num">${e.current_fixed_overtime_hours != null ? fmt(e.current_fixed_overtime_hours) : '-'}</td>
      <td class="num">${e.current_attendance_allowance != null ? fmt(e.current_attendance_allowance) : '-'}</td>
      <td class="num">${e.current_meal_allowance != null ? fmt(e.current_meal_allowance) : '-'}</td>
      <td>${esc(e.current_contract_end_date || '-')}</td>
    </tr>
  `).join('');
}

function toggleWorkTypeFields() {
  if (editingId !== null) return; // 수정 모드에서는 신규입사 전용 조건 섹션 숨김 유지
  const type = $('f_employment_type').value;
  $('probationFields').style.display = type === '수습' ? 'grid' : 'none';
  $('contractFields').style.display = type === '계약직' ? 'grid' : 'none';
}

function openAddModal() {
  editingId = null;
  $('modalTitle').textContent = '직원 추가';
  ['name','position','pay_position','branch','department','hire_date','retire_date','note',
   'pension_enrollment_date','salary','salary_month','salary_reason'].forEach(f => $('f_' + f).value = '');
  $('f_status').value = '재직';
  $('f_pension_enrolled').value = 'true';
  $('f_employment_type').value = '정규직';
  $('editModeWorkTypeHint').style.display = 'none';
  $('f_probation_months').value = '3';
  $('f_probation_rate').value = '90';
  $('f_contract_months').value = '';
  $('f_contract_rate').value = '100';
  $('f_contract_fixed_amount').value = '';
  $('f_contract_proration_mode').value = 'daily';
  $('f_fixed_overtime_hours').value = '0';
  $('f_attendance_allowance').value = '0';
  $('f_meal_allowance').value = '0';
  $('newEmployeePayFields').style.display = 'grid';
  populatePositionSelect('f_pay_position', '');
  toggleWorkTypeFields();
  $('modalMsg').textContent = '';
  $('salaryHistorySection').style.display = 'none';
  $('empSaveBtn').disabled = false;
  $('empModal').style.display = 'flex';
}

async function applyPositionStandardToNewEmployee() {
  if (editingId !== null) return; // 신규입사 모달에서만 자동채움
  const position = $('f_position').value.trim();
  if (!position) return;
  if (!$('f_pay_position').value.trim()) {
    $('f_pay_position').value = position; // 신규입사는 기본적으로 직급=급여직급
  }
  try {
    const res = await fetch(`${apiBase()}/api/promotions?standards=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const match = (data.standards || []).find(s => s.position === position);
    if (match) {
      $('f_fixed_overtime_hours').value = match.fixed_overtime_hours;
      $('f_attendance_allowance').value = match.attendance_allowance;
      $('f_meal_allowance').value = match.meal_allowance;
    }
  } catch (e) {
    // 자동채움 실패해도 수동 입력은 계속 가능하므로 조용히 무시
  }
}

function openEditModal(id) {
  const emp = employeesCache.find(e => e.id === id);
  if (!emp) return;
  editingId = id;
  $('newEmployeePayFields').style.display = 'none';
  $('modalTitle').textContent = `직원 수정 — ${emp.name}`;
  $('f_name').value = emp.name || '';
  $('f_position').value = emp.position || '';
  populatePositionSelect('f_pay_position', emp.pay_position || '');
  $('f_branch').value = emp.branch || '';
  $('f_department').value = emp.department || '';
  $('f_hire_date').value = emp.hire_date || '';
  $('f_status').value = emp.status || '재직';
  $('f_retire_date').value = emp.retire_date || '';
  $('f_employment_type').value = emp.employment_type || '정규직';
  $('probationFields').style.display = 'none';
  $('contractFields').style.display = 'none';
  $('editModeWorkTypeHint').style.display = 'block';
  $('f_pension_enrolled').value = emp.pension_enrolled ? 'true' : 'false';
  $('f_pension_enrollment_date').value = emp.pension_enrollment_date || '';
  $('f_note').value = emp.note || '';
  $('f_salary').value = '';
  $('f_salary_month').value = '';
  $('f_salary_reason').value = '';
  $('pr_month').value = '';
  $('pr_rate').value = '';
  $('pr_employment_type').value = '';
  $('pr_contract_end').value = '';
  $('pr_fixed_amount').value = '';
  $('pr_proration_mode').value = 'daily';
  togglePrContractEnd();
  $('payRateMsg').textContent = '';
  loadSettingsHistoryInModal(id);
  $('modalMsg').textContent = `현재 연봉: ${fmt(emp.current_salary_thousand)}천원 — 아래는 "변경"이 있을 때만 입력하세요.`;
  $('modalMsg').className = 'hr-msg';
  $('salaryHistorySection').style.display = 'block';
  loadSalaryHistoryInModal(id);
  $('empSaveBtn').disabled = false;
  $('empModal').style.display = 'flex';
}

function closeModal() {
  $('empModal').style.display = 'none';
}

async function saveEmployee() {
  const btn = $('empSaveBtn');
  if (btn.disabled) return; // 중복 클릭 방지
  btn.disabled = true;

  const payload = {
    name: $('f_name').value.trim(),
    position: $('f_position').value.trim(),
    pay_position: $('f_pay_position').value.trim() || null,
    branch: $('f_branch').value.trim(),
    department: $('f_department').value.trim(),
    hire_date: $('f_hire_date').value || null,
    status: $('f_status').value,
    retire_date: $('f_retire_date').value || null,
    employment_type: $('f_employment_type').value.trim() || null,
    pension_enrolled: $('f_pension_enrolled').value === 'true',
    pension_enrollment_date: $('f_pension_enrollment_date').value || null,
    note: $('f_note').value.trim() || null,
  };

  if (!payload.name) {
    $('modalMsg').textContent = '이름은 필수입니다.';
    $('modalMsg').className = 'hr-msg';
    btn.disabled = false;
    return;
  }

  const salaryVal = $('f_salary').value;
  const isNew = editingId === null;

  try {
    if (isNew) {
      if (salaryVal) {
        payload.annual_salary_thousand = Number(salaryVal);
        payload.effective_month = $('f_salary_month').value || payload.hire_date;
      }
      payload.fixed_overtime_hours = Number($('f_fixed_overtime_hours').value) || 0;
      payload.attendance_allowance = Number($('f_attendance_allowance').value) || 0;
      payload.meal_allowance = Number($('f_meal_allowance').value) || 0;
      payload.work_type = $('f_employment_type').value;
      if (payload.work_type === '수습') {
        payload.probation_months = Number($('f_probation_months').value);
        payload.probation_rate = Number($('f_probation_rate').value);
      } else if (payload.work_type === '계약직') {
        payload.contract_months = Number($('f_contract_months').value) || null;
        payload.contract_rate = Number($('f_contract_rate').value) || 100;
        payload.contract_fixed_amount = Number($('f_contract_fixed_amount').value) || null;
        payload.contract_proration_mode = $('f_contract_proration_mode').value;
      }
      const res = await fetch(`${apiBase()}/api/hr_employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');
    } else {
      const originalEmp = employeesCache.find(e => e.id === editingId);
      const positionChanged = originalEmp && (originalEmp.position || '') !== payload.position && payload.position;

      payload.id = editingId;
      if (salaryVal) {
        payload.new_salary_thousand = Number(salaryVal);
        payload.new_salary_effective_month = $('f_salary_month').value;
        payload.new_salary_reason = $('f_salary_reason').value.trim() || null;
        if (!payload.new_salary_effective_month) {
          $('modalMsg').textContent = '연봉을 변경하려면 적용 시작월을 입력해주세요.';
          $('modalMsg').className = 'hr-msg';
          btn.disabled = false;
          return;
        }
      }
      const res = await fetch(`${apiBase()}/api/hr_employees`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');

      if (positionChanged) {
        try {
          await fetch(`${apiBase()}/api/promotions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
            body: JSON.stringify({
              employee_id: editingId,
              effective_date: new Date().toISOString().slice(0, 10),
              position: payload.position,
              note: '직원정보 수정 시 자동기록',
            }),
          });
        } catch (e) {
          // 직급이력 기록 실패해도 직원정보 저장 자체는 이미 성공했으므로 조용히 넘어감
        }
      }
    }
    closeModal();
    loadEmployees();
  } catch (e) {
    $('modalMsg').textContent = '저장 중 오류가 발생했습니다.';
    $('modalMsg').className = 'hr-msg';
  } finally {
    btn.disabled = false;
  }
}

/* ── 퇴직연금 현황 ── */
async function loadPension() {
  const tbody = $('pensionTbody');
  tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  const asOf = $('pensionAsOf').value;
  try {
    const url = `${apiBase()}/api/hr_pension${asOf ? `?as_of=${asOf}` : ''}`;
    const res = await fetch(url, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (res.status === 401) {
      sessionStorage.removeItem('chwork_hr_pw');
      $('loginPanel').style.display = 'block';
      $('hrMain').style.display = 'none';
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    renderPension(data.pension || [], asOf);
    if ($('pensionInstallmentList')) loadPensionInstallmentList();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

/* ── 퇴직연금 현황(자료) 탭 전용 — 항상 "오늘" 기준, 입력 탭의 기준일자와 완전히 무관 ── */
let pensionStatusListCache = [];
async function loadPensionStatus() {
  const tbody = $('pensionStatusTbody');
  tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  const todayStr = new Date().toISOString().slice(0, 10);
  if ($('pensionStatusTodayLabel')) $('pensionStatusTodayLabel').textContent = todayStr;
  try {
    // as_of 파라미터를 절대 붙이지 않음 — 서버가 항상 "오늘"을 기본값으로 계산하게 함
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (res.status === 401) {
      sessionStorage.removeItem('chwork_hr_pw');
      $('loginPanel').style.display = 'block';
      $('hrMain').style.display = 'none';
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    pensionStatusListCache = data.pension || [];
    renderPensionStatus(pensionStatusListCache);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function renderPensionStatus(list) {
  $('pensionStatusCount').textContent = `총 ${list.length}명`;
  const tbody = $('pensionStatusTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:24px;">DC 가입자가 없습니다.</td></tr>`;
    return;
  }
  const sum = (arr, key) => arr.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const positionOf = (id) => {
    const emp = employeesCache.find(e => e.id === id);
    return emp ? (emp.position || '-') : '-';
  };
  const rowHtml = (p) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.branch || '-')}</td>
      <td>${esc(p.department || '-')}</td>
      <td>${esc(positionOf(p.id))}</td>
      <td>${esc(p.pension_enrollment_date || p.hire_date || '-')}</td>
      <td class="num">${fmt(p.cumulative_estimate)}</td>
      <td class="num">${fmt(p.total_contributed)}</td>
      <td class="num ${p.balance > 0 ? 'negative' : ''}">${fmt(p.balance)}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(p.ytd_accrual)}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(p.ytd_paid)}</td>
      <td><a class="hr-edit-link" onclick="openHistoryModal('${p.id}', '${esc(p.name)}')">이력/보정</a></td>
    </tr>
  `;
  const subtotalHtml = (branch, arr) => `
    <tr class="hr-total-row" style="background:var(--surface);">
      <td colspan="5">${esc(branch)} 소계 (${arr.length}명)</td>
      <td class="num">${fmt(sum(arr,'cumulative_estimate'))}</td>
      <td class="num">${fmt(sum(arr,'total_contributed'))}</td>
      <td class="num">${fmt(sum(arr,'balance'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(arr,'ytd_accrual'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(arr,'ytd_paid'))}</td>
      <td></td>
    </tr>
  `;

  // 지사별로 그룹 (원래 정렬 순서 유지, 지사 첫 등장 순서대로)
  const branches = [];
  const byBranch = {};
  list.forEach(p => {
    const b = p.branch || '(미지정)';
    if (!byBranch[b]) { byBranch[b] = []; branches.push(b); }
    byBranch[b].push(p);
  });

  let html = '';
  branches.forEach(b => {
    byBranch[b].forEach(p => { html += rowHtml(p); });
    html += subtotalHtml(b, byBranch[b]);
  });
  html += `
    <tr class="hr-total-row">
      <td colspan="5">전체 합계 (${list.length}명)</td>
      <td class="num">${fmt(sum(list,'cumulative_estimate'))}</td>
      <td class="num">${fmt(sum(list,'total_contributed'))}</td>
      <td class="num">${fmt(sum(list,'balance'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(list,'ytd_accrual'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(list,'ytd_paid'))}</td>
      <td></td>
    </tr>
  `;
  tbody.innerHTML = html;
}

function renderPension(list, asOf) {
  pensionListCache = list;
  pensionAsOfCache = asOf;
  $('pensionInputCount').textContent = `총 ${list.length}명`;
  $('asOfCumHeader').textContent = asOf ? `${asOf} 기준 누적추계액` : '기준일자 누적추계액';
  $('periodAccrualHeader').textContent = asOf ? `${asOf.slice(0,4)}년 1월~${asOf.slice(5)} 발생액` : '해당연도 1월~기준일자 발생액';
  const tbody = $('pensionTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; color:var(--text-muted); padding:24px;">DC 가입자가 없습니다.</td></tr>`;
    return;
  }

  const sum = (arr, key) => arr.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const positionOf = (id) => {
    const emp = employeesCache.find(e => e.id === id);
    return emp ? (emp.position || '-') : '-';
  };
  const rowHtml = (p) => `
    <tr data-emp-id="${p.id}" data-emp-name="${esc(p.name)}" data-balance="${p.balance}" data-asofbalance="${asOf ? (p.as_of_balance ?? 0) : ''}">
      <td>${esc(p.name)}</td>
      <td>${esc(p.branch || '-')}</td>
      <td>${esc(p.department || '-')}</td>
      <td>${esc(positionOf(p.id))}</td>
      <td>${esc(p.pension_enrollment_date || p.hire_date || '-')}</td>
      <td class="num">${fmt(p.cumulative_estimate)}</td>
      <td class="num">${fmt(p.total_contributed)}</td>
      <td class="num ${p.balance > 0 ? 'negative' : ''}">${fmt(p.balance)}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(p.ytd_accrual)}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(p.ytd_paid)}</td>
      <td class="num">${asOf ? fmt(p.as_of_cumulative_estimate) : '-'}</td>
      <td class="num">${asOf ? fmt(p.period_accrual) : '-'}</td>
      <td class="num ${asOf && p.as_of_balance > 0 ? 'negative' : ''}">${asOf ? fmt(p.as_of_balance) : '-'}</td>
      <td class="num"><input type="number" class="hr-input bulk-amount" style="width:120px; text-align:right;" placeholder="0"></td>
      <td><a class="hr-edit-link" onclick="openHistoryModal('${p.id}', '${esc(p.name)}')">이력/보정</a></td>
    </tr>
  `;
  const subtotalHtml = (branch, arr) => `
    <tr class="hr-total-row" style="background:var(--surface);">
      <td colspan="5">${esc(branch)} 소계 (${arr.length}명)</td>
      <td class="num">${fmt(sum(arr,'cumulative_estimate'))}</td>
      <td class="num">${fmt(sum(arr,'total_contributed'))}</td>
      <td class="num">${fmt(sum(arr,'balance'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(arr,'ytd_accrual'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(arr,'ytd_paid'))}</td>
      <td class="num">${asOf ? fmt(sum(arr,'as_of_cumulative_estimate')) : '-'}</td>
      <td class="num">${asOf ? fmt(sum(arr,'period_accrual')) : '-'}</td>
      <td class="num">${asOf ? fmt(sum(arr,'as_of_balance')) : '-'}</td>
      <td colspan="2"></td>
    </tr>
  `;

  // 지사별로 그룹 (원래 정렬 순서 유지, 지사 첫 등장 순서대로)
  const branches = [];
  const byBranch = {};
  list.forEach(p => {
    const b = p.branch || '(미지정)';
    if (!byBranch[b]) { byBranch[b] = []; branches.push(b); }
    byBranch[b].push(p);
  });

  let html = '';
  branches.forEach(b => {
    byBranch[b].forEach(p => { html += rowHtml(p); });
    html += subtotalHtml(b, byBranch[b]);
  });
  html += `
    <tr class="hr-total-row">
      <td colspan="5">전체 합계 (${list.length}명)</td>
      <td class="num">${fmt(sum(list,'cumulative_estimate'))}</td>
      <td class="num">${fmt(sum(list,'total_contributed'))}</td>
      <td class="num">${fmt(sum(list,'balance'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(list,'ytd_accrual'))}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(sum(list,'ytd_paid'))}</td>
      <td class="num">${asOf ? fmt(sum(list,'as_of_cumulative_estimate')) : '-'}</td>
      <td class="num">${asOf ? fmt(sum(list,'period_accrual')) : '-'}</td>
      <td class="num">${asOf ? fmt(sum(list,'as_of_balance')) : '-'}</td>
      <td colspan="2"></td>
    </tr>
  `;
  tbody.innerHTML = html;

  // 불입 모달용 직원 셀렉트도 채워두기
  const sel = $('c_employee_id');
  sel.innerHTML = list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}

/* ── 불입 기록 추가 ── */
function openContribModal() {
  $('c_date').value = '';
  $('c_amount').value = '';
  $('c_note').value = '';
  $('contribMsg').textContent = '';
  $('contribModal').style.display = 'flex';
}
function closeContribModal() {
  $('contribModal').style.display = 'none';
}

async function saveContribution() {
  const payload = {
    employee_id: $('c_employee_id').value,
    contribution_date: $('c_date').value,
    amount: Number($('c_amount').value),
    note: $('c_note').value.trim() || null,
  };
  if (!payload.employee_id || !payload.contribution_date || !payload.amount) {
    $('contribMsg').textContent = '직원, 정산지급일, 금액은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || '저장 실패');
    }
    closeContribModal();
    loadPension();
    loadPensionInstallmentList();
  } catch (e) {
    $('contribMsg').textContent = e.message || '저장 중 오류가 발생했습니다.';
  }
}

/* ── 퇴사자 정산 계산기 ── */
async function populateSettlementEmployeeSelect() {
  const sel = $('s_employee_id');
  if (sel.dataset.loaded === '1') return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?all=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = (data.employees || []).filter(e => e.pension_enrolled);
    sel.innerHTML = '<option value="">-- 직원 선택 --</option>' +
      list.map(e => `<option value="${e.id}">${esc(e.name)} (${esc(e.status)})</option>`).join('');
    sel.dataset.loaded = '1';
  } catch (e) {
    sel.innerHTML = '<option value="">불러오기 실패</option>';
  }
}

async function calcSettlement() {
  const employeeId = $('s_employee_id').value;
  const retireDate = $('s_retire_date').value;
  if (!employeeId || !retireDate) {
    $('settlementResult').style.display = 'none';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_settlement?employee_id=${employeeId}&retire_date=${retireDate}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      $('settlementMsg').textContent = data.detail || '계산 실패';
      return;
    }
    $('s_name').textContent = $('s_employee_id').selectedOptions[0]?.textContent.replace(/\s*\(.*\)$/, '') || '-';
    $('s_hire_display').textContent = data.hire_date || '-';
    $('s_retire_display').textContent = retireDate;
    $('s_cum').textContent = fmt(data.cumulative_estimate) + '원';
    $('s_paid').textContent = fmt(data.total_contributed) + '원';
    $('s_add').textContent = fmt(data.additional_payment) + '원';
    if (!$('s_pay_date').value) $('s_pay_date').value = retireDate;
    $('settlementResult').dataset.cum = data.cumulative_estimate;
    $('settlementResult').dataset.paid = data.total_contributed;
    $('settlementResult').dataset.add = data.additional_payment;
    $('settlementResult').dataset.yearly = JSON.stringify(data.yearly || []);
    $('settlementResult').style.display = 'block';
    renderYearlyTable(data.yearly || []);
    calcNet();
  } catch (e) {
    $('settlementMsg').textContent = '계산 중 오류가 발생했습니다.';
  }
}

function renderYearlyTable(yearly) {
  const tbody = $('yearlyTbody');
  if (yearly.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">데이터 없음</td></tr>`;
    return;
  }
  tbody.innerHTML = yearly.map(r => `
    <tr>
      <td>${r.year}년</td>
      <td class="num">${fmt(r.cumulative_estimate)}</td>
      <td class="num">${fmt(r.cumulative_paid)}</td>
      <td class="num ${r.balance > 0 ? 'negative' : ''}">${fmt(r.balance)}</td>
    </tr>
  `).join('');
}

function calcNet() {
  const add = Number($('settlementResult').dataset.add || 0);
  const deduction = Number($('s_deduction').value || 0);
  const refund = Number($('s_tax_refund').value || 0);
  const other = Number($('s_other').value || 0);
  const net = add - deduction + refund + other;
  $('s_net').textContent = fmt(net) + '원';
}

async function saveSettlement() {
  const r = $('settlementResult');
  const deduction = Number($('s_deduction').value || 0);
  const refund = Number($('s_tax_refund').value || 0);
  const other = Number($('s_other').value || 0);
  const add = Number(r.dataset.add || 0);
  const net = add - deduction + refund + other;
  const payDate = $('s_pay_date').value || $('s_retire_date').value;

  const payload = {
    employee_id: $('s_employee_id').value,
    retire_date: $('s_retire_date').value,
    pay_date: payDate,
    cumulative_estimate: Number(r.dataset.cum),
    total_contributed: Number(r.dataset.paid),
    additional_payment: add,
    deduction_total: deduction,
    year_end_tax_refund: refund,
    other_payment: other,
    net_payment: net,
    note: $('s_note').value.trim() || null,
  };

  if (!confirm('정산을 확정하시겠습니까? 저장 후 해당 직원은 "퇴사" 상태로 자동 변경되고, 추가불입액은 불입 기록에도 자동 등록됩니다.')) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_settlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || 'save failed');

    $('settlementMsg').textContent = '';
    $('settlementMsg').className = data.contrib_warning ? 'hr-msg' : 'hr-msg success';
    $('settlementMsg').textContent = '정산이 확정 저장되었습니다.' + (data.contrib_warning ? ' (' + data.contrib_warning + ')' : '');
    loadSettlementHistory();
    loadPension(); // 퇴직연금 현황·발생및불입입력 탭도 함께 최신화
  } catch (e) {
    $('settlementMsg').className = 'hr-msg';
    $('settlementMsg').textContent = '저장 중 오류가 발생했습니다: ' + (e.message || '');
  }
}

async function loadSettlementHistory() {
  const tbody = $('historyTbody');
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_settlement?list=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.settlements || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">확정된 정산 내역이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(s => `
      <tr>
        <td>${esc(s.employees?.name || '-')}</td>
        <td>${esc(s.employees?.position || '-')}</td>
        <td>${esc(s.employees?.branch || '-')}</td>
        <td>${esc(s.employees?.department || '-')}</td>
        <td>${esc(s.retire_date)}</td>
        <td class="num">${fmt(s.additional_payment)}</td>
        <td class="num">${fmt(s.net_payment)}</td>
        <td>${esc((s.created_at || '').slice(0, 10))}</td>
        <td><a class="hr-edit-link" onclick="revertSettlement('${s.id}', '${esc(s.employees?.name || '')}')">되돌리기</a></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

async function revertSettlement(id, name) {
  if (!confirm(`${name}님의 정산 확정을 되돌리시겠습니까?\n이 정산 기록과, 이때 자동 등록됐던 불입 기록이 함께 삭제되고, 해당 직원은 다시 "재직" 상태로 복구됩니다.`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_settlement?id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || 'revert failed');
    alert('되돌렸습니다.' + (data.warning ? '\n\n⚠ ' + data.warning : ''));
    loadSettlementHistory();
    loadPension(); // 퇴직연금 현황·발생및불입입력 탭도 함께 최신화
    $('s_employee_id').dataset.loaded = '0';
    populateSettlementEmployeeSelect();
  } catch (e) {
    alert('되돌리는 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* ── 정산내역서 출력/다운로드 ── */
function printSettlement() {
  const printAreaEl = $('printArea');
  const originalParent = printAreaEl.parentNode;
  const originalNextSibling = printAreaEl.nextSibling;
  document.body.appendChild(printAreaEl); // .layout 밖(body 바로 아래)으로 잠깐 이동

  const style = document.createElement('style');
  style.id = 'settlementPrintStyle';
  style.textContent = `
    @page { size: portrait; margin: 12mm; }
    @media print {
      #printArea { font-size: 11px; }
      #printArea h3 { font-size: 14px; margin-bottom: 8px; }
      #printArea table { font-size: 10px; }
      #printArea th, #printArea td { padding: 3px 5px; }
    }
  `;
  document.head.appendChild(style);
  window.print();
  document.head.removeChild(style);

  // 인쇄(또는 취소) 후 원래 위치(퇴사자 정산 화면 안)로 되돌림
  if (originalNextSibling) {
    originalParent.insertBefore(printAreaEl, originalNextSibling);
  } else {
    originalParent.appendChild(printAreaEl);
  }
}

function downloadSettlementExcel() {
  const name = $('s_name').textContent;
  const rows = [
    ['퇴직금(DC형 퇴직연금) 정산내역서'],
    [],
    ['성명', name],
    ['입사일', $('s_hire_display').textContent],
    ['퇴사일', $('s_retire_display').textContent],
    [],
    ['누적추계액 (퇴사일 기준)', Number($('settlementResult').dataset.cum || 0)],
    ['기 불입액 (퇴사일까지)', Number($('settlementResult').dataset.paid || 0)],
    ['추가불입(정산)액', Number($('settlementResult').dataset.add || 0)],
    [],
    ['공제금액 합계', Number($('s_deduction').value || 0)],
    ['연말정산 환급금', Number($('s_tax_refund').value || 0)],
    ['기타지급액', Number($('s_other').value || 0)],
    [],
    ['실 지급액', $('s_net').textContent.replace(/[^\d-]/g, '')],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '정산내역서');

  const yearly = JSON.parse($('settlementResult').dataset.yearly || '[]');
  const yearlyRows = [['연도', '누적추계액', '누적불입액', '잔액']];
  yearly.forEach(r => yearlyRows.push([`${r.year}년`, r.cumulative_estimate, r.cumulative_paid, r.balance]));
  const ws2 = XLSX.utils.aoa_to_sheet(yearlyRows);
  ws2['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, '부속명세서');

  XLSX.writeFile(wb, `퇴직금정산내역서_${name}_${$('s_retire_display').textContent}.xlsx`);
}

/* ── 퇴직연금 현황 엑셀 다운로드 ── */
function downloadPensionExcel() {
  const rows = [['이름', '지사', '부서', '직급', '가입일', '누적추계액(현재기준)', '실불입액 합계', '잔액', $('asOfCumHeader').textContent, $('periodAccrualHeader').textContent, $('asOfBalanceHeader').textContent]];
  document.querySelectorAll('#pensionTbody tr').forEach(tr => {
    if (tr.classList.contains('hr-total-row')) {
      const tds = Array.from(tr.children).map(td => td.textContent.trim());
      rows.push([tds[0], '', '', '', '', tds[1], tds[2], tds[3], tds[4], tds[5], tds[6]]);
      return;
    }
    const cells = Array.from(tr.children).slice(0, 11).map(td => td.textContent.trim());
    if (cells.length === 11) rows.push(cells);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '퇴직연금현황');
  XLSX.writeFile(wb, `퇴직연금현황_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ── 일괄 불입 처리 ── */
function fillBulkAmounts(mode) {
  if (mode === 'accrual' && !$('pensionAsOf').value) {
    alert('먼저 위에서 "기준일자"를 지정하고 조회한 뒤 사용해주세요.');
    return;
  }
  document.querySelectorAll('#pensionTbody tr').forEach(tr => {
    const input = tr.querySelector('.bulk-amount');
    if (!input) return;
    if (mode === 'clear') {
      input.value = '';
      return;
    }
    if (mode === 'accrual') {
      const v = tr.dataset.asofbalance;
      const num = (v === '' || v === 'undefined') ? null : Math.round(Number(v));
      input.value = (num !== null && num > 0) ? num : '';
    } else if (mode === 'balance') {
      const v = Math.round(Number(tr.dataset.balance || 0));
      input.value = v > 0 ? v : '';
    }
  });
}

async function saveBulkContributions() {
  const date = $('pensionSettlePayDate').value;
  if (!date) {
    alert('먼저 "정산지급일"을 지정해주세요 (이 날짜로 저장됩니다).');
    return;
  }
  const items = [];
  document.querySelectorAll('#pensionTbody tr').forEach(tr => {
    const empId = tr.dataset.empId;
    const input = tr.querySelector('.bulk-amount');
    const amount = Number(input?.value || 0);
    if (empId && amount > 0) {
      items.push({ employee_id: empId, contribution_date: date, amount, note: '일괄 불입 처리' });
    }
  });
  if (items.length === 0) {
    alert('입력된 금액이 없습니다. "발생액으로 채우기" 또는 "잔액으로 채우기"를 먼저 눌러주세요.');
    return;
  }
  if (!confirm(`${items.length}명에게 총 ${fmt(items.reduce((s, i) => s + i.amount, 0))}원을 ${date}자로 저장하시겠습니까?\n\n저장 즉시 이 차수(${date})는 자동으로 마감되어, 이후 추가/수정/삭제하려면 먼저 마감해제해야 합니다.`)) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || '저장 실패');
    }
    alert('저장 및 마감되었습니다.');
    loadPension();
    loadPensionInstallmentList();
  } catch (e) {
    alert('저장 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* ── 불입 내역 조회/취소(삭제) ── */
let currentHistoryEmployeeId = null;
let currentHistoryEmployeeName = null;
let currentAdjustEmployeeId = null;
let currentAdjustEmployeeName = null;

async function openHistoryModal(employeeId, name) {
  currentHistoryEmployeeId = employeeId;
  currentHistoryEmployeeName = name;
  currentAdjustEmployeeId = employeeId;
  currentAdjustEmployeeName = name;
  $('historyModalTitle').textContent = `${name} — 불입/보정 내역`;
  $('contribHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  $('adj_date').value = '';
  $('adj_amount').value = '';
  $('adj_note').value = '';
  $('adjustMsg').textContent = '';
  $('historyModal').style.display = 'flex';
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?employee_id=${employeeId}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.contributions || [];
    if (list.length === 0) {
      $('contribHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">불입 내역이 없습니다.</td></tr>`;
    } else {
      $('contribHistoryTbody').innerHTML = list.map(c => {
        const editable = c.contribution_date && c.contribution_date.slice(0,4) >= '2026';
        return `
        <tr data-id="${c.id}" data-date="${c.contribution_date}" data-amount="${c.amount}" data-note="${esc(c.note || '')}">
          <td class="hview">${esc(c.contribution_date)}</td>
          <td class="num hview">${fmt(c.amount)}</td>
          <td class="hview">${esc(c.note || '-')}</td>
          <td class="hview">
            ${editable ? `
              <div style="display:flex; gap:6px; white-space:nowrap;">
                <a class="hr-edit-link" onclick="editContributionRow(this)">수정</a>
                <a class="hr-edit-link" onclick="deleteContribution('${c.id}', '${employeeId}', '${esc(name)}')">삭제</a>
              </div>
            ` : `<span style="color:var(--text-muted); font-size:11px;">2025년 이전 확정자료</span>`}
          </td>
        </tr>
      `;
      }).join('');
    }
  } catch (e) {
    $('contribHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
  await loadAdjustHistory(employeeId);
  await loadMultiplierHistory(employeeId);
  await loadYearlyHistory(employeeId);
}

async function loadMultiplierHistory(employeeId) {
  $('multiplierHistoryTbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:12px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?employee_id=${employeeId}&type=multiplier`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.multipliers || [];
    if (list.length === 0) {
      $('multiplierHistoryTbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:12px;">등록된 배수가 없습니다 (일반 직원 방식으로 계산됩니다).</td></tr>`;
      return;
    }
    const typeLabels = [
      ['include_bonus1', '성과급1차'], ['include_bonus2', '성과급2차'], ['include_severance_bonus', '상여금'],
      ['include_other_allowance', '기타수당'], ['include_annual_leave_pay', '연차수당'],
    ];
    $('multiplierHistoryTbody').innerHTML = list.map(m => {
      const included = typeLabels.filter(([key]) => m[key]).map(([, label]) => label);
      return `
      <tr>
        <td>${esc(m.effective_date)}</td>
        <td class="num">${m.multiplier}배</td>
        <td>${included.length > 0 ? esc(included.join(', ')) : '없음'}</td>
        <td>${esc(m.note || '-')}</td>
        <td><a class="hr-edit-link" onclick="deleteMultiplier('${m.id}', '${employeeId}')">삭제</a></td>
      </tr>
    `;
    }).join('');
  } catch (e) {
    $('multiplierHistoryTbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--red); padding:12px;">불러오기 실패</td></tr>`;
  }
}

async function saveMultiplier() {
  const date = $('mult_date').value;
  const value = Number($('mult_value').value);
  const note = $('mult_note').value.trim() || null;
  if (!date || !value) {
    $('multiplierMsg').textContent = '적용 시작일과 배수는 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'multiplier',
        employee_id: currentAdjustEmployeeId,
        effective_date: date,
        multiplier: value,
        include_bonus1: $('mult_bonus1').checked,
        include_bonus2: $('mult_bonus2').checked,
        include_severance_bonus: $('mult_severance_bonus').checked,
        include_other_allowance: $('mult_other_allowance').checked,
        include_annual_leave_pay: $('mult_annual_leave_pay').checked,
        note,
      }),
    });
    if (!res.ok) throw new Error('save failed');
    $('mult_date').value = '';
    $('mult_value').value = '';
    $('mult_note').value = '';
    $('mult_bonus1').checked = false;
    $('mult_bonus2').checked = false;
    $('mult_severance_bonus').checked = false;
    $('mult_other_allowance').checked = false;
    $('mult_annual_leave_pay').checked = false;
    $('multiplierMsg').className = 'hr-msg success';
    $('multiplierMsg').textContent = '저장되었습니다.';
    loadMultiplierHistory(currentAdjustEmployeeId);
    loadYearlyHistory(currentAdjustEmployeeId);
  } catch (e) {
    $('multiplierMsg').className = 'hr-msg';
    $('multiplierMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deleteMultiplier(id, employeeId) {
  if (!confirm('이 배수 설정을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?id=${id}&type=multiplier`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    loadMultiplierHistory(employeeId);
    loadYearlyHistory(employeeId);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

async function loadYearlyHistory(employeeId) {
  $('yearlyHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?employee_id=${employeeId}&type=yearly`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.yearly || [];
    if (list.length === 0) {
      $('yearlyHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px;">데이터가 없습니다.</td></tr>`;
      return;
    }
    $('yearlyHistoryTbody').innerHTML = list.map(r => `
      <tr>
        <td>${r.year}년</td>
        <td class="num">${fmt(r.cumulative_estimate)}</td>
        <td class="num">${fmt(r.cumulative_paid)}</td>
        <td class="num ${r.balance > 0 ? 'negative' : ''}">${fmt(r.balance)}</td>
      </tr>
    `).join('');
  } catch (e) {
    $('yearlyHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--red); padding:12px;">불러오기 실패</td></tr>`;
  }
}

function closeHistoryModal() {
  $('historyModal').style.display = 'none';
  loadPension();
}

async function deleteContribution(contribId, employeeId, name) {
  if (!confirm('이 불입 기록을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?id=${contribId}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || '삭제 실패');
    }
    openHistoryModal(employeeId, name);
    loadPensionInstallmentList();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* ── 불입 내역 수정(인라인) ── */
function editContributionRow(linkEl) {
  const tr = linkEl.closest('tr');
  const id = tr.dataset.id;
  const date = tr.dataset.date;
  const amount = tr.dataset.amount;
  const note = tr.dataset.note;

  tr.innerHTML = `
    <td><input type="date" class="hr-input" id="edit_date_${id}" value="${date}" style="width:130px;"></td>
    <td class="num"><input type="number" class="hr-input" id="edit_amount_${id}" value="${amount}" style="width:110px; text-align:right;"></td>
    <td><input type="text" class="hr-input" id="edit_note_${id}" value="${esc(note)}"></td>
    <td>
      <a class="hr-edit-link" onclick="saveContributionEdit('${id}')">저장</a>
      <a class="hr-edit-link" style="margin-left:8px;" onclick="openHistoryModal(currentHistoryEmployeeId, currentHistoryEmployeeName)">취소</a>
    </td>
  `;
}

async function saveContributionEdit(id) {
  const date = $(`edit_date_${id}`).value;
  const amount = Number($(`edit_amount_${id}`).value);
  const note = $(`edit_note_${id}`).value.trim() || null;
  if (!date || !amount) {
    alert('정산지급일과 금액은 필수입니다.');
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ contribution_date: date, amount, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || '수정 실패');
    }
    openHistoryModal(currentHistoryEmployeeId, currentHistoryEmployeeName);
    loadPensionInstallmentList();
  } catch (e) {
    alert('수정 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* ── 월별 급여명세 ── */
function payrollYearMonthDate() {
  const m = $('payrollMonth').value; // "2026-07"
  return m ? `${m}-01` : '';
}

/* 급여명세 조회 시, 재직자 중 직급은 승진됐는데 급여기준(pay_position)엔 아직
   반영 안 된 사람이 있으면 상단에 빨간 배너로 알려줌 (직급이력 관리에서 "급여반영" 필요). */
async function checkPayrollPositionWarning() {
  const banner = $('payrollPositionWarning');
  banner.style.display = 'none';
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, { headers: { 'X-HR-Password': hrPassword() } });
    const data = await res.json();
    if (!res.ok) return;
    const pending = (data.employees || []).filter(e => e.computed_position && e.pay_position && e.computed_position !== e.pay_position);
    if (pending.length === 0) return;
    banner.style.display = 'block';
    banner.textContent = `⚠ 급여기준 미반영 직원 ${pending.length}명 있음: ${pending.map(e => e.name).join(', ')} — 직급은 승진됐지만 급여기준표 반영 전이라, 이 달 급여는 아직 예전 직급 기준으로 계산됩니다. 반영하려면 "인사기록보고서 → 직급이력 관리"에서 급여반영을 눌러주세요.`;
  } catch (e) {
    // 이 배너는 부가 정보라 실패해도 급여명세 조회 자체엔 영향 없음
  }
}

async function loadPayrollPreview() {
  const ym = payrollYearMonthDate();
  if (!ym) { alert('먼저 월을 선택해주세요.'); return; }
  const tbody = $('payrollTbody');
  tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  $('retroAdjHeader').textContent = '소급인상분';
  $('finalTotalHeader').textContent = '최종 지급액';
  checkPayrollPositionWarning();
  try {
    // 1) 저장된 자료가 있는지 먼저 확인 (있으면 그게 최종 진실)
    const savedRes = await fetch(`${apiBase()}/api/hr_payroll?year_month=${ym}&saved=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const savedData = await savedRes.json();
    if (savedRes.ok && savedData.payroll && savedData.payroll.length > 0) {
      const list = savedData.payroll.map(p => ({
        ...p,
        name: p.employees?.name,
        branch: p.employees?.branch,
        department: p.employees?.department,
        position: p.employees?.position,
        hire_date: p.employees?.hire_date,
      })).sort((a, b) => (a.hire_date || '').localeCompare(b.hire_date || '') || (a.name || '').localeCompare(b.name || '', 'ko'));
      renderPayroll(list, true);
      refreshPayrollLockStatus();
      return;
    }

    // 2) 저장된 자료가 없으면 실시간 미리보기
    const res = await fetch(`${apiBase()}/api/hr_payroll?year_month=${ym}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    renderPayroll(data.payroll || [], false);
    refreshPayrollLockStatus();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

let payrollCache = [];
let pensionListCache = [];
let pensionAsOfCache = '';

function renderPayroll(list, savedMode) {
  payrollCache = list;
  $('payrollCount').textContent = `총 ${list.length}명`;
  const tbody = $('payrollTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--text-muted); padding:24px;">데이터가 없습니다.</td></tr>`;
    $('payrollAdjustNoteBox').style.display = 'none';
    return;
  }
  tbody.innerHTML = list.map((p, idx) => {
    const retro = savedMode ? (Number(p.retroactive_adjustment) || 0) : null;
    const finalTotal = savedMode ? (Number(p.total_pay) || 0) + (retro || 0) : null;
    return `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.branch || '-')}</td>
      <td>${esc(p.department || '-')}</td>
      <td>${esc(p.position || '-')}</td>
      <td class="num">${fmt(p.base_pay)}</td>
      <td class="num">${fmt(p.fixed_overtime_pay)}</td>
      <td class="num">${fmt(p.attendance_allowance)}</td>
      <td class="num">${fmt(p.meal_allowance)}</td>
      <td class="num">${fmt(p.total_pay)}</td>
      <td class="num">${savedMode ? (retro ? fmt(retro) : '') : '-'}</td>
      <td class="num">${savedMode ? fmt(finalTotal) : '-'}</td>
      <td><a class="hr-edit-link" onclick="openPayslipModal(${idx})">명세서</a>${savedMode ? ` <a class="hr-edit-link" onclick="deletePayrollRecord('${p.id}', '${esc(p.name)}')">삭제</a>` : ''}</td>
    </tr>
  `;
  }).join('');

  const sum = (arr, key) => arr.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const sumFinal = (arr) => arr.reduce((s, p) => s + (Number(p.total_pay) || 0) + (savedMode ? (Number(p.retroactive_adjustment) || 0) : 0), 0);
  tbody.innerHTML += `
    <tr class="hr-total-row">
      <td colspan="4">합계 (${list.length}명)</td>
      <td class="num">${fmt(sum(list,'base_pay'))}</td>
      <td class="num">${fmt(sum(list,'fixed_overtime_pay'))}</td>
      <td class="num">${fmt(sum(list,'attendance_allowance'))}</td>
      <td class="num">${fmt(sum(list,'meal_allowance'))}</td>
      <td class="num">${fmt(sum(list,'total_pay'))}</td>
      <td class="num">${savedMode ? fmt(sum(list,'retroactive_adjustment')) : '-'}</td>
      <td class="num">${savedMode ? fmt(sumFinal(list)) : '-'}</td>
      <td></td>
    </tr>
  `;

  // 지사별 합계 (전체 합계 아래에 별도 섹션으로)
  const byBranch = {};
  const branchOrder = [];
  list.forEach(p => {
    const b = p.branch || '(미지정)';
    if (!byBranch[b]) { byBranch[b] = []; branchOrder.push(b); }
    byBranch[b].push(p);
  });
  tbody.innerHTML += `
    <tr><td colspan="12" style="padding:14px 4px 6px; font-size:12px; color:var(--text-muted); font-weight:500;">지사별 합계</td></tr>
  `;
  branchOrder.forEach(b => {
    const arr = byBranch[b];
    tbody.innerHTML += `
      <tr class="hr-total-row">
        <td colspan="4">${esc(b)} (${arr.length}명)</td>
        <td class="num">${fmt(sum(arr,'base_pay'))}</td>
        <td class="num">${fmt(sum(arr,'fixed_overtime_pay'))}</td>
        <td class="num">${fmt(sum(arr,'attendance_allowance'))}</td>
        <td class="num">${fmt(sum(arr,'meal_allowance'))}</td>
        <td class="num">${fmt(sum(arr,'total_pay'))}</td>
        <td class="num">${savedMode ? fmt(sum(arr,'retroactive_adjustment')) : '-'}</td>
        <td class="num">${savedMode ? fmt(sumFinal(arr)) : '-'}</td>
        <td></td>
      </tr>
    `;
  });

  // 이번 달 특이사항 안내 박스 (재직자 조정 + 일할계산 대상)
  const noted = list.filter(p => p.adjustment_note || p.proration_note);
  if (noted.length > 0) {
    $('payrollAdjustNoteBox').style.display = 'block';
    $('payrollAdjustNoteList').innerHTML = noted.map(p => `
      <div style="font-size:12px; color:var(--text-secondary); padding:3px 0;">
        <b>${esc(p.name)}</b>
        ${p.adjustment_note ? ` — ${esc(p.adjustment_note)}` : ''}
        ${p.proration_note ? `<br><span style="margin-left:8px;">└ ${esc(p.proration_note)}</span>` : ''}
      </div>
    `).join('');
  } else {
    $('payrollAdjustNoteBox').style.display = 'none';
  }
}

async function deletePayrollRecord(employeeId, name) {
  const ym = payrollYearMonthDate();
  if (!confirm(`${name} 님의 ${$('payrollMonth').value} 급여 기록을 삭제하시겠습니까?\n(직원 자체는 삭제되지 않고, 이 달의 급여 저장 기록만 지워집니다. 이후 삭제 안 되던 직원이 삭제 가능해질 수 있어요.)`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?payroll_employee_id=${employeeId}&payroll_month=${ym}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'delete failed');
    loadPayrollPreview();
  } catch (e) {
    alert(e.message && e.message.includes('마감') ? e.message : '삭제 중 오류가 발생했습니다.');
  }
}

async function generatePayroll() {
  const ym = payrollYearMonthDate();
  if (!ym) { alert('먼저 월을 선택해주세요.'); return; }
  if (!confirm(`${$('payrollMonth').value} 급여명세를 생성/저장하시겠습니까? (이미 생성된 달이면 최신 계산값으로 덮어씁니다)`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ year_month: ym }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    alert(`${data.count}명분 저장되었습니다.`);
    loadPayrollPreview();
  } catch (e) {
    alert(e.message || '저장 중 오류가 발생했습니다.');
  }
}

function downloadPayrollExcel() {
  const rows = [['이름', '지사', '부서', '직급', '기본급', '고정연장수당', '만근수당', '식대', '합계', '소급인상분', '최종 지급액', '재직자 조정 안내']];
  document.querySelectorAll('#payrollTbody tr').forEach(tr => {
    if (tr.children.length === 1) return; // "지사별 합계" 섹션 제목 줄은 건너뜀
    if (tr.classList.contains('hr-total-row')) {
      const tds = Array.from(tr.children).map(td => td.textContent.trim());
      rows.push([tds[0], '', '', '', tds[1], tds[2], tds[3], tds[4], tds[5], tds[6], tds[7], '']);
      return;
    }
    const cells = Array.from(tr.children).map(td => td.textContent.trim());
    if (cells.length === 12) rows.push(cells.slice(0, 11).concat(['']));
  });
  // 재직자 조정 안내는 payrollCache에서 별도로 채움
  payrollCache.forEach((p, idx) => {
    if (p.adjustment_note && rows[idx + 1]) rows[idx + 1][11] = p.adjustment_note;
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const sheetName = $('payrollMonth').value || '급여명세';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `급여명세_${sheetName}.xlsx`);
}

/* ── 퇴직연금 개별 보정 ── */

async function loadAdjustHistory(employeeId) {
  $('adjustHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?employee_id=${employeeId}&type=adjustment`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.adjustments || [];
    if (list.length === 0) {
      $('adjustHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px;">보정 내역이 없습니다.</td></tr>`;
      return;
    }
    $('adjustHistoryTbody').innerHTML = list.map(a => {
      const editable = a.effective_date && a.effective_date.slice(0,4) >= '2026';
      return `
      <tr data-id="${a.id}" data-date="${a.effective_date}" data-amount="${a.adjustment_amount}" data-note="${esc(a.note || '')}">
        <td class="hview">${esc(a.effective_date)}</td>
        <td class="num hview">${a.adjustment_amount > 0 ? '+' : ''}${fmt(a.adjustment_amount)}</td>
        <td class="hview">${esc(a.note || '-')}</td>
        <td class="hview">
          ${editable ? `
            <a class="hr-edit-link" onclick="editAdjustRow(this)">수정</a>
            <a class="hr-edit-link" style="margin-left:8px;" onclick="deleteAdjustment('${a.id}')">삭제</a>
          ` : `<span style="color:var(--text-muted); font-size:11px;">2025년 이전 확정자료</span>`}
        </td>
      </tr>
    `;
    }).join('');
  } catch (e) {
    $('adjustHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--red); padding:12px;">불러오기 실패</td></tr>`;
  }
}

async function saveAdjustment() {
  const date = $('adj_date').value;
  const amount = Number($('adj_amount').value);
  const note = $('adj_note').value.trim() || null;
  if (!date || !amount) {
    $('adjustMsg').textContent = '적용 시작일과 금액은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'adjustment',
        employee_id: currentAdjustEmployeeId,
        effective_date: date,
        adjustment_amount: amount,
        note,
      }),
    });
    if (!res.ok) throw new Error('save failed');
    $('adj_date').value = '';
    $('adj_amount').value = '';
    $('adj_note').value = '';
    $('adjustMsg').className = 'hr-msg success';
    $('adjustMsg').textContent = '저장되었습니다.';
    loadAdjustHistory(currentAdjustEmployeeId);
  } catch (e) {
    $('adjustMsg').className = 'hr-msg';
    $('adjustMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deleteAdjustment(id) {
  if (!confirm('이 보정 내역을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?id=${id}&type=adjustment`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    loadAdjustHistory(currentAdjustEmployeeId);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 보정 내역 수정(인라인) ── */
function editAdjustRow(linkEl) {
  const tr = linkEl.closest('tr');
  const id = tr.dataset.id;
  const date = tr.dataset.date;
  const amount = tr.dataset.amount;
  const note = tr.dataset.note;

  tr.innerHTML = `
    <td><input type="date" class="hr-input" id="adjedit_date_${id}" value="${date}" style="width:130px;"></td>
    <td class="num"><input type="number" class="hr-input" id="adjedit_amount_${id}" value="${amount}" style="width:110px; text-align:right;"></td>
    <td><input type="text" class="hr-input" id="adjedit_note_${id}" value="${esc(note)}"></td>
    <td>
      <a class="hr-edit-link" onclick="saveAdjustEdit('${id}')">저장</a>
      <a class="hr-edit-link" style="margin-left:8px;" onclick="loadAdjustHistory(currentAdjustEmployeeId)">취소</a>
    </td>
  `;
}

async function saveAdjustEdit(id) {
  const date = $(`adjedit_date_${id}`).value;
  const amount = Number($(`adjedit_amount_${id}`).value);
  const note = $(`adjedit_note_${id}`).value.trim() || null;
  if (!date || !amount) {
    alert('적용일과 금액은 필수입니다.');
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?id=${id}&type=adjustment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ effective_date: date, adjustment_amount: amount, note }),
    });
    if (!res.ok) throw new Error('update failed');
    loadAdjustHistory(currentAdjustEmployeeId);
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
  }
}

/* ── 연도/월 마감 공통 ── */
async function lockPeriod(apiPath, periodKey, locked) {
  try {
    const res = await fetch(`${apiBase()}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'lock', period_key: periodKey, locked }),
    });
    if (!res.ok) throw new Error('lock failed');
    return true;
  } catch (e) {
    alert('마감 처리 중 오류가 발생했습니다.');
    return false;
  }
}

async function fetchLocks(apiPath) {
  try {
    const res = await fetch(`${apiBase()}${apiPath}?locks=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    return data.locks || [];
  } catch (e) {
    return [];
  }
}

/* ── 퇴직연금 연도 마감 ── */
async function lockPensionYear(locked) {
  const year = $('pensionLockYear').value;
  if (!year) return;
  if (!confirm(`${year}년 퇴직연금 자료를 ${locked ? '마감' : '마감해제'} 하시겠습니까?`)) return;
  const ok = await lockPeriod('/api/hr_pension', year, locked);
  if (ok) refreshPensionLockStatus();
}

async function refreshPensionLockStatus() {
  const year = $('pensionLockYear').value;
  const locks = await fetchLocks('/api/hr_pension');
  const current = locks.find(l => l.period_key === year);
  const locked = current && current.locked;
  $('pensionLockStatus').textContent = locked ? `🔒 ${year}년 마감됨` : `${year}년 마감 전`;
  $('pensionLockBtn').style.display = locked ? 'none' : 'inline-flex';
  $('pensionUnlockBtn').style.display = locked ? 'inline-flex' : 'none';
}

/* ── 급여 월 마감 ── */
async function lockPayrollMonth(locked) {
  const ym = $('payrollMonth').value;
  if (!ym) { alert('먼저 월을 선택해주세요.'); return; }
  if (!confirm(`${ym} 급여 자료를 ${locked ? '마감' : '마감해제'} 하시겠습니까?`)) return;
  const ok = await lockPeriod('/api/hr_payroll', ym, locked);
  if (ok) refreshPayrollLockStatus();
}

async function refreshPayrollLockStatus() {
  const ym = $('payrollMonth').value;
  const locks = await fetchLocks('/api/hr_payroll');
  const current = locks.find(l => l.period_key === ym);
  const isLocked = !!(current && current.locked);
  $('payrollLockStatus').textContent = isLocked ? `🔒 ${ym} 마감됨` : `${ym} 마감 전`;
  $('lockBtn').style.display = isLocked ? 'none' : '';
  $('unlockBtn').style.display = isLocked ? '' : 'none';
}

/* ── 성과급/기타지급 연도 마감 ── */
async function lockOtherPayYear(locked) {
  const year = $('otherpayYear').value;
  if (!year) return;
  if (!confirm(`${year}년 성과급/기타지급 자료를 ${locked ? '마감' : '마감해제'} 하시겠습니까?`)) return;
  const ok = await lockPeriod('/api/hr_other_payments', year, locked);
  if (ok) refreshOtherPayLockStatus();
}

async function refreshOtherPayLockStatus() {
  const year = $('otherpayYear').value;
  const locks = await fetchLocks('/api/hr_other_payments');
  const current = locks.find(l => l.period_key === year);
  const locked = current && current.locked;
  $('otherpayLockStatus').textContent = locked ? `🔒 ${year}년 마감됨` : `${year}년 마감 전`;
  $('otherpayLockBtn').style.display = locked ? 'none' : 'inline-flex';
  $('otherpayUnlockBtn').style.display = locked ? 'inline-flex' : 'none';
}

/* ── 성과급/기타지급 ── */
async function populateOtherPayEmployeeSelect() {
  const sel = $('op_employee_id');
  if (sel.dataset.loaded === '1') return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?all=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    sel.innerHTML = (data.employees || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    sel.dataset.loaded = '1';
  } catch (e) {
    sel.innerHTML = '<option value="">불러오기 실패</option>';
  }
}

async function loadOtherPayments() {
  const year = $('otherpayYear').value;
  const tbody = $('otherpayTbody');
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments?year=${year}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.payments || [];
    otherPaymentsCache = list;
    $('otherpayCount').textContent = `총 ${list.length}건`;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">${year}년 지급 내역이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = list.map(p => {
        const fy = p.fiscal_year || (p.payment_date || '').slice(0, 4);
        const fyDiffers = String(fy) !== (p.payment_date || '').slice(0, 4);
        return `
        <tr>
          <td>${esc(p.employees?.name || '-')}</td>
          <td>${esc(p.employees?.branch || '-')}</td>
          <td>${esc(p.employees?.department || '-')}</td>
          <td>${esc(p.payment_type)}</td>
          <td>${esc((p.payment_date || '').slice(0,7))}</td>
          <td${fyDiffers ? ' style="color:var(--red); font-weight:600;"' : ''}>${esc(String(fy))}${fyDiffers ? ' ⚠' : ''}</td>
          <td class="num">${fmt(p.amount)}</td>
          <td>${esc(p.note || '-')}</td>
          <td>
            <a class="hr-edit-link" onclick="openOtherPayModal('${p.id}')">수정</a>
            <a class="hr-edit-link" style="margin-left:6px;" onclick="deleteOtherPayment('${p.id}')">삭제</a>
          </td>
        </tr>
      `;
      }).join('');
      const total = list.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      tbody.innerHTML += `
        <tr class="hr-total-row">
          <td colspan="6">합계 (${list.length}건)</td>
          <td class="num">${fmt(total)}</td>
          <td colspan="2"></td>
        </tr>
      `;

      // 지사별 합계 (전체 합계 아래에 별도 섹션으로)
      const byBranch = {};
      const branchOrder = [];
      list.forEach(p => {
        const b = p.employees?.branch || '(미지정)';
        if (!byBranch[b]) { byBranch[b] = []; branchOrder.push(b); }
        byBranch[b].push(p);
      });
      tbody.innerHTML += `
        <tr><td colspan="9" style="padding:14px 4px 6px; font-size:12px; color:var(--text-muted); font-weight:500;">지사별 합계</td></tr>
      `;
      branchOrder.forEach(b => {
        const arr = byBranch[b];
        const branchTotal = arr.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        tbody.innerHTML += `
          <tr class="hr-total-row">
            <td colspan="6">${esc(b)} (${arr.length}건)</td>
            <td class="num">${fmt(branchTotal)}</td>
            <td colspan="2"></td>
          </tr>
        `;
      });
    }
    refreshOtherPayLockStatus();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

let otherPaymentsCache = [];
let editingOtherPayId = null;

function openOtherPayModal(id) {
  editingOtherPayId = id || null;
  const existing = id ? otherPaymentsCache.find(p => p.id === id) : null;
  $('otherPayModalTitle').textContent = existing ? '성과급/기타지급 수정' : '성과급/기타지급 추가';
  $('op_employee_id').value = existing ? existing.employee_id : '';
  $('op_payment_type').value = existing ? existing.payment_type : '성과급1차';
  $('op_date').value = existing ? (existing.payment_date || '').slice(0, 7) : '';
  $('op_amount').value = existing ? existing.amount : '';
  $('op_note').value = existing ? (existing.note || '') : '';
  $('op_fiscal_year').value = existing ? (existing.fiscal_year || (existing.payment_date || '').slice(0, 4)) : '';
  $('otherPayMsg').textContent = '';
  $('otherPayModal').style.display = 'flex';
}
function closeOtherPayModal() {
  $('otherPayModal').style.display = 'none';
}

/* 지급월/지급유형을 고르면, "성과급2차 + 1~2월"인 경우만 전년도로 자동 채움
   (그 외엔 지급월과 같은 해). 사용자가 직접 고친 값은 안 건드림 — 지급월/유형을
   바꿀 때마다 다시 계산해서 채워주는 정도로만 도와줌. */
function autofillOtherPayFiscalYear() {
  const dateVal = $('op_date').value;
  if (!dateVal) return;
  const [y, m] = dateVal.split('-').map(Number);
  const type = $('op_payment_type').value;
  const fy = (type === '성과급2차' && (m === 1 || m === 2)) ? y - 1 : y;
  $('op_fiscal_year').value = fy;
}

async function saveOtherPayment() {
  const payload = {
    employee_id: $('op_employee_id').value,
    payment_type: $('op_payment_type').value,
    payment_date: $('op_date').value ? `${$('op_date').value}-01` : '',
    amount: Number($('op_amount').value),
    note: $('op_note').value.trim() || null,
    fiscal_year: $('op_fiscal_year').value ? Number($('op_fiscal_year').value) : null,
  };
  if (!payload.employee_id || !payload.payment_date || !payload.amount) {
    $('otherPayMsg').textContent = '직원, 지급월, 금액은 필수입니다.';
    return;
  }
  try {
    const url = editingOtherPayId
      ? `${apiBase()}/api/hr_other_payments?id=${editingOtherPayId}`
      : `${apiBase()}/api/hr_other_payments`;
    const res = await fetch(url, {
      method: editingOtherPayId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    closeOtherPayModal();
    loadOtherPayments();
  } catch (e) {
    $('otherPayMsg').textContent = e.message.includes('마감') ? e.message : '저장 중 오류가 발생했습니다.';
  }
}

async function deleteOtherPayment(id) {
  if (!confirm('이 지급 내역을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments?id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'delete failed');
    loadOtherPayments();
  } catch (e) {
    alert(e.message.includes('마감') ? e.message : '삭제 중 오류가 발생했습니다.');
  }
}

function downloadOtherPaymentsExcel() {
  const rows = [['이름', '지사', '부서', '지급유형', '지급월', '금액', '비고']];
  document.querySelectorAll('#otherpayTbody tr:not(.hr-total-row)').forEach(tr => {
    const cells = Array.from(tr.children).slice(0, 7).map(td => td.textContent.trim());
    if (cells.length === 7) rows.push(cells);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const year = $('otherpayYear').value;
  XLSX.utils.book_append_sheet(wb, ws, `${year}년`);
  XLSX.writeFile(wb, `성과급기타지급_${year}.xlsx`);
}

/* ── 성과급/기타지급 일괄 입력 ── */
async function loadBulkOtherPayList() {
  const opType = $('bulkOpType').value;
  $('bulkOpWrap').style.display = 'block';
  $('bulkOpWrap2').style.display = 'block';
  $('bulkOpTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;

  if (opType === '연차수당') {
    const year = $('bulkLeaveYear').value;
    if (!year) { alert('귀속연도를 선택해주세요.'); return; }
    return loadBulkLeavePayList(year);
  }

  const month = $('bulkOpDate').value;
  if (!month) { alert('먼저 지급월을 선택해주세요.'); return; }
  $('bulkOpLeaveNote').style.display = 'none';
  $('bulkOpThead').innerHTML = `<tr><th>이름</th><th>지사</th><th>부서</th><th class="num">지급 금액</th></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.employees || [];
    $('bulkOpTbody').innerHTML = list.map(e => `
      <tr data-emp-id="${e.id}">
        <td>${esc(e.name)}</td>
        <td>${esc(e.branch || '-')}</td>
        <td>${esc(e.department || '-')}</td>
        <td class="num"><input type="number" class="hr-input bulk-op-amount" style="width:130px; text-align:right;" placeholder="0"></td>
      </tr>
    `).join('');
  } catch (e) {
    $('bulkOpTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function toggleBulkLeaveAsOfField() {
  const isLeave = $('bulkOpType').value === '연차수당';
  $('bulkOpDateWrap').style.display = isLeave ? 'none' : 'flex';
  $('bulkLeaveAsOfWrap').style.display = isLeave ? 'flex' : 'none';
  if (isLeave) {
    const sel = $('bulkLeaveYear');
    if (!sel.dataset.loaded) {
      const thisYear = new Date().getFullYear();
      let opts = '';
      for (let y = thisYear; y >= thisYear - 4; y--) opts += `<option value="${y}">${y}년</option>`;
      sel.innerHTML = opts;
      sel.dataset.loaded = '1';
    }
  }
}

async function loadBulkLeavePayList(year) {
  const asOf = `${year}-12-31`;
  $('bulkOpLeaveNote').style.display = 'block';
  $('bulkOpThead').innerHTML = `<tr><th>이름</th><th>지사</th><th>부서</th><th class="num">잔여일수</th><th class="num">지급 금액(자동계산)</th></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/annual_leave_calc?asof=${asOf}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.employees || [];
    if (list.length === 0) {
      $('bulkOpTbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">${asOf} 기준으로 연봉 정보가 있는 재직자가 없습니다.</td></tr>`;
      return;
    }
    $('bulkOpTbody').innerHTML = list.map(e => `
      <tr data-emp-id="${e.employee_id}" data-daily-wage="${e.daily_wage}">
        <td>${esc(e.name)}${e.adjusted_month ? ' <span style="font-size:10px; color:var(--accent);" title="이 달은 급여조정(육아기단축 등)이 있어 조정 전 정상금액 기준으로 계산했습니다">*조정보정</span>' : ''}</td>
        <td>${esc(e.branch || '-')}</td>
        <td>${esc(e.department || '-')}</td>
        <td class="num"><input type="number" step="0.5" class="hr-input bulk-leave-days" style="width:90px; text-align:right;" placeholder="0" oninput="recalcLeavePayAmount(this)"></td>
        <td class="num"><input type="number" class="hr-input bulk-op-amount" style="width:130px; text-align:right;" placeholder="0"></td>
      </tr>
    `).join('');
  } catch (e) {
    $('bulkOpTbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function recalcLeavePayAmount(inputEl) {
  const tr = inputEl.closest('tr');
  const dailyWage = Number(tr.dataset.dailyWage) || 0;
  const days = Number(inputEl.value) || 0;
  const raw = days * dailyWage;
  const rounded = Math.ceil(raw / 1000) * 1000; // 백원단위 올림 → 끝자리 ,000
  const amountInput = tr.querySelector('.bulk-op-amount');
  amountInput.value = rounded || '';
}

async function saveBulkOtherPayments() {
  const paymentType = $('bulkOpType').value;
  let date;
  if (paymentType === '연차수당') {
    const year = $('bulkLeaveYear').value;
    if (!year) { alert('귀속연도를 선택해주세요.'); return; }
    date = `${year}-12-01`;
  } else {
    const month = $('bulkOpDate').value;
    if (!month) { alert('지급월을 선택해주세요.'); return; }
    date = `${month}-01`;
  }

  const items = [];
  document.querySelectorAll('#bulkOpTbody tr').forEach(tr => {
    const empId = tr.dataset.empId;
    const input = tr.querySelector('.bulk-op-amount');
    const amount = Number(input?.value || 0);
    if (empId && amount > 0) {
      items.push({ employee_id: empId, payment_type: paymentType, payment_date: date, amount });
    }
  });
  if (items.length === 0) {
    $('otherPayBulkMsg').textContent = '입력된 금액이 없습니다.';
    return;
  }
  if (!confirm(`${items.length}명에게 "${paymentType}" ${fmt(items.reduce((s,i)=>s+i.amount,0))}원을 ${date.slice(0,7)}월로 저장하시겠습니까?`)) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    $('otherPayBulkMsg').className = 'hr-msg success';
    $('otherPayBulkMsg').textContent = `${data.count}건 저장되었습니다.`;
    $('bulkOpWrap').style.display = 'none';
    $('bulkOpWrap2').style.display = 'none';
    loadOtherPayments();
  } catch (e) {
    $('otherPayBulkMsg').className = 'hr-msg';
    $('otherPayBulkMsg').textContent = e.message.includes('마감') ? e.message : '저장 중 오류가 발생했습니다.';
  }
}

/* ── 연봉 소급 정산 ── */
async function loadRetroPreview() {
  const from = $('retroFrom').value; // "2026-01"
  const to = $('retroTo').value;
  if (!from || !to) { alert('소급 적용 구간을 먼저 선택해주세요.'); return; }
  const fromDate = `${from}-01`;
  const toDate = `${to}-01`;

  $('retroWrap').style.display = 'block';
  $('retroTbody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:16px;">계산 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?retro_preview=1&from_month=${fromDate}&to_month=${toDate}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'calc failed');
    const flat = data.employees || [];

    // 직원별로 묶기 (화면은 한 줄, 저장용 월별 내역은 데이터로 보관)
    const byEmp = {};
    const empOrder = [];
    flat.forEach(e => {
      if (!byEmp[e.id]) { byEmp[e.id] = { ...e, months: [] }; empOrder.push(e.id); }
      byEmp[e.id].months.push({ source_month: e.source_month, amount: e.retroactive_diff });
    });

    if (empOrder.length === 0) {
      $('retroTbody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:16px;">이 구간에 남은 차액이 있는 직원이 없습니다. (이미 소급 지급되었거나, 연봉 변경이 없는 경우입니다)</td></tr>`;
    } else {
      $('retroTbody').innerHTML = empOrder.map(id => {
        const e = byEmp[id];
        const total = e.months.reduce((s, m) => s + (Number(m.amount) || 0), 0);
        const monthsLabel = e.months.length > 1
          ? `${e.months[e.months.length - 1].source_month.slice(0,7)}~${e.months[0].source_month.slice(0,7)} (${e.months.length}개월)`
          : e.months[0].source_month.slice(0,7);
        return `
        <tr data-emp-id="${e.id}" data-months='${JSON.stringify(e.months)}'>
          <td><input type="checkbox" class="retro-select" checked></td>
          <td>${esc(e.name)}</td>
          <td>${esc(e.branch || '-')}</td>
          <td>${esc(e.department || '-')}</td>
          <td>${esc(monthsLabel)}</td>
          <td class="num"><input type="number" class="hr-input retro-amount" style="width:140px; text-align:right;" value="${total}"></td>
          <td><a class="hr-edit-link" onclick="toggleRetroDetail(this)">월별 보기</a></td>
        </tr>
        <tr class="retro-detail-row" data-for-emp="${e.id}" style="display:none;">
          <td colspan="7" style="background:var(--bg); padding:10px 16px;">
            ${e.months.slice().reverse().map(m => `<div style="display:flex; justify-content:space-between; max-width:280px; font-size:12px; color:var(--text-secondary); padding:2px 0;"><span>${m.source_month.slice(0,7)}</span><span>${fmt(m.amount)}원</span></div>`).join('')}
          </td>
        </tr>
      `;
      }).join('');
      const grandTotal = empOrder.reduce((s, id) => s + byEmp[id].months.reduce((s2,m)=>s2+(Number(m.amount)||0),0), 0);
      $('retroTbody').innerHTML += `
        <tr class="hr-total-row">
          <td colspan="5">합계 (${empOrder.length}명)</td>
          <td class="num">${fmt(grandTotal)}</td>
          <td></td>
        </tr>
      `;
    }
    $('retroSaveWrap').style.display = 'flex';
  } catch (e) {
    $('retroTbody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--red); padding:16px;">계산 실패</td></tr>`;
  }
}

function toggleAllRetroSelect(headerCheckbox) {
  document.querySelectorAll('#retroTbody .retro-select').forEach(cb => {
    cb.checked = headerCheckbox.checked;
  });
}

function toggleRetroDetail(linkEl) {
  const tr = linkEl.closest('tr');
  const empId = tr.dataset.empId;
  const detailRow = document.querySelector(`.retro-detail-row[data-for-emp="${empId}"]`);
  if (detailRow) {
    detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
  }
}

async function saveRetroAdjustments() {
  const targetMonth = $('retroTargetMonth').value;
  if (!targetMonth) { alert('적용할 급여명세월을 선택해주세요.'); return; }
  const targetMonthDate = `${targetMonth}-01`;

  const items = [];
  document.querySelectorAll('#retroTbody tr[data-emp-id]').forEach(tr => {
    const checkbox = tr.querySelector('.retro-select');
    if (checkbox && !checkbox.checked) return; // 체크 해제된 직원은 제외
    const empId = tr.dataset.empId;
    const months = JSON.parse(tr.dataset.months || '[]');
    const input = tr.querySelector('.retro-amount');
    const editedTotal = Number(input?.value || 0);
    const originalTotal = months.reduce((s, m) => s + (Number(m.amount) || 0), 0);
    if (!empId || editedTotal === 0 || months.length === 0) return;

    if (originalTotal !== 0 && editedTotal !== originalTotal) {
      // 사용자가 합계를 직접 고친 경우: 월별 비중대로 재분배
      const ratio = editedTotal / originalTotal;
      months.forEach(m => {
        items.push({ employee_id: empId, source_month: m.source_month, amount: Math.round(m.amount * ratio) });
      });
    } else {
      months.forEach(m => {
        items.push({ employee_id: empId, source_month: m.source_month, amount: m.amount });
      });
    }
  });
  if (items.length === 0) {
    $('retroMsg').textContent = '적용할 금액이 없습니다.';
    return;
  }
  const uniqueEmployees = new Set(items.map(i => i.employee_id)).size;
  if (!confirm(`${uniqueEmployees}명, 총 ${fmt(items.reduce((s,i)=>s+i.amount,0))}원을 ${targetMonth} 급여명세에 소급인상분으로 반영하시겠습니까?`)) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'retroactive', target_month: targetMonthDate, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    $('retroMsg').className = 'hr-msg success';
    $('retroMsg').textContent = `${data.count}명 반영 완료. "월별 급여명세"에서 ${targetMonth} 저장된 자료를 확인해보세요.`;
    $('retroWrap').style.display = 'none';
    $('retroSaveWrap').style.display = 'none';
    loadRetroLog();
  } catch (e) {
    $('retroMsg').className = 'hr-msg';
    $('retroMsg').textContent = e.message.includes('마감') ? e.message : '저장 중 오류가 발생했습니다.';
  }
}

async function loadRetroLog() {
  const tbody = $('retroLogTbody');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?retro_log=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.logs || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:16px;">소급 지급 기록이 없습니다.</td></tr>`;
      return;
    }

    // 직원별로 묶어서 요약 줄 + (펼치면) 개별 줄
    const byEmp = {};
    const empOrder = [];
    list.forEach(l => {
      const empId = l.employee_id;
      if (!byEmp[empId]) { byEmp[empId] = { name: l.employees?.name, branch: l.employees?.branch, entries: [] }; empOrder.push(empId); }
      byEmp[empId].entries.push(l);
    });

    tbody.innerHTML = empOrder.map(empId => {
      const g = byEmp[empId];
      const total = g.entries.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const monthsRange = g.entries.length > 1
        ? `${g.entries.length}건`
        : `${(g.entries[0].source_month || '').slice(0,7)}`;
      const detailRows = g.entries.map(l => `
        <tr class="retro-log-detail-row" data-for-emp="${empId}" style="display:none;">
          <td style="padding-left:24px; color:var(--text-muted);">└ ${esc((l.source_month || '').slice(0,7))}</td>
          <td></td>
          <td>${esc((l.source_month || '').slice(0,7))}</td>
          <td class="num">${fmt(l.amount)}</td>
          <td>${esc((l.target_month || '').slice(0,7))}</td>
          <td>${esc((l.created_at || '').slice(0,10))}</td>
          <td><a class="hr-edit-link" onclick="revertRetroLog('${l.id}')">되돌리기</a></td>
        </tr>
      `).join('');
      const targetMonths = [...new Set(g.entries.map(l => (l.target_month || '').slice(0,7)))];
      const targetMonthLabel = targetMonths.length === 1 ? targetMonths[0] : `${targetMonths.length}개월 분산`;
      const latestDate = g.entries.reduce((max, l) => (l.created_at > max ? l.created_at : max), g.entries[0].created_at || '');
      return `
        <tr data-emp-summary="${empId}">
          <td>${esc(g.name || '-')}</td>
          <td>${esc(g.branch || '-')}</td>
          <td>${esc(monthsRange)}</td>
          <td class="num">${fmt(total)}</td>
          <td>${esc(targetMonthLabel)}</td>
          <td>${esc((latestDate || '').slice(0,10))}</td>
          <td>
            <a class="hr-edit-link" onclick="toggleRetroLogDetail('${empId}')">${g.entries.length > 1 ? '월별 보기' : ''}</a>
            <a class="hr-edit-link" style="margin-left:8px;" onclick="revertEmployeeRetroLog('${empId}', '${esc(g.name || '')}')">직원별 되돌리기</a>
          </td>
        </tr>
        ${detailRows}
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function toggleRetroLogDetail(empId) {
  document.querySelectorAll(`.retro-log-detail-row[data-for-emp="${empId}"]`).forEach(tr => {
    tr.style.display = tr.style.display === 'none' ? 'table-row' : 'none';
  });
}

async function revertRetroLog(logId) {
  if (!confirm('이 소급 지급 기록을 되돌리시겠습니까? 해당 급여명세월의 소급인상분에서 이 금액만큼 차감됩니다.')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?retro_log_id=${logId}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'revert failed');
    loadRetroLog();
  } catch (e) {
    alert(e.message.includes('마감') ? e.message : '되돌리는 중 오류가 발생했습니다.');
  }
}

async function revertEmployeeRetroLog(empId, name) {
  if (!confirm(`${name}님의 소급 지급 기록을 전부 되돌리시겠습니까? (마감된 달은 제외되고 나머지만 처리됩니다)`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?revert_employee_id=${empId}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'revert failed');
    let msg = `${data.reverted}건 되돌렸습니다.`;
    if (data.skipped && data.skipped.length > 0) msg += ` (마감된 ${data.skipped.length}건은 건너뜀: ${data.skipped.join(', ')})`;
    alert(msg);
    loadRetroLog();
  } catch (e) {
    alert('되돌리는 중 오류가 발생했습니다.');
  }
}

async function revertAllRetroLog() {
  if (!confirm('모든 직원의 소급 지급 기록을 전부 되돌리시겠습니까? (마감된 달은 제외되고 나머지만 처리됩니다)')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?revert_all=1`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'revert failed');
    let msg = `${data.reverted}건 되돌렸습니다.`;
    if (data.skipped && data.skipped.length > 0) msg += ` (마감된 ${data.skipped.length}건은 건너뜀)`;
    alert(msg);
    loadRetroLog();
  } catch (e) {
    alert('되돌리는 중 오류가 발생했습니다.');
  }
}

/* ── 직원 모달 안 연봉 이력 관리 ── */
async function loadSalaryHistoryInModal(employeeId) {
  $('salaryHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?salary_history=1&employee_id=${employeeId}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.salary_history || [];
    if (list.length === 0) {
      $('salaryHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px;">이력이 없습니다.</td></tr>`;
      return;
    }
    $('salaryHistoryTbody').innerHTML = list.map(s => `
      <tr data-id="${s.id}" data-month="${s.effective_month}" data-salary="${s.annual_salary_thousand}" data-reason="${esc(s.reason || '')}">
        <td class="hview">${esc(s.effective_month)}</td>
        <td class="num hview">${fmt(s.annual_salary_thousand)}</td>
        <td class="hview">${esc(s.reason || '-')}</td>
        <td class="hview">
          <a class="hr-edit-link" onclick="editSalaryHistoryRow(this)">수정</a>
          <a class="hr-edit-link" style="margin-left:8px;" onclick="deleteSalaryHistoryRow('${s.id}', '${employeeId}')">삭제</a>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    $('salaryHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--red); padding:12px;">불러오기 실패</td></tr>`;
  }
}

function editSalaryHistoryRow(linkEl) {
  const tr = linkEl.closest('tr');
  const id = tr.dataset.id;
  const month = tr.dataset.month;
  const salary = tr.dataset.salary;
  const reason = tr.dataset.reason;
  tr.innerHTML = `
    <td><input type="date" class="hr-input" id="sh_month_${id}" value="${month}" style="width:130px;"></td>
    <td class="num"><input type="number" class="hr-input" id="sh_salary_${id}" value="${salary}" style="width:100px; text-align:right;"></td>
    <td><input type="text" class="hr-input" id="sh_reason_${id}" value="${esc(reason)}"></td>
    <td>
      <a class="hr-edit-link" onclick="saveSalaryHistoryEdit('${id}')">저장</a>
      <a class="hr-edit-link" style="margin-left:8px;" onclick="loadSalaryHistoryInModal(editingId)">취소</a>
    </td>
  `;
}

async function saveSalaryHistoryEdit(id) {
  const month = $(`sh_month_${id}`).value;
  const salary = Number($(`sh_salary_${id}`).value);
  const reason = $(`sh_reason_${id}`).value.trim() || null;
  if (!month || !salary) {
    alert('적용 시작월과 연봉은 필수입니다.');
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?salary_history_id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ effective_month: month, annual_salary_thousand: salary, reason }),
    });
    if (!res.ok) throw new Error('update failed');
    loadSalaryHistoryInModal(editingId);
    loadEmployees();
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
  }
}

async function deleteSalaryHistoryRow(id, employeeId) {
  if (!confirm('이 연봉 이력을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?salary_history_id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    loadSalaryHistoryInModal(employeeId);
    loadEmployees();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 일괄 연봉 인상 ── */
async function loadBulkSalaryList() {
  const month = $('bulkSalaryMonth').value;
  if (!month) { alert('먼저 적용 시작월을 선택해주세요.'); return; }
  $('bulkSalaryWrap').style.display = 'block';
  $('bulkSalarySaveWrap').style.display = 'block';
  $('bulkSalaryTbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.employees || [];
    $('bulkSalaryTbody').innerHTML = list.map(e => `
      <tr data-emp-id="${e.id}">
        <td>${esc(e.name)}</td>
        <td>${esc(e.branch || '-')}</td>
        <td>${esc(e.department || '-')}</td>
        <td class="num">${fmt(e.current_salary_thousand)}</td>
        <td class="num"><input type="number" class="hr-input bulk-salary-amount" style="width:130px; text-align:right;" placeholder="변경 없으면 비워두세요"></td>
      </tr>
    `).join('');
  } catch (e) {
    $('bulkSalaryTbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

async function saveBulkSalary() {
  const month = $('bulkSalaryMonth').value;
  if (!month) { alert('적용 시작월을 선택해주세요.'); return; }
  const effectiveMonth = `${month}-01`;
  const reason = $('bulkSalaryReason').value.trim() || '일괄 연봉 인상';

  const items = [];
  document.querySelectorAll('#bulkSalaryTbody tr').forEach(tr => {
    const empId = tr.dataset.empId;
    const input = tr.querySelector('.bulk-salary-amount');
    const amount = Number(input?.value || 0);
    if (empId && amount > 0) {
      items.push({ employee_id: empId, effective_month: effectiveMonth, annual_salary_thousand: amount, reason });
    }
  });
  if (items.length === 0) {
    $('bulkSalaryMsg').textContent = '입력된 인원이 없습니다.';
    return;
  }
  if (!confirm(`${items.length}명의 연봉을 ${month}부터 새 금액으로 반영하시겠습니까?`)) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'bulk_salary', items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    $('bulkSalaryMsg').className = 'hr-msg success';
    $('bulkSalaryMsg').textContent = `${data.count}명 반영되었습니다.`;
    $('bulkSalaryWrap').style.display = 'none';
    $('bulkSalarySaveWrap').style.display = 'none';
    loadEmployees();
  } catch (e) {
    $('bulkSalaryMsg').className = 'hr-msg';
    $('bulkSalaryMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

function togglePrContractEnd() {
  const type = $('pr_employment_type').value;
  $('prContractEndWrap').style.display = type === '계약직' ? 'block' : 'none';
}

async function loadSettingsHistoryInModal(employeeId) {
  $('settingsHistoryTbody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:12px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?settings_history=1&employee_id=${employeeId}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.settings_history || [];
    if (list.length === 0) {
      $('settingsHistoryTbody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:12px;">이력이 없습니다.</td></tr>`;
      return;
    }
    $('settingsHistoryTbody').innerHTML = list.map(s => `
      <tr>
        <td>${esc(s.effective_month)}</td>
        <td class="num">${s.pay_rate != null ? Math.round(s.pay_rate * 100) + '%' : '-'}</td>
        <td>${esc(s.employment_type || '-')}</td>
        <td>${esc(s.contract_end_date || '-')}</td>
        <td>${s.fixed_monthly_amount ? fmt(s.fixed_monthly_amount) + '원(정액)' : '-'}${s.proration_mode === 'current_month' ? ' / 당월반영' : s.proration_mode === 'next_month' ? ' / 익월반영' : ''}</td>
        <td>${esc(s.note || '-')}</td>
        <td><a class="hr-edit-link" onclick="deleteSettingsHistoryRow('${s.id}', '${employeeId}')">삭제</a></td>
      </tr>
    `).join('');
  } catch (e) {
    $('settingsHistoryTbody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--red); padding:12px;">불러오기 실패</td></tr>`;
  }
}

async function deleteSettingsHistoryRow(id, employeeId) {
  if (!confirm('이 급여 요율 이력을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?settings_id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    loadSettingsHistoryInModal(employeeId);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

async function savePayRate() {
  const empId = editingId;
  const dateVal = $('pr_month').value;
  const rate = Number($('pr_rate').value);
  const employmentType = $('pr_employment_type').value;
  const contractEnd = $('pr_contract_end').value;
  if (!empId || !dateVal || !rate) {
    $('payRateMsg').textContent = '적용 시작일, 요율은 필수입니다.';
    return;
  }
  const payload = {
    type: 'pay_rate',
    employee_id: empId,
    effective_month: dateVal,
    pay_rate: rate / 100,
  };
  if (employmentType) payload.employment_type = employmentType;
  if (employmentType === '계약직' && contractEnd) payload.contract_end_date = contractEnd;
  const fixedAmount = $('pr_fixed_amount').value;
  payload.fixed_monthly_amount = fixedAmount ? Number(fixedAmount) : null;
  payload.proration_mode = $('pr_proration_mode').value;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    $('payRateMsg').className = 'hr-msg success';
    $('payRateMsg').textContent = `적용되었습니다 (${rate}%, ${dateVal}부터).`;
    $('pr_month').value = '';
    $('pr_rate').value = '';
    $('pr_employment_type').value = '';
    $('pr_contract_end').value = '';
    $('pr_fixed_amount').value = '';
    $('pr_proration_mode').value = 'daily';
    togglePrContractEnd();
    loadSettingsHistoryInModal(empId);
    loadEmployees();
  } catch (e) {
    $('payRateMsg').className = 'hr-msg';
    $('payRateMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

/* ── 재직자 조정(육아휴직 등) 관리 ── */
function toggleLeaveAdjustFields() {
  const type = $('la_reason_type').value;
  const isReduced = type === '육아기근로시간단축';
  $('leaveAdjustHoursFields').style.display = isReduced ? 'grid' : 'none';
  $('leaveAdjustNoteOnly').style.display = isReduced ? 'none' : 'grid';
}

async function populateLeaveAdjustEmployeeSelect() {
  await populateEmployeeSelectById('la_employee_id');
}

async function populateEmployeeSelectById(elId) {
  const sel = $(elId);
  if (!sel || sel.dataset.loaded === '1') return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    sel.innerHTML = (data.employees || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    sel.dataset.loaded = '1';
  } catch (e) {
    sel.innerHTML = '<option value="">불러오기 실패</option>';
  }
}

let leaveAdjustCache = [];
let showPastLeaveAdjustments = false;

async function loadLeaveAdjustments() {
  const tbody = $('leaveAdjustTbody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?leave_adjustments=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    leaveAdjustCache = data.adjustments || [];
    renderLeaveAdjustments();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function renderLeaveAdjustments() {
  const tbody = $('leaveAdjustTbody');
  const today = new Date().toISOString().slice(0, 10);
  const list = showPastLeaveAdjustments
    ? leaveAdjustCache
    : leaveAdjustCache.filter(a => !a.end_date || a.end_date >= today);

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">${showPastLeaveAdjustments ? '등록된 조정 내역이 없습니다.' : '진행중/예정인 조정 내역이 없습니다. (지난 내역은 "지난 내역 보기"로 확인 가능)'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(a => `
    <tr>
      <td>${esc(a.employees?.name || '-')}</td>
      <td>${esc(a.employees?.branch || '-')}</td>
      <td>${esc(a.reason_type)}</td>
      <td>${esc(a.start_date)} ~ ${esc(a.end_date)}</td>
      <td>${esc(a.note || '-')}</td>
      <td><a class="hr-edit-link" onclick="deleteLeaveAdjustment('${a.id}')">삭제</a></td>
    </tr>
  `).join('');
}

function togglePastLeaveAdjustments() {
  showPastLeaveAdjustments = !showPastLeaveAdjustments;
  $('pastAdjustToggleBtn').textContent = showPastLeaveAdjustments ? '지난 내역 숨기기' : '지난 내역 보기';
  renderLeaveAdjustments();
}

async function saveLeaveAdjustment() {
  const type = $('la_reason_type').value;
  const payload = {
    type: 'leave_adjustment',
    employee_id: $('la_employee_id').value,
    reason_type: type,
    start_date: $('la_start').value,
    end_date: $('la_end').value,
    note: type === '육아기근로시간단축' ? $('la_note').value.trim() || null : $('la_note2').value.trim() || null,
  };
  if (type === '육아기근로시간단축') {
    payload.standard_hours = Number($('la_standard_hours').value || 0) || null;
    payload.reduced_hours = Number($('la_reduced_hours').value || 0) || null;
    if (!payload.standard_hours || !payload.reduced_hours) {
      $('leaveAdjustMsg').textContent = '육아기근로시간단축은 통상/단축후 소정근로시간이 필요합니다.';
      return;
    }
  }
  if (!payload.employee_id || !payload.start_date || !payload.end_date) {
    $('leaveAdjustMsg').textContent = '직원, 시작일, 종료일은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    $('leaveAdjustMsg').className = 'hr-msg success';
    $('leaveAdjustMsg').textContent = '저장되었습니다.';
    $('la_start').value = ''; $('la_end').value = ''; $('la_note').value = ''; $('la_note2').value = '';
    $('la_standard_hours').value = ''; $('la_reduced_hours').value = '';
    loadLeaveAdjustments();
  } catch (e) {
    $('leaveAdjustMsg').className = 'hr-msg';
    $('leaveAdjustMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deleteLeaveAdjustment(id) {
  if (!confirm('이 조정 내역을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?leave_adjustment_id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    loadLeaveAdjustments();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 개인별 급여명세서 출력 ── */
function openPayslipModal(idx) {
  const p = payrollCache[idx];
  if (!p) return;
  const retro = Number(p.retroactive_adjustment) || 0;
  const hasSaved = p.retroactive_adjustment !== undefined;
  const finalTotal = (Number(p.total_pay) || 0) + (hasSaved ? retro : 0);

  $('ps_name').textContent = p.name || '-';
  $('ps_org').textContent = `${p.branch || '-'} / ${p.department || '-'} / ${p.position || '-'}`;
  $('ps_month').textContent = $('payrollMonth').value || '-';
  $('ps_base').textContent = fmt(p.base_pay) + '원';
  $('ps_ot').textContent = fmt(p.fixed_overtime_pay) + '원';
  $('ps_att').textContent = fmt(p.attendance_allowance) + '원';
  $('ps_meal').textContent = fmt(p.meal_allowance) + '원';
  $('ps_retro').textContent = hasSaved ? (retro ? (fmt(retro) + '원') : '없음') : '- (저장된 자료 아님)';
  $('ps_total').textContent = fmt(hasSaved ? finalTotal : p.total_pay) + '원';

  const empInfo = p.current_settings || (employeesCache || []).find(e => e.id === p.id);
  if (empInfo) {
    const parts = [];
    if (empInfo.current_employment_type) parts.push(`고용형태: ${empInfo.current_employment_type}`);
    if (empInfo.current_pay_rate != null) parts.push(`요율: ${Math.round(empInfo.current_pay_rate*100)}%`);
    if (empInfo.current_standard_hours != null) parts.push(`기본시간: ${fmt(empInfo.current_standard_hours)}시간`);
    if (empInfo.current_fixed_overtime_hours != null) parts.push(`고정연장시간(1.5배적용): ${fmt(empInfo.current_fixed_overtime_hours)}시간`);
    if (empInfo.current_attendance_allowance != null) parts.push(`만근수당: ${fmt(empInfo.current_attendance_allowance)}원`);
    if (empInfo.current_meal_allowance != null) parts.push(`식대: ${fmt(empInfo.current_meal_allowance)}원`);
    $('ps_conditions').textContent = parts.length > 0 ? parts.join(' · ') : '설정 정보 없음';
  } else {
    $('ps_conditions').textContent = '설정 정보 없음';
  }

  if (p.adjustment_note || p.proration_note) {
    $('ps_adjust_note_wrap').style.display = 'block';
    $('ps_adjust_note').textContent = [p.adjustment_note, p.proration_note].filter(Boolean).join(' / ');
  } else {
    $('ps_adjust_note_wrap').style.display = 'none';
  }

  if (p.calc_formula) {
    $('ps_calc_detail_wrap').style.display = 'block';
    const rows = [
      ['기본급', p.base_pay_before, p.base_pay],
      ['고정연장수당', p.fixed_overtime_pay_before, p.fixed_overtime_pay],
      ['만근수당', p.attendance_allowance_before, p.attendance_allowance],
      ['식대', p.meal_allowance_before, p.meal_allowance],
      ['합계', p.total_pay_before, p.total_pay],
    ];
    $('ps_calc_table').innerHTML = rows.map(([label, before, after]) => `
      <tr>
        <td style="padding:2px 4px;">${label}</td>
        <td style="text-align:right; padding:2px 4px; color:var(--text-muted);">${fmt(before)}</td>
        <td style="text-align:right; padding:2px 4px; font-weight:500;">${fmt(after)}</td>
      </tr>
    `).join('');
    $('ps_calc_formula').textContent = p.calc_formula;
  } else {
    $('ps_calc_detail_wrap').style.display = 'none';
  }

  // 통상시급 산정시간(급여명세서 표기용) — 조정 여부와 무관하게 항상 표시.
  // 재직자 조정이 없으면(before===after) 자동으로 209시간이 나옵니다.
  // 조정이 있으면 (기본급+식대) 비율만큼 209시간에서 환산된 시간이 나옵니다.
  {
    const beforeBase = (p.base_pay_before != null) ? Number(p.base_pay_before) : (Number(p.base_pay) || 0);
    const beforeMeal = (p.meal_allowance_before != null) ? Number(p.meal_allowance_before) : (Number(p.meal_allowance) || 0);
    const afterBase = Number(p.base_pay) || 0;
    const afterMeal = Number(p.meal_allowance) || 0;
    const beforeSum = beforeBase + beforeMeal;
    const afterSum = afterBase + afterMeal;
    const normalWageHours = beforeSum > 0 ? 209 * (afterSum / beforeSum) : 209;
    $('ps_normal_wage_hours').textContent = normalWageHours.toFixed(2) + '시간';
    const normalWageRate = normalWageHours > 0 ? afterSum / normalWageHours : 0;
    $('ps_normal_wage_rate').textContent = fmt(Math.round(normalWageRate)) + '원';
  }

  $('payslipModal').style.display = 'flex';
}

function closePayslipModal() {
  $('payslipModal').style.display = 'none';
}

function printPayslip() {
  $('registerPrintArea').style.display = 'none';
  const style = document.createElement('style');
  style.id = 'payslipPrintStyle';
  style.textContent = `
    @page { size: portrait; margin: 14mm; }
    @media print {
      #payslipPrintArea { font-size: 12px; }
      #payslipPrintArea h3 { font-size: 15px; }
      #payslipPrintArea table { font-size: 11px; }
    }
  `;
  document.head.appendChild(style);
  window.print();
  document.head.removeChild(style);
}

/* ── 불입 차수(정산지급일별) 목록 — '발생 및 불입 입력' 탭 ── */
async function loadPensionInstallmentList() {
  const wrap = $('pensionInstallmentList');
  wrap.innerHTML = `<div class="dash-empty" style="padding:12px;">불러오는 중…</div>`;
  try {
    const [listRes, lockRes] = await Promise.all([
      fetch(`${apiBase()}/api/hr_pension?installment_list=1`, { headers: { 'X-HR-Password': hrPassword() } }),
      fetch(`${apiBase()}/api/hr_pension?installment_locks=1`, { headers: { 'X-HR-Password': hrPassword() } }),
    ]);
    const data = await listRes.json();
    if (!listRes.ok) {
      wrap.innerHTML = `<div class="dash-empty" style="padding:12px; color:var(--red);">${esc(data.detail || '불러오기 실패')}</div>`;
      return;
    }
    const lockData = await lockRes.json().catch(() => ({ locks: [] }));
    const lockedDates = new Set((lockData.locks || []).filter(l => l.locked).map(l => l.period_key));

    const list = data.installments || [];
    if (list.length === 0) {
      wrap.innerHTML = `<div class="dash-empty" style="padding:12px;">아직 저장된 불입 기록이 없습니다.</div>`;
      return;
    }
    const thisYear = String(new Date().getFullYear());
    const currentYearList = list.filter(it => (it.date || '').slice(0, 4) === thisYear);
    const olderList = list.filter(it => (it.date || '').slice(0, 4) !== thisYear);

    const rowHtml = (it) => {
      const d = String(it.date).slice(0, 10);
      const locked = lockedDates.has(d);
      const lockBadge = locked
        ? `<span style="font-size:11px; color:var(--red); font-weight:600;">🔒 마감</span>`
        : `<span style="font-size:11px; color:var(--text-muted);">마감 전</span>`;
      const lockBtn = locked
        ? `<button class="secondary" style="font-size:11px; padding:3px 8px;" onclick="togglePensionInstallmentLock('${d}', false)">마감해제</button>`
        : `<button class="secondary" style="font-size:11px; padding:3px 8px;" onclick="togglePensionInstallmentLock('${d}', true)">마감</button>`;
      return `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--bg); border-radius:var(--radius-sm); font-size:13px; flex-wrap:wrap;">
        <b style="min-width:100px;">${esc(it.date)}</b>
        <span style="color:var(--text-secondary);">${it.employee_count}명</span>
        <span style="font-weight:600;">${fmt(it.total_amount)}원</span>
        ${lockBadge}
        ${it.notes && it.notes.length ? `<span style="color:var(--text-muted); font-size:11px;">${it.notes.map(esc).join(', ')}</span>` : ''}
        <span style="margin-left:auto; display:flex; gap:6px;">
          ${lockBtn}
          <button class="secondary" style="font-size:11px; padding:3px 8px;" onclick="printPensionInstallment('${d}','${d}')">이 차수 인쇄</button>
          <button class="secondary" style="font-size:11px; padding:3px 8px; color:var(--red);" onclick="deletePensionInstallment('${d}')">전체 삭제</button>
        </span>
      </div>
    `;
    };

    let html = '';
    if (currentYearList.length === 0) {
      html += `<div class="dash-empty" style="padding:8px 12px;">${thisYear}년 불입 기록이 아직 없습니다.</div>`;
    } else {
      html += currentYearList.map(rowHtml).join('');
    }
    if (olderList.length > 0) {
      html += `
        <div id="pensionInstallmentOlder" style="display:none; flex-direction:column; gap:6px; margin-top:6px;">
          ${olderList.map(rowHtml).join('')}
        </div>
        <button class="secondary" style="align-self:flex-start; font-size:12px; margin-top:4px;" id="pensionInstallmentMoreBtn"
          onclick="const el=$('pensionInstallmentOlder'); const show = el.style.display==='none'; el.style.display = show?'flex':'none'; $('pensionInstallmentMoreBtn').textContent = show ? '▲ 이전 연도 접기' : '▼ 이전 연도 더보기 (${olderList.length}건)';">
          ▼ 이전 연도 더보기 (${olderList.length}건)
        </button>
      `;
    }
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty" style="padding:12px; color:var(--red);">불러오기 실패</div>`;
  }
}

/* 차수(지급일자) 단위 마감/마감해제 — 마감 시 그 지급일자의 최종 상태가 자동으로
   스냅샷에 다시 저장되어, "이 차수 인쇄"는 이 시점 자료를 그대로 보여주게 됨 */
async function togglePensionInstallmentLock(dateStr, locked) {
  if (locked) {
    if (!await appConfirm(`${dateStr} 차수를 마감하시겠습니까? 지금 상태가 최종 자료로 얼려집니다.\n마감 후에는 이 차수의 불입 기록을 추가/수정/삭제할 수 없고, 먼저 마감해제해야 합니다.`, '차수 마감')) return;
  } else {
    if (!await appConfirm(`${dateStr} 차수 마감을 해제하시겠습니까? 해제 후 추가/수정/삭제한 내용은 실시간으로 스냅샷에 반영됩니다.`, '차수 마감해제')) return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'lock_installment', period_key: dateStr, locked }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || '처리 실패');
    }
    loadPensionInstallmentList();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* 이 지급일자(차수)에 걸린 불입 기록·스냅샷·마감 상태를 전부 한 번에 지움 —
   마감 여부와 상관없이 지울 수 있음(직원마다 하나씩 이력에서 지울 필요 없게). */
async function deletePensionInstallment(dateStr) {
  if (!await appConfirm(
    `${dateStr} 차수 전체를 삭제하시겠습니까?\n이 날짜로 저장된 모든 직원의 불입 기록과, 인쇄용으로 얼려둔 자료까지 전부 지워지며 되돌릴 수 없습니다.`,
    '차수 전체 삭제'
  )) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'delete_installment', period_key: dateStr }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || '삭제 실패');
    }
    loadPensionInstallmentList();
    loadPension();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* ── 퇴직연금(DC) 차수별 불입 보고서 인쇄 (선택한 기간 지급액 + 당해년도 발생액/불입액 합계) ── */
async function printPensionInstallment(fromArg, toArg) {
  const from = fromArg || ($('pensionInstallFrom') ? $('pensionInstallFrom').value : '');
  const to = toArg || ($('pensionInstallTo') ? $('pensionInstallTo').value : '');
  if (!from || !to) {
    alert('불입 기간(차수)의 시작일과 종료일을 먼저 선택해주세요.');
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?print_installment=1&from=${from}&to=${to}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      alert('불러오기 실패: ' + (data.error || data.detail || `상태코드 ${res.status}`));
      return;
    }
    const rows = data.rows || [];
    if (rows.length === 0) {
      alert('선택한 기간에 저장된 불입 기록이 없습니다.');
      return;
    }
    $('pension_install_print_range').textContent = `대상 차수: ${from} ~ ${to} 불입분`;
    $('pension_install_print_asof').textContent = data.snapshot_note || `당해년도 발생액·불입액 합계 기준일: ${data.as_of}`;

    const positionOf = (id) => {
      const emp = employeesCache.find(e => e.id === id);
      return emp ? (emp.position || '-') : '-';
    };

    let sumInstall = 0, sumAccrual = 0, sumPaid = 0, sumCum = 0, sumContrib = 0, sumBalance = 0;
    const sumBy = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
    const rowHtml = (r) => `
      <tr>
        <td>${esc(r.name)}</td>
        <td>${esc(r.branch || '-')}</td>
        <td>${esc(r.department || '-')}</td>
        <td>${esc(r.position || positionOf(r.id))}</td>
        <td>${esc(r.hire_date || '-')}</td>
        <td class="num">${fmt(r.cumulative_estimate)}</td>
        <td class="num">${fmt(r.total_contributed)}</td>
        <td class="num">${fmt(r.balance)}</td>
        <td class="num" style="background:#f2f2f2;">${fmt(r.ytd_accrual)}</td>
        <td class="num" style="background:#f2f2f2;">${fmt(r.ytd_paid)}</td>
        <td class="num" style="background:#fff3d6;">${fmt(r.installment_amount)}</td>
      </tr>
    `;
    const subtotalHtml = (branch, arr) => `
      <tr class="hr-total-row">
        <td colspan="5">${esc(branch)} 소계 (${arr.length}명)</td>
        <td class="num">${fmt(sumBy(arr,'cumulative_estimate'))}</td>
        <td class="num">${fmt(sumBy(arr,'total_contributed'))}</td>
        <td class="num">${fmt(sumBy(arr,'balance'))}</td>
        <td class="num">${fmt(sumBy(arr,'ytd_accrual'))}</td>
        <td class="num">${fmt(sumBy(arr,'ytd_paid'))}</td>
        <td class="num">${fmt(sumBy(arr,'installment_amount'))}</td>
      </tr>
    `;

    const branches = [];
    const byBranch = {};
    rows.forEach(r => {
      const b = r.branch || '(미지정)';
      if (!byBranch[b]) { byBranch[b] = []; branches.push(b); }
      byBranch[b].push(r);
      sumInstall += r.installment_amount || 0;
      sumAccrual += r.ytd_accrual || 0;
      sumPaid += r.ytd_paid || 0;
      sumCum += r.cumulative_estimate || 0;
      sumContrib += r.total_contributed || 0;
      sumBalance += r.balance || 0;
    });

    let bodyHtml = '';
    branches.forEach(b => {
      byBranch[b].forEach(r => { bodyHtml += rowHtml(r); });
      bodyHtml += subtotalHtml(b, byBranch[b]);
    });
    bodyHtml += `
      <tr class="hr-total-row">
        <td colspan="5">전체 합계 (${rows.length}명)</td>
        <td class="num">${fmt(sumCum)}</td>
        <td class="num">${fmt(sumContrib)}</td>
        <td class="num">${fmt(sumBalance)}</td>
        <td class="num">${fmt(sumAccrual)}</td>
        <td class="num">${fmt(sumPaid)}</td>
        <td class="num">${fmt(sumInstall)}</td>
      </tr>
    `;
    $('pension_install_print_tbody').innerHTML = bodyHtml;

    $('pensionInstallPrintArea').style.display = 'block';
    const landscapeStyle = document.createElement('style');
    landscapeStyle.id = 'pensionInstallLandscapeStyle';
    landscapeStyle.textContent = `
      @page { size: landscape; margin: 10mm; }
      @media print {
        #pensionInstallPrintArea table { font-size: 9px; border-collapse: collapse; width: 100%; }
        #pensionInstallPrintArea th, #pensionInstallPrintArea td { padding: 3px 5px; line-height: 1.3; }
      }
    `;
    document.head.appendChild(landscapeStyle);
    window.print();
    document.head.removeChild(landscapeStyle);
    $('pensionInstallPrintArea').style.display = 'none';
  } catch (e) {
    alert('인쇄 준비 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* ── 퇴직연금(DC) 현황 대장 출력 ── */
function printPensionRegister() {
  if (!pensionStatusListCache || pensionStatusListCache.length === 0) {
    alert('먼저 퇴직연금 현황이 로딩될 때까지 기다려주세요.');
    return;
  }
  const list = pensionStatusListCache;
  const positionOf = (id) => {
    const emp = employeesCache.find(e => e.id === id);
    return emp ? (emp.position || '-') : '-';
  };
  $('pension_print_date').textContent = `기준일자: 오늘(${new Date().toISOString().slice(0,10)})`;

  const sum = (arr, key) => arr.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const rowHtml = (p) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.branch || '-')}</td>
      <td>${esc(p.department || '-')}</td>
      <td>${esc(positionOf(p.id))}</td>
      <td>${esc(p.pension_enrollment_date || p.hire_date || '-')}</td>
      <td class="num">${fmt(p.cumulative_estimate)}</td>
      <td class="num">${fmt(p.total_contributed)}</td>
      <td class="num">${fmt(p.balance)}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(p.ytd_accrual)}</td>
      <td class="num" style="background:#f2f2f2;">${fmt(p.ytd_paid)}</td>
    </tr>
  `;
  const subtotalHtml = (branch, arr) => `
    <tr class="hr-total-row">
      <td colspan="5">${esc(branch)} 소계 (${arr.length}명)</td>
      <td class="num">${fmt(sum(arr,'cumulative_estimate'))}</td>
      <td class="num">${fmt(sum(arr,'total_contributed'))}</td>
      <td class="num">${fmt(sum(arr,'balance'))}</td>
      <td class="num">${fmt(sum(arr,'ytd_accrual'))}</td>
      <td class="num">${fmt(sum(arr,'ytd_paid'))}</td>
    </tr>
  `;

  const branches = [];
  const byBranch = {};
  list.forEach(p => {
    const b = p.branch || '(미지정)';
    if (!byBranch[b]) { byBranch[b] = []; branches.push(b); }
    byBranch[b].push(p);
  });

  let html = '';
  branches.forEach(b => {
    byBranch[b].forEach(p => { html += rowHtml(p); });
    html += subtotalHtml(b, byBranch[b]);
  });
  html += `
    <tr class="hr-total-row">
      <td colspan="5">전체 합계 (${list.length}명)</td>
      <td class="num">${fmt(sum(list,'cumulative_estimate'))}</td>
      <td class="num">${fmt(sum(list,'total_contributed'))}</td>
      <td class="num">${fmt(sum(list,'balance'))}</td>
      <td class="num">${fmt(sum(list,'ytd_accrual'))}</td>
      <td class="num">${fmt(sum(list,'ytd_paid'))}</td>
    </tr>
  `;
  $('pension_print_tbody').innerHTML = html;

  $('pensionPrintArea').style.display = 'block';
  const landscapeStyle = document.createElement('style');
  landscapeStyle.id = 'pensionLandscapeStyle';
  landscapeStyle.textContent = `
    @page { size: landscape; margin: 8mm; }
    @media print {
      #pensionPrintArea table { font-size: 9px; border-collapse: collapse; width: 100%; }
      #pensionPrintArea th, #pensionPrintArea td { padding: 2px 4px; line-height: 1.25; }
    }
  `;
  document.head.appendChild(landscapeStyle);

  window.print();

  document.head.removeChild(landscapeStyle);
  $('pensionPrintArea').style.display = 'none';
}

/* ── 전 직원 급여 대장 출력 ── */
function printPayrollRegister() {
  if (!payrollCache || payrollCache.length === 0) {
    alert('먼저 급여명세를 조회해주세요 ("미리보기 조회" 또는 "저장된 자료 보기").');
    return;
  }
  // 개인별 명세서 팝업이 열려있으면 먼저 닫기 (같이 인쇄되는 것 방지)
  $('payslipModal').style.display = 'none';

  const list = payrollCache;
  const hasSaved = list[0] && list[0].retroactive_adjustment !== undefined;

  $('reg_month').textContent = `급여월: ${$('payrollMonth').value || '-'}`;

  const sum = (key, extra) => list.reduce((s, p) => s + (Number(p[key]) || 0) + (extra ? (Number(p[extra]) || 0) : 0), 0);

  $('reg_tbody').innerHTML = list.map(p => {
    const retro = hasSaved ? (Number(p.retroactive_adjustment) || 0) : 0;
    const finalTotal = (Number(p.total_pay) || 0) + retro;
    return `
      <tr>
        <td>${esc(p.name)}</td>
        <td>${esc(p.branch || '-')}</td>
        <td>${esc(p.department || '-')}</td>
        <td>${esc(p.position || '-')}</td>
        <td class="num">${fmt(p.base_pay)}</td>
        <td class="num">${fmt(p.fixed_overtime_pay)}</td>
        <td class="num">${fmt(p.attendance_allowance)}</td>
        <td class="num">${fmt(p.meal_allowance)}</td>
        <td class="num">${fmt(p.total_pay)}</td>
        <td class="num reg-retro-cell">${hasSaved ? (retro ? fmt(retro) : '') : '-'}</td>
        <td class="num">${hasSaved ? fmt(finalTotal) : '-'}</td>
      </tr>
    `;
  }).join('') + `
    <tr class="hr-total-row">
      <td colspan="4">합계 (${list.length}명)</td>
      <td class="num">${fmt(sum('base_pay'))}</td>
      <td class="num">${fmt(sum('fixed_overtime_pay'))}</td>
      <td class="num">${fmt(sum('attendance_allowance'))}</td>
      <td class="num">${fmt(sum('meal_allowance'))}</td>
      <td class="num">${fmt(sum('total_pay'))}</td>
      <td class="num reg-retro-cell">${hasSaved ? fmt(sum('retroactive_adjustment')) : '-'}</td>
      <td class="num">${hasSaved ? fmt(sum('total_pay','retroactive_adjustment')) : '-'}</td>
    </tr>
  `;

  // 전 직원 소급인상분이 전부 0이면, 인쇄본에서는 그 컬럼 자체를 숨김
  const totalRetro = hasSaved ? sum('retroactive_adjustment') : 0;
  const showRetroCol = hasSaved && totalRetro !== 0;
  $('reg_retro_header').style.display = showRetroCol ? '' : 'none';
  document.querySelectorAll('.reg-retro-cell').forEach(td => {
    td.style.display = showRetroCol ? '' : 'none';
  });

  const adjusted = list.filter(p => p.adjustment_note || p.proration_note);
  if (adjusted.length > 0) {
    $('reg_adjust_section').style.display = 'block';
    $('reg_adjust_list').innerHTML = adjusted.map(p => `
      <div style="padding:3px 0;"><b>${esc(p.name)}</b>(${esc(p.branch || '-')}/${esc(p.department || '-')}) — ${esc([p.adjustment_note, p.proration_note].filter(Boolean).join(' / '))}</div>
    `).join('');
  } else {
    $('reg_adjust_section').style.display = 'none';
  }

  $('registerPrintArea').style.display = 'block';

  // 대장 출력만 가로(landscape)로, 인원이 많아도 1~2장 안에 들어오도록
  // 폰트·여백을 인쇄 전용으로 압축한 스타일을 임시 삽입 후 인쇄 후 제거
  const landscapeStyle = document.createElement('style');
  landscapeStyle.id = 'registerLandscapeStyle';
  landscapeStyle.textContent = `
    @page { size: landscape; margin: 8mm; }
    @media print {
      #registerPrintArea h2 { font-size: 13px; margin-bottom: 2px; }
      #registerPrintArea p { font-size: 10px; margin-bottom: 6px; }
      #registerPrintArea table { font-size: 8.5px; border-collapse: collapse; width: 100%; }
      #registerPrintArea th, #registerPrintArea td { padding: 2px 4px; line-height: 1.25; }
      #reg_adjust_section { font-size: 9px; margin-top: 8px; }
      #reg_adjust_section h3 { font-size: 10px; margin-bottom: 4px; }
    }
  `;
  document.head.appendChild(landscapeStyle);

  window.print();

  document.head.removeChild(landscapeStyle);
  $('registerPrintArea').style.display = 'none';
}

/* ── 직원별 연간 급여 종합 ── */
let annualSummaryCache = null;

async function loadAnnualSummary() {
  const empId = $('annualEmployeeId').value;
  const year = $('annualYear').value;
  if (!empId || !year) { alert('직원과 연도를 선택해주세요.'); return; }

  $('annualResult').style.display = 'none';
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?annual_summary=1&employee_id=${empId}&year=${year}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '조회 실패');
    annualSummaryCache = data;
    renderAnnualSummary(data);
  } catch (e) {
    alert(e.message || '조회 중 오류가 발생했습니다.');
  }
}

function renderAnnualSummary(data) {
  const emp = data.employee;
  $('annual_emp_name').textContent = emp.name;
  $('annual_emp_org').textContent = `${emp.branch || '-'} / ${emp.department || '-'} / ${emp.position || '-'}`;

  const tbody = $('annualTbody');
  tbody.innerHTML = data.months.map(m => `
    <tr>
      <td>${m.month.slice(5)}월${m.has_payroll_data ? '' : ' <span style="color:var(--text-muted); font-size:10px;">(자료없음)</span>'}</td>
      <td class="num">${fmt(m.base_pay)}</td>
      <td class="num">${fmt(m.fixed_overtime_pay)}</td>
      <td class="num">${fmt(m.attendance_allowance)}</td>
      <td class="num">${fmt(m.meal_allowance)}</td>
      <td class="num">${m.retroactive_adjustment ? fmt(m.retroactive_adjustment) : ''}</td>
      <td class="num">${fmt(m.monthly_total)}</td>
      <td class="num">${m['성과급1차'] ? fmt(m['성과급1차']) : ''}</td>
      <td class="num">${m['성과급2차'] ? fmt(m['성과급2차']) : ''}</td>
      <td class="num">${m['상여금'] ? fmt(m['상여금']) : ''}</td>
      <td class="num">${m['기타수당'] ? fmt(m['기타수당']) : ''}</td>
      <td class="num">${m['연차수당'] ? fmt(m['연차수당']) : ''}</td>
      <td class="num" style="font-weight:500;">${fmt(m.grand_total)}</td>
    </tr>
  `).join('');

  const t = data.totals;
  tbody.innerHTML += `
    <tr class="hr-total-row">
      <td>합계</td>
      <td class="num">${fmt(t.base_pay)}</td>
      <td class="num">${fmt(t.fixed_overtime_pay)}</td>
      <td class="num">${fmt(t.attendance_allowance)}</td>
      <td class="num">${fmt(t.meal_allowance)}</td>
      <td class="num">${fmt(t.retroactive_adjustment)}</td>
      <td class="num">${fmt(t.monthly_total)}</td>
      <td class="num">${fmt(t['성과급1차'])}</td>
      <td class="num">${fmt(t['성과급2차'])}</td>
      <td class="num">${fmt(t['상여금'])}</td>
      <td class="num">${fmt(t['기타수당'])}</td>
      <td class="num">${fmt(t['연차수당'])}</td>
      <td class="num">${fmt(t.grand_total)}</td>
    </tr>
  `;

  $('annualResult').style.display = 'block';
}

function downloadAnnualSummaryExcel() {
  if (!annualSummaryCache) { alert('먼저 조회해주세요.'); return; }
  const data = annualSummaryCache;
  const rows = [[
    '월', '기본급', '고정연장수당', '만근수당', '식대', '소급인상분', '월급여 합계',
    '성과급1차', '성과급2차', '상여금', '기타수당', '연차수당', '월 총합계',
  ]];
  data.months.forEach(m => {
    rows.push([
      `${data.year}-${m.month.slice(5)}`, m.base_pay, m.fixed_overtime_pay, m.attendance_allowance, m.meal_allowance,
      m.retroactive_adjustment, m.monthly_total, m['성과급1차'], m['성과급2차'], m['상여금'], m['기타수당'], m['연차수당'],
      m.grand_total,
    ]);
  });
  const t = data.totals;
  rows.push([
    '합계', t.base_pay, t.fixed_overtime_pay, t.attendance_allowance, t.meal_allowance, t.retroactive_adjustment,
    t.monthly_total, t['성과급1차'], t['성과급2차'], t['상여금'], t['기타수당'], t['연차수당'], t.grand_total,
  ]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${data.year}년`);
  XLSX.writeFile(wb, `연간급여종합_${data.employee.name}_${data.year}.xlsx`);
}

/* ── 직원별 연간 급여 종합 — 전 직원 보기 ── */
let annualSummaryAllCache = null;

async function loadAnnualSummaryAll() {
  const year = $('annualAllYear').value;
  if (!year) { alert('연도를 선택해주세요.'); return; }
  const tbody = $('annualAllTbody');
  tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?annual_summary_all=1&year=${year}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '조회 실패');
    annualSummaryAllCache = data;
    renderAnnualSummaryAll(data);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function renderAnnualSummaryAll(data) {
  const tbody = $('annualAllTbody');
  const list = data.employees || [];
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:24px;">데이터가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(e => `
    <tr>
      <td>${esc(e.name)}</td>
      <td>${esc(e.branch || '-')}</td>
      <td>${esc(e.department || '-')}</td>
      <td>${esc(e.position || '-')}</td>
      <td class="num">${fmt(e.monthly_total)}</td>
      <td class="num">${e['성과급1차'] ? fmt(e['성과급1차']) : ''}</td>
      <td class="num">${e['성과급2차'] ? fmt(e['성과급2차']) : ''}</td>
      <td class="num">${e['상여금'] ? fmt(e['상여금']) : ''}</td>
      <td class="num">${e['기타수당'] ? fmt(e['기타수당']) : ''}</td>
      <td class="num">${e['연차수당'] ? fmt(e['연차수당']) : ''}</td>
      <td class="num" style="font-weight:500;">${fmt(e.grand_total)}</td>
    </tr>
  `).join('');

  const t = data.totals;
  tbody.innerHTML += `
    <tr class="hr-total-row">
      <td colspan="4">합계 (${list.length}명)</td>
      <td class="num">${fmt(t.monthly_total)}</td>
      <td class="num">${fmt(t['성과급1차'])}</td>
      <td class="num">${fmt(t['성과급2차'])}</td>
      <td class="num">${fmt(t['상여금'])}</td>
      <td class="num">${fmt(t['기타수당'])}</td>
      <td class="num">${fmt(t['연차수당'])}</td>
      <td class="num">${fmt(t.grand_total)}</td>
    </tr>
  `;
}

function downloadAnnualSummaryAllExcel() {
  if (!annualSummaryAllCache) { alert('먼저 조회해주세요.'); return; }
  const data = annualSummaryAllCache;
  const rows = [[
    '이름', '지사', '부서', '직급', '월급여 합계(연간)',
    '성과급1차', '성과급2차', '상여금', '기타수당', '연차수당', '연간 총계',
  ]];
  data.employees.forEach(e => {
    rows.push([
      e.name, e.branch || '', e.department || '', e.position || '', e.monthly_total,
      e['성과급1차'], e['성과급2차'], e['상여금'], e['기타수당'], e['연차수당'], e.grand_total,
    ]);
  });
  const t = data.totals;
  rows.push([
    `합계(${data.employees.length}명)`, '', '', '', t.monthly_total,
    t['성과급1차'], t['성과급2차'], t['상여금'], t['기타수당'], t['연차수당'], t.grand_total,
  ]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${data.year}년 전직원`);
  XLSX.writeFile(wb, `연간급여종합_전직원_${data.year}.xlsx`);
}

/* ── 연봉계약서용 데이터 다운로드(엑셀) ── */
async function downloadContractDataExcel() {
  const year = $('contractYear').value;
  if (!year) { alert('계약연도를 선택해주세요.'); return; }

  const btn = $('contractsAllBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '불러오는 중…';
  $('contractsMsg').textContent = '';
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?contract_data=1&year=${year}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '조회 실패');

    const list = data.employees || [];
    if (list.length === 0) {
      $('contractsMsg').textContent = '해당 연도에 급여 정보가 있는 직원이 없습니다.';
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`${year}년 연봉계약`);

    const headers = [
      '이름', '직위', '근무지(지사)', '계약연도', '계약시작일',
      '연봉액', '월급여', '기본급', '고정연장근로수당', '만근수당', '식대',
      '고정연장근무시간(실제시간)', '수습대상여부', '수습급여(최초3개월)',
    ];
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    });

    const grayFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

    list.forEach(e => {
      const row = sheet.addRow([
        e.name, e.position, e.branch, e.contract_year, e.contract_start_date,
        e.annual_salary, e.monthly_salary, e.base_pay, e.overtime_pay, e.attendance, e.meal,
        e.fixed_overtime_hours_raw, e.is_probation ? '예' : '아니오', e.probation_amount || '',
      ]);
      if (e.is_mid_year_hire) {
        row.eachCell({ includeEmpty: true }, cell => { cell.fill = grayFill; });
      }
    });

    sheet.columns.forEach(col => { col.width = 16; });
    sheet.getColumn(1).width = 10; // 이름

    if (list.some(e => e.is_mid_year_hire)) {
      const noteRow = sheet.addRow(['※ 회색으로 표시된 줄은 그 해 중도입사자로, 계약시작일이 1월 1일이 아니라 실제 입사일입니다.']);
      sheet.mergeCells(noteRow.number, 1, noteRow.number, headers.length);
      noteRow.font = { italic: true, size: 10, color: { argb: 'FF888888' } };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `연봉계약서_데이터_${year}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    $('contractsMsg').className = 'hr-msg success';
    $('contractsMsg').textContent = `${list.length}명분 다운로드되었습니다.`;
  } catch (e) {
    $('contractsMsg').className = 'hr-msg';
    $('contractsMsg').textContent = e.message || '다운로드 중 오류가 발생했습니다.';
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ── 거래처 연락처 관리 ── */
let contactCache = [];
let editingContactId = null;

async function loadContacts() {
  const tbody = $('contactTbody');
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/contacts`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (res.status === 401) {
      sessionStorage.removeItem('chwork_hr_pw');
      $('loginPanel').style.display = 'block';
      $('hrMain').style.display = 'none';
      return;
    }
    const data = await res.json();
    contactCache = data.contacts || [];
    populateContactCategoryFilter();
    renderContacts();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function populateContactCategoryFilter() {
  const cats = [...new Set(contactCache.map(c => c.category).filter(Boolean))].sort();
  const sel = $('contactCategoryFilter');
  const current = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = current;
}

function renderContacts() {
  const categoryFilter = $('contactCategoryFilter').value;
  const search = $('contactSearch').value.trim().toLowerCase();

  let list = contactCache;
  if (categoryFilter) list = list.filter(c => (c.category || '') === categoryFilter);
  if (search) {
    list = list.filter(c =>
      (c.company_name || '').toLowerCase().includes(search) ||
      (c.contact_name || '').toLowerCase().includes(search) ||
      (c.phones || []).some(p => (p || '').toLowerCase().includes(search))
    );
  }

  $('contactCount').textContent = `총 ${list.length}건`;
  const tbody = $('contactTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">등록된 거래처가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(c => `
    <tr>
      <td>${esc(c.company_name)}</td>
      <td>${esc(c.category || '-')}</td>
      <td>${esc(c.contact_name || '-')}</td>
      <td>${(c.phones && c.phones.length > 0) ? c.phones.map(p => esc(p)).join('<br>') : '-'}</td>
      <td>${esc(c.fax || '-')}</td>
      <td>${esc(c.email || '-')}</td>
      <td>${esc(c.address || '-')}</td>
      <td style="font-size:12px; color:var(--text-secondary); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(c.note || '')}">${esc(c.note || '-')}</td>
      <td>
        <a class="hr-edit-link" onclick="editContact('${c.id}')">수정</a>
        <a class="hr-edit-link" onclick="deleteContact('${c.id}', '${esc(c.company_name)}')">삭제</a>
      </td>
    </tr>
  `).join('');
}

function addContactPhoneField(value) {
  const wrap = $('ct_phones_list');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:6px;';
  row.innerHTML = `
    <input class="hr-input ct-phone-input" value="${esc(value || '')}" placeholder="예: 02-1234-5678" style="flex:1;">
    <button type="button" class="secondary" onclick="this.parentElement.remove()" style="padding:0 12px;">삭제</button>
  `;
  wrap.appendChild(row);
}

function getContactPhonesFromModal() {
  return Array.from(document.querySelectorAll('.ct-phone-input')).map(i => i.value.trim()).filter(Boolean);
}

function openContactModal() {
  editingContactId = null;
  $('contactModalTitle').textContent = '거래처 추가';
  ['company_name', 'category', 'contact_name', 'fax', 'email', 'address', 'note'].forEach(f => $('ct_' + f).value = '');
  $('ct_phones_list').innerHTML = '';
  addContactPhoneField();
  $('contactModalMsg').textContent = '';
  $('contactSaveBtn').disabled = false;
  $('contactModal').style.display = 'flex';
}

function editContact(id) {
  const c = contactCache.find(x => x.id === id);
  if (!c) return;
  editingContactId = id;
  $('contactModalTitle').textContent = `거래처 수정 — ${c.company_name}`;
  $('ct_company_name').value = c.company_name || '';
  $('ct_category').value = c.category || '';
  $('ct_contact_name').value = c.contact_name || '';
  $('ct_fax').value = c.fax || '';
  $('ct_email').value = c.email || '';
  $('ct_address').value = c.address || '';
  $('ct_note').value = c.note || '';
  $('ct_phones_list').innerHTML = '';
  if (c.phones && c.phones.length > 0) {
    c.phones.forEach(p => addContactPhoneField(p));
  } else {
    addContactPhoneField();
  }
  $('contactModalMsg').textContent = '';
  $('contactSaveBtn').disabled = false;
  $('contactModal').style.display = 'flex';
}

function closeContactModal() {
  $('contactModal').style.display = 'none';
}

async function saveContact() {
  const btn = $('contactSaveBtn');
  if (btn.disabled) return;
  btn.disabled = true;

  const payload = {
    company_name: $('ct_company_name').value.trim(),
    category: $('ct_category').value.trim() || null,
    contact_name: $('ct_contact_name').value.trim() || null,
    phones: getContactPhonesFromModal(),
    fax: $('ct_fax').value.trim() || null,
    email: $('ct_email').value.trim() || null,
    address: $('ct_address').value.trim() || null,
    note: $('ct_note').value.trim() || null,
  };

  if (!payload.company_name) {
    $('contactModalMsg').textContent = '업체명은 필수입니다.';
    btn.disabled = false;
    return;
  }

  try {
    let res;
    if (editingContactId) {
      res = await fetch(`${apiBase()}/api/contacts?id=${editingContactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${apiBase()}/api/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error('save failed');
    closeContactModal();
    loadContacts();
  } catch (e) {
    $('contactModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  } finally {
    btn.disabled = false;
  }
}

async function deleteContact(id, name) {
  if (!confirm(`"${name}" 거래처를 삭제하시겠습니까?`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/contacts?id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    loadContacts();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 계약/증빙관리 ── */
let contractDocCache = [];
let referenceDocCache = [];
let financialDocCache = [];
let editingContractDocId = null;

function cdDDayBadge(dueDateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dueDateStr + 'T00:00:00');
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
  let cls = 'normal';
  let label = diff === 0 ? 'D-DAY' : (diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`);
  if (diff < 0) cls = 'overdue';
  else if (diff <= 14) cls = 'soon';
  return `<span class="sch-dday ${cls}">${label}</span>`;
}

async function loadContractDocsBanner() {
  const wrap = $('contractDocsBannerWrap');
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs?upcoming=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) { wrap.innerHTML = ''; return; }
    const overdue = list.filter(x => x.days_left < 0);
    const soon = list.filter(x => x.days_left >= 0);
    let html = '';
    if (overdue.length > 0) {
      html += `<div class="sch-banner danger"><h3>⚠ 계약이 만료된 서류 (${overdue.length}건)</h3>`;
      html += overdue.map(x => `
        <div class="sch-banner-row">
          <span><span class="sch-dday overdue">D+${Math.abs(x.days_left)}</span> ${esc(x.vendor_name || '-')} — ${esc(x.contract_title || x.doc_type || '')} (만료 ${esc(x.contract_end_date)})</span>
          <a class="hr-edit-link" onclick="dismissContractAlert('${x.id}')">그만 알림</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    if (soon.length > 0) {
      html += `<div class="sch-banner warn"><h3>🔔 만료가 다가오는 서류 (${soon.length}건)</h3>`;
      html += soon.map(x => `
        <div class="sch-banner-row">
          <span><span class="sch-dday soon">D-${x.days_left}</span> ${esc(x.vendor_name || '-')} — ${esc(x.contract_title || x.doc_type || '')} (만료 ${esc(x.contract_end_date)})</span>
          <a class="hr-edit-link" onclick="dismissContractAlert('${x.id}')">그만 알림</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = '';
  }
}

async function dismissContractAlert(id) {
  if (!confirm('이 서류의 만료 알림을 그만 보시겠습니까? (서류 자체는 삭제되지 않습니다)')) return;
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'dismiss', id }),
    });
    if (!res.ok) throw new Error('failed');
    loadContractDocsBanner();
    loadContractDocs();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

async function loadContractDocs() {
  const tbody = $('contractDocTbody');
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  loadContractDocsBanner();
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (res.status === 401) {
      sessionStorage.removeItem('chwork_hr_pw');
      $('loginPanel').style.display = 'block';
      $('hrMain').style.display = 'none';
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    const all = data.documents || [];
    contractDocCache = all.filter(d => (d.doc_group || 'contract') === 'contract');
    referenceDocCache = all.filter(d => d.doc_group === 'reference');
    financialDocCache = all.filter(d => d.doc_group === 'financial');
    populateContractDocTypeFilter();
    renderContractDocs();
    renderReferenceDocs();
    renderFinancialDocs();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function populateContractDocTypeFilter() {
  const types = [...new Set(contractDocCache.map(c => c.doc_type).filter(Boolean))].sort();
  const sel = $('cdTypeFilter');
  const current = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  sel.value = current;
}

function renderDocFileLinks(files) {
  if (!files || files.length === 0) return '-';
  // 파일이 여러 개면 <br>로 세로로 쌓으면 그 행만 세로로 길어져서(가로스크롤 표라 안 보이는 채로)
  // 표 전체 줄 간격이 이상하게 벌어져 보이는 문제가 있어, 한 줄로 이어서 표시하고 필요하면 가로 스크롤로 보게 함.
  // 목록 조회 시에는 서명 URL을 미리 안 만들고(느려지니까), 실제 클릭한 순간에만 만들어서 엶
  return files.map(f =>
    `<a href="#" onclick="openContractDocFileLink('${f.id}'); return false;" class="hr-file-link">📎 ${esc(f.file_name || '보기')}</a>`
  ).join(' ');
}

async function openContractDocFileLink(fileId) {
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs?file_id=${fileId}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.detail || '열람 실패');
    window.open(data.view_url, '_blank');
  } catch (e) {
    alert('파일을 여는 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

function contractDocStatus(c) {
  if (c.terminated_date) return 'terminated';
  if (!c.contract_end_date) return 'active';
  const today = new Date().toISOString().slice(0, 10);
  return c.contract_end_date < today ? 'expired' : 'active';
}

function contractDocStatusBadge(status) {
  if (status === 'terminated') return `<span class="hr-badge retired">계약종료</span>`;
  if (status === 'expired') return `<span class="hr-badge no">계약만료</span>`;
  return `<span class="hr-badge active">계약유지중</span>`;
}

function renderContractDocs() {
  const typeFilter = $('cdTypeFilter').value;
  const statusFilter = $('cdStatusFilter').value;
  const search = $('cdSearch').value.trim().toLowerCase();
  const expiringOnly = $('cdExpiringOnly').checked;
  const today = new Date().toISOString().slice(0, 10);

  let list = contractDocCache;
  if (typeFilter) list = list.filter(c => (c.doc_type || '') === typeFilter);
  if (statusFilter) list = list.filter(c => contractDocStatus(c) === statusFilter);
  if (search) {
    list = list.filter(c =>
      (c.vendor_name || '').toLowerCase().includes(search) ||
      (c.contract_title || '').toLowerCase().includes(search)
    );
  }
  if (expiringOnly) {
    list = list.filter(c => {
      if (!c.contract_end_date) return false;
      const days = Math.round((new Date(c.contract_end_date) - new Date(today)) / 86400000);
      return days <= (c.reminder_days_before || 14);
    });
  }

  $('contractDocCount').textContent = `총 ${list.length}건`;
  const tbody = $('contractDocTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">등록된 서류가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(c => {
    const status = contractDocStatus(c);
    // 입력 시 비고와 해지/연장 처리 시 비고를 구분해서 두 줄로 보여줌 + hover하면 전체 내용도 보임
    const noteParts = status === 'terminated'
      ? [c.note || null, `해지일 ${c.terminated_date}${c.termination_note ? ' — ' + c.termination_note : ''}`].filter(Boolean)
      : [c.note || null].filter(Boolean);
    const noteTitle = noteParts.join('\n');
    const noteText = noteParts.length
      ? `<span title="${esc(noteTitle)}">${noteParts.map(esc).join('<br>')}</span>`
      : '-';
    return `
    <tr>
      <td>${esc(c.doc_type || '-')}</td>
      <td>${esc(c.vendor_name || '-')}</td>
      <td>${esc(c.contract_title || '-')}</td>
      <td style="font-size:12px;">${esc(c.contract_start_date || '-')} ~ ${esc(c.contract_end_date || '-')}${c.auto_renew ? ' <span style="color:var(--text-muted);">(자동연장 조항)</span>' : ''}</td>
      <td>${contractDocStatusBadge(status)}</td>
      <td>${(c.contract_end_date && status !== 'terminated') ? cdDDayBadge(c.contract_end_date) : '-'}</td>
      <td>${renderDocFileLinks(c.files)}</td>
      <td style="font-size:12px; color:var(--text-secondary); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(c.note || '')}">${noteText}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap; white-space:nowrap;">
          <a class="hr-edit-link" onclick="editContractDoc('${c.id}')">수정</a>
         
          <a class="hr-edit-link" onclick="deleteContractDoc('${c.id}', '${esc(c.contract_title || c.vendor_name || '서류')}')">삭제</a>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; white-space:nowrap; margin-top:4px;">
          ${status === 'terminated'
            ? `<a class="hr-edit-link" onclick="reactivateContractDoc('${c.id}')">해지취소</a>`
            : `<a class="hr-edit-link" onclick="openRenewModal('${c.id}')">연장</a>
              
               <a class="hr-edit-link" onclick="openTerminateModal('${c.id}')">해지</a>`}
         
          <a class="hr-edit-link" onclick="openRenewHistoryModal('${c.id}', '${esc(c.contract_title || c.vendor_name || '서류')}')">이력</a>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

function renderReferenceDocs() {
  const categoryFilter = $('refCategoryFilter').value;
  const search = $('refSearch').value.trim().toLowerCase();

  let list = referenceDocCache;
  if (categoryFilter) list = list.filter(c => (c.doc_type || '') === categoryFilter);
  if (search) {
    list = list.filter(c => (c.contract_title || '').toLowerCase().includes(search));
  }

  $('referenceDocCount').textContent = `총 ${list.length}건`;
  const tbody = $('referenceDocTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:24px;">등록된 자료가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(c => `
    <tr>
      <td>${esc(c.doc_type || '-')}</td>
      <td>${esc(c.contract_title || '-')}</td>
      <td>${renderDocFileLinks(c.files)}</td>
      <td style="font-size:12px; color:var(--text-secondary); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(c.note || '')}">${esc(c.note || '-')}</td>
      <td>
        <a class="hr-edit-link" onclick="editContractDoc('${c.id}')">수정</a>
        <a class="hr-edit-link" onclick="deleteContractDoc('${c.id}', '${esc(c.contract_title || '서류')}')">삭제</a>
      </td>
    </tr>
  `).join('');
}

function renderFinancialDocs() {
  const statusFilter = $('finStatusFilter').value;
  const search = $('finSearch').value.trim().toLowerCase();

  let list = financialDocCache;
  if (statusFilter) list = list.filter(c => contractDocStatus(c) === statusFilter);
  if (search) {
    list = list.filter(c =>
      (c.vendor_name || '').toLowerCase().includes(search) ||
      (c.contract_title || '').toLowerCase().includes(search)
    );
  }

  $('financialDocCount').textContent = `총 ${list.length}건`;
  const tbody = $('financialDocTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:24px;">등록된 금융상품이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(c => {
    const status = contractDocStatus(c);
    // 입력 시 비고와 해지/연장 처리 시 비고를 구분해서 두 줄로 보여줌 + hover하면 전체 내용도 보임
    const noteParts = status === 'terminated'
      ? [c.note || null, `해지일 ${c.terminated_date}${c.termination_note ? ' — ' + c.termination_note : ''}`].filter(Boolean)
      : [c.note || null].filter(Boolean);
    const noteTitle = noteParts.join('\n');
    const noteText = noteParts.length
      ? `<span title="${esc(noteTitle)}">${noteParts.map(esc).join('<br>')}</span>`
      : '-';
    return `
    <tr>
      <td>${esc(c.vendor_name || '-')}</td>
      <td>${esc(c.contract_title || '-')}</td>
      <td>${esc(c.account_number || '-')}</td>
      <td class="num">${c.investment_amount != null ? fmt(c.investment_amount) : '-'}</td>
      <td class="num">${c.return_rate != null ? c.return_rate + '%' : '-'}</td>
      <td style="font-size:12px;">${esc(c.contract_start_date || '-')} ~ ${esc(c.contract_end_date || '-')}</td>
      <td>${contractDocStatusBadge(status)}</td>
      <td>${(c.contract_end_date && status !== 'terminated') ? cdDDayBadge(c.contract_end_date) : '-'}</td>
      <td>${renderDocFileLinks(c.files)}</td>
      <td style="font-size:12px; color:var(--text-secondary); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(c.note || '')}">${noteText}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap; white-space:nowrap;">
          <a class="hr-edit-link" onclick="editContractDoc('${c.id}')">수정</a>
         
          <a class="hr-edit-link" onclick="deleteContractDoc('${c.id}', '${esc(c.contract_title || c.vendor_name || '금융상품')}')">삭제</a>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; white-space:nowrap; margin-top:4px;">
          ${status === 'terminated'
            ? `<a class="hr-edit-link" onclick="reactivateContractDoc('${c.id}')">해지취소</a>`
            : `<a class="hr-edit-link" onclick="openRenewModal('${c.id}')">연장</a>
              
               <a class="hr-edit-link" onclick="openTerminateModal('${c.id}')">해지</a>`}
         
          <a class="hr-edit-link" onclick="openRenewHistoryModal('${c.id}', '${esc(c.contract_title || c.vendor_name || '금융상품')}')">이력</a>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

function toggleDocGroupFields() {
  const group = $('cd_doc_group').value;
  $('cdFinancialFieldsWrap').style.display = group === 'financial' ? 'grid' : 'none';
  $('cdContractFieldsWrap').style.display = group === 'contract' ? 'grid' : 'none';
  $('cdReferenceFieldsWrap').style.display = group === 'reference' ? 'grid' : 'none';
}

function openContractDocModal() {
  editingContractDocId = null;
  $('contractDocModalTitle').textContent = '서류 업로드';
  ['vendor_name', 'contract_title', 'start_date', 'end_date', 'note'].forEach(f => $('cd_' + f).value = '');
  $('cd_doc_group').value = 'financial';
  $('cd_doc_type').value = '계약서[일반]';
  $('cd_ref_category').value = '인사';
  $('cd_ref_title').value = '';
  $('cd_reminder_days').value = '14';
  $('cd_auto_renew').checked = false;
  ['fin_institution', 'fin_product', 'fin_account', 'fin_amount', 'fin_rate', 'fin_start_date', 'fin_end_date'].forEach(f => $('cd_' + f).value = '');
  $('cd_fin_reminder_days').value = '14';
  $('cd_file').value = '';
  $('cdFileInputLabel').textContent = '첨부파일 (여러 개 선택 가능, 각 8MB 이하, 최소 1개 필요)';
  $('cdExistingFilesWrap').style.display = 'none';
  $('cdExistingFilesList').innerHTML = '';
  $('contractDocModalMsg').textContent = '';
  $('contractDocSaveBtn').disabled = false;
  toggleDocGroupFields();
  $('contractDocModal').style.display = 'flex';
}

function renderExistingFilesList(docId, files) {
  if (!files || files.length === 0) {
    $('cdExistingFilesWrap').style.display = 'none';
    $('cdExistingFilesList').innerHTML = '';
    return;
  }
  $('cdExistingFilesWrap').style.display = 'block';
  $('cdExistingFilesList').innerHTML = files.map(f => `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 8px; background:var(--bg); border-radius:var(--radius-sm); font-size:12px;">
      <a href="#" onclick="openContractDocFileLink('${f.id}'); return false;" class="hr-edit-link">${esc(f.file_name || '파일')}</a>
      <a class="hr-edit-link" onclick="deleteContractDocFile('${f.id}', '${docId}')" style="color:var(--red); flex-shrink:0;">삭제</a>
    </div>
  `).join('');
}

async function deleteContractDocFile(fileId, docId) {
  if (!confirm('이 첨부파일을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs?file_id=${fileId}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    // 모달을 열어둔 채로 목록만 갱신 (다른 입력값은 그대로 유지)
    const all = [...contractDocCache, ...referenceDocCache, ...financialDocCache];
    const doc = all.find(x => x.id === docId);
    if (doc) {
      doc.files = (doc.files || []).filter(f => f.id !== fileId);
      renderExistingFilesList(docId, doc.files);
    }
    loadContractDocs(); // 표 쪽 첨부파일 컬럼도 백그라운드로 갱신
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

function editContractDoc(id) {
  const c = [...contractDocCache, ...referenceDocCache, ...financialDocCache].find(x => x.id === id);
  if (!c) return;
  editingContractDocId = id;
  const group = c.doc_group || 'contract';
  $('contractDocModalTitle').textContent = `서류 수정 — ${c.contract_title || c.vendor_name || ''}`;
  $('cd_doc_group').value = group;
  if (group === 'contract') {
    $('cd_doc_type').value = c.doc_type || '';
    $('cd_vendor_name').value = c.vendor_name || '';
    $('cd_contract_title').value = c.contract_title || '';
    $('cd_start_date').value = c.contract_start_date || '';
    $('cd_end_date').value = c.contract_end_date || '';
    $('cd_reminder_days').value = c.reminder_days_before != null ? c.reminder_days_before : 14;
    $('cd_auto_renew').checked = !!c.auto_renew;
  } else if (group === 'financial') {
    $('cd_fin_institution').value = c.vendor_name || '';
    $('cd_fin_product').value = c.contract_title || '';
    $('cd_fin_account').value = c.account_number || '';
    $('cd_fin_amount').value = c.investment_amount != null ? c.investment_amount : '';
    $('cd_fin_rate').value = c.return_rate != null ? c.return_rate : '';
    $('cd_fin_start_date').value = c.contract_start_date || '';
    $('cd_fin_end_date').value = c.contract_end_date || '';
    $('cd_fin_reminder_days').value = c.reminder_days_before != null ? c.reminder_days_before : 14;
  } else {
    $('cd_ref_category').value = c.doc_type || '인사';
    $('cd_ref_title').value = c.contract_title || '';
  }
  $('cd_note').value = c.note || '';
  $('cd_file').value = '';
  $('cdFileInputLabel').textContent = '파일 추가 (선택, 여러 개 가능, 각 8MB 이하)';
  renderExistingFilesList(id, c.files);
  $('contractDocModalMsg').textContent = '';
  $('contractDocSaveBtn').disabled = false;
  toggleDocGroupFields();
  $('contractDocModal').style.display = 'flex';
}

function closeContractDocModal() {
  $('contractDocModal').style.display = 'none';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // "data:<mime>;base64,<data>"
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveContractDoc() {
  const btn = $('contractDocSaveBtn');
  if (btn.disabled) return;
  btn.disabled = true;

  const group = $('cd_doc_group').value;
  let payload;
  if (group === 'contract') {
    payload = {
      doc_group: 'contract',
      doc_type: $('cd_doc_type').value.trim() || null,
      vendor_name: $('cd_vendor_name').value.trim() || null,
      contract_title: $('cd_contract_title').value.trim() || null,
      contract_start_date: $('cd_start_date').value || null,
      contract_end_date: $('cd_end_date').value || null,
      reminder_days_before: Number($('cd_reminder_days').value) || 0,
      auto_renew: $('cd_auto_renew').checked,
      note: $('cd_note').value.trim() || null,
    };
  } else if (group === 'financial') {
    payload = {
      doc_group: 'financial',
      doc_type: '금융상품',
      vendor_name: $('cd_fin_institution').value.trim() || null,
      contract_title: $('cd_fin_product').value.trim() || null,
      account_number: $('cd_fin_account').value.trim() || null,
      investment_amount: $('cd_fin_amount').value ? Number($('cd_fin_amount').value) : null,
      return_rate: $('cd_fin_rate').value ? Number($('cd_fin_rate').value) : null,
      contract_start_date: $('cd_fin_start_date').value || null,
      contract_end_date: $('cd_fin_end_date').value || null,
      reminder_days_before: Number($('cd_fin_reminder_days').value) || 0,
      note: $('cd_note').value.trim() || null,
    };
  } else {
    payload = {
      doc_group: 'reference',
      doc_type: $('cd_ref_category').value,
      contract_title: $('cd_ref_title').value.trim() || null,
      note: $('cd_note').value.trim() || null,
    };
  }

  if (group === 'reference' && !payload.contract_title) {
    $('contractDocModalMsg').textContent = '문서명은 필수입니다.';
    btn.disabled = false;
    return;
  }
  if (group === 'financial' && !payload.vendor_name) {
    $('contractDocModalMsg').textContent = '금융기관명은 필수입니다.';
    btn.disabled = false;
    return;
  }

  try {
    // 선택된 파일들을 전부 base64로 변환 (여러 개 지원)
    const selectedFiles = Array.from($('cd_file').files || []);
    for (const f of selectedFiles) {
      if (f.size > 8 * 1024 * 1024) {
        $('contractDocModalMsg').textContent = `'${f.name}' 파일이 너무 큽니다 (8MB 이하로 올려주세요).`;
        btn.disabled = false;
        return;
      }
    }
    const fileEntries = await Promise.all(selectedFiles.map(async f => ({
      file_base64: await readFileAsBase64(f),
      file_name: f.name,
      content_type: f.type || 'application/octet-stream',
    })));

    if (editingContractDocId) {
      if (fileEntries.length > 0) payload.new_files = fileEntries;
      const res = await fetch(`${apiBase()}/api/contract_docs?id=${editingContractDocId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'save failed');
    } else {
      if (fileEntries.length === 0) {
        $('contractDocModalMsg').textContent = '첨부할 파일을 최소 1개 선택해주세요.';
        btn.disabled = false;
        return;
      }
      payload.files = fileEntries;

      const res = await fetch(`${apiBase()}/api/contract_docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'save failed');
    }
    closeContractDocModal();
    loadContractDocs();
  } catch (e) {
    $('contractDocModalMsg').textContent = '저장 중 오류가 발생했습니다: ' + (e.message || '');
  } finally {
    btn.disabled = false;
  }
}

async function deleteContractDoc(id, name) {
  if (!confirm(`"${name}" 서류를 삭제하시겠습니까? 첨부된 파일도 함께 삭제됩니다.`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs?id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('delete failed');
    loadContractDocs();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 계약 해지 처리 ── */
let pendingTerminateDocId = null;

function openTerminateModal(id) {
  pendingTerminateDocId = id;
  const today = new Date();
  $('term_date').value = today.toISOString().slice(0, 10);
  $('term_note').value = '';
  $('terminateModalMsg').textContent = '';
  $('terminateModal').style.display = 'flex';
}

function closeTerminateModal() {
  $('terminateModal').style.display = 'none';
}

async function confirmTerminate() {
  const date = $('term_date').value;
  if (!date) {
    $('terminateModalMsg').textContent = '해지일은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'terminate',
        id: pendingTerminateDocId,
        terminated_date: date,
        note: $('term_note').value.trim() || null,
      }),
    });
    if (!res.ok) throw new Error('failed');
    closeTerminateModal();
    loadContractDocs();
  } catch (e) {
    $('terminateModalMsg').textContent = '처리 중 오류가 발생했습니다.';
  }
}

async function reactivateContractDoc(id) {
  if (!confirm('이 계약의 해지 처리를 취소하고 "계약유지중"으로 되돌리시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'reactivate', id }),
    });
    if (!res.ok) throw new Error('failed');
    loadContractDocs();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

/* ── 계약 연장 처리 / 이력 ── */
let pendingRenewDocId = null;

function openRenewModal(id) {
  pendingRenewDocId = id;
  $('renew_end_date').value = '';
  $('renew_note').value = '';
  $('renewModalMsg').textContent = '';
  $('renewModal').style.display = 'flex';
}

function closeRenewModal() {
  $('renewModal').style.display = 'none';
}

async function confirmRenew() {
  const newEndDate = $('renew_end_date').value;
  if (!newEndDate) {
    $('renewModalMsg').textContent = '새 계약만료일은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'renew',
        id: pendingRenewDocId,
        new_end_date: newEndDate,
        note: $('renew_note').value.trim() || null,
      }),
    });
    if (!res.ok) throw new Error('failed');
    closeRenewModal();
    loadContractDocs();
  } catch (e) {
    $('renewModalMsg').textContent = '처리 중 오류가 발생했습니다.';
  }
}

async function openRenewHistoryModal(id, title) {
  $('renewHistoryModalTitle').textContent = `연장 이력 — ${title}`;
  $('renewHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  $('renewHistoryModal').style.display = 'flex';
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs?history=1&id=${id}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.renewals || [];
    if (list.length === 0) {
      $('renewHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">연장 이력이 없습니다.</td></tr>`;
      return;
    }
    $('renewHistoryTbody').innerHTML = list.map(r => `
      <tr>
        <td>${esc((r.created_at || '').slice(0, 10))}</td>
        <td>${esc(r.previous_end_date || '-')}</td>
        <td>${esc(r.new_end_date)}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${esc(r.note || '-')}</td>
      </tr>
    `).join('');
  } catch (e) {
    $('renewHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function closeRenewHistoryModal() {
  $('renewHistoryModal').style.display = 'none';
}

/* ── 인사기록보고서 ── */
let promoLiveCache = [];
let promoHistoryEmployeeId = null;
let promoHistoryCache = [];

/* ── 성과급보고서 ── */
let bonusReportCache = [];
let bonusReportMetaCache = {};

function initBonusReportTab() {
  const sel = $('bonusYear');
  if (!sel.dataset.loaded) {
    const thisYear = new Date().getFullYear();
    let opts = '';
    for (let y = thisYear + 1; y >= thisYear - 1; y--) opts += `<option value="${y}">${y}년</option>`;
    sel.innerHTML = opts;
    sel.value = thisYear;
    sel.dataset.loaded = '1';
  }
  if (!$('bonusPayDate').value) $('bonusPayDate').value = new Date().toISOString().slice(0, 10);
  loadBonusReport();
}

function fmtManwon(thousand) {
  // 연봉은 "천원" 단위 숫자 그대로 표시(양식과 동일하게)
  if (thousand == null) return '-';
  return Number(thousand).toLocaleString('ko-KR');
}

// 지급기준표: 표(직급별)와 자유텍스트를 같은 criteria_note 문자열 하나에 같이 저장함
// (백엔드에 별도 컬럼 추가 없이, 마커로 구분해서 안에 JSON을 숨겨 넣는 방식)
const BONUS_CRITERIA_TABLE_MARKER = '<!--BONUS_CRITERIA_TABLE:';
const BONUS_CRITERIA_TABLE_MARKER_END = '-->';

function parseBonusCriteriaNote(raw) {
  const text = raw || '';
  const start = text.indexOf(BONUS_CRITERIA_TABLE_MARKER);
  if (start === -1) return { freeText: text, rows: [] };
  const jsonStart = start + BONUS_CRITERIA_TABLE_MARKER.length;
  const end = text.indexOf(BONUS_CRITERIA_TABLE_MARKER_END, jsonStart);
  if (end === -1) return { freeText: text, rows: [] };
  let rows = [];
  try {
    rows = JSON.parse(text.slice(jsonStart, end)) || [];
  } catch (e) {
    rows = [];
  }
  const freeText = (text.slice(0, start) + text.slice(end + BONUS_CRITERIA_TABLE_MARKER_END.length)).trim();
  return { freeText, rows };
}

function buildBonusCriteriaNote(freeText, rows) {
  const cleanRows = (rows || []).filter(r => (r.position || '').trim() || (r.criteria || '').trim() || (r.note || '').trim());
  if (cleanRows.length === 0) return freeText || '';
  const marker = `${BONUS_CRITERIA_TABLE_MARKER}${JSON.stringify(cleanRows)}${BONUS_CRITERIA_TABLE_MARKER_END}`;
  return freeText ? `${freeText}\n\n${marker}` : marker;
}

let bonusCriteriaRows = [];

function renderBonusCriteriaTable() {
  const tbody = $('bonusCriteriaTableBody');
  if (bonusCriteriaRows.length === 0) bonusCriteriaRows = [{ position: '', criteria: '', note: '' }];
  tbody.innerHTML = bonusCriteriaRows.map((r, idx) => `
    <tr>
      <td><input type="text" class="hr-input bonus-criteria-position" data-idx="${idx}" value="${esc(r.position)}" placeholder="예: 임원"></td>
      <td><input type="text" class="hr-input bonus-criteria-value" data-idx="${idx}" value="${esc(r.criteria)}" placeholder="예: 2,000~10,000천원"></td>
      <td><input type="text" class="hr-input bonus-criteria-note" data-idx="${idx}" value="${esc(r.note || '')}" placeholder="비고"></td>
      <td style="text-align:center;"><a class="hr-edit-link" onclick="removeBonusCriteriaRow(${idx})">삭제</a></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('.bonus-criteria-position, .bonus-criteria-value, .bonus-criteria-note').forEach(input => {
    input.addEventListener('input', () => {
      const idx = Number(input.dataset.idx);
      const field = input.classList.contains('bonus-criteria-position') ? 'position'
        : input.classList.contains('bonus-criteria-value') ? 'criteria' : 'note';
      bonusCriteriaRows[idx][field] = input.value;
    });
  });
}

function addBonusCriteriaRow() {
  bonusCriteriaRows.push({ position: '', criteria: '', note: '' });
  renderBonusCriteriaTable();
}

function removeBonusCriteriaRow(idx) {
  bonusCriteriaRows.splice(idx, 1);
  if (bonusCriteriaRows.length === 0) bonusCriteriaRows.push({ position: '', criteria: '', note: '' });
  renderBonusCriteriaTable();
}

async function loadBonusReport() {
  const year = $('bonusYear').value;
  const round = $('bonusRound').value;
  const tbody = $('bonusReportTbody');
  tbody.innerHTML = `<tr><td colspan="22" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments?bonus_report=1&year=${year}&round=${round}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="22" style="text-align:center; color:var(--red); padding:24px;">${esc(data.error || '불러오기 실패')}${data.detail ? '<br><span style="font-size:11px; color:var(--text-muted);">' + esc(data.detail) + '</span>' : ''}</td></tr>`;
      return;
    }
    bonusReportCache = data.employees || [];
    bonusReportMetaCache = { year: data.year, round: data.round, y1: data.y1, y2: data.y2, locked: data.locked };
    $('bonusY2GroupHeader').textContent = `${data.y2}년 이력 (전전년도)`;
    $('bonusY1GroupHeader').textContent = `${data.y1}년 이력 (직전년도)`;
    $('bonusLockStatus').textContent = data.locked ? `🔒 ${year}년 ${round}차 마감됨` : `${year}년 ${round}차 마감 전`;
    const parsed = parseBonusCriteriaNote(data.criteria_note || '');
    $('bonusCriteriaNote').value = parsed.freeText;
    bonusCriteriaRows = parsed.rows.length > 0 ? parsed.rows : [{ position: '', criteria: '', note: '' }];
    renderBonusCriteriaTable();

    const locked = data.locked;
    if (bonusReportCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="22" style="text-align:center; color:var(--text-muted); padding:24px;">재직 직원이 없습니다.</td></tr>`;
      return;
    }

    // 지사별 소계 없이, 입사일 기준으로 정렬해서 표시
    const sorted = [...bonusReportCache].sort((a, b) => (a.hire_date || '').localeCompare(b.hire_date || ''));
    const html = sorted.map((e, idx) => renderBonusRow({ ...e, seq: idx + 1 }, locked)).join('');
    tbody.innerHTML = html;

    document.querySelectorAll('.bonus-decided-input, .bonus-note-input, .bonus-criteria-input').forEach(el => {
      el.addEventListener('input', () => { updateBonusRowCalc(el.closest('tr')); renderBonusReportTotals(); });
    });
    document.querySelectorAll('#bonusReportTbody tr[data-emp-id]').forEach(tr => updateBonusRowCalc(tr));
    renderBonusReportTotals();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="22" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패<br><span style="font-size:11px; color:var(--text-muted);">${esc(e.message || '')}</span></td></tr>`;
  }
}

function renderBonusRow(e, locked) {
  return `
    <tr data-emp-id="${e.employee_id}" data-branch="${esc(e.branch || '(미지정)')}" data-bonus-y1="${e.bonus_y1 || 0}" data-bonus-y2="${e.bonus_y2 || 0}">
      <td class="num">${e.seq}</td>
      <td>${esc(e.name)}</td>
      <td>${esc(e.branch || '-')}</td>
      <td>${esc(e.department || '-')}</td>
      <td>${esc(e.position || '-')}</td>
      <td>${esc(e.hire_date || '-')}</td>
      <td class="num" style="background:#f7f9fc;">${fmtManwon(e.salary_y2)}</td>
      <td class="num" style="background:#f7f9fc;">${fmt(e.monthly_y2)}</td>
      <td style="background:#f7f9fc;">${esc(e.criteria_y2 || '-')}</td>
      <td class="num" style="background:#f7f9fc;">${fmt(e.bonus_y2)}</td>
      <td class="num" style="background:#f7f9fc;">${fmtManwon(e.salary_y1)}</td>
      <td class="num" style="background:#f7f9fc;">${fmt(e.monthly_y1)}</td>
      <td style="background:#f7f9fc;">${esc(e.criteria_y1 || '-')}</td>
      <td class="num" style="background:#f7f9fc;">${fmt(e.bonus_y1)}</td>
      <td class="num">${fmtManwon(e.salary_now)}</td>
      <td class="num">${fmt(e.monthly_now)}</td>
      <td style="background:#fff9ec;"><input type="text" class="hr-input bonus-criteria-input" style="width:110px;" value="${esc(e.criteria || '')}" ${locked ? 'disabled' : ''}></td>
      <td style="background:#fff9ec;">
        <input type="number" class="hr-input bonus-decided-input" style="width:120px; text-align:right;"
          value="${e.decided_amount != null ? e.decided_amount : ''}" ${locked ? 'disabled' : ''}>
      </td>
      <td class="num bonus-diff-cell" style="background:#fff9ec;">-</td>
      <td class="num bonus-pct-cell" style="background:#fff9ec;">-</td>
      <td><input type="text" class="hr-input bonus-note-input" style="width:110px;" value="${esc(e.note || '')}" ${locked ? 'disabled' : ''}></td>
      <td class="bonus-exclude-col" style="text-align:center;">
        <input type="checkbox" class="bonus-exclude-checkbox" title="체크하면 인쇄에서 이 직원을 제외합니다">
      </td>
    </tr>
  `;
}

function updateBonusRowCalc(tr) {
  if (!tr) return;
  const bonusY1 = Number(tr.dataset.bonusY1 || 0);
  const decidedInput = tr.querySelector('.bonus-decided-input');
  const decided = decidedInput.value.trim() === '' ? null : Number(decidedInput.value);
  const diffCell = tr.querySelector('.bonus-diff-cell');
  const pctCell = tr.querySelector('.bonus-pct-cell');
  if (decided == null) {
    diffCell.textContent = '-';
    pctCell.textContent = '-';
    return;
  }
  const diff = decided - bonusY1;
  diffCell.textContent = fmt(diff);
  diffCell.style.color = diff < 0 ? 'var(--red)' : '';
  if (bonusY1 > 0) {
    const pct = (diff / bonusY1 * 100).toFixed(1) + '%';
    pctCell.textContent = pct;
    pctCell.style.color = diff < 0 ? 'var(--red)' : '';
  } else {
    pctCell.textContent = '-';
  }
}

function renderBonusReportTotals() {
  let sumY2 = 0, sumY1Bonus = 0, sumDecided = 0;

  document.querySelectorAll('#bonusReportTbody tr[data-emp-id]').forEach(tr => {
    const y2 = Number(tr.dataset.bonusY2 || 0);
    const y1 = Number(tr.dataset.bonusY1 || 0);
    const v = tr.querySelector('.bonus-decided-input').value.trim();
    const decided = v === '' ? 0 : Number(v);
    sumY2 += y2; sumY1Bonus += y1; sumDecided += decided;
  });

  // 전체 합계는 tfoot이 아니라 tbody 맨 끝의 일반 행으로 둠
  // (tfoot으로 하면 표가 여러 페이지로 나뉠 때 브라우저가 매 페이지마다 자동으로 반복 출력해버림)
  const existingGrandTotal = document.querySelector('.bonus-grand-total-row');
  if (existingGrandTotal) existingGrandTotal.remove();
  $('bonusReportTbody').insertAdjacentHTML('beforeend', `
    <tr class="hr-total-row bonus-grand-total-row">
      <td colspan="9">전체 합계</td>
      <td class="num">${fmt(sumY2)}</td>
      <td colspan="3"></td>
      <td class="num">${fmt(sumY1Bonus)}</td>
      <td colspan="2"></td>
      <td style="background:#fff9ec;"></td>
      <td class="num" style="background:#fff9ec;">${fmt(sumDecided)}</td>
      <td colspan="2" style="background:#fff9ec;"></td>
      <td></td>
      <td class="bonus-exclude-col"></td>
    </tr>
  `);
}

function collectBonusReportInputs() {
  const items = [];
  document.querySelectorAll('#bonusReportTbody tr[data-emp-id]').forEach(tr => {
    const empId = tr.dataset.empId;
    const amountInput = tr.querySelector('.bonus-decided-input');
    const noteInput = tr.querySelector('.bonus-note-input');
    const criteriaInput = tr.querySelector('.bonus-criteria-input');
    const val = amountInput.value.trim();
    items.push({
      employee_id: empId,
      criteria: criteriaInput.value.trim() || null,
      decided_amount: val === '' ? null : Number(val),
      note: noteInput.value.trim() || null,
    });
  });
  return items;
}

/* 결정기준/율(입력) 칸을 표 전체(또는 아직 비어있는 칸만)에 한 번에 채워넣음.
   emptyOnly=true면 이미 값이 있는 칸은 건드리지 않고 빈 칸만 채움. */
function applyBonusCriteriaBulk(emptyOnly) {
  const value = $('bonusCriteriaBulkInput').value.trim();
  if (!value) {
    alert('일괄 적용할 결정기준/율 값을 먼저 입력해주세요.');
    return;
  }
  const inputs = document.querySelectorAll('#bonusReportTbody tr[data-emp-id] .bonus-criteria-input');
  if (inputs.length === 0) {
    alert('먼저 조회를 눌러 직원 목록을 불러와주세요.');
    return;
  }
  let count = 0;
  inputs.forEach(input => {
    if (input.disabled) return;  // 마감된 보고서는 건드리지 않음
    if (emptyOnly && input.value.trim() !== '') return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    count += 1;
  });
  alert(`${count}명에게 적용했습니다. 저장하시려면 "입력내용 저장(초안)"을 눌러주세요.`);
}

async function saveBonusReportDraft() {
  const year = Number($('bonusYear').value);
  const round = Number($('bonusRound').value);
  const items = collectBonusReportInputs();
  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'bonus_save', year, round, items }),
    });
    const data = await res.json();
    if (!res.ok) { alert('저장 실패: ' + (data.error || '')); return; }
    alert('저장되었습니다.');
    loadBonusReport();
  } catch (e) {
    alert('저장 중 오류가 발생했습니다.');
  }
}

async function saveBonusCriteriaNote() {
  const year = Number($('bonusYear').value);
  const round = Number($('bonusRound').value);
  const combined = buildBonusCriteriaNote($('bonusCriteriaNote').value, bonusCriteriaRows);
  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'bonus_criteria_note', year, round, criteria_note: combined }),
    });
    if (!res.ok) throw new Error('failed');
    alert('지급기준표가 저장되었습니다.');
  } catch (e) {
    alert('저장 중 오류가 발생했습니다.');
  }
}

async function finalizeBonusReport() {
  const year = Number($('bonusYear').value);
  const round = Number($('bonusRound').value);
  const payDate = $('bonusPayDate').value;
  if (!payDate) { alert('지급일자를 먼저 선택해주세요.'); return; }
  if (!confirm(`${year}년 ${round}차 성과급을 확정(마감)하시겠습니까?\n결정된 금액이 "성과급/기타지급"에 자동 등록되고, 이 차수는 잠깁니다.`)) return;

  const items = collectBonusReportInputs();
  try {
    await fetch(`${apiBase()}/api/hr_other_payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'bonus_save', year, round, items }),
    });
    const res = await fetch(`${apiBase()}/api/hr_other_payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'bonus_finalize', year, round, pay_date: payDate }),
    });
    const data = await res.json();
    if (!res.ok) { alert('확정 실패: ' + (data.error || '')); return; }
    alert(`확정 완료! ${data.created}건이 성과급/기타지급에 등록됐습니다.`);
    loadBonusReport();
  } catch (e) {
    alert('확정 중 오류가 발생했습니다.');
  }
}

/* ── 성과급보고서 인쇄 공통 ── */
function _bonusPrintLandscape() {
  // 가로(landscape) 인쇄 + 실행 공통 로직
  const style = document.createElement('style');
  style.id = 'bonusPrintLandscapeStyle';
  style.textContent = `@page { size: landscape; margin: 10mm; }`;
  document.head.appendChild(style);
  $('bonus_print_asof').textContent = `기준일자: ${new Date().toISOString().slice(0, 10)}`;

  const criteriaNote = $('bonusCriteriaNote').value.trim();
  const criteriaRowsForPrint = (bonusCriteriaRows || []).filter(r => (r.position || '').trim() || (r.criteria || '').trim() || (r.note || '').trim());
  const existingBlock = document.getElementById('bonus_print_criteria_block');
  if (existingBlock) existingBlock.remove();
  if (criteriaNote || criteriaRowsForPrint.length > 0) {
    const block = document.createElement('div');
    block.id = 'bonus_print_criteria_block';
    block.style.cssText = 'margin-top:16px; padding:10px; border:1px solid #ccc; font-size:11px;';
    let inner = '<b>[참고] 지급기준표</b>';
    if (criteriaRowsForPrint.length > 0) {
      inner += `
        <table style="width:100%; border-collapse:collapse; margin-top:6px;">
          <thead><tr>
            <th style="border:1px solid #ccc; padding:3px 6px; text-align:left; background:#f2f2f2;">직급</th>
            <th style="border:1px solid #ccc; padding:3px 6px; text-align:left; background:#f2f2f2;">기준</th>
            <th style="border:1px solid #ccc; padding:3px 6px; text-align:left; background:#f2f2f2;">비고</th>
          </tr></thead>
          <tbody>
            ${criteriaRowsForPrint.map(r => `
              <tr>
                <td style="border:1px solid #ccc; padding:3px 6px;">${esc(r.position)}</td>
                <td style="border:1px solid #ccc; padding:3px 6px;">${esc(r.criteria)}</td>
                <td style="border:1px solid #ccc; padding:3px 6px;">${esc(r.note || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    if (criteriaNote) {
      inner += `<div style="margin-top:8px; white-space:pre-wrap;">${esc(criteriaNote).replace(/\n/g, '<br>')}</div>`;
    }
    block.innerHTML = inner;
    $('bonusReportPrintArea').appendChild(block);
  }

  $('bonusReportPrintArea').style.display = 'block';
  window.print();
  $('bonusReportPrintArea').style.display = 'none';
  document.head.removeChild(style);
}

// 화면에 실제로 보이는 표(#bonusReportTable)를 그대로 복제해서 인쇄에 씀
// -> 화면과 인쇄가 항상 100% 똑같이 유지됨(배경색·선·컬럼구성 전부 화면 그대로).
// input(결정기준/율, 결정성과급 입력칸)은 인쇄에서는 입력값 텍스트로 바꿔서 보여줌.
function _cloneScreenTableForPrint() {
  const original = document.getElementById('bonusReportTable');
  const clone = original.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.add('mc-framed-table');

  // "인쇄제외"에 체크된 직원은 인쇄본에서 행 자체를 통째로 제거
  const excludedIds = new Set();
  document.querySelectorAll('#bonusReportTbody tr[data-emp-id]').forEach(tr => {
    const cb = tr.querySelector('.bonus-exclude-checkbox');
    if (cb && cb.checked) excludedIds.add(tr.dataset.empId);
  });
  if (excludedIds.size > 0) {
    Array.from(clone.querySelectorAll('tbody tr[data-emp-id]')).forEach(tr => {
      if (excludedIds.has(tr.dataset.empId)) tr.remove();
    });
    // 제외하고 나면 원래 순번(1,2,3...)에 빈 번호가 생기므로, 남은 행 기준으로 1부터 다시 매김
    Array.from(clone.querySelectorAll('tbody tr[data-emp-id]')).forEach((tr, idx) => {
      const seqCell = tr.querySelector('td');
      if (seqCell) seqCell.textContent = idx + 1;
    });
    // 제외된 인원이 있으면, 인쇄본 기준(남은 인원만)으로 전체 합계를 다시 계산해서 반영
    let sumY2 = 0, sumY1 = 0, sumDecided = 0;
    clone.querySelectorAll('tbody tr[data-emp-id]').forEach(tr => {
      sumY2 += Number(tr.dataset.bonusY2 || 0);
      sumY1 += Number(tr.dataset.bonusY1 || 0);
      const decidedInput = tr.querySelector('.bonus-decided-input');
      sumDecided += decidedInput && decidedInput.value.trim() !== '' ? Number(decidedInput.value) : 0;
    });
    const totalRow = clone.querySelector('.bonus-grand-total-row');
    if (totalRow) {
      const cells = Array.from(totalRow.children);
      if (cells[1]) cells[1].textContent = fmt(sumY2);
      if (cells[3]) cells[3].textContent = fmt(sumY1);
      if (cells[6]) cells[6].textContent = fmt(sumDecided);
    }
  }

  // 인쇄제외 체크박스 칼럼(헤더+본문)은 화면 조작용이라 인쇄에는 필요없으니 통째로 제거
  clone.querySelectorAll('.bonus-exclude-col').forEach(el => el.remove());

  clone.querySelectorAll('input').forEach(input => {
    const span = document.createElement('span');
    span.textContent = input.value || '';
    input.replaceWith(span);
  });
  return clone;
}

/* ── 인쇄(의사결정용): 화면 그대로 + "당해년도 성과급 결정" 4칸 중 결정성과급 한 칸만 남김 ── */
function printBonusReportDecision() {
  if (bonusReportCache.length === 0) {
    alert('먼저 조회해주세요.');
    return;
  }
  const year = $('bonusYear').value;
  const round = $('bonusRound').value;
  $('bonus_print_title').textContent = `${year}년 성과급 검토표 - ${round}차 (의사결정용)`;

  const clone = _cloneScreenTableForPrint();

  // 헤더 1행: "당해년도 성과급 결정" 그룹(colspan 5 -> 1, 결정성과급만 남김. 비고는 별도 rowspan 컬럼으로 새로 추가)
  const headRow1 = clone.querySelector('thead tr:nth-child(1)');
  const decisionGroupTh = headRow1.children[headRow1.children.length - 1]; // 마지막 th = 결정 그룹헤더
  decisionGroupTh.setAttribute('colspan', '1');

  // 헤더 2행: 결정기준/율(input), 전년대비 증감, 전년대비(%), 비고 서브헤더 중 결정성과급만 남김
  const headRow2 = clone.querySelector('thead tr:nth-child(2)');
  const head2Cells = Array.from(headRow2.children);
  // 0-based 순서: [0~3]y2 [4~7]y1 [8~9]현재 [10]결정기준율 [11]결정성과급 [12]전년대비증감 [13]전년대비% [14]비고
  [head2Cells[10], head2Cells[12], head2Cells[13], head2Cells[14]].forEach(el => el && el.remove());
  const decidedTh = headRow2.children[10]; // 위 4개 제거 후 이제 10번째가 "결정 성과급(입력)"
  if (decidedTh) decidedTh.textContent = '결정 성과급';

  // 데이터 행(개별 직원)만 컬럼 제거: 17,19,20,21번째(1-based) td 제거, 결정성과급(18번째)만 남김
  Array.from(clone.querySelectorAll('tbody tr')).forEach(tr => {
    if (tr.classList.contains('bonus-subtotal-row') || tr.classList.contains('bonus-grand-total-row')) return; // 소계/전체합계행은 아래서 별도 처리
    const cells = Array.from(tr.children);
    if (cells.length < 21) return;
    [cells[16], cells[18], cells[19], cells[20]].forEach(td => td && td.remove()); // 0-based: 16=결정기준율,18=증감,19=%,20=비고
  });

  // 소계행/전체합계행: colspan 구조라 위와 같은 방식으로 정리
  // (구조: [colspan9][y2][colspan3][y1][colspan2][빈칸=결정기준율][결정합계][colspan3=증감,%,비고])
  const fixTotalRow = (tr) => {
    const cells = Array.from(tr.children);
    if (cells.length !== 9) return;
    cells[5].remove(); // 결정기준율 빈칸 제거
    cells[7].remove(); // 증감,% 자리(colspan=2) 제거
    cells[8].remove(); // 비고 자리 제거
  };
  clone.querySelectorAll('tbody tr.bonus-subtotal-row').forEach(fixTotalRow);
  const grandTotalRow = clone.querySelector('.bonus-grand-total-row');
  if (grandTotalRow) fixTotalRow(grandTotalRow);

  $('bonus_print_table_container').innerHTML = '';
  $('bonus_print_table_container').appendChild(clone);
  _bonusPrintLandscape();
}

/* ── 인쇄(확정 결정내용): 화면 표를 그대로(전체 컬럼) 복제 ── */
function printBonusReportFinal() {
  if (bonusReportCache.length === 0) {
    alert('먼저 조회해주세요.');
    return;
  }
  const year = $('bonusYear').value;
  const round = $('bonusRound').value;
  $('bonus_print_title').textContent = `${year}년 성과급 확정 결정내용 - ${round}차`;

  const clone = _cloneScreenTableForPrint();
  $('bonus_print_table_container').innerHTML = '';
  $('bonus_print_table_container').appendChild(clone);
  _bonusPrintLandscape();
}

/* ══════════════ 연봉인상보고서 (성과급보고서와 동일한 구조) ══════════════ */
let siReportCache = [];
let siReportMetaCache = {};

function initSalaryIncreaseReportTab() {
  const sel = $('siYear');
  if (!sel.dataset.loaded) {
    const thisYear = new Date().getFullYear();
    let opts = '';
    for (let y = thisYear + 1; y >= thisYear - 1; y--) opts += `<option value="${y}">${y}년</option>`;
    sel.innerHTML = opts;
    sel.value = thisYear;
    sel.dataset.loaded = '1';
  }
  loadSalaryIncreaseReport();
  loadSalaryIncreaseHistoryList();
}

async function loadSalaryIncreaseHistoryList() {
  const wrap = $('siHistoryList');
  wrap.innerHTML = `<div class="dash-empty" style="padding:12px;">불러오는 중…</div>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?salary_increase_history_list=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      wrap.innerHTML = `<div class="dash-empty" style="padding:12px; color:var(--red);">${esc(data.error || '불러오기 실패')}</div>`;
      return;
    }
    const list = data.items || [];
    if (list.length === 0) {
      wrap.innerHTML = `<div class="dash-empty" style="padding:12px;">아직 확정 반영된 소급분이 없습니다.</div>`;
      return;
    }
    wrap.innerHTML = list.map(it => {
      const empNames = it.employees.map(e => `${esc(e.name)}(${fmt(e.amount)})`).join(', ');
      return `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--bg); border-radius:var(--radius-sm); font-size:13px; flex-wrap:wrap;">
        <b style="min-width:90px;">${esc(it.target_month.slice(0, 7))}</b>
        <span style="color:var(--text-secondary);">${it.year}년 보고서 · ${it.employee_count}명</span>
        <span style="font-weight:600;">${fmt(it.total_amount)}원</span>
        <span style="color:var(--text-muted); font-size:11px; flex-basis:100%;">${empNames}</span>
      </div>
    `;
    }).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty" style="padding:12px; color:var(--red);">불러오기 실패</div>`;
  }
}

async function loadSalaryIncreaseReport() {
  const year = $('siYear').value;
  const tbody = $('siTbody');
  tbody.innerHTML = `<tr><td colspan="27" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?salary_increase_report=1&year=${year}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="27" style="text-align:center; color:var(--red); padding:24px;">${esc(data.error || '불러오기 실패')}${data.detail ? '<br><span style="font-size:11px; color:var(--text-muted);">' + esc(data.detail) + '</span>' : ''}</td></tr>`;
      return;
    }
    siReportCache = data.employees || [];
    siReportMetaCache = { year: data.year, y1: data.y1, y2: data.y2, locked: data.locked };
    $('siY3GroupHeader').textContent = `${data.y3}년 이력 (전전전년도)`;
    $('siY2GroupHeader').textContent = `${data.y2}년 이력 (전전년도)`;
    $('siY1GroupHeader').textContent = `${data.y1}년 이력 (직전년도)`;

    // "마감"은 이제 입력을 막는 게 아니라 "지금까지 확정 이력이 있다"는 표시일 뿐 —
    // 실제로 입력을 막는 기준은 "이미 지난 연도인지"임(지난 연도는 더 이상 손댈 일이 없으므로 잠금).
    const isPastYear = Number(year) < new Date().getFullYear();
    $('siLockStatus').textContent = (data.locked ? `🔵 확정 이력 있음` : '') + (isPastYear ? '  🔒 지난 연도(입력 잠김)' : '');
    $('siFinalizeBtn').style.display = isPastYear ? 'none' : '';
    $('siUnlockBtn').style.display = data.locked ? '' : 'none';
    $('siAppliedBulkInput').disabled = isPastYear;

    const locked = isPastYear;
    if (siReportCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="27" style="text-align:center; color:var(--text-muted); padding:24px;">재직 직원이 없습니다.</td></tr>`;
      return;
    }

    const sorted = [...siReportCache].sort((a, b) => (a.hire_date || '').localeCompare(b.hire_date || ''));
    tbody.innerHTML = sorted.map((e, idx) => renderSiRow({ ...e, seq: idx + 1 }, locked)).join('');

    document.querySelectorAll('.si-decided-input, .si-note-input').forEach(el => {
      el.addEventListener('input', () => { updateSiRowCalc(el.closest('tr')); renderSiTotals(); });
    });
    document.querySelectorAll('#siTbody tr[data-emp-id]').forEach(tr => updateSiRowCalc(tr));
    renderSiTotals();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="27" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패<br><span style="font-size:11px; color:var(--text-muted);">${esc(e.message || '')}</span></td></tr>`;
  }
}

function renderSiRow(e, locked) {
  return `
    <tr data-emp-id="${e.employee_id}" data-salary-now="${e.salary_now || 0}">
      <td class="num">${e.seq}</td>
      <td>${esc(e.name)}</td>
      <td>${esc(e.branch || '-')}</td>
      <td>${esc(e.department || '-')}</td>
      <td>${esc(e.position || '-')}</td>
      <td>${esc(e.hire_date || '-')}</td>
      <td class="num" style="background:#f8fbfd;">${fmtManwon(e.salary_y3)}</td>
      <td class="num" style="background:#f8fbfd;">${fmt(e.monthly_y3)}</td>
      <td class="num" style="background:#f8fbfd;">${e.bonus_y3 != null ? fmtManwon(Math.round(e.bonus_y3 / 1000)) : '-'}</td>
      <td class="num" style="background:#f7f9fc;">${fmtManwon(e.salary_y2)}</td>
      <td class="num" style="background:#f7f9fc;">${fmt(e.monthly_y2)}</td>
      <td class="num" style="background:#f7f9fc;">${e.bonus_y2 != null ? fmtManwon(Math.round(e.bonus_y2 / 1000)) : '-'}</td>
      <td class="num" style="background:#f7f9fc;">${e.y2_increase_amount != null ? fmt(e.y2_increase_amount) : '-'}</td>
      <td class="num" style="background:#f7f9fc;">${e.y2_increase_rate != null ? (e.y2_increase_rate * 100).toFixed(1) + '%' : '-'}</td>
      <td class="num" style="background:#f7f9fc;">${fmtManwon(e.salary_y1)}</td>
      <td class="num" style="background:#f7f9fc;">${fmt(e.monthly_y1)}</td>
      <td class="num" style="background:#f7f9fc;">${e.bonus_y1 != null ? fmtManwon(Math.round(e.bonus_y1 / 1000)) : '-'}</td>
      <td class="num" style="background:#f7f9fc;">${e.y1_increase_amount != null ? fmt(e.y1_increase_amount) : '-'}</td>
      <td class="num" style="background:#f7f9fc;">${e.y1_increase_rate != null ? (e.y1_increase_rate * 100).toFixed(1) + '%' : '-'}</td>
      <td class="num">${fmtManwon(e.salary_now)}</td>
      <td class="num">${fmt(e.monthly_now)}</td>
      <td style="background:#fff9ec;">
        <input type="number" class="hr-input si-decided-input" style="width:110px; text-align:right;"
          value="${e.decided_salary != null ? e.decided_salary : ''}" ${locked ? 'disabled' : ''}>
      </td>
      <td style="background:#fff9ec;">
        <input type="month" class="hr-input si-applied-input" style="width:120px;"
          value="${e.applied_month ? e.applied_month.slice(0, 7) : ''}" ${locked ? 'disabled' : ''}>
      </td>
      <td class="num si-diff-cell" style="background:#fff9ec;">-</td>
      <td class="num si-pct-cell" style="background:#fff9ec;">-</td>
      <td style="background:#fff9ec;"><input type="text" class="hr-input si-note-input" style="width:110px;" value="${esc(e.note || '')}" ${locked ? 'disabled' : ''}></td>
      <td class="si-exclude-col" style="text-align:center;">
        <input type="checkbox" class="si-exclude-checkbox" title="체크하면 인쇄에서 이 직원을 제외합니다">
      </td>
    </tr>
  `;
}

function updateSiRowCalc(tr) {
  if (!tr) return;
  const salaryNow = Number(tr.dataset.salaryNow || 0);
  const decidedInput = tr.querySelector('.si-decided-input');
  if (!decidedInput) return;  // 화면 전환 도중 등으로 요소가 이미 없어졌으면 조용히 건너뜀
  const decided = decidedInput.value.trim() === '' ? null : Number(decidedInput.value);
  const diffCell = tr.querySelector('.si-diff-cell');
  const pctCell = tr.querySelector('.si-pct-cell');
  if (!diffCell || !pctCell) return;
  if (decided == null) {
    diffCell.textContent = '-';
    pctCell.textContent = '-';
    return;
  }
  const diff = decided - salaryNow;
  diffCell.textContent = fmt(diff);
  diffCell.style.color = diff < 0 ? 'var(--red)' : '';
  if (salaryNow > 0) {
    pctCell.textContent = (diff / salaryNow * 100).toFixed(1) + '%';
    pctCell.style.color = diff < 0 ? 'var(--red)' : '';
  } else {
    pctCell.textContent = '-';
  }
}

function renderSiTotals() {
  const sums = { y3s: 0, y3m: 0, y3b: 0, y2s: 0, y2m: 0, y2b: 0, y2inc: 0, y1s: 0, y1m: 0, y1b: 0, y1inc: 0, nows: 0, nowm: 0, decided: 0, incAmt: 0 };
  let empCount = 0;
  document.querySelectorAll('#siTbody tr[data-emp-id]').forEach(tr => {
    empCount += 1;
    const e = siReportCache.find(x => x.employee_id === tr.dataset.empId) || {};
    sums.y3s += Number(e.salary_y3 || 0); sums.y3m += Number(e.monthly_y3 || 0); sums.y3b += Number(e.bonus_y3 || 0);
    sums.y2s += Number(e.salary_y2 || 0); sums.y2m += Number(e.monthly_y2 || 0); sums.y2b += Number(e.bonus_y2 || 0);
    if (e.y2_increase_amount != null) sums.y2inc += Number(e.y2_increase_amount);
    sums.y1s += Number(e.salary_y1 || 0); sums.y1m += Number(e.monthly_y1 || 0); sums.y1b += Number(e.bonus_y1 || 0);
    if (e.y1_increase_amount != null) sums.y1inc += Number(e.y1_increase_amount);
    sums.nows += Number(e.salary_now || 0); sums.nowm += Number(e.monthly_now || 0);
    const decidedEl = tr.querySelector('.si-decided-input');
    const v = decidedEl ? decidedEl.value.trim() : '';
    const decided = v === '' ? null : Number(v);
    if (decided != null) {
      sums.decided += decided;
      sums.incAmt += decided - Number(tr.dataset.salaryNow || 0);
    }
  });
  const existing = document.querySelector('.si-grand-total-row');
  if (existing) existing.remove();
  $('siTbody').insertAdjacentHTML('beforeend', `
    <tr class="hr-total-row si-grand-total-row">
      <td colspan="6">전체 합계 (${empCount}명)</td>
      <td class="num">${fmt(sums.y3s)}</td>
      <td class="num">${fmt(sums.y3m)}</td>
      <td class="num">${fmtManwon(Math.round(sums.y3b / 1000))}</td>
      <td class="num">${fmt(sums.y2s)}</td>
      <td class="num">${fmt(sums.y2m)}</td>
      <td class="num">${fmtManwon(Math.round(sums.y2b / 1000))}</td>
      <td class="num">${fmt(sums.y2inc)}</td>
      <td style="background:var(--bg);"></td>
      <td class="num">${fmt(sums.y1s)}</td>
      <td class="num">${fmt(sums.y1m)}</td>
      <td class="num">${fmtManwon(Math.round(sums.y1b / 1000))}</td>
      <td class="num">${fmt(sums.y1inc)}</td>
      <td style="background:var(--bg);"></td>
      <td class="num">${fmt(sums.nows)}</td>
      <td class="num">${fmt(sums.nowm)}</td>
      <td class="num" style="background:#fff9ec;">${fmt(sums.decided)}</td>
      <td style="background:#fff9ec;"></td>
      <td class="num" style="background:#fff9ec;">${fmt(sums.incAmt)}</td>
      <td style="background:#fff9ec;"></td>
      <td style="background:#fff9ec;"></td>
      <td class="si-exclude-col"></td>
    </tr>
  `);
}

function collectSiReportInputs() {
  const items = [];
  document.querySelectorAll('#siTbody tr[data-emp-id]').forEach(tr => {
    const empId = tr.dataset.empId;
    const amountInput = tr.querySelector('.si-decided-input');
    const appliedInput = tr.querySelector('.si-applied-input');
    const noteInput = tr.querySelector('.si-note-input');
    if (!amountInput || !appliedInput || !noteInput) return;  // 화면이 예상 상태가 아니면 그 행은 건너뜀
    const val = amountInput.value.trim();
    items.push({
      employee_id: empId,
      decided_salary: val === '' ? null : Number(val),
      applied_month: appliedInput.value ? `${appliedInput.value}-01` : null,
      note: noteInput.value.trim() || null,
    });
  });
  return items;
}

/* 적용월을 표 전체(또는 아직 안 채운 칸만)에 한 번에 채워넣음 */
function applySiAppliedMonthBulk(emptyOnly) {
  const value = $('siAppliedBulkInput').value;
  if (!value) {
    alert('일괄 적용할 적용월을 먼저 선택해주세요.');
    return;
  }
  const inputs = document.querySelectorAll('#siTbody tr[data-emp-id] .si-applied-input');
  if (inputs.length === 0) {
    alert('먼저 조회를 눌러 직원 목록을 불러와주세요.');
    return;
  }
  let count = 0;
  inputs.forEach(input => {
    if (input.disabled) return;
    if (emptyOnly && input.value !== '') return;
    input.value = value;
    count += 1;
  });
  alert(`${count}명에게 적용했습니다. 저장하시려면 "입력내용 저장(초안)"을 눌러주세요.`);
}

async function saveSalaryIncreaseDraft() {
  const year = Number($('siYear').value);
  const items = collectSiReportInputs();
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'salary_increase_save', year, items }),
    });
    const data = await res.json();
    if (!res.ok) { alert('저장 실패: ' + (data.error || '')); return; }
    alert('저장되었습니다.');
    loadSalaryIncreaseReport();
  } catch (e) {
    alert('저장 중 오류가 발생했습니다.');
  }
}

let siPendingTargetMonth = null;

async function openSiFinalizeModal() {
  const year = Number($('siYear').value);
  // 결정연봉은 입력했는데 적용월을 빼먹은 직원이 있으면 미리 알려줌(그 직원은 반영에서 빠지게 됨)
  const missing = [];
  document.querySelectorAll('#siTbody tr[data-emp-id]').forEach(tr => {
    const decidedEl = tr.querySelector('.si-decided-input');
    const appliedEl = tr.querySelector('.si-applied-input');
    if (!decidedEl || !appliedEl) return;
    const decided = decidedEl.value.trim();
    const applied = appliedEl.value;
    if (decided !== '' && !applied) {
      const name = tr.children[1] ? tr.children[1].textContent : '';
      missing.push(name);
    }
  });
  if (missing.length > 0) {
    alert(`다음 직원은 결정연봉은 입력됐는데 적용월이 비어있어서 이번 확정에서 제외됩니다:\n${missing.join(', ')}\n\n적용월까지 입력한 뒤 다시 시도해주세요.`);
    return;
  }

  // 반영 전, 지금까지 입력한 내용부터 저장(초안)
  await fetch(`${apiBase()}/api/hr_payroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
    body: JSON.stringify({ type: 'salary_increase_save', year, items: collectSiReportInputs() }),
  });

  $('siFinalizeModalBody').innerHTML = `<div class="dash-empty">소급분 계산 중…</div>`;
  $('siFinalizeModal').style.display = 'flex';

  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'salary_increase_retro_preview', year }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '계산 실패');
    renderSiFinalizePreview(data);
  } catch (e) {
    $('siFinalizeModalBody').innerHTML = `<div class="dash-empty" style="color:var(--red);">계산 중 오류: ${esc(e.message || '')}</div>`;
  }
}

function renderSiFinalizePreview(data) {
  const year = $('siYear').value;
  const items = data.items || [];
  let html = `<p style="font-size:13px; margin-bottom:12px;">
    <b>${year}년</b> 연봉인상보고서를 확정하면, 결정연봉+적용월이 입력된 직원의 <b>연봉이력이 새로 추가</b>되고,
    적용월부터 이번달까지 이미 처리된 급여와의 차액이 계산되어 아래처럼 소급 반영됩니다.
  </p>`;

  if (items.length === 0) {
    html += `<div class="dash-empty">소급으로 추가 지급/차감할 차액이 없습니다 (연봉이력은 그대로 추가됩니다).</div>`;
  } else {
    html += `<div class="table-wrap"><table class="table"><thead><tr>
      <th>이름</th><th>적용월</th><th class="num">결정연봉(천원)</th><th>소급 대상월</th><th class="num">소급 합계</th>
    </tr></thead><tbody>`;
    items.forEach(it => {
      const monthsLabel = it.months.map(m => `${m.source_month.slice(0, 7)}(${fmt(m.amount)})`).join(', ');
      html += `<tr>
        <td>${esc(it.name)}</td>
        <td>${esc(it.applied_month.slice(0, 7))}</td>
        <td class="num">${fmt(it.decided_salary)}</td>
        <td style="font-size:12px;">${esc(monthsLabel)}</td>
        <td class="num" style="${it.subtotal < 0 ? 'color:var(--red);' : ''}">${fmt(it.subtotal)}</td>
      </tr>`;
    });
    html += `</tbody></table></div>
    <p style="text-align:right; font-weight:600; margin-top:8px;">전체 소급 합계: ${fmt(data.total)}원</p>`;
  }

  html += `
    <div class="hr-form-grid" style="grid-template-columns:1fr; margin-top:16px;">
      <label>소급분 반영월 (이 소급액을 합산해서 지급할 급여 달)
        <input id="siTargetMonthInput" type="month" class="hr-input">
      </label>
    </div>
  `;
  $('siFinalizeModalBody').innerHTML = html;
}

function closeSiFinalizeModal() { $('siFinalizeModal').style.display = 'none'; }

async function confirmSiFinalize() {
  const year = Number($('siYear').value);
  const targetInput = $('siTargetMonthInput');
  if (!targetInput || !targetInput.value) {
    alert('소급분 반영월을 선택해주세요.');
    return;
  }
  const targetMonth = `${targetInput.value}-01`;
  if (!confirm(`정말 반영하시겠습니까?\n\n이 작업은 연봉이력을 추가하고 실제 급여(${targetInput.value})에 소급분을 합산합니다.\n되돌리려면 "마감해제"를 눌러야 합니다.`)) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'salary_increase_confirm_finalize', year, target_month: targetMonth }),
    });
    const data = await res.json();
    if (!res.ok) { alert('반영 실패: ' + (data.error || data.detail || '')); return; }
    alert(`반영되었습니다. (연봉이력 ${data.salary_history_count}건, 소급 ${data.retro_count}건)`);
    closeSiFinalizeModal();
    loadSalaryIncreaseReport();
    loadSalaryIncreaseHistoryList();
  } catch (e) {
    alert('반영 중 오류가 발생했습니다.');
  }
}

async function unlockSalaryIncreaseReport() {
  const year = Number($('siYear').value);
  if (!confirm(`${year}년에 이 보고서로 지금까지 반영된 것을 전부 되돌리시겠습니까?\n\n(이 연도 안에서 여러 번에 나눠 확정했더라도, 전부 한꺼번에 되돌아갑니다 — 일부만 골라 되돌리는 건 안 됩니다)\n연봉이력과 소급분 급여가 전부 취소됩니다.`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'salary_increase_lock', year, locked: false }),
    });
    if (!res.ok) { const data = await res.json().catch(() => ({})); alert('처리 실패: ' + (data.error || '')); return; }
    alert('되돌렸습니다. 반영됐던 연봉이력/소급분이 전부 취소되었습니다.');
    loadSalaryIncreaseReport();
    loadSalaryIncreaseHistoryList();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

/* ── 연봉인상보고서 인쇄 공통 ── */
function _siPrintLandscape() {
  const style = document.createElement('style');
  style.id = 'siPrintLandscapeStyle';
  style.textContent = `@page { size: landscape; margin: 8mm; }`;
  document.head.appendChild(style);
  $('si_print_asof').textContent = `기준일자: ${new Date().toISOString().slice(0, 10)}`;

  $('siPrintArea').style.display = 'block';

  // 컬럼이 많아(27칸) 폭을 넘으면 그 비율만큼 표 전체를 자동으로 축소함
  // (헤더는 2줄 줄바꿈, 데이터 글씨·세로 여백은 CSS에서 최대한 키워둔 상태 — 그래도 안 맞으면 이걸로 보정).
  const table = $('siPrintArea').querySelector('table');
  const availablePx = 1050;  // landscape A4(297mm) - 여백 8mm×2 ≈ 281mm ≈ 1060px 기준
  if (table) {
    table.style.zoom = '';
    const naturalWidth = table.scrollWidth;
    if (naturalWidth > availablePx) {
      table.style.zoom = String(availablePx / naturalWidth);
    }
  }

  window.print();
  $('siPrintArea').style.display = 'none';
  if (table) { table.style.zoom = ''; }
  document.head.removeChild(style);
}

function _cloneSiTableForPrint() {
  const original = document.getElementById('siTable');
  const clone = original.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.add('mc-framed-table');

  const excludedIds = new Set();
  document.querySelectorAll('#siTbody tr[data-emp-id]').forEach(tr => {
    const cb = tr.querySelector('.si-exclude-checkbox');
    if (cb && cb.checked) excludedIds.add(tr.dataset.empId);
  });
  if (excludedIds.size > 0) {
    Array.from(clone.querySelectorAll('tbody tr[data-emp-id]')).forEach(tr => {
      if (excludedIds.has(tr.dataset.empId)) tr.remove();
    });
    Array.from(clone.querySelectorAll('tbody tr[data-emp-id]')).forEach((tr, idx) => {
      const seqCell = tr.querySelector('td');
      if (seqCell) seqCell.textContent = idx + 1;
    });
    // 제외된 인원이 있으면, 인쇄본 기준(남은 인원만)으로 합계 전부 다시 계산
    const sums = { y3s: 0, y3m: 0, y3b: 0, y2s: 0, y2m: 0, y2b: 0, y2inc: 0, y1s: 0, y1m: 0, y1b: 0, y1inc: 0, nows: 0, nowm: 0, decided: 0, incAmt: 0 };
    let empCount = 0;
    clone.querySelectorAll('tbody tr[data-emp-id]').forEach(tr => {
      empCount += 1;
      const e = siReportCache.find(x => x.employee_id === tr.dataset.empId) || {};
      sums.y3s += Number(e.salary_y3 || 0); sums.y3m += Number(e.monthly_y3 || 0); sums.y3b += Number(e.bonus_y3 || 0);
      sums.y2s += Number(e.salary_y2 || 0); sums.y2m += Number(e.monthly_y2 || 0); sums.y2b += Number(e.bonus_y2 || 0);
      if (e.y2_increase_amount != null) sums.y2inc += Number(e.y2_increase_amount);
      sums.y1s += Number(e.salary_y1 || 0); sums.y1m += Number(e.monthly_y1 || 0); sums.y1b += Number(e.bonus_y1 || 0);
      if (e.y1_increase_amount != null) sums.y1inc += Number(e.y1_increase_amount);
      sums.nows += Number(e.salary_now || 0); sums.nowm += Number(e.monthly_now || 0);
      const decidedInput = tr.querySelector('.si-decided-input');
      const decided = decidedInput && decidedInput.value.trim() !== '' ? Number(decidedInput.value) : null;
      if (decided != null) { sums.decided += decided; sums.incAmt += decided - Number(tr.dataset.salaryNow || 0); }
    });
    const totalRow = clone.querySelector('.si-grand-total-row');
    if (totalRow) {
      const cells = Array.from(totalRow.children);
      cells[0].textContent = `전체 합계 (${empCount}명)`;
      // [1]y3s [2]y3m [3]y3b [4]y2s [5]y2m [6]y2b [7]y2inc [8]빈 [9]y1s [10]y1m [11]y1b [12]y1inc [13]빈
      // [14]nows [15]nowm [16]decided [17]빈(적용월) [18]incAmt
      const targets = [cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7], null, cells[9], cells[10], cells[11], cells[12], null, cells[14], cells[15], cells[16], null, cells[18]];
      const vals = [sums.y3s, sums.y3m, Math.round(sums.y3b / 1000), sums.y2s, sums.y2m, Math.round(sums.y2b / 1000), sums.y2inc, null, sums.y1s, sums.y1m, Math.round(sums.y1b / 1000), sums.y1inc, null, sums.nows, sums.nowm, sums.decided, null, sums.incAmt];
      targets.forEach((cell, i) => {
        if (!cell) return;
        cell.textContent = fmt(vals[i]);
      });
    }
  }

  clone.querySelectorAll('.si-exclude-col').forEach(el => el.remove());
  clone.querySelectorAll('input').forEach(input => {
    const span = document.createElement('span');
    span.textContent = input.value || '';
    input.replaceWith(span);
  });
  return clone;
}

/* 표에서 "적용월" 칸을 전부 빼고, 대신 상단에 한 줄로 표시할 문구를 돌려줌
   (직원마다 적용월이 다르면 그 사실을 그대로 안내함) */
function _removeSiAppliedMonthColumn(clone) {
  // 화면(live table)에서 직접 읽으면 타이밍에 따라 요소가 없을 수 있어서(인쇄 버튼 오류 원인),
  // 캐시(siReportCache)를 기준으로 삼고, 혹시 화면에 그 사이 새로 입력된 값이 있으면 그것만 보완
  const appliedMonths = new Set();
  const liveMap = {};
  document.querySelectorAll('#siTbody tr[data-emp-id]').forEach(tr => {
    const el = tr.querySelector('.si-applied-input');
    if (el && el.value) liveMap[tr.dataset.empId] = el.value;
  });
  (siReportCache || []).forEach(e => {
    const v = liveMap[e.employee_id] || (e.applied_month ? e.applied_month.slice(0, 7) : null);
    if (v) appliedMonths.add(v);
  });

  const headRow2 = clone.querySelector('thead tr:nth-child(2)');
  const head2Cells = Array.from(headRow2.children);
  // 0-based: [0~2]y3 [3~7]y2 [8~12]y1 [13~14]현재 [15]결정연봉 [16]적용월 [17]인상액 [18]인상률 [19]비고
  if (head2Cells[16]) head2Cells[16].remove();

  Array.from(clone.querySelectorAll('tbody tr')).forEach(tr => {
    if (tr.classList.contains('si-grand-total-row')) {
      const cells = Array.from(tr.children);
      if (cells[17]) cells[17].remove(); // 합계행의 적용월 자리(빈칸)
      return;
    }
    const cells = Array.from(tr.children);
    if (cells[22]) cells[22].remove(); // 데이터행의 적용월 칸
  });

  if (appliedMonths.size === 0) return '';
  if (appliedMonths.size === 1) {
    const [only] = appliedMonths;
    const [y, m] = only.split('-');
    return `적용월: ${y}년 ${m}월`;
  }
  return `적용월: 직원별로 다름 (${[...appliedMonths].sort().map(v => { const [y, m] = v.split('-'); return `${y}.${m}`; }).join(', ')})`;
}

function printSalaryIncreaseDecision() {
  if (siReportCache.length === 0) { alert('먼저 조회해주세요.'); return; }
  const year = $('siYear').value;
  $('si_print_title').textContent = `${year}년 연봉인상 검토표 (의사결정용)`;

  const clone = _cloneSiTableForPrint();
  const appliedLabel = _removeSiAppliedMonthColumn(clone);
  $('si_print_applied').textContent = appliedLabel;

  const headRow1 = clone.querySelector('thead tr:nth-child(1)');
  const decisionGroupTh = headRow1.children[headRow1.children.length - 1]; // si-exclude-col 제거 후 마지막 = "당해년도 인상 결정" 그룹헤더
  decisionGroupTh.setAttribute('colspan', '1');

  const headRow2 = clone.querySelector('thead tr:nth-child(2)');
  const head2Cells = Array.from(headRow2.children);
  // 적용월이 이미 빠진 뒤라: [0~2]y3 [3~7]y2 [8~12]y1 [13~14]현재 [15]결정연봉 [16]인상액 [17]인상률 [18]비고
  [head2Cells[16], head2Cells[17], head2Cells[18]].forEach(el => el && el.remove());
  if (head2Cells[15]) head2Cells[15].textContent = '결정연봉';

  Array.from(clone.querySelectorAll('tbody tr')).forEach(tr => {
    if (tr.classList.contains('si-grand-total-row')) return;
    const cells = Array.from(tr.children);
    if (cells.length < 25) return;
    [cells[22], cells[23], cells[24]].forEach(td => td && td.remove()); // 인상액,인상률,비고
  });
  const totalRow = clone.querySelector('.si-grand-total-row');
  if (totalRow) {
    const cells = Array.from(totalRow.children);
    // 적용월 자리가 이미 빠진 뒤라: [0]colspan6 [1~13]y3,y2,y2inc,y1,y1inc [14~15]현재 [16]결정연봉합계 [17]인상액합계 [18]빈 [19]빈
    [cells[17], cells[18], cells[19]].forEach(td => td && td.remove());
  }

  $('si_print_table_container').innerHTML = '';
  $('si_print_table_container').appendChild(clone);
  _siPrintLandscape();
}
function printSalaryIncreaseFinal() {
  if (siReportCache.length === 0) { alert('먼저 조회해주세요.'); return; }
  const year = $('siYear').value;
  $('si_print_title').textContent = `${year}년 연봉인상 확정 결정내용`;

  const clone = _cloneSiTableForPrint();
  const appliedLabel = _removeSiAppliedMonthColumn(clone);
  $('si_print_applied').textContent = appliedLabel;

  $('si_print_table_container').innerHTML = '';
  $('si_print_table_container').appendChild(clone);
  _siPrintLandscape();
}

function initPromotionsTab() {
  if (!$('promoAsOf').value) {
    $('promoAsOf').value = new Date().toISOString().slice(0, 10);
  }
  switchPromotionsSubTab('live');
  loadPromotionsLive();
}

function switchPromotionsSubTab(name) {
  document.querySelectorAll('[data-promosub]').forEach(b => b.classList.toggle('active', b.dataset.promosub === name));
  $('promoLiveView').style.display = name === 'live' ? 'block' : 'none';
  $('promoHistoryView').style.display = name === 'history' ? 'block' : 'none';
  $('promoBulkView').style.display = name === 'bulk' ? 'block' : 'none';
  $('promoStandardsView').style.display = name === 'standards' ? 'block' : 'none';
  if (name === 'history') {
    populatePromoHistoryEmployeeSelect();
    populatePositionSelect('ph_position', '');
  }
  if (name === 'bulk' && $('promoBulkTbody').dataset.loaded !== '1') {
    $('promoBulkTbody').dataset.loaded = '1';
    loadPromoBulkTable();
  }
  if (name === 'standards') loadPositionStandards();
}

async function loadPromotionsLive() {
  const tbody = $('promoLiveTbody');
  tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  const asof = $('promoAsOf').value || new Date().toISOString().slice(0, 10);
  const includeRetired = $('promoIncludeRetired').checked ? '&all=1' : '';
  try {
    const res = await fetch(`${apiBase()}/api/promotions?asof=${asof}${includeRetired}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || '조회 실패');
    promoLiveCache = data.employees || [];
    renderPromotionsTable(promoLiveCache, tbody);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패: ${esc(e.message || '')}</td></tr>`;
  }
}

/* ── 승진 일괄입력 ── */
async function loadPromoBulkTable() {
  const tbody = $('promoBulkTbody');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const [res] = await Promise.all([
      fetch(`${apiBase()}/api/promotions?asof=${new Date().toISOString().slice(0, 10)}`, {
        headers: { 'X-HR-Password': hrPassword() },
      }),
      ensurePositionStandardsLoaded(),  // 직급 드롭다운용 목록도 같이 미리 받아둠
    ]);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || '조회 실패');
    const employees = data.employees || [];
    if (employees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">재직 직원이 없습니다.</td></tr>`;
      return;
    }
    const positionOptions = '<option value="">-- 선택 --</option>' +
      positionStandardsCache.map(s => `<option value="${esc(s.position)}">${esc(s.position)}</option>`).join('');
    tbody.innerHTML = employees.map(e => `
      <tr data-emp-id="${e.employee_id}">
        <td>${esc(e.name)}</td>
        <td>${esc(e.branch || '-')}</td>
        <td>${esc(e.department || '-')}</td>
        <td>${esc(e.position || '-')}</td>
        <td><input type="date" class="hr-input promo-bulk-date" style="width:140px;"></td>
        <td><select class="hr-input promo-bulk-position" style="width:130px;">${positionOptions}</select></td>
        <td><input type="text" class="hr-input promo-bulk-note" style="width:120px;"></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패: ${esc(e.message || '')}</td></tr>`;
  }
}

function applyPromoBulkDate(emptyOnly) {
  const value = $('promoBulkDateInput').value;
  if (!value) {
    alert('일괄 적용할 승진일을 먼저 선택해주세요.');
    return;
  }
  const rows = document.querySelectorAll('#promoBulkTbody tr[data-emp-id]');
  if (rows.length === 0) {
    alert('먼저 조회를 눌러 직원 목록을 불러와주세요.');
    return;
  }
  // "승진 후 직급"을 입력해둔 사람한테만 승진일을 채움 — 전체 직원한테 무작정 날짜부터
  // 채워버리면(직급은 안 정한 상태로) 화면에 승진 대상이 아닌 사람까지 날짜가 찍혀 보여서
  // 헷갈릴 수 있으므로, 직급을 먼저 입력해두시는 걸 기준으로 동작함.
  let count = 0;
  let skippedNoPosition = 0;
  rows.forEach(tr => {
    const dateInput = tr.querySelector('.promo-bulk-date');
    const posInput = tr.querySelector('.promo-bulk-position');
    if (!dateInput || !posInput) return;
    if (!posInput.value.trim()) { skippedNoPosition += 1; return; }
    if (emptyOnly && dateInput.value !== '') return;
    dateInput.value = value;
    count += 1;
  });
  if (count === 0 && skippedNoPosition > 0) {
    alert('"승진 후 직급"을 먼저 입력한 직원이 없어서 적용할 대상이 없습니다. 직급부터 입력해주세요.');
    return;
  }
  alert(`${count}명에게 적용했습니다. (직급을 아직 안 입력한 ${skippedNoPosition}명은 건너뜀)`);
}

async function savePromoBulk() {
  const items = [];
  document.querySelectorAll('#promoBulkTbody tr[data-emp-id]').forEach(tr => {
    const dateEl = tr.querySelector('.promo-bulk-date');
    const posEl = tr.querySelector('.promo-bulk-position');
    const noteEl = tr.querySelector('.promo-bulk-note');
    if (!dateEl || !posEl) return;
    const position = posEl.value.trim();
    if (!position) return;  // 승진 후 직급을 입력한 사람만 처리
    items.push({
      employee_id: tr.dataset.empId,
      effective_date: dateEl.value || null,
      position,
      note: noteEl ? noteEl.value.trim() || null : null,
    });
  });
  const missingDate = items.filter(it => !it.effective_date);
  if (missingDate.length > 0) {
    alert(`승진 후 직급은 입력했는데 승진일이 비어있는 직원이 ${missingDate.length}명 있습니다. 승진일도 입력해주세요.`);
    return;
  }
  if (items.length === 0) {
    alert('저장할 대상이 없습니다. 승진 후 직급을 입력한 직원이 있어야 저장됩니다.');
    return;
  }
  if (!confirm(`${items.length}명의 승진 기록을 추가하시겠습니까?\n(급여에는 자동 반영되지 않습니다 — 반영 시점은 "직급이력 관리"에서 따로 지정하시면 됩니다.)`)) return;

  $('promoBulkMsg').textContent = '저장 중…';
  try {
    const res = await fetch(`${apiBase()}/api/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'bulk_position_history', items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.detail || '저장 실패');
    $('promoBulkMsg').className = 'hr-msg success';
    $('promoBulkMsg').textContent = `${data.count}명 저장되었습니다.`;
    loadPromoBulkTable();
  } catch (e) {
    $('promoBulkMsg').className = 'hr-msg';
    $('promoBulkMsg').textContent = '저장 중 오류가 발생했습니다: ' + (e.message || '');
  }
}

function renderPromotionsTable(list, tbody) {
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:24px;">데이터가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(e => `
    <tr>
      <td>${esc(e.branch || '-')}</td>
      <td>${esc(e.department || '-')}</td>
      <td>${esc(e.name)}</td>
      <td>${esc(e.position || '-')}</td>
      <td>${esc(e.hire_date || '-')}</td>
      <td class="num">${esc(e.tenure_current || '-')}</td>
      <td class="num">${esc(e.tenure_prior_year_end || '-')}</td>
      <td>${esc(e.last_promotion_date || '-')}</td>
      <td>${esc(e.last_promotion_position || '-')}</td>
      <td>${e.employee_id ? `<a class="hr-edit-link" onclick="switchPromotionsSubTab('history'); setTimeout(()=>selectPromoHistoryEmployee('${e.employee_id}'),50)">이력보기</a>` : ''}</td>
    </tr>
  `).join('');
}

function downloadPromotionsExcel() {
  if (!promoLiveCache || promoLiveCache.length === 0) { alert('먼저 조회해주세요.'); return; }
  const rows = [['지사', '부서', '성명', '직급', '입사일', '근속(기준일)', '근속(전년말)', '최근승진일', '최근승진직급']];
  promoLiveCache.forEach(e => {
    rows.push([e.branch || '', e.department || '', e.name, e.position || '', e.hire_date || '',
      e.tenure_current || '', e.tenure_prior_year_end || '', e.last_promotion_date || '', e.last_promotion_position || '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '인사기록');
  XLSX.writeFile(wb, `인사기록보고서_${$('promoAsOf').value || 'now'}.xlsx`);
}

function downloadBonusReportExcel() {
  if (!bonusReportCache || bonusReportCache.length === 0) { alert('먼저 조회해주세요.'); return; }
  const { year, round } = bonusReportMetaCache;
  const rows = [['순번', '이름', '지사', '부서', '직급', '결정기준/율', '결정성과급', '비고']];
  bonusReportCache.forEach((e, idx) => {
    rows.push([idx + 1, e.name, e.branch || '', e.department || '', e.position || '',
      e.criteria || '', e.decided_amount ?? '', e.note || '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${year}년 ${round}차`);
  XLSX.writeFile(wb, `성과급보고서_${year}_${round}차_확정내용.xlsx`);
}

function downloadSalaryIncreaseExcel() {
  if (!siReportCache || siReportCache.length === 0) { alert('먼저 조회해주세요.'); return; }
  const { year } = siReportMetaCache;
  const rows = [['순번', '이름', '지사', '부서', '직급', '결정연봉', '적용월', '인상액', '인상률', '비고']];
  siReportCache.forEach((e, idx) => {
    rows.push([idx + 1, e.name, e.branch || '', e.department || '', e.position || '',
      e.decided_salary ?? '', e.applied_month || '',
      (e.decided_salary != null && e.salary_now != null) ? e.decided_salary - e.salary_now : '',
      (e.decided_salary != null && e.salary_now) ? (((e.decided_salary - e.salary_now) / e.salary_now) * 100).toFixed(1) + '%' : '',
      e.note || '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${year}년`);
  XLSX.writeFile(wb, `연봉인상보고서_${year}_확정내용.xlsx`);
}

/* ── 직급이력 관리 ── */
async function populatePromoHistoryEmployeeSelect() {
  const sel = $('promoHistoryEmployeeSelect');
  if (sel.dataset.loaded === '1') return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees?all=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    sel.innerHTML = '<option value="">-- 직원 선택 --</option>' +
      (data.employees || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    sel.dataset.loaded = '1';
  } catch (e) {
    sel.innerHTML = '<option value="">불러오기 실패</option>';
  }
}

function selectPromoHistoryEmployee(employeeId) {
  populatePromoHistoryEmployeeSelect().then(() => {
    $('promoHistoryEmployeeSelect').value = employeeId;
    loadEmployeePositionHistory();
  });
}

async function loadEmployeePositionHistory() {
  const employeeId = $('promoHistoryEmployeeSelect').value;
  promoHistoryEmployeeId = employeeId || null;
  const tbody = $('promoHistoryTbody');
  if (!employeeId) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">직원을 먼저 선택해주세요.</td></tr>`;
    return;
  }
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/promotions?history=1&employee_id=${employeeId}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.history || [];
    promoHistoryCache = list;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 직급이력이 없습니다.</td></tr>`;
      return;
    }
    const thisMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    tbody.innerHTML = list.map(h => {
      const historyMonth = (h.effective_date || '').slice(0, 7);
      const isPast = historyMonth && historyMonth < thisMonth;
      const actionsHtml = isPast
        ? `<span class="promo-history-locked-actions" data-history-id="${h.id}">
             <span style="color:var(--text-muted); font-size:11px;">🔒 지난 이력</span>
             <a class="hr-edit-link" onclick="unlockPositionHistoryRow('${h.id}')">잠금해제</a>
           </span>`
        : `<a class="hr-edit-link" onclick="openApplyStandardModal('${employeeId}', '${esc(h.position)}')">급여반영</a>
           <a class="hr-edit-link" onclick="deletePositionHistory('${h.id}')">삭제</a>`;
      return `
      <tr>
        <td>${esc(h.effective_date)}</td>
        <td>${esc(h.position)}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${esc(h.note || '-')}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

async function addPositionHistory() {
  if (!promoHistoryEmployeeId) {
    $('promoHistoryMsg').textContent = '직원을 먼저 선택해주세요.';
    return;
  }
  const date = $('ph_date').value;
  const position = $('ph_position').value.trim();
  if (!date || !position) {
    $('promoHistoryMsg').textContent = '승진일과 직급은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        employee_id: promoHistoryEmployeeId,
        effective_date: date,
        position,
        note: $('ph_note').value.trim() || null,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || errData.error || `요청 실패 (상태코드 ${res.status})`);
    }
    $('ph_date').value = ''; $('ph_position').value = ''; $('ph_note').value = '';
    $('promoHistoryMsg').className = 'hr-msg success';
    $('promoHistoryMsg').textContent = '직급이력에 추가되었습니다. (급여에는 자동 반영 안 됨 — 반영할 시점이 되면 목록에서 "급여반영"을 눌러주세요)';
    loadEmployeePositionHistory();
  } catch (e) {
    $('promoHistoryMsg').className = 'hr-msg';
    $('promoHistoryMsg').textContent = '추가 중 오류가 발생했습니다: ' + (e.message || '');
  }
}

function unlockPositionHistoryRow(id) {
  if (!confirm('이미 지난 시점(지난달 이전)의 직급이력이에요.\n이미 지급된 급여명세서의 계산 근거가 흔들릴 수 있으니 신중하게 진행해주세요.\n\n정말로 이 건을 급여반영/삭제하시겠습니까?')) return;
  const h = promoHistoryCache.find(x => x.id === id);
  if (!h) return;
  const span = document.querySelector(`.promo-history-locked-actions[data-history-id="${id}"]`);
  if (!span) return;
  span.outerHTML = `
    <a class="hr-edit-link" onclick="openApplyStandardModal('${promoHistoryEmployeeId}', '${esc(h.position)}')">급여반영</a>
    <a class="hr-edit-link" onclick="deletePositionHistory('${id}')">삭제</a>
  `;
}

async function deletePositionHistory(id) {
  if (!confirm('이 직급이력을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/promotions?id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('failed');
    loadEmployeePositionHistory();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 급여기준표 관리 ── */
let positionStandardsCache = [];

async function ensurePositionStandardsLoaded() {
  if (positionStandardsCache.length > 0) return positionStandardsCache;
  try {
    const res = await fetch(`${apiBase()}/api/promotions?standards=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    positionStandardsCache = data.standards || [];
  } catch (e) {
    positionStandardsCache = [];
  }
  return positionStandardsCache;
}

async function populatePositionSelect(selectId, selectedValue) {
  const standards = await ensurePositionStandardsLoaded();
  const sel = $(selectId);
  if (standards.length === 0) {
    sel.innerHTML = '<option value="">급여기준표가 비어있습니다 — 먼저 등록해주세요</option>';
    return;
  }
  sel.innerHTML = '<option value="">-- 직급 선택 --</option>' +
    standards.map(s => `<option value="${esc(s.position)}">${esc(s.position)}</option>`).join('');
  if (selectedValue) sel.value = selectedValue;
}

async function loadPositionStandards() {
  const tbody = $('promoStandardsTbody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/promotions?standards=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    positionStandardsCache = data.standards || [];
    if (positionStandardsCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 기준이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = positionStandardsCache.map(s => `
      <tr>
        <td>${esc(s.position)}</td>
        <td class="num">${fmt(s.fixed_overtime_hours)}</td>
        <td class="num">${fmt(s.attendance_allowance)}</td>
        <td class="num">${fmt(s.meal_allowance)}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${esc(s.note || '-')}</td>
        <td>
          <a class="hr-edit-link" onclick="editPositionStandard('${esc(s.position)}')">수정</a>
          <a class="hr-edit-link" onclick="deletePositionStandard('${s.id}')">삭제</a>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function editPositionStandard(position) {
  const s = positionStandardsCache.find(x => x.position === position);
  if (!s) return;
  $('ps_position').value = s.position;
  $('ps_fixed_overtime_hours').value = s.fixed_overtime_hours;
  $('ps_attendance_allowance').value = s.attendance_allowance;
  $('ps_meal_allowance').value = s.meal_allowance;
}

async function savePositionStandard() {
  const position = $('ps_position').value.trim();
  if (!position) {
    $('promoStandardsMsg').textContent = '직급명은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'save_standard',
        position,
        fixed_overtime_hours: Number($('ps_fixed_overtime_hours').value) || 0,
        attendance_allowance: Number($('ps_attendance_allowance').value) || 0,
        meal_allowance: Number($('ps_meal_allowance').value) || 0,
      }),
    });
    if (!res.ok) throw new Error('failed');
    $('ps_position').value = ''; $('ps_fixed_overtime_hours').value = '';
    $('ps_attendance_allowance').value = ''; $('ps_meal_allowance').value = '';
    $('promoStandardsMsg').className = 'hr-msg success';
    $('promoStandardsMsg').textContent = '저장되었습니다.';
    loadPositionStandards();
  } catch (e) {
    $('promoStandardsMsg').className = 'hr-msg';
    $('promoStandardsMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deletePositionStandard(id) {
  if (!confirm('이 직급 기준을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/promotions?id=${id}&type=standard`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('failed');
    loadPositionStandards();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 급여기준 반영 (직급이력과 별개 시점 지정) ── */
let pendingApplyStandardEmployeeId = null;

function openApplyStandardModal(employeeId, position) {
  pendingApplyStandardEmployeeId = employeeId;
  populatePositionSelect('as_position', position);
  $('as_month').value = '';
  $('as_note').value = '';
  $('applyStandardModalMsg').textContent = '';
  const emp = employeesCache.find(e => e.id === employeeId);
  $('asCurrentPayPositionHint').textContent = emp
    ? `현재 급여직급: ${emp.pay_position || '(미설정)'}`
    : '';
  $('applyStandardModal').style.display = 'flex';
}

function closeApplyStandardModal() {
  $('applyStandardModal').style.display = 'none';
}

async function confirmApplyStandard() {
  const month = $('as_month').value;
  const position = $('as_position').value.trim();
  if (!month || !position) {
    $('applyStandardModalMsg').textContent = '반영월과 직급은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'apply_standard',
        employee_id: pendingApplyStandardEmployeeId,
        effective_month: `${month}-01`,
        position,
        note: $('as_note').value.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'failed');
    closeApplyStandardModal();
    alert('급여설정에 반영되었습니다.');
  } catch (e) {
    $('applyStandardModalMsg').textContent = e.message || '반영 중 오류가 발생했습니다.';
  }
}

/* ── 직급별 이력표(피벗) ── */
function switchPromoViewMode(mode) {
  document.querySelectorAll('[data-promoview]').forEach(b => b.classList.toggle('active', b.dataset.promoview === mode));
  $('promoLiveTableWrap').style.display = mode === 'list' ? 'block' : 'none';
  $('promoMatrixWrap').style.display = mode === 'matrix' ? 'block' : 'none';
  if (mode === 'matrix') {
    ensurePositionStandardsLoaded().then(() => renderPromotionMatrixInto('promoMatrixWrap', promoLiveCache));
  }
}

function buildPromotionMatrixColumns(list) {
  // 급여기준표 순서(만근수당 오름차순 = 사원→대표이사)를 기본 컬럼 순서로 쓰고,
  // 기준표에 없는 직급명(과거 이력의 오타/이명 등)은 뒤에 별도로 붙임.
  const standardOrder = positionStandardsCache.map(s => s.position);
  const seen = new Set();
  list.forEach(e => (e.history || []).forEach(h => seen.add(h.position)));

  const ordered = standardOrder.filter(p => seen.has(p));
  const extra = [...seen].filter(p => !standardOrder.includes(p)).sort();
  return [...ordered, ...extra];
}

function renderPromotionMatrixInto(containerId, list) {
  const container = $(containerId);
  if (!list || list.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px;">데이터가 없습니다.</div>`;
    return;
  }
  const columns = buildPromotionMatrixColumns(list);
  if (columns.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px;">등록된 직급이력이 없습니다. "직급이력 관리"에서 먼저 등록해주세요.</div>`;
    return;
  }

  const headerHtml = `<th>지사</th><th>부서</th><th>성명</th><th>현재직급</th><th>입사일</th>` +
    columns.map(c => `<th style="text-align:center;">${esc(c)}</th>`).join('');

  const rowsHtml = list.map(e => {
    // 직급별로 "가장 이른(최초로 그 직급을 단) 날짜"를 셀에 표시
    const earliestByPosition = {};
    (e.history || []).forEach(h => {
      if (!earliestByPosition[h.position] || h.date < earliestByPosition[h.position]) {
        earliestByPosition[h.position] = h.date;
      }
    });
    const cells = columns.map(c => {
      const date = earliestByPosition[c];
      if (!date) return `<td style="text-align:center; color:var(--border-strong);">-</td>`;
      const year = date.slice(0, 4);
      const isCurrent = c === e.position;
      return `<td style="text-align:center; ${isCurrent ? 'font-weight:700; background:var(--green-light); color:var(--green);' : ''}" title="${esc(date)}">${year}</td>`;
    }).join('');
    return `
      <tr>
        <td>${esc(e.branch || '-')}</td>
        <td>${esc(e.department || '-')}</td>
        <td>${esc(e.name)}</td>
        <td style="font-weight:600;">${esc(e.position || '-')}</td>
        <td>${esc(e.hire_date || '-')}</td>
        ${cells}
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="table">
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="font-size:11px; color:var(--text-muted); margin-top:8px; padding:0 4px;">
      숫자는 그 직급을 처음 단 연도입니다 (마우스를 올리면 정확한 날짜가 보입니다). 초록색으로 표시된 칸이 현재 직급입니다.
      직급이력이 없는 칸은 "-"로 표시됩니다.
    </div>
  `;
}

/* ── 직급별 이력표 인쇄 ── */
/* ── 직급별 이력표 인쇄 ── */
function printCurrentPromoView() {
  // "목록형"인지 "직급별 이력표"인지 자동으로 판단해서 그 화면 그대로 인쇄함.
  const isMatrix = document.querySelector('[data-promoview="matrix"]').classList.contains('active');
  printPromotionMatrix(isMatrix ? 'promoMatrixWrap' : 'promoLiveTableWrap');
}

function printPromotionMatrix(containerId) {
  const source = $(containerId);
  if (!source || !source.querySelector('table')) {
    alert('먼저 "직급별 이력표"를 조회해주세요.');
    return;
  }
  const asOfDate = $('promoAsOf').value || new Date().toISOString().slice(0, 10);
  const title = `${asOfDate.slice(0, 4)}년 진급자 보고서(기준일: ${asOfDate})`;

  $('promoMatrixPrintTitle').textContent = title;
  $('promoMatrixPrintBody').innerHTML = source.innerHTML;
  $('promoMatrixPrintArea').style.display = 'block';

  const style = document.createElement('style');
  style.id = 'promoMatrixPrintStyle';
  style.textContent = `
    @media print {
      body * { visibility: hidden; }
      .layout { display: none !important; }
      #promoMatrixPrintArea, #promoMatrixPrintArea * { visibility: visible; }
      #promoMatrixPrintArea { position: static; width: 100%; }
      @page { size: landscape; margin: 8mm; }
      #promoMatrixPrintTitle { font-size: 14px; margin-bottom: 6px; }
      #promoMatrixPrintBody table { font-size: 8.5px; border-collapse: collapse; width: 100%; }
      #promoMatrixPrintBody th, #promoMatrixPrintBody td { padding: 2px 4px; line-height: 1.2; }
      #promoMatrixPrintBody > div:last-child { font-size: 8px; }
      #promoMatrixPrintBody table.promo-list-table th:last-child, #promoMatrixPrintBody table.promo-list-table td:last-child { display: none; }
    }
  `;
  document.head.appendChild(style);

  window.print();

  document.head.removeChild(style);
  $('promoMatrixPrintArea').style.display = 'none';
}
