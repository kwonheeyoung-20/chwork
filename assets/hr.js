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
  if (name === 'pension') loadPension();
  if (name === 'settlement') { populateSettlementEmployeeSelect(); loadSettlementHistory(); }
  if (name === 'payroll' && !$('payrollMonth').value) {
    const now = new Date();
    $('payrollMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
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
  tbody.innerHTML = list.map(p => `
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
      <td><a class="hr-edit-link" onclick="openHistoryModal('${p.id}', '${esc(p.name)}')">이력</a></td>
    </tr>
  `).join('');

  const sum = (key) => list.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  tbody.innerHTML += `
    <tr class="hr-total-row">
      <td colspan="4">합계 (${list.length}명)</td>
      <td class="num">${fmt(sum('cumulative_estimate'))}</td>
      <td class="num">${fmt(sum('total_contributed'))}</td>
      <td class="num">${fmt(sum('balance'))}</td>
      <td class="num">${asOf ? fmt(sum('as_of_cumulative_estimate')) : '-'}</td>
      <td class="num">${asOf ? fmt(sum('period_accrual')) : '-'}</td>
      <td class="num">${asOf ? fmt(sum('as_of_balance')) : '-'}</td>
      <td colspan="2"></td>
    </tr>
  `;

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
  document.querySelectorAll('#pensionTbody tr:not(.hr-total-row)').forEach(tr => {
    const cells = Array.from(tr.children).slice(0, 10).map(td => td.textContent.trim());
    if (cells.length === 10) rows.push(cells);
  });
  const totalRow = document.querySelector('#pensionTbody tr.hr-total-row');
  if (totalRow) {
    const tds = Array.from(totalRow.children).map(td => td.textContent.trim());
    rows.push([tds[0], '', '', '', tds[1], tds[2], tds[3], tds[4], tds[5], tds[6]]);
  }
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

async function openHistoryModal(employeeId, name) {
  currentHistoryEmployeeId = employeeId;
  currentHistoryEmployeeName = name;
  $('historyModalTitle').textContent = `${name} — 불입 내역`;
  $('contribHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">불러오는 중…</td></tr>`;
  $('historyModal').style.display = 'flex';
  try {
    const res = await fetch(`${apiBase()}/api/hr_pension?employee_id=${employeeId}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    const list = data.contributions || [];
    if (list.length === 0) {
      $('contribHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">불입 내역이 없습니다.</td></tr>`;
      return;
    }
    $('contribHistoryTbody').innerHTML = list.map(c => `
      <tr data-id="${c.id}" data-date="${c.contribution_date}" data-amount="${c.amount}" data-note="${esc(c.note || '')}">
        <td class="hview">${esc(c.contribution_date)}</td>
        <td class="num hview">${fmt(c.amount)}</td>
        <td class="hview">${esc(c.note || '-')}</td>
        <td class="hview">
          <a class="hr-edit-link" onclick="editContributionRow(this)">수정</a>
          <a class="hr-edit-link" style="margin-left:8px;" onclick="deleteContribution('${c.id}', '${employeeId}', '${esc(name)}')">삭제</a>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    $('contribHistoryTbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
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
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  try {
    const res = await fetch(`${apiBase()}/api/hr_payroll?year_month=${ym}`, {
      headers: { 'X-HR-Password': hrPassword() },
    });
    const data = await res.json();
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red); padding:24px;">${esc(data.detail || '불러오기 실패')}</td></tr>`;
      return;
    }
    renderPayroll(data.payroll || []);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function renderPayroll(list) {
  $('payrollCount').textContent = `총 ${list.length}명`;
  const tbody = $('payrollTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:24px;">데이터가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(p => `
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
    </tr>
  `).join('');

  const sum = (key) => list.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  tbody.innerHTML += `
    <tr class="hr-total-row">
      <td colspan="4">합계 (${list.length}명)</td>
      <td class="num">${fmt(sum('base_pay'))}</td>
      <td class="num">${fmt(sum('fixed_overtime_pay'))}</td>
      <td class="num">${fmt(sum('attendance_allowance'))}</td>
      <td class="num">${fmt(sum('meal_allowance'))}</td>
      <td class="num">${fmt(sum('total_pay'))}</td>
    </tr>
  `;
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
    if (!res.ok) throw new Error(data.detail || 'save failed');
    alert(`${data.count}명분 저장되었습니다.`);
    loadPayrollPreview();
  } catch (e) {
    alert('저장 중 오류가 발생했습니다.');
  }
}

function downloadPayrollExcel() {
  const rows = [['이름', '지사', '부서', '직급', '기본급', '고정연장수당', '만근수당', '식대', '합계']];
  document.querySelectorAll('#payrollTbody tr:not(.hr-total-row)').forEach(tr => {
    const cells = Array.from(tr.children).map(td => td.textContent.trim());
    if (cells.length === 9) rows.push(cells);
  });
  const totalRow = document.querySelector('#payrollTbody tr.hr-total-row');
  if (totalRow) {
    const tds = Array.from(totalRow.children).map(td => td.textContent.trim());
    rows.push([tds[0], '', '', '', tds[1], tds[2], tds[3], tds[4], tds[5]]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const sheetName = $('payrollMonth').value || '급여명세';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `급여명세_${sheetName}.xlsx`);
}
