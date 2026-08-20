/* ───────── personal.js ───────── */

const $ = id => document.getElementById(id);

function apiBase() { return window.location.origin; }
function hrPassword() { return sessionStorage.getItem('chwork_hr_pw') || ''; }

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function authHeaders(json) {
  const h = { 'X-HR-Password': hrPassword() };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function handle401(res) {
  if (res.status === 401) {
    sessionStorage.removeItem('chwork_hr_pw');
    $('loginPanel').style.display = 'block';
    $('perMain').style.display = 'none';
    return true;
  }
  return false;
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ── 로그인 ── */
async function perLogin() {
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
      showMain(); // 이 페이지는 딥링크로 들어오는 경우가 많아서, 대시보드로 안 튕기고 여기 그대로 머뭅니다
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
  $('perMain').style.display = 'flex';
  loadMembers().then(() => {
    initPerCalState();
    loadPersonalReminderBanner();
    loadPersonalOccurrences();
    loadPerCalendar();
  });
  loadTimetable();
}

window.addEventListener('DOMContentLoaded', () => {
  if (hrPassword()) showMain();
  $('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') perLogin(); });
});

function switchPerTab(name) {
  document.querySelectorAll('[data-persub]').forEach(b => b.classList.toggle('active', b.dataset.persub === name));
  $('perFamilyView').style.display = name === 'family' ? 'block' : 'none';
  $('perTimetableView').style.display = name === 'timetable' ? 'block' : 'none';
}

/* ── 가족 구성원 ── */
let membersCache = [];

async function loadMembers() {
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?members=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    membersCache = data.members || [];
    renderMemberLegend();
    populateMemberSelects();
  } catch (e) {
    // 무시 - 목록은 비어있는 채로 진행
  }
}

function memberColor(name) {
  const m = membersCache.find(x => x.name === name);
  return m ? m.color : '#888888';
}

function renderMemberLegend() {
  $('memberLegend').innerHTML = membersCache.map(m => `
    <span class="member-chip" style="background:${esc(m.color)};">
      <span class="member-dot"></span>${esc(m.name)}
      <a onclick="deleteMember('${m.id}')" style="color:#fff; opacity:0.8; margin-left:4px; cursor:pointer;">×</a>
    </span>
  `).join('');
}

function populateMemberSelects() {
  const optionsHtml = membersCache.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
  $('pe_member').innerHTML = optionsHtml;
  $('perMemberFilter').innerHTML = '<option value="">전체</option>' + optionsHtml;
}

function openMemberModal() {
  $('mem_name').value = '';
  $('mem_color').value = '#c82828';
  $('memberModalMsg').textContent = '';
  $('memberModal').style.display = 'flex';
}
function closeMemberModal() { $('memberModal').style.display = 'none'; }

async function saveMember() {
  const name = $('mem_name').value.trim();
  if (!name) { $('memberModalMsg').textContent = '이름을 입력해주세요.'; return; }
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ type: 'save_member', name, color: $('mem_color').value, sort_order: membersCache.length + 1 }),
    });
    if (!res.ok) throw new Error('save failed');
    closeMemberModal();
    await loadMembers();
  } catch (e) {
    $('memberModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deleteMember(id) {
  if (!confirm('이 구성원을 삭제하시겠습니까? (등록된 일정은 그대로 남습니다)')) return;
  try {
    await fetch(`${apiBase()}/api/personal_schedule?member_id=${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadMembers();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 알림 배너 ── */
async function loadPersonalReminderBanner() {
  const wrap = $('perReminderBannerWrap');
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?upcoming=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) { wrap.innerHTML = ''; return; }
    const overdue = list.filter(x => x.days_left < 0);
    const soon = list.filter(x => x.days_left >= 0);
    let html = '';
    if (overdue.length > 0) {
      html += `<div class="sch-banner danger"><h3>⚠ 지난 일정 (${overdue.length}건)</h3>`;
      html += overdue.map(x => `<div class="sch-banner-row"><span><span class="sch-dday overdue">D+${Math.abs(x.days_left)}</span> [${esc(x.member_name)}] ${esc(x.title)}</span></div>`).join('');
      html += `</div>`;
    }
    if (soon.length > 0) {
      html += `<div class="sch-banner warn"><h3>🔔 다가오는 일정 (${soon.length}건)</h3>`;
      html += soon.map(x => `<div class="sch-banner-row"><span><span class="sch-dday soon">${x.days_left === 0 ? 'D-DAY' : 'D-' + x.days_left}</span> [${esc(x.member_name)}] ${esc(x.title)}</span></div>`).join('');
      html += `</div>`;
    }
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = '';
  }
}

/* ── 달력 ── */
let perCalYear, perCalMonth;

function initPerCalState() {
  const now = new Date();
  perCalYear = now.getFullYear();
  perCalMonth = now.getMonth();
}

function perCalPrevMonth() {
  perCalMonth -= 1;
  if (perCalMonth < 0) { perCalMonth = 11; perCalYear -= 1; }
  loadPerCalendar();
}
function perCalNextMonth() {
  perCalMonth += 1;
  if (perCalMonth > 11) { perCalMonth = 0; perCalYear += 1; }
  loadPerCalendar();
}
function perCalToday() {
  initPerCalState();
  loadPerCalendar();
}

async function loadPerCalendar() {
  $('perCalMonthLabel').textContent = `${perCalYear}년 ${perCalMonth + 1}월`;
  const monthStart = new Date(perCalYear, perCalMonth, 1);
  const monthEnd = new Date(perCalYear, perCalMonth + 1, 0);
  const fromStr = toISO(monthStart);
  const toStr = toISO(monthEnd);
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?from=${fromStr}&to=${toStr}&status=all`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    renderPerCalendar(data.occurrences || [], monthStart, monthEnd);
  } catch (e) {
    $('perCalGrid').innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--red); padding:16px;">달력 불러오기 실패</div>`;
  }
}

// 대한민국 공휴일 (업무 일정관리 달력과 동일한 목록)
const KOREAN_HOLIDAYS_BY_YEAR = {
  2026: {
    '2026-01-01': '신정',
    '2026-02-16': '설날 전날',
    '2026-02-17': '설날',
    '2026-02-18': '설날 다음날',
    '2026-03-01': '삼일절',
    '2026-03-02': '삼일절 대체공휴일',
    '2026-05-01': '근로자의 날',
    '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날',
    '2026-05-25': '부처님오신날 대체공휴일',
    '2026-06-03': '전국동시지방선거일',
    '2026-06-06': '현충일',
    '2026-07-17': '제헌절',
    '2026-08-15': '광복절',
    '2026-09-24': '추석 전날',
    '2026-09-25': '추석',
    '2026-09-26': '추석 다음날',
    '2026-10-03': '개천절',
    '2026-10-09': '한글날',
    '2026-12-25': '크리스마스',
  },
};

function getHolidayName(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const table = KOREAN_HOLIDAYS_BY_YEAR[year];
  return table ? (table[dateStr] || null) : null;
}

function renderPerCalendar(occurrences, monthStart, monthEnd) {
  const byDate = {};
  occurrences.forEach(o => {
    if (!byDate[o.due_date]) byDate[o.due_date] = [];
    byDate[o.due_date].push(o);
  });
  const todayStr = toISO(new Date());
  const firstWeekday = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();

  let html = '';
  for (let i = 0; i < firstWeekday; i++) html += `<div class="sch-cal-cell empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(perCalYear, perCalMonth, day);
    const dateStr = toISO(dateObj);
    const weekday = dateObj.getDay();
    const isToday = dateStr === todayStr;
    const holidayName = getHolidayName(dateStr);
    const dayItems = byDate[dateStr] || [];
    const maxShow = holidayName ? 2 : 3;
    const itemsHtml = dayItems.slice(0, maxShow).map(o => {
      const task = o.personal_schedule_tasks || {};
      const color = memberColor(task.member_name);
      return `<div class="sch-cal-item ${o.status === 'done' ? 'done' : ''}" style="background:${color};" title="[${esc(task.member_name)}] ${esc(task.title)}">${esc(task.title || '')}</div>`;
    }).join('');
    const moreHtml = dayItems.length > maxShow ? `<div class="sch-cal-more">+${dayItems.length - maxShow}개 더</div>` : '';
    const holidayHtml = holidayName ? `<div class="sch-cal-holiday" title="${esc(holidayName)}">${esc(holidayName)}</div>` : '';
    const dayNumClass = (weekday === 0 || holidayName) ? 'sun' : (weekday === 6 ? 'sat' : '');
    html += `
      <div class="sch-cal-cell ${isToday ? 'today' : ''} ${holidayName ? 'holiday' : ''}">
        <div class="sch-cal-daynum ${dayNumClass}">${day}</div>
        ${holidayHtml}
        ${itemsHtml}
        ${moreHtml}
      </div>
    `;
  }
  const totalCells = firstWeekday + daysInMonth;
  const remain = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < remain; i++) html += `<div class="sch-cal-cell empty"></div>`;
  $('perCalGrid').innerHTML = html;
}

/* ── 일정 목록 ── */
async function loadPersonalOccurrences() {
  const tbody = $('perOccTbody');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  const status = $('perStatusFilter').value;
  const member = $('perMemberFilter').value;
  const today = new Date();
  const from = toISO(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
  const to = toISO(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()));
  try {
    let url = `${apiBase()}/api/personal_schedule?from=${from}&to=${to}&status=${status}`;
    if (member) url += `&member=${encodeURIComponent(member)}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    const list = data.occurrences || [];
    $('perOccCount').textContent = `총 ${list.length}건`;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">등록된 일정이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(o => {
      const task = o.personal_schedule_tasks || {};
      const color = memberColor(task.member_name);
      const statusLabel = o.status === 'done' ? '완료' : (o.status === 'skipped' ? '건너뜀' : '미완료');
      return `
        <tr>
          <td>${esc(o.due_date)}${task.date_type === 'lunar' ? ' <span style="font-size:10px; color:var(--accent);">(음력)</span>' : ''}</td>
          <td><span class="member-chip" style="background:${color}; font-size:11px;">${esc(task.member_name || '-')}</span></td>
          <td>${esc(task.category || '-')}</td>
          <td>${esc(task.title || '-')}</td>
          <td style="font-size:12px; color:var(--text-secondary);">${[task.note ? esc(task.note) : null, o.completed_note ? '완료메모: ' + esc(o.completed_note) : null].filter(Boolean).join('<br>') || '-'}</td>
          <td>${statusLabel}</td>
          <td style="white-space:nowrap;">
            ${(o.status === 'pending' && task.category === '결제일') ? `<a class="hr-edit-link" onclick="openPerCompleteModal('${o.id}')">완료</a> · <a class="hr-edit-link" onclick="perSkip('${o.id}')">건너뜀</a> · ` : ''}
            <a class="hr-edit-link" onclick="editPersonalTask('${o.task_id}')">수정</a>
            · <a class="hr-edit-link" onclick="deletePersonalOccurrence('${o.id}')">이 날짜만 삭제</a>
            · <a class="hr-edit-link" onclick="deletePersonalTaskDirect('${o.task_id}')" style="color:var(--red);">전체 삭제</a>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

let pendingPerCompleteOccId = null;
function openPerCompleteModal(occId) {
  pendingPerCompleteOccId = occId;
  $('pc_note').value = '';
  $('perCompleteModal').style.display = 'flex';
}
function closePerCompleteModal() { $('perCompleteModal').style.display = 'none'; }

async function confirmPerComplete() {
  try {
    await fetch(`${apiBase()}/api/personal_schedule`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ type: 'complete', occurrence_id: pendingPerCompleteOccId, done: true, note: $('pc_note').value.trim() || null }),
    });
    closePerCompleteModal();
    loadPersonalOccurrences();
    loadPerCalendar();
    loadPersonalReminderBanner();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

async function perSkip(occId) {
  if (!confirm('이 일정을 건너뛰시겠습니까?')) return;
  try {
    await fetch(`${apiBase()}/api/personal_schedule`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ type: 'skip', occurrence_id: occId }),
    });
    loadPersonalOccurrences();
    loadPerCalendar();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

async function deletePersonalOccurrence(occId) {
  if (!confirm('이 날짜의 일정을 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?occurrence_id=${occId}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || `삭제 실패 (상태코드 ${res.status})`);
    }
    loadPersonalOccurrences();
    loadPerCalendar();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

async function deletePersonalTaskDirect(taskId) {
  if (!confirm('이 일정을 완전히 삭제하시겠습니까? (반복되는 모든 날짜가 함께 삭제됩니다)')) return;
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?id=${taskId}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || `삭제 실패 (상태코드 ${res.status})`);
    }
    loadPersonalOccurrences();
    loadPerCalendar();
    loadPersonalReminderBanner();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

/* ── 일정 추가 ── */
function togglePersonalRecurrenceFields() {
  const isWeekly = $('pe_recurrence').value === 'weekly';
  const isYearly = $('pe_recurrence').value === 'yearly';
  $('peIntervalWrap').style.display = isWeekly ? 'inline' : 'none';
  $('peLunarWrap').style.display = isYearly ? 'flex' : 'none';
  if (!isYearly) $('pe_is_lunar').checked = false;
  updateLunarPreview();
}

// 음력 변환은 서버(파이썬)에서 정확히 계산하지만, 화면에서도 간단한 안내 문구 정도는 보여줌
function updateLunarPreview() {
  const wrap = $('lunarPreview');
  if (!$('pe_is_lunar').checked) { wrap.textContent = ''; return; }
  const dateVal = $('pe_anchor_date').value;
  if (!dateVal) { wrap.textContent = ''; return; }
  wrap.textContent = `${dateVal}(양력)을 음력으로 환산해서 저장 → 저장 후 다음 목록에서 정확한 값을 확인해주세요.`;
}

let editingPersonalTaskId = null;
let personalTasksCache = [];

function openPersonalEventModal() {
  editingPersonalTaskId = null;
  $('personalEventModalTitle').textContent = '일정 추가';
  $('personalEventDeleteBtn').style.display = 'none';
  $('pe_title').value = '';
  $('pe_category').value = '일정';
  $('pe_recurrence').value = 'once';
  $('pe_anchor_date').value = toISO(new Date());
  $('pe_interval').value = '1';
  $('pe_is_lunar').checked = false;
  $('pe_end_date').value = '';
  $('pe_reminder_days').value = '1';
  $('pe_note').value = '';
  togglePersonalRecurrenceFields();
  $('personalEventModalMsg').textContent = '';
  $('personalEventModal').style.display = 'flex';
}
function closePersonalEventModal() { $('personalEventModal').style.display = 'none'; }

async function editPersonalTask(taskId) {
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?tasks=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    personalTasksCache = data.tasks || [];
    const t = personalTasksCache.find(x => x.id === taskId);
    if (!t) { alert('일정을 찾을 수 없습니다.'); return; }

    editingPersonalTaskId = taskId;
    $('personalEventModalTitle').textContent = '일정 수정';
    $('personalEventDeleteBtn').style.display = 'inline-block';
    $('pe_member').value = t.member_name;
    $('pe_category').value = t.category || '일정';
    $('pe_title').value = t.title || '';
    const uiRecurrence = (t.recurrence_type === 'monthly' && t.interval_value === 12) ? 'yearly' : t.recurrence_type;
    $('pe_recurrence').value = uiRecurrence;
    $('pe_anchor_date').value = t.anchor_date || '';
    $('pe_interval').value = t.recurrence_type === 'weekly' ? (t.interval_value || 1) : 1;
    $('pe_is_lunar').checked = t.date_type === 'lunar';
    $('pe_end_date').value = t.end_date || '';
    $('pe_reminder_days').value = t.reminder_days_before != null ? t.reminder_days_before : 1;
    $('pe_note').value = t.note || '';
    togglePersonalRecurrenceFields();
    $('personalEventModalMsg').textContent = '';
    $('personalEventModal').style.display = 'flex';
  } catch (e) {
    alert('불러오기 실패');
  }
}

async function deletePersonalTaskFromModal() {
  if (!editingPersonalTaskId) return;
  if (!confirm('이 일정을 완전히 삭제하시겠습니까? (반복되는 모든 날짜가 함께 삭제됩니다)')) return;
  try {
    await fetch(`${apiBase()}/api/personal_schedule?id=${editingPersonalTaskId}`, { method: 'DELETE', headers: authHeaders() });
    closePersonalEventModal();
    loadPerCalendar();
    loadPersonalOccurrences();
    loadPersonalReminderBanner();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

async function savePersonalEvent() {
  const title = $('pe_title').value.trim();
  const memberName = $('pe_member').value;
  const anchorDate = $('pe_anchor_date').value;
  if (!title || !memberName || !anchorDate) {
    $('personalEventModalMsg').textContent = '구성원, 제목, 기준일자는 필수입니다.';
    return;
  }
  const uiRecurrence = $('pe_recurrence').value;
  // 화면의 "매년"은 매월(monthly) 반복간격 12로 저장 (백엔드는 once/weekly/monthly만 지원)
  let recurrence_type = uiRecurrence;
  let interval_value = 1;
  if (uiRecurrence === 'yearly') { recurrence_type = 'monthly'; interval_value = 12; }
  else if (uiRecurrence === 'weekly') { interval_value = Number($('pe_interval').value) || 1; }
  const isLunar = uiRecurrence === 'yearly' && $('pe_is_lunar').checked;

  const payload = {
    member_name: memberName,
    category: $('pe_category').value,
    title,
    recurrence_type,
    interval_value,
    anchor_date: anchorDate,
    date_type: isLunar ? 'lunar' : 'solar',
    end_date: $('pe_end_date').value || null,
    reminder_days_before: Number($('pe_reminder_days').value) || 0,
    note: $('pe_note').value.trim() || null,
  };

  try {
    let res;
    if (editingPersonalTaskId) {
      res = await fetch(`${apiBase()}/api/personal_schedule?id=${editingPersonalTaskId}`, {
        method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${apiBase()}/api/personal_schedule`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error('save failed');
    closePersonalEventModal();
    loadPerCalendar();
    loadPersonalOccurrences();
    loadPersonalReminderBanner();
  } catch (e) {
    $('personalEventModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

/* ── 학교 시간표 ── */
async function loadTimetable() {
  const tbody = $('ttTbody');
  tbody.innerHTML = `<tr><td colspan="6" style="padding:24px; color:var(--text-muted);">불러오는 중…</td></tr>`;
  try {
    const [periodsRes, entriesRes] = await Promise.all([
      fetch(`${apiBase()}/api/timetable?periods=1`, { headers: authHeaders() }),
      fetch(`${apiBase()}/api/timetable`, { headers: authHeaders() }),
    ]);
    if (handle401(periodsRes)) return;
    const periodsData = await periodsRes.json();
    const entriesData = await entriesRes.json();
    periodsCache = periodsData.periods || [];
    entriesCache = entriesData.entries || [];
    renderTimetable(periodsCache, entriesCache);
    renderPeriodList(periodsCache);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px; color:var(--red);">불러오기 실패</td></tr>`;
  }
  loadTeachers();
}

let periodsCache = [];
let entriesCache = [];

function renderTimetable(periods, entries) {
  const tbody = $('ttTbody');
  if (periods.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px; color:var(--text-muted);">등록된 교시 시간이 없습니다. "+ 교시 시간 설정"으로 먼저 등록해주세요.</td></tr>`;
    return;
  }
  // (period_label, weekday) -> entry
  const entryMap = {};
  entries.forEach(e => { entryMap[`${e.period_label}__${e.weekday}`] = e; });

  // 2차원 병합(가로: 같은 교시에서 요일 연속 동일과목, 세로: 같은 요일에서 교시 연속 동일과목)
  const consumed = {}; // key: `${periodIdx}_${weekday}`
  const rowsHtml = periods.map((p, periodIdx) => {
    let cells = '';
    for (let wd = 1; wd <= 5; wd++) {
      const key = `${periodIdx}_${wd}`;
      if (consumed[key]) continue;
      const e = entryMap[`${p.period_label}__${wd}`];
      if (!e) {
        cells += `<td><span class="tt-cell-empty-add" onclick="openTimetableEntryModal('${p.period_label}', ${wd})">+ 등록</span></td>`;
        continue;
      }
      // 가로 병합 범위 계산
      let colspan = 1;
      while (wd + colspan <= 5) {
        const nextE = entryMap[`${p.period_label}__${wd + colspan}`];
        if (nextE && nextE.subject_name === e.subject_name) colspan++;
        else break;
      }
      // 세로 병합은 가로 병합이 없을 때만(1칸 너비일 때만) 시도
      let rowspan = 1;
      if (colspan === 1) {
        let nextIdx = periodIdx + 1;
        while (nextIdx < periods.length) {
          const nextP = periods[nextIdx];
          const nextE = entryMap[`${nextP.period_label}__${wd}`];
          if (nextE && nextE.subject_name === e.subject_name) {
            rowspan++;
            nextIdx++;
          } else break;
        }
      }
      for (let r = 0; r < rowspan; r++) {
        for (let c = 0; c < colspan; c++) {
          if (r === 0 && c === 0) continue;
          consumed[`${periodIdx + r}_${wd + c}`] = true;
        }
      }
      const spanAttrs = `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
      cells += `
        <td${spanAttrs}>
          <div class="tt-cell-subject">${esc(e.subject_name)}</div>
          ${e.teacher_name || e.teacher_phone ? `<div class="tt-cell-teacher">${esc(e.teacher_name || '')} ${e.teacher_phone ? esc(e.teacher_phone) : ''}</div>` : ''}
          <span class="tt-cell-edit" onclick="openTimetableEntryModal('${p.period_label}', ${wd}, '${e.id}')" title="수정">✏️</span>
        </td>
      `;
    }
    return `
      <tr>
        <td>${esc(p.period_label)}<br><span style="font-size:10px; color:var(--text-muted);">${esc((p.start_time||'').slice(0,5))}~${esc((p.end_time||'').slice(0,5))}</span></td>
        ${cells}
      </tr>
    `;
  }).join('');
  tbody.innerHTML = rowsHtml;
}

function renderPeriodList(periods) {
  const tbody = $('periodListTbody');
  if (periods.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 교시가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = periods.map(p => `
    <tr>
      <td>${esc(p.period_label)}</td>
      <td>${esc((p.start_time||'').slice(0,5))}~${esc((p.end_time||'').slice(0,5))}</td>
      <td>${p.sort_order}</td>
      <td><a class="hr-edit-link" onclick="editPeriod('${p.id}')">수정</a> · <a class="hr-edit-link" onclick="quickDeletePeriod('${p.id}')">삭제</a></td>
    </tr>
  `).join('');
}

function printTimetable() {
  $('ttPrintTitle').style.display = 'block';
  const style = document.createElement('style');
  style.id = 'ttPrintStyle';
  style.textContent = `
    @media print {
      body * { visibility: hidden; }
      #ttPrintArea, #ttPrintArea * { visibility: visible; }
      #ttPrintArea { position: absolute; left: 0; top: 0; width: 100%; }
      @page { size: landscape; margin: 10mm; }
      #ttPrintTitle { font-size: 16px; margin-bottom: 8px; }
      #ttTable { font-size: 11px; }
      #ttTable th, #ttTable td { padding: 4px 6px; }
    }
  `;
  document.head.appendChild(style);
  window.print();
  document.head.removeChild(style);
  $('ttPrintTitle').style.display = 'none';
}

let editingPeriodId = null;
function openPeriodModal() {
  editingPeriodId = null;
  $('periodModalTitle').textContent = '교시 시간 설정';
  $('periodDeleteBtn').style.display = 'none';
  $('pd_period').value = '';
  $('pd_sort').value = periodsCache.length;
  $('pd_start').value = '';
  $('pd_end').value = '';
  $('periodModalMsg').textContent = '';
  $('periodModal').style.display = 'flex';
}
function editPeriod(id) {
  const p = periodsCache.find(x => x.id === id);
  if (!p) return;
  editingPeriodId = id;
  $('periodModalTitle').textContent = '교시 시간 수정';
  $('periodDeleteBtn').style.display = 'inline-block';
  $('pd_period').value = p.period_label;
  $('pd_sort').value = p.sort_order;
  $('pd_start').value = (p.start_time || '').slice(0, 5);
  $('pd_end').value = (p.end_time || '').slice(0, 5);
  $('periodModalMsg').textContent = '';
  $('periodModal').style.display = 'flex';
}
function closePeriodModal() { $('periodModal').style.display = 'none'; }

async function savePeriod() {
  const label = $('pd_period').value.trim();
  const start_time = $('pd_start').value;
  const end_time = $('pd_end').value;
  if (!label || !start_time || !end_time) {
    $('periodModalMsg').textContent = '교시명, 시작/종료시간은 필수입니다.';
    return;
  }
  const payload = {
    type: 'period',
    child_name: '하진',
    period_label: label,
    sort_order: Number($('pd_sort').value) || 0,
    start_time, end_time,
  };
  try {
    let res;
    if (editingPeriodId) {
      res = await fetch(`${apiBase()}/api/timetable?id=${editingPeriodId}`, {
        method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${apiBase()}/api/timetable`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error('save failed');
    closePeriodModal();
    loadTimetable();
  } catch (e) {
    $('periodModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deletePeriodFromModal() {
  if (!editingPeriodId) return;
  if (!confirm('이 교시를 삭제하시겠습니까? (배정된 과목도 함께 정리해주세요)')) return;
  await quickDeletePeriod(editingPeriodId);
  closePeriodModal();
}

async function quickDeletePeriod(id) {
  if (!confirm('이 교시를 삭제하시겠습니까?')) return;
  try {
    await fetch(`${apiBase()}/api/timetable?id=${id}&type=period`, { method: 'DELETE', headers: authHeaders() });
    loadTimetable();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

let editingTimetableEntryId = null;
let pendingEntryWeekday = null;
let pendingEntryPeriodLabel = null;

function openTimetableEntryModal(periodLabel, weekday, entryId) {
  editingTimetableEntryId = entryId || null;
  pendingEntryWeekday = weekday;
  pendingEntryPeriodLabel = periodLabel;
  const weekdayNames = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };
  $('ttEntryModalTitle').textContent = entryId ? '과목 수정' : '과목 등록';
  $('ttEntryModalSub').textContent = `${weekdayNames[weekday] || ''}요일 · ${periodLabel}`;
  $('ttEntryDeleteBtn').style.display = entryId ? 'inline-block' : 'none';
  if (entryId) {
    const e = entriesCache.find(x => x.id === entryId);
    $('te_subject').value = e ? e.subject_name : '';
  } else {
    $('te_subject').value = '';
  }
  $('ttEntryModalMsg').textContent = '';
  $('ttEntryModal').style.display = 'flex';
}
function closeTimetableEntryModal() { $('ttEntryModal').style.display = 'none'; }

async function saveTimetableEntry() {
  const subject = $('te_subject').value.trim();
  if (!subject) {
    $('ttEntryModalMsg').textContent = '과목명은 필수입니다.';
    return;
  }
  const payload = {
    child_name: '하진',
    weekday: pendingEntryWeekday,
    period_label: pendingEntryPeriodLabel,
    subject_name: subject,
  };
  try {
    let res;
    if (editingTimetableEntryId) {
      res = await fetch(`${apiBase()}/api/timetable?id=${editingTimetableEntryId}`, {
        method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${apiBase()}/api/timetable`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error('save failed');
    closeTimetableEntryModal();
    loadTimetable();
  } catch (e) {
    $('ttEntryModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deleteTimetableEntryFromModal() {
  if (!editingTimetableEntryId) return;
  if (!confirm('이 칸의 과목을 삭제하시겠습니까?')) return;
  try {
    await fetch(`${apiBase()}/api/timetable?id=${editingTimetableEntryId}`, { method: 'DELETE', headers: authHeaders() });
    closeTimetableEntryModal();
    loadTimetable();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 선생님 연락처 (과목별) ── */
/* ── 선생님 연락처 (과목별) ── */
let teachersCache = [];
let editingTeacherId = null;

async function loadTeachers() {
  const tbody = $('teacherTbody');
  try {
    const child = $('te_child') ? ($('te_child').value.trim() || '하진') : '하진';
    const res = await fetch(`${apiBase()}/api/timetable?teachers=1&child=${encodeURIComponent(child)}`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    teachersCache = data.teachers || [];
    $('subjectNameList').innerHTML = teachersCache.map(t => `<option value="${esc(t.subject_name)}">`).join('');
    if (teachersCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 선생님이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = teachersCache.map(t => `
      <tr>
        <td>${esc(t.subject_name)}</td>
        <td>${esc(t.teacher_name || '-')}</td>
        <td>${esc(t.teacher_phone || '-')}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${esc(t.note || '-')}</td>
        <td>
          <a class="hr-edit-link" onclick="editTeacher('${t.id}')">수정</a>
          · <a class="hr-edit-link" onclick="deleteTeacher('${t.id}')">삭제</a>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function openTeacherModal() {
  editingTeacherId = null;
  $('teacherModalTitle').textContent = '선생님 등록';
  $('tc_subject').value = '';
  $('tc_name').value = '';
  $('tc_phone').value = '';
  $('tc_note').value = '';
  $('teacherModalMsg').textContent = '';
  $('teacherModal').style.display = 'flex';
}

function editTeacher(id) {
  const t = teachersCache.find(x => x.id === id);
  if (!t) return;
  editingTeacherId = id;
  $('teacherModalTitle').textContent = `선생님 수정 — ${t.subject_name}`;
  $('tc_subject').value = t.subject_name;
  $('tc_name').value = t.teacher_name || '';
  $('tc_phone').value = t.teacher_phone || '';
  $('tc_note').value = t.note || '';
  $('teacherModalMsg').textContent = '';
  $('teacherModal').style.display = 'flex';
}

function closeTeacherModal() { $('teacherModal').style.display = 'none'; }

async function saveTeacher() {
  const subject = $('tc_subject').value.trim();
  if (!subject) { $('teacherModalMsg').textContent = '과목명은 필수입니다.'; return; }
  const payload = {
    type: 'teacher',
    child_name: ($('te_child') ? $('te_child').value.trim() : '') || '하진',
    subject_name: subject,
    teacher_name: $('tc_name').value.trim() || null,
    teacher_phone: $('tc_phone').value.trim() || null,
    note: $('tc_note').value.trim() || null,
  };
  try {
    let res;
    if (editingTeacherId) {
      res = await fetch(`${apiBase()}/api/timetable?id=${editingTeacherId}`, {
        method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${apiBase()}/api/timetable`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error('save failed');
    closeTeacherModal();
    loadTeachers();
    loadTimetable();
  } catch (e) {
    $('teacherModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deleteTeacher(id) {
  if (!confirm('이 선생님 정보를 삭제하시겠습니까?')) return;
  try {
    await fetch(`${apiBase()}/api/timetable?id=${id}&type=teacher`, { method: 'DELETE', headers: authHeaders() });
    loadTeachers();
    loadTimetable();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}
