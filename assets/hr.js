/* ───────── hr.js ───────── */

const $ = id => document.getElementById(id);
const fmt = n => (n == null || isNaN(n)) ? '-' : Math.round(n).toLocaleString('ko-KR');

function apiBase() { return window.location.origin; }
function hrPassword() { return sessionStorage.getItem('chwork_hr_pw') || ''; }

/* ── 로그인 ── */
/* ── 전체 데이터 백업 ── */
function refreshLastBackupLabel() {
  const saved = localStorage.getItem('chwork_last_backup');
  $('lastBackupLabel').textContent = saved ? `마지막 백업: ${saved}` : '아직 백업한 적 없음';
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
    localStorage.setItem('chwork_last_backup', stamp);
    refreshLastBackupLabel();
  } catch (e) {
    alert('백업 다운로드 중 오류가 발생했습니다: ' + (e.message || ''));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
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
    if (data.ok) {
      sessionStorage.setItem('chwork_hr_pw', pw);
      showMain();
    } else {
      $('loginMsg').textContent = '비밀번호가 올바르지 않습니다.';
    }
  } catch (e) {
    $('loginMsg').textContent = '서버 연결에 실패했습니다.';
  }
}

function showMain() {
  $('loginPanel').style.display = 'none';
  $('hrMain').style.display = 'flex';
  const validGroups = ['home', 'payroll', 'pension', 'contacts', 'contractdocs'];
  const hashGroup = (window.location.hash || '').replace('#', '');
  switchMenuGroup(validGroups.includes(hashGroup) ? hashGroup : 'home');
  loadEmployees();
}

/* ── 탭 전환 ── */
const MENU_GROUPS = {
  home: { label: null, tabs: [{ id: 'employees', label: '직원마스터' }] },
  payroll: {
    label: '급여관리',
    tabs: [
      { id: 'payroll', label: '월별 급여명세' },
      { id: 'otherpay', label: '성과급/기타지급' },
      { id: 'annual', label: '직원별 연간 급여 종합' },
      { id: 'contracts', label: '연봉계약서' },
      { id: 'promotions', label: '인사기록보고서' },
    ],
  },
  pension: {
    label: '퇴직급여관리',
    tabs: [
      { id: 'pension', label: '퇴직연금 현황' },
      { id: 'settlement', label: '퇴사자 정산' },
    ],
  },
  contacts: { label: null, tabs: [{ id: 'contacts', label: '거래처 연락처' }] },
  contractdocs: { label: null, tabs: [{ id: 'contractdocs', label: '계약/증빙관리' }] },
};

let currentMenuGroup = 'home';

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

  // 상단 탭바 렌더링
  const bar = $('hrTabBar');
  if (g.tabs.length <= 1) {
    bar.style.display = 'none';
    $('hrGroupLabel').style.display = 'none';
  } else {
    bar.style.display = 'flex';
    $('hrGroupLabel').style.display = 'block';
    $('hrGroupLabel').textContent = g.label;
    bar.innerHTML = g.tabs.map((t, i) => `
      <button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.id}" onclick="switchHrTab('${t.id}')">${t.label}</button>
    `).join('');
  }

  switchHrTab(g.tabs[0].id);
}

function switchHrTab(name) {
  document.querySelectorAll('#hrTabBar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('tab-employees').style.display = name === 'employees' ? 'block' : 'none';
  $('tab-pension').style.display = name === 'pension' ? 'block' : 'none';
  $('tab-settlement').style.display = name === 'settlement' ? 'block' : 'none';
  $('tab-payroll').style.display = name === 'payroll' ? 'block' : 'none';
  $('tab-otherpay').style.display = name === 'otherpay' ? 'block' : 'none';
  $('tab-annual').style.display = name === 'annual' ? 'block' : 'none';
  $('tab-contracts').style.display = name === 'contracts' ? 'block' : 'none';
  $('tab-promotions').style.display = name === 'promotions' ? 'block' : 'none';
  $('tab-contacts').style.display = name === 'contacts' ? 'block' : 'none';
  $('tab-contractdocs').style.display = name === 'contractdocs' ? 'block' : 'none';
  if (name === 'pension') { populateYearSelect('pensionLockYear'); loadPension(); refreshPensionLockStatus(); }
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
  if (hrPassword()) showMain();
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
    const res = await fetch(`${apiBase()}/api/hr_employees?contract_expiring=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.employees || [];
    if (list.length === 0) {
      $('contractExpiryBox').style.display = 'none';
      return;
    }
    $('contractExpiryBox').style.display = 'block';
    $('contractExpiryList').innerHTML = list.map(e => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:12px;">
        <span><b>${esc(e.name)}</b>(${esc(e.branch || '-')}/${esc(e.department || '-')}) — 계약 ${esc(e.contract_end_date)} ${e.is_expired ? '만료됨' : '만료 예정'}</span>
        <span>
          <a class="hr-edit-link" onclick="convertContractToRegular('${e.employee_id}', '${esc(e.name)}')">정규직 전환</a>
          <a class="hr-edit-link" style="margin-left:8px;" onclick="openEditModal('${e.employee_id}')">퇴사 처리(수정에서)</a>
        </span>
      </div>
    `).join('');
  } catch (e) {
    $('contractExpiryBox').style.display = 'none';
  }
}

async function convertContractToRegular(empId, name) {
  const month = prompt(`${name} 님을 정규직으로 전환할 시작월을 입력해주세요 (예: 2026-08)`);
  if (!month) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ type: 'convert_to_regular', employee_id: empId, effective_month: `${month}-01` }),
    });
    if (!res.ok) throw new Error('convert failed');
    alert('정규직으로 전환되었습니다.');
    loadContractExpiring();
  } catch (e) {
    alert('전환 중 오류가 발생했습니다.');
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
      <td>${esc(emp.position || '-')}</td>
      <td>${esc(emp.branch || '-')}</td>
      <td>${esc(emp.department || '-')}</td>
      <td>${esc(emp.hire_date || '-')}</td>
      <td><span class="hr-badge ${emp.status === '재직' ? 'active' : 'retired'}">${esc(emp.status)}</span></td>
      <td>${esc(emp.current_employment_type || '-')}${emp.current_pay_rate != null && emp.current_pay_rate != 1 ? ` (${Math.round(emp.current_pay_rate*100)}%)` : ''}</td>
      <td class="num">${fmt(emp.current_salary_thousand)}</td>
      <td><span class="hr-badge ${emp.pension_enrolled ? 'yes' : 'no'}">${emp.pension_enrolled ? '가입' : '미가입'}</span></td>
      <td><a class="hr-edit-link" onclick="openEditModal('${emp.id}')">수정</a> · <a class="hr-edit-link" onclick="deleteEmployee('${emp.id}', '${esc(emp.name)}')">삭제</a></td>
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
  tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    renderPension(data.pension || [], asOf);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function renderPension(list, asOf) {
  $('pensionCount').textContent = `총 ${list.length}명`;
  $('asOfCumHeader').textContent = asOf ? `${asOf} 기준 누적추계액` : '지정일자 누적추계액';
  $('periodAccrualHeader').textContent = asOf ? `${asOf.slice(0,4)}년 1월~${asOf.slice(5)} 발생액` : '해당연도 1월~지정일 발생액';
  const tbody = $('pensionTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center; color:var(--text-muted); padding:24px;">DC 가입자가 없습니다.</td></tr>`;
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
    $('contribMsg').textContent = '직원, 입금일, 금액은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('save failed');
    closeContribModal();
    loadPension();
  } catch (e) {
    $('contribMsg').textContent = '저장 중 오류가 발생했습니다.';
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
    $('s_retire_display').textContent = retireDate;
    $('s_cum').textContent = fmt(data.cumulative_estimate) + '원';
    $('s_paid').textContent = fmt(data.total_contributed) + '원';
    $('s_add').textContent = fmt(data.additional_payment) + '원';
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

  const payload = {
    employee_id: $('s_employee_id').value,
    retire_date: $('s_retire_date').value,
    cumulative_estimate: Number(r.dataset.cum),
    total_contributed: Number(r.dataset.paid),
    additional_payment: add,
    deduction_total: deduction,
    year_end_tax_refund: refund,
    other_payment: other,
    net_payment: net,
    note: $('s_note').value.trim() || null,
  };

  if (!confirm('정산을 확정하시겠습니까? 저장 후 해당 직원은 "퇴사" 상태로 자동 변경됩니다.')) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_settlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('save failed');
    $('settlementMsg').textContent = '';
    $('settlementMsg').className = 'hr-msg success';
    $('settlementMsg').textContent = '정산이 확정 저장되었습니다.';
    loadSettlementHistory();
  } catch (e) {
    $('settlementMsg').className = 'hr-msg';
    $('settlementMsg').textContent = '저장 중 오류가 발생했습니다.';
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
  if (!confirm(`${name}님의 정산 확정을 되돌리시겠습니까?\n이 정산 기록이 삭제되고, 해당 직원은 다시 "재직" 상태로 복구됩니다.`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/hr_settlement?id=${id}`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('revert failed');
    alert('되돌렸습니다.');
    loadSettlementHistory();
    $('s_employee_id').dataset.loaded = '0';
    populateSettlementEmployeeSelect();
  } catch (e) {
    alert('되돌리는 중 오류가 발생했습니다.');
  }
}

/* ── 정산내역서 출력/다운로드 ── */
function printSettlement() {
  window.print();
}

function downloadSettlementExcel() {
  const name = $('s_name').textContent;
  const rows = [
    ['퇴직금(DC형 퇴직연금) 정산내역서'],
    [],
    ['성명', name],
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
  const date = $('pensionAsOf').value;
  if (!date) {
    alert('먼저 위에서 "기준일자"를 지정해주세요 (이 날짜로 저장됩니다).');
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
  if (!confirm(`${items.length}명에게 총 ${fmt(items.reduce((s, i) => s + i.amount, 0))}원을 ${date}자로 저장하시겠습니까?`)) return;

  try {
    const res = await fetch(`${apiBase()}/api/hr_pension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error('save failed');
    alert('저장되었습니다.');
    loadPension();
  } catch (e) {
    alert('저장 중 오류가 발생했습니다.');
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
              <a class="hr-edit-link" onclick="editContributionRow(this)">수정</a>
              <a class="hr-edit-link" style="margin-left:8px;" onclick="deleteContribution('${c.id}', '${employeeId}', '${esc(name)}')">삭제</a>
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
    if (!res.ok) throw new Error('delete failed');
    openHistoryModal(employeeId, name);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
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
    alert('입금일과 금액은 필수입니다.');
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({ contribution_date: date, amount, note }),
    });
    if (!res.ok) throw new Error('update failed');
    openHistoryModal(currentHistoryEmployeeId, currentHistoryEmployeeName);
  } catch (e) {
    alert('수정 중 오류가 발생했습니다.');
  }
}

/* ── 월별 급여명세 ── */
function payrollYearMonthDate() {
  const m = $('payrollMonth').value; // "2026-07"
  return m ? `${m}-01` : '';
}

async function loadPayrollPreview() {
  const ym = payrollYearMonthDate();
  if (!ym) { alert('먼저 월을 선택해주세요.'); return; }
  const tbody = $('payrollTbody');
  tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  $('retroAdjHeader').textContent = '소급인상분';
  $('finalTotalHeader').textContent = '최종 지급액';
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
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    renderPayroll(data.payroll || [], false);
    refreshPayrollLockStatus();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

let payrollCache = [];

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
      <td><a class="hr-edit-link" onclick="openPayslipModal(${idx})">명세서</a>${savedMode ? ` · <a class="hr-edit-link" onclick="deletePayrollRecord('${p.id}', '${esc(p.name)}')">삭제</a>` : ''}</td>
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
  $('pensionLockStatus').textContent = current && current.locked ? `🔒 ${year}년 마감됨` : `${year}년 마감 전`;
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
  $('otherpayLockStatus').textContent = current && current.locked ? `🔒 ${year}년 마감됨` : `${year}년 마감 전`;
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
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments?year=${year}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.payments || [];
    $('otherpayCount').textContent = `총 ${list.length}건`;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">${year}년 지급 내역이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = list.map(p => `
        <tr>
          <td>${esc(p.employees?.name || '-')}</td>
          <td>${esc(p.employees?.branch || '-')}</td>
          <td>${esc(p.employees?.department || '-')}</td>
          <td>${esc(p.payment_type)}</td>
          <td>${esc((p.payment_date || '').slice(0,7))}</td>
          <td class="num">${fmt(p.amount)}</td>
          <td>${esc(p.note || '-')}</td>
          <td><a class="hr-edit-link" onclick="deleteOtherPayment('${p.id}')">삭제</a></td>
        </tr>
      `).join('');
      const total = list.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      tbody.innerHTML += `
        <tr class="hr-total-row">
          <td colspan="5">합계 (${list.length}건)</td>
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
        <tr><td colspan="8" style="padding:14px 4px 6px; font-size:12px; color:var(--text-muted); font-weight:500;">지사별 합계</td></tr>
      `;
      branchOrder.forEach(b => {
        const arr = byBranch[b];
        const branchTotal = arr.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        tbody.innerHTML += `
          <tr class="hr-total-row">
            <td colspan="5">${esc(b)} (${arr.length}건)</td>
            <td class="num">${fmt(branchTotal)}</td>
            <td colspan="2"></td>
          </tr>
        `;
      });
    }
    refreshOtherPayLockStatus();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function openOtherPayModal() {
  $('op_date').value = '';
  $('op_amount').value = '';
  $('op_note').value = '';
  $('otherPayMsg').textContent = '';
  $('otherPayModal').style.display = 'flex';
}
function closeOtherPayModal() {
  $('otherPayModal').style.display = 'none';
}

async function saveOtherPayment() {
  const payload = {
    employee_id: $('op_employee_id').value,
    payment_type: $('op_payment_type').value,
    payment_date: $('op_date').value ? `${$('op_date').value}-01` : '',
    amount: Number($('op_amount').value),
    note: $('op_note').value.trim() || null,
  };
  if (!payload.employee_id || !payload.payment_date || !payload.amount) {
    $('otherPayMsg').textContent = '직원, 지급월, 금액은 필수입니다.';
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/hr_other_payments`, {
      method: 'POST',
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
  const month = $('bulkOpDate').value;
  if (!month) { alert('먼저 지급월을 선택해주세요.'); return; }
  $('bulkOpWrap').style.display = 'block';
  $('bulkOpWrap2').style.display = 'block';
  $('bulkOpTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
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

async function saveBulkOtherPayments() {
  const paymentType = $('bulkOpType').value;
  const month = $('bulkOpDate').value;
  if (!month) { alert('지급월을 선택해주세요.'); return; }
  const date = `${month}-01`;

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
  if (!confirm(`${items.length}명에게 "${paymentType}" ${fmt(items.reduce((s,i)=>s+i.amount,0))}원을 ${month}월로 저장하시겠습니까?`)) return;

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
  const month = $('pr_month').value;
  const rate = Number($('pr_rate').value);
  const employmentType = $('pr_employment_type').value;
  const contractEnd = $('pr_contract_end').value;
  if (!empId || !month || !rate) {
    $('payRateMsg').textContent = '적용 시작월, 요율은 필수입니다.';
    return;
  }
  const payload = {
    type: 'pay_rate',
    employee_id: empId,
    effective_month: `${month}-01`,
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
    $('payRateMsg').textContent = `적용되었습니다 (${rate}%, ${month}부터).`;
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
  }

  $('payslipModal').style.display = 'flex';
}

function closePayslipModal() {
  $('payslipModal').style.display = 'none';
}

function printPayslip() {
  $('registerPrintArea').style.display = 'none';
  window.print();
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

  // 대장 출력만 가로(landscape)로 인쇄 — 임시 스타일 삽입 후 인쇄 후 제거
  const landscapeStyle = document.createElement('style');
  landscapeStyle.id = 'registerLandscapeStyle';
  landscapeStyle.textContent = '@page { size: landscape; }';
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
      <td style="font-size:12px; color:var(--text-secondary);">${esc(c.note || '-')}</td>
      <td>
        <a class="hr-edit-link" onclick="editContact('${c.id}')">수정</a>
        · <a class="hr-edit-link" onclick="deleteContact('${c.id}', '${esc(c.company_name)}')">삭제</a>
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
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    contractDocCache = data.documents || [];
    populateContractDocTypeFilter();
    renderContractDocs();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function populateContractDocTypeFilter() {
  const types = [...new Set(contractDocCache.map(c => c.doc_type).filter(Boolean))].sort();
  const sel = $('cdTypeFilter');
  const current = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  sel.value = current;
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
    const noteText = status === 'terminated'
      ? `해지일 ${esc(c.terminated_date)}${c.termination_note ? ' — ' + esc(c.termination_note) : ''}`
      : esc(c.note || '-');
    return `
    <tr>
      <td>${esc(c.doc_type || '-')}</td>
      <td>${esc(c.vendor_name || '-')}</td>
      <td>${esc(c.contract_title || '-')}</td>
      <td style="font-size:12px;">${esc(c.contract_start_date || '-')} ~ ${esc(c.contract_end_date || '-')}${c.auto_renew ? ' <span style="color:var(--text-muted);">(자동연장 조항)</span>' : ''}</td>
      <td>${contractDocStatusBadge(status)}</td>
      <td>${(c.contract_end_date && status !== 'terminated') ? cdDDayBadge(c.contract_end_date) : '-'}</td>
      <td>${c.view_url ? `<a href="${esc(c.view_url)}" target="_blank" rel="noopener" download="${esc(c.file_name || '')}" class="hr-edit-link">${esc(c.file_name || '보기')}</a>` : (c.file_name ? esc(c.file_name) + ' (만료된 링크, 새로고침 필요)' : '-')}</td>
      <td style="font-size:12px; color:var(--text-secondary);">${noteText}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap; white-space:nowrap;">
          <a class="hr-edit-link" onclick="editContractDoc('${c.id}')">수정</a>
          <span style="color:var(--border-strong);">|</span>
          <a class="hr-edit-link" onclick="deleteContractDoc('${c.id}', '${esc(c.contract_title || c.vendor_name || '서류')}')">삭제</a>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; white-space:nowrap; margin-top:4px;">
          ${status === 'terminated'
            ? `<a class="hr-edit-link" onclick="reactivateContractDoc('${c.id}')">해지취소</a>`
            : `<a class="hr-edit-link" onclick="openRenewModal('${c.id}')">연장</a>
               <span style="color:var(--border-strong);">|</span>
               <a class="hr-edit-link" onclick="openTerminateModal('${c.id}')">해지</a>`}
          <span style="color:var(--border-strong);">|</span>
          <a class="hr-edit-link" onclick="openRenewHistoryModal('${c.id}', '${esc(c.contract_title || c.vendor_name || '서류')}')">이력</a>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

function openContractDocModal() {
  editingContractDocId = null;
  $('contractDocModalTitle').textContent = '서류 업로드';
  ['vendor_name', 'contract_title', 'start_date', 'end_date', 'note'].forEach(f => $('cd_' + f).value = '');
  $('cd_doc_type').value = '계약서[일반]';
  $('cd_reminder_days').value = '14';
  $('cd_auto_renew').checked = false;
  $('cd_file').value = '';
  $('cdFileUploadWrap').style.display = 'block';
  $('cdExistingFileWrap').style.display = 'none';
  $('contractDocModalMsg').textContent = '';
  $('contractDocSaveBtn').disabled = false;
  toggleContractDocTypeFields();
  $('contractDocModal').style.display = 'flex';
}

function isContractLikeDocType(docType) {
  return (docType || '').startsWith('계약서') || docType === '지급보증서';
}

function toggleContractDocTypeFields() {
  const isContract = isContractLikeDocType($('cd_doc_type').value);
  $('cdContractDatesWrap').style.display = isContract ? 'grid' : 'none';
}

function editContractDoc(id) {
  const c = contractDocCache.find(x => x.id === id);
  if (!c) return;
  editingContractDocId = id;
  $('contractDocModalTitle').textContent = `서류 수정 — ${c.contract_title || c.vendor_name || ''}`;
  $('cd_doc_type').value = c.doc_type || '';
  $('cd_vendor_name').value = c.vendor_name || '';
  $('cd_contract_title').value = c.contract_title || '';
  $('cd_start_date').value = c.contract_start_date || '';
  $('cd_end_date').value = c.contract_end_date || '';
  $('cd_reminder_days').value = c.reminder_days_before != null ? c.reminder_days_before : 14;
  $('cd_auto_renew').checked = !!c.auto_renew;
  $('cd_note').value = c.note || '';
  $('cdFileUploadWrap').style.display = 'none';
  if (c.file_name) {
    $('cdExistingFileWrap').style.display = 'block';
    $('cdExistingFileLink').textContent = c.file_name;
    $('cdExistingFileLink').href = c.view_url || '#';
  } else {
    $('cdExistingFileWrap').style.display = 'none';
  }
  $('contractDocModalMsg').textContent = '';
  $('contractDocSaveBtn').disabled = false;
  toggleContractDocTypeFields();
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

  const payload = {
    doc_type: $('cd_doc_type').value.trim() || null,
    vendor_name: $('cd_vendor_name').value.trim() || null,
    contract_title: $('cd_contract_title').value.trim() || null,
    contract_start_date: $('cd_start_date').value || null,
    contract_end_date: $('cd_end_date').value || null,
    reminder_days_before: Number($('cd_reminder_days').value) || 0,
    auto_renew: $('cd_auto_renew').checked,
    note: $('cd_note').value.trim() || null,
  };

  try {
    if (editingContractDocId) {
      const res = await fetch(`${apiBase()}/api/contract_docs?id=${editingContractDocId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');
    } else {
      const file = $('cd_file').files[0];
      if (!file) {
        $('contractDocModalMsg').textContent = '첨부할 파일을 선택해주세요.';
        btn.disabled = false;
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        $('contractDocModalMsg').textContent = '파일이 너무 큽니다 (8MB 이하로 올려주세요).';
        btn.disabled = false;
        return;
      }
      const base64 = await readFileAsBase64(file);
      payload.file_base64 = base64;
      payload.file_name = file.name;
      payload.content_type = file.type || 'application/octet-stream';

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
let promoReportListCache = [];
let promoCurrentDetailReport = null;
let promoHistoryEmployeeId = null;

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
  $('promoSavedView').style.display = name === 'saved' ? 'block' : 'none';
  $('promoHistoryView').style.display = name === 'history' ? 'block' : 'none';
  $('promoStandardsView').style.display = name === 'standards' ? 'block' : 'none';
  if (name === 'saved') loadPromotionReportList();
  if (name === 'history') {
    populatePromoHistoryEmployeeSelect();
    populatePositionSelect('ph_position', '');
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

function openSaveReportModal() {
  const now = new Date();
  $('sr_year').value = now.getFullYear();
  $('sr_asof').value = now.toISOString().slice(0, 10);
  $('sr_note').value = '';
  $('sr_include_retired').checked = false;
  $('saveReportModalMsg').textContent = '';
  $('saveReportBtn').disabled = false;
  $('saveReportModal').style.display = 'flex';
}

function closeSaveReportModal() {
  $('saveReportModal').style.display = 'none';
}

async function confirmSaveReport() {
  const btn = $('saveReportBtn');
  if (btn.disabled) return;
  const year = $('sr_year').value;
  const asof = $('sr_asof').value;
  if (!year || !asof) {
    $('saveReportModalMsg').textContent = '보고 연도와 기준일자는 필수입니다.';
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(`${apiBase()}/api/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
      body: JSON.stringify({
        type: 'save_report',
        report_year: Number(year),
        as_of: asof,
        note: $('sr_note').value.trim() || null,
        include_all: $('sr_include_retired').checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    closeSaveReportModal();
    switchPromotionsSubTab('saved');
  } catch (e) {
    $('saveReportModalMsg').textContent = '생성 중 오류가 발생했습니다.';
  } finally {
    btn.disabled = false;
  }
}

async function loadPromotionReportList() {
  const tbody = $('promoReportListTbody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  $('promoReportDetailWrap').style.display = 'none';
  try {
    const res = await fetch(`${apiBase()}/api/promotions?reports=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    promoReportListCache = data.reports || [];
    if (promoReportListCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">저장된 보고서가 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = promoReportListCache.map(r => `
      <tr>
        <td>${r.report_year}년</td>
        <td>${esc(r.as_of_date)}</td>
        <td>${esc(r.prior_year_end_date)}</td>
        <td>${esc((r.generated_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${esc(r.note || '-')}</td>
        <td>
          <a class="hr-edit-link" onclick="viewPromotionReport('${r.id}')">보기</a>
          · <a class="hr-edit-link" onclick="downloadPromotionReportExcel('${r.id}')">엑셀</a>
          · <a class="hr-edit-link" onclick="deletePromotionReport('${r.id}')">삭제</a>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

async function viewPromotionReport(id) {
  try {
    const res = await fetch(`${apiBase()}/api/promotions?report_id=${id}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error('failed');
    promoCurrentDetailReport = data.report;
    $('promoReportDetailTitle').textContent = `${data.report.report_year}년 진급자 보고서(기준일: ${data.report.as_of_date})`;
    const tbody = $('promoReportDetailTbody');
    const list = data.report.snapshot || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:16px;">데이터 없음</td></tr>`;
    } else {
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
        </tr>
      `).join('');
    }
    $('promoReportDetailWrap').style.display = 'block';
  } catch (e) {
    alert('보고서를 불러오지 못했습니다.');
  }
}

function downloadPromotionReportExcel(id) {
  const r = promoReportListCache.find(x => x.id === id);
  const doDownload = (report) => {
    const rows = [['지사', '부서', '성명', '직급', '입사일', '근속(기준일)', '근속(전년말)', '최근승진일', '최근승진직급']];
    (report.snapshot || []).forEach(e => {
      rows.push([e.branch || '', e.department || '', e.name, e.position || '', e.hire_date || '',
        e.tenure_current || '', e.tenure_prior_year_end || '', e.last_promotion_date || '', e.last_promotion_position || '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${report.report_year}년`);
    XLSX.writeFile(wb, `인사기록보고서_${report.report_year}.xlsx`);
  };
  if (promoCurrentDetailReport && promoCurrentDetailReport.id === id) {
    doDownload(promoCurrentDetailReport);
    return;
  }
  fetch(`${apiBase()}/api/promotions?report_id=${id}`, { headers: { 'X-HR-Password': hrPassword() } })
    .then(res => res.json())
    .then(data => doDownload(data.report))
    .catch(() => alert('다운로드 중 오류가 발생했습니다.'));
}

async function deletePromotionReport(id) {
  if (!confirm('이 보고서를 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/promotions?id=${id}&type=report`, {
      method: 'DELETE',
      headers: { 'X-HR-Password': hrPassword() },
    });
    if (!res.ok) throw new Error('failed');
    loadPromotionReportList();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
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
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 직급이력이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(h => `
      <tr>
        <td>${esc(h.effective_date)}</td>
        <td>${esc(h.position)}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${esc(h.note || '-')}</td>
        <td>
          <a class="hr-edit-link" onclick="openApplyStandardModal('${employeeId}', '${esc(h.position)}')">급여반영</a>
          · <a class="hr-edit-link" onclick="deletePositionHistory('${h.id}')">삭제</a>
        </td>
      </tr>
    `).join('');
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
          · <a class="hr-edit-link" onclick="deletePositionStandard('${s.id}')">삭제</a>
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

function switchPromoSavedViewMode(mode) {
  document.querySelectorAll('[data-promosavedview]').forEach(b => b.classList.toggle('active', b.dataset.promosavedview === mode));
  $('promoReportDetailTableWrap').style.display = mode === 'list' ? 'block' : 'none';
  $('promoReportDetailMatrixWrap').style.display = mode === 'matrix' ? 'block' : 'none';
  if (mode === 'matrix' && promoCurrentDetailReport) {
    ensurePositionStandardsLoaded().then(() => renderPromotionMatrixInto('promoReportDetailMatrixWrap', promoCurrentDetailReport.snapshot || []));
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
function printPromotionMatrix(containerId) {
  const source = $(containerId);
  if (!source || !source.querySelector('table')) {
    alert('먼저 "직급별 이력표"를 조회해주세요.');
    return;
  }
  const asOfDate = $('promoAsOf').value || new Date().toISOString().slice(0, 10);
  const title = containerId === 'promoReportDetailMatrixWrap'
    ? $('promoReportDetailTitle').textContent
    : `${asOfDate.slice(0, 4)}년 진급자 보고서(기준일: ${asOfDate})`;

  $('promoMatrixPrintTitle').textContent = title;
  $('promoMatrixPrintBody').innerHTML = source.innerHTML;
  $('promoMatrixPrintArea').style.display = 'block';

  const style = document.createElement('style');
  style.id = 'promoMatrixPrintStyle';
  style.textContent = `
    @media print {
      body * { visibility: hidden; }
      #promoMatrixPrintArea, #promoMatrixPrintArea * { visibility: visible; }
      #promoMatrixPrintArea { position: absolute; left: 0; top: 0; width: 100%; }
      @page { size: landscape; }
    }
  `;
  document.head.appendChild(style);

  window.print();

  document.head.removeChild(style);
  $('promoMatrixPrintArea').style.display = 'none';
}
