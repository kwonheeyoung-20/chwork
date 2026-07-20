/* ───────── hr.js ───────── */

const $ = id => document.getElementById(id);
const fmt = n => (n == null || isNaN(n)) ? '-' : Math.round(n).toLocaleString('ko-KR');

function apiBase() { return window.location.origin; }
function hrPassword() { return sessionStorage.getItem('chwork_hr_pw') || ''; }

/* ── 로그인 ── */
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
  loadEmployees();
}

/* ── 탭 전환 ── */
function switchHrTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('tab-employees').style.display = name === 'employees' ? 'block' : 'none';
  $('tab-pension').style.display = name === 'pension' ? 'block' : 'none';
  $('tab-settlement').style.display = name === 'settlement' ? 'block' : 'none';
  $('tab-payroll').style.display = name === 'payroll' ? 'block' : 'none';
  $('tab-otherpay').style.display = name === 'otherpay' ? 'block' : 'none';
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
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

let employeesCache = [];

function renderEmployees(list) {
  employeesCache = list;
  $('empCount').textContent = `총 ${list.length}명`;
  const tbody = $('empTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">직원이 없습니다.</td></tr>`;
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
      <td class="num">${fmt(emp.current_salary_thousand)}</td>
      <td><span class="hr-badge ${emp.pension_enrolled ? 'yes' : 'no'}">${emp.pension_enrolled ? '가입' : '미가입'}</span></td>
      <td><a class="hr-edit-link" onclick="openEditModal('${emp.id}')">수정</a></td>
    </tr>
  `).join('');

  const totalSalary = list.reduce((s, e) => s + (Number(e.current_salary_thousand) || 0), 0);
  tbody.innerHTML += `
    <tr class="hr-total-row">
      <td colspan="6">합계 (${list.length}명)</td>
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
    <tr><td colspan="9" style="padding:14px 4px 6px; font-size:12px; color:var(--text-muted); font-weight:500;">지사별 합계</td></tr>
  `;
  branchOrder.forEach(b => {
    const arr = byBranch[b];
    const branchTotal = arr.reduce((s, e) => s + (Number(e.current_salary_thousand) || 0), 0);
    tbody.innerHTML += `
      <tr class="hr-total-row">
        <td colspan="6">${esc(b)} (${arr.length}명)</td>
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

function openAddModal() {
  editingId = null;
  $('modalTitle').textContent = '직원 추가';
  ['name','position','branch','department','hire_date','retire_date','employment_type','note',
   'pension_enrollment_date','salary','salary_month','salary_reason'].forEach(f => $('f_' + f).value = '');
  $('f_status').value = '재직';
  $('f_pension_enrolled').value = 'true';
  $('modalMsg').textContent = '';
  $('salaryHistorySection').style.display = 'none';
  $('empModal').style.display = 'flex';
}

function openEditModal(id) {
  const emp = employeesCache.find(e => e.id === id);
  if (!emp) return;
  editingId = id;
  $('modalTitle').textContent = `직원 수정 — ${emp.name}`;
  $('f_name').value = emp.name || '';
  $('f_position').value = emp.position || '';
  $('f_branch').value = emp.branch || '';
  $('f_department').value = emp.department || '';
  $('f_hire_date').value = emp.hire_date || '';
  $('f_status').value = emp.status || '재직';
  $('f_retire_date').value = emp.retire_date || '';
  $('f_employment_type').value = emp.employment_type || '';
  $('f_pension_enrolled').value = emp.pension_enrolled ? 'true' : 'false';
  $('f_pension_enrollment_date').value = emp.pension_enrollment_date || '';
  $('f_note').value = emp.note || '';
  $('f_salary').value = '';
  $('f_salary_month').value = '';
  $('f_salary_reason').value = '';
  $('modalMsg').textContent = `현재 연봉: ${fmt(emp.current_salary_thousand)}천원 — 아래는 "변경"이 있을 때만 입력하세요.`;
  $('modalMsg').className = 'hr-msg';
  $('salaryHistorySection').style.display = 'block';
  loadSalaryHistoryInModal(id);
  $('empModal').style.display = 'flex';
}

function closeModal() {
  $('empModal').style.display = 'none';
}

async function saveEmployee() {
  const payload = {
    name: $('f_name').value.trim(),
    position: $('f_position').value.trim(),
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
      const res = await fetch(`${apiBase()}/api/hr_employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');
    } else {
      payload.id = editingId;
      if (salaryVal) {
        payload.new_salary_thousand = Number(salaryVal);
        payload.new_salary_effective_month = $('f_salary_month').value;
        payload.new_salary_reason = $('f_salary_reason').value.trim() || null;
        if (!payload.new_salary_effective_month) {
          $('modalMsg').textContent = '연봉을 변경하려면 적용 시작월을 입력해주세요.';
          $('modalMsg').className = 'hr-msg';
          return;
        }
      }
      const res = await fetch(`${apiBase()}/api/hr_employees`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-HR-Password': hrPassword() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');
    }
    closeModal();
    loadEmployees();
  } catch (e) {
    $('modalMsg').textContent = '저장 중 오류가 발생했습니다.';
    $('modalMsg').className = 'hr-msg';
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
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--text-muted); padding:24px;">DC 가입자가 없습니다.</td></tr>`;
    return;
  }

  const sum = (arr, key) => arr.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const rowHtml = (p) => `
    <tr data-emp-id="${p.id}" data-emp-name="${esc(p.name)}" data-balance="${p.balance}" data-asofbalance="${asOf ? (p.as_of_balance ?? 0) : ''}">
      <td>${esc(p.name)}</td>
      <td>${esc(p.branch || '-')}</td>
      <td>${esc(p.department || '-')}</td>
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
      <td colspan="4">${esc(branch)} 소계 (${arr.length}명)</td>
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
      <td colspan="4">전체 합계 (${list.length}명)</td>
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
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_settlement?list=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.settlements || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">확정된 정산 내역이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(s => `
      <tr>
        <td>${esc(s.employees?.name || '-')}</td>
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
  const rows = [['이름', '지사', '부서', '가입일', '누적추계액(현재기준)', '실불입액 합계', '잔액', $('asOfCumHeader').textContent, $('periodAccrualHeader').textContent, $('asOfBalanceHeader').textContent]];
  document.querySelectorAll('#pensionTbody tr').forEach(tr => {
    if (tr.classList.contains('hr-total-row')) {
      const tds = Array.from(tr.children).map(td => td.textContent.trim());
      rows.push([tds[0], '', '', '', tds[1], tds[2], tds[3], tds[4], tds[5], tds[6]]);
      return;
    }
    const cells = Array.from(tr.children).slice(0, 10).map(td => td.textContent.trim());
    if (cells.length === 10) rows.push(cells);
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
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?year_month=${ym}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    $('retroAdjHeader').textContent = '소급인상분';
    $('finalTotalHeader').textContent = '최종 지급액';
    renderPayroll(data.payroll || [], false);
    refreshPayrollLockStatus();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

async function loadPayrollSaved() {
  const ym = payrollYearMonthDate();
  if (!ym) { alert('먼저 월을 선택해주세요.'); return; }
  const tbody = $('payrollTbody');
  tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?year_month=${ym}&saved=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    const list = (data.payroll || []).map(p => ({
      ...p,
      name: p.employees?.name,
      branch: p.employees?.branch,
      department: p.employees?.department,
      position: p.employees?.position,
      hire_date: p.employees?.hire_date,
    })).sort((a, b) => (a.hire_date || '').localeCompare(b.hire_date || ''));
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--text-muted); padding:24px;">이 달은 아직 "생성/저장"된 자료가 없습니다.</td></tr>`;
      return;
    }
    $('retroAdjHeader').textContent = '소급인상분';
    $('finalTotalHeader').textContent = '최종 지급액';
    renderPayroll(list, true);
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
      <td class="num">${savedMode ? fmt(retro) : '-'}</td>
      <td class="num">${savedMode ? fmt(finalTotal) : '-'}</td>
      <td><a class="hr-edit-link" onclick="openPayslipModal(${idx})">명세서</a></td>
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

  // 이번 달 재직자 조정 대상 안내 박스
  const adjusted = list.filter(p => p.adjustment_note);
  if (adjusted.length > 0) {
    $('payrollAdjustNoteBox').style.display = 'block';
    $('payrollAdjustNoteList').innerHTML = adjusted.map(p => `
      <div style="font-size:12px; color:var(--text-secondary); padding:3px 0;">
        <b>${esc(p.name)}</b> — ${esc(p.adjustment_note)}
      </div>
    `).join('');
  } else {
    $('payrollAdjustNoteBox').style.display = 'none';
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
  $('payrollLockStatus').textContent = current && current.locked ? `🔒 ${ym} 마감됨` : `${ym} 마감 전`;
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

/* ── 재직자 조정(육아휴직 등) 관리 ── */
function toggleLeaveAdjustFields() {
  const type = $('la_reason_type').value;
  const isReduced = type === '육아기근로시간단축';
  $('leaveAdjustHoursFields').style.display = isReduced ? 'grid' : 'none';
  $('leaveAdjustNoteOnly').style.display = isReduced ? 'none' : 'grid';
}

async function populateLeaveAdjustEmployeeSelect() {
  const sel = $('la_employee_id');
  if (sel.dataset.loaded === '1') return;
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

async function loadLeaveAdjustments() {
  const tbody = $('leaveAdjustTbody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?leave_adjustments=1`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.adjustments || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 조정 내역이 없습니다.</td></tr>`;
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
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
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
  $('ps_retro').textContent = hasSaved ? (fmt(retro) + '원') : '- (저장된 자료 아님)';
  $('ps_total').textContent = fmt(hasSaved ? finalTotal : p.total_pay) + '원';

  if (p.adjustment_note) {
    $('ps_adjust_note_wrap').style.display = 'block';
    $('ps_adjust_note').textContent = p.adjustment_note;
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

  $('payslipModal').style.display = 'flex';
}

function closePayslipModal() {
  $('payslipModal').style.display = 'none';
}

function printPayslip() {
  window.print();
}

/* ── 전 직원 급여 대장 출력 ── */
function printPayrollRegister() {
  if (!payrollCache || payrollCache.length === 0) {
    alert('먼저 급여명세를 조회해주세요 ("미리보기 조회" 또는 "저장된 자료 보기").');
    return;
  }
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
        <td class="num">${hasSaved ? fmt(retro) : '-'}</td>
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
      <td class="num">${hasSaved ? fmt(sum('retroactive_adjustment')) : '-'}</td>
      <td class="num">${hasSaved ? fmt(sum('total_pay','retroactive_adjustment')) : '-'}</td>
    </tr>
  `;

  const adjusted = list.filter(p => p.adjustment_note);
  if (adjusted.length > 0) {
    $('reg_adjust_section').style.display = 'block';
    $('reg_adjust_list').innerHTML = adjusted.map(p => `
      <div style="padding:3px 0;"><b>${esc(p.name)}</b>(${esc(p.branch || '-')}/${esc(p.department || '-')}) — ${esc(p.adjustment_note)}</div>
    `).join('');
  } else {
    $('reg_adjust_section').style.display = 'none';
  }

  $('registerPrintArea').style.display = 'block';
  window.print();
  $('registerPrintArea').style.display = 'none';
}
