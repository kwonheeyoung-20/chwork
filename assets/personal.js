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

const personalOccurrencePending = new Map();

async function fetchPersonalOccurrencesShared(from, to) {
  const key = `${from}|${to}`;
  if (personalOccurrencePending.has(key)) return personalOccurrencePending.get(key);
  const request = (async () => {
    const res = await fetch(`${apiBase()}/api/personal_schedule?from=${from}&to=${to}&status=all&skip_prepare=1`, { headers: authHeaders() });
    if (handle401(res)) return [];
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '일정 조회 실패');
    return data.occurrences || [];
  })();
  personalOccurrencePending.set(key, request);
  request.finally(() => { setTimeout(() => personalOccurrencePending.delete(key), 0); });
  return request;
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
      sessionStorage.setItem('chwork_hr_role', data.role);
      showMain(); // 이 페이지는 딥링크로 들어오는 경우가 많아서, 대시보드로 안 튕기고 여기 그대로 머뭅니다
    } else {
      $('loginMsg').textContent = '비밀번호가 올바르지 않습니다.';
    }
  } catch (e) {
    $('loginMsg').textContent = '서버 연결에 실패했습니다.';
  }
}

async function showMain() {
  $('mainSidebar').style.display = '';
  $('loginPanel').style.display = 'none';
  $('perMain').style.display = 'flex';
  if (sessionStorage.getItem('chwork_hr_role') === 'family') {
    document.querySelectorAll('.admin-only-nav').forEach(el => el.style.display = 'none');
  }
  initPerCalState();
  setInitialPersonalListRange();
  $('perOccTbody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">달력을 먼저 불러오고 있습니다…</td></tr>`;

  // 구성원 정보는 달력 조회와 동시에 시작하되, 달력 표시를 막지 않습니다.
  const membersPromise = loadMembers();
  const calendarList = await loadPerCalendar();
  await membersPromise;

  // 첫 화면의 일정목록은 달력에서 이미 받은 이번 달 자료를 재사용합니다.
  if (calendarList) renderPersonalOccurrences(calendarList);
  else loadPersonalOccurrences();

  // 부가 자료와 반복일정 준비는 첫 화면이 표시된 뒤 순차적으로 처리합니다.
  const loadSecondaryData = async () => {
    loadPersonalReminderBanner();
    loadFamilyNotes();
    await preparePersonalScheduleData();
    await loadPerCalendar();
    await loadPersonalOccurrences();
    loadPersonalReminderBanner();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(loadSecondaryData, { timeout: 1200 });
  else setTimeout(loadSecondaryData, 250);
}

// 반복일정 회차 생성(prepare=1)은 서버에서 꽤 무거운 작업(전체 일정 재계산)이라,
// 페이지를 열 때마다 매번 실행할 필요는 없습니다. 저장/수정 시점에는 서버가 이미
// 자동으로 갱신해주므로, 여기서는 "혹시 놓친 게 있을 때"를 대비한 catch-up 용도로
// 일정 시간(12시간)에 한 번만 실행되도록 제한합니다.
const PERSONAL_PREPARE_THROTTLE_MS = 12 * 60 * 60 * 1000;

async function preparePersonalScheduleData() {
  try {
    const lastRun = Number(localStorage.getItem('chwork_personal_prepare_at') || 0);
    if (Date.now() - lastRun < PERSONAL_PREPARE_THROTTLE_MS) return;
    const res = await fetch(`${apiBase()}/api/personal_schedule?prepare=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    if (!res.ok) throw new Error('일정 준비 실패');
    localStorage.setItem('chwork_personal_prepare_at', String(Date.now()));
  } catch (e) {
    // 조회 화면에서 구체적인 오류를 표시할 수 있도록 여기서는 진행을 막지 않습니다.
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (hrPassword()) { showMain(); } else { $('loginPanel').style.display = 'block'; }
  $('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') perLogin(); });
});

function switchPerTab(name) {
  document.querySelectorAll('[data-persub]').forEach(b => b.classList.toggle('active', b.dataset.persub === name));
  $('perFamilyView').style.display = name === 'family' ? 'block' : 'none';
  $('perTimetableView').style.display = name === 'timetable' ? 'block' : 'none';
  $('perNoticeView').style.display = name === 'notice' ? 'block' : 'none';
  $('perAlbumView').style.display = name === 'album' ? 'block' : 'none';
  if (name === 'timetable' && $('perTimetableView').dataset.loaded !== '1') {
    $('perTimetableView').dataset.loaded = '1';
    loadTimetable();
  }
  if (name === 'notice' && $('perNoticeView').dataset.loaded !== '1') {
    $('perNoticeView').dataset.loaded = '1';
    loadPersonalMedia('notice');
  }
  if (name === 'album' && $('perAlbumView').dataset.loaded !== '1') {
    $('perAlbumView').dataset.loaded = '1';
    loadPersonalMedia('album');
  }
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

// "0교시"/"점심시간"처럼 요일 상관없이 항상 같은 내용인 교시는, 한 번만 입력하면 월~금 전체에 자동 적용됨
const WHOLE_ROW_PERIODS = ['0교시', '점심시간'];

const CATEGORY_EMOJI = {
  '생일': '🎂',
  '기념일': '💝',
  '결제일': '💳',
  '학교': '🏫',
  '학원': '🏫',
  '회사': '🏢',
  '일정': '📌',
  '기타': '⭐',
};
function categoryEmoji(category) {
  return CATEGORY_EMOJI[category] || '📌';
}

function personalCategoryLabel(category) {
  return category === '학원' ? '학교' : (category || '-');
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
  if (!await appConfirm('이 구성원을 삭제하시겠습니까? (등록된 일정은 그대로 남습니다)', '구성원 삭제')) return;
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
    const res = await fetch(`${apiBase()}/api/personal_schedule?upcoming=1&skip_prepare=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) { wrap.innerHTML = ''; return; }
    const overdue = list.filter(x => x.days_left < 0);
    const soon = list.filter(x => x.days_left >= 0);
    let html = '';
    if (overdue.length > 0) {
      html += `<div class="sch-banner danger"><h3>⚠ 지난 일정 (${overdue.length}건)</h3>`;
      html += overdue.map(x => `<div class="sch-banner-row"><span><span class="sch-dday overdue">D+${Math.abs(x.days_left)}</span> ${categoryEmoji(x.category)} [${esc(x.member_name)}] ${esc(x.title)}</span></div>`).join('');
      html += `</div>`;
    }
    if (soon.length > 0) {
      html += `<div class="sch-banner warn"><h3>🔔 다가오는 일정 (${soon.length}건)</h3>`;
      html += soon.map(x => `<div class="sch-banner-row"><span><span class="sch-dday soon">${x.days_left === 0 ? 'D-DAY' : 'D-' + x.days_left}</span> ${categoryEmoji(x.category)} [${esc(x.member_name)}] ${esc(x.title)}</span></div>`).join('');
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

function syncPerCalMonthPicker() {
  $('perCalMonthPicker').value = `${perCalYear}-${String(perCalMonth + 1).padStart(2, '0')}`;
}

function perCalPickMonth() {
  const value = $('perCalMonthPicker').value;
  if (!/^\d{4}-\d{2}$/.test(value)) return;
  const [year, month] = value.split('-').map(Number);
  perCalYear = year;
  perCalMonth = month - 1;
  loadPerCalendar();
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
  syncPerCalMonthPicker();
  const monthStart = new Date(perCalYear, perCalMonth, 1);
  const monthEnd = new Date(perCalYear, perCalMonth + 1, 0);
  const fromStr = toISO(monthStart);
  const toStr = toISO(monthEnd);
  try {
    const list = await fetchPersonalOccurrencesShared(fromStr, toStr);
    renderPerCalendar(list, monthStart, monthEnd);
    return list;
  } catch (e) {
    $('perCalGrid').innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--red); padding:16px;">달력 불러오기 실패</div>`;
    return null;
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

let perCalByDate = {};

function renderPerCalendar(occurrences, monthStart, monthEnd) {
  const byDate = {};
  const visibleStart = new Date(toISO(monthStart) + 'T00:00:00');
  const visibleEnd = new Date(toISO(monthEnd) + 'T00:00:00');
  occurrences.forEach(o => {
    const task = o.personal_schedule_tasks || {};
    const isPeriod = task.recurrence_type === 'once' && task.end_date && task.end_date >= o.due_date;
    const eventStart = new Date(o.due_date + 'T00:00:00');
    const eventEnd = isPeriod ? new Date(task.end_date + 'T00:00:00') : eventStart;
    // 기간 전체를 순회하지 않고 현재 보이는 달과 겹치는 최대 31일만 계산합니다.
    // 기존 데이터에 비정상적으로 먼 종료일이 있어도 브라우저가 멈추지 않습니다.
    let cursor = new Date(Math.max(eventStart.getTime(), visibleStart.getTime()));
    const last = new Date(Math.min(eventEnd.getTime(), visibleEnd.getTime()));
    let renderedDays = 0;
    while (cursor <= last && renderedDays < 31) {
      const date = toISO(cursor);
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(o);
      cursor.setDate(cursor.getDate() + 1);
      renderedDays += 1;
    }
  });
  perCalByDate = byDate;
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
      return `<div class="sch-cal-item ${o.status === 'done' ? 'done' : ''}" style="background:${color};">${categoryEmoji(task.category)} ${esc(task.title || '')}</div>`;
    }).join('');
    const moreHtml = dayItems.length > maxShow ? `<div class="sch-cal-more">+${dayItems.length - maxShow}개 더</div>` : '';
    const holidayHtml = holidayName ? `<div class="sch-cal-holiday" title="${esc(holidayName)}">${esc(holidayName)}</div>` : '';
    const dayNumClass = (weekday === 0 || holidayName) ? 'sun' : (weekday === 6 ? 'sat' : '');
    const clickable = dayItems.length > 0;
    html += `
      <div class="sch-cal-cell ${isToday ? 'today' : ''} ${holidayName ? 'holiday' : ''} ${clickable ? 'has-items' : ''}"
           ${clickable ? `onclick="openPerDayDetail('${dateStr}')" style="cursor:pointer;"` : ''}>
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

/* ── 날짜 클릭 시 그 날 일정 전체를 팝업으로 표시 (호버가 없는 터치기기에서도 동작) ── */
function openPerDayDetail(dateStr) {
  const items = perCalByDate[dateStr] || [];
  if (items.length === 0) return;
  const dateObj = new Date(dateStr);
  const wk = ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()];
  $('perDayDetailTitle').textContent = `${dateStr} (${wk}) 일정 ${items.length}건`;
  $('perDayDetailBody').innerHTML = items.map(o => {
    const task = o.personal_schedule_tasks || {};
    const color = memberColor(task.member_name);
    const statusLabel = task.category !== '결제일' ? ''
      : (o.status === 'done' ? '완료' : (o.status === 'skipped' ? '건너뜀' : '미완료'));
    return `
      <div style="display:flex; align-items:flex-start; gap:8px; padding:10px 0; border-bottom:0.5px solid var(--border);">
        <span class="member-chip" style="background:${color}; font-size:11px; flex-shrink:0;">${esc(task.member_name || '-')}</span>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:500;">${categoryEmoji(task.category)} ${esc(task.title || '-')}${task.is_private ? ' 🔒' : ''}</div>
          ${task.note ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${esc(task.note)}</div>` : ''}
          ${statusLabel ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${statusLabel}</div>` : ''}
        </div>
        <a class="hr-edit-link" onclick="closePerDayDetail(); editPersonalTask('${o.task_id}')">수정</a>
      </div>
    `;
  }).join('');
  $('perDayDetailModal').style.display = 'flex';
}
function closePerDayDetail() { $('perDayDetailModal').style.display = 'none'; }

/* ── 일정 목록 ── */
function setPerRangePreset(kind) {
  const today = new Date();
  if (kind === 'month') {
    $('perRangeFrom').value = toISO(new Date(today.getFullYear(), today.getMonth(), 1));
    $('perRangeTo').value = toISO(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  } else if (kind === '3m') {
    $('perRangeFrom').value = toISO(today);
    $('perRangeTo').value = toISO(new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()));
  }
  loadPersonalOccurrences();
}

function setInitialPersonalListRange() {
  const today = new Date();
  $('perRangeFrom').value = toISO(new Date(today.getFullYear(), today.getMonth(), 1));
  $('perRangeTo').value = toISO(new Date(today.getFullYear(), today.getMonth() + 1, 0));
}

function renderPersonalOccurrences(sourceList) {
  const tbody = $('perOccTbody');
  const status = $('perStatusFilter').value;
  const member = $('perMemberFilter').value;
  let list = Array.isArray(sourceList) ? [...sourceList] : [];
  if (member) list = list.filter(o => (o.personal_schedule_tasks || {}).member_name === member);
  if (status !== 'all') list = list.filter(o => o.status === status);
  if (status === 'pending') {
    const today = toISO(new Date());
    list = list.filter(o => (o.personal_schedule_tasks || {}).category === '결제일' || o.due_date >= today);
  }
  $('perOccCount').textContent = `총 ${list.length}건`;
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">등록된 일정이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(o => {
    const task = o.personal_schedule_tasks || {};
    const color = memberColor(task.member_name);
    const statusLabel = task.category !== '결제일' ? '-'
      : (o.status === 'done' ? '완료' : (o.status === 'skipped' ? '건너뜀' : '미완료'));
    const currentRole = sessionStorage.getItem('chwork_hr_role') === 'family' ? 'family' : 'admin';
    const lockedForOther = currentRole !== 'admin' && task.created_by_role && task.created_by_role !== currentRole;
    const actionsHtml = lockedForOther
      ? `<span style="color:var(--text-muted); font-size:12px;">🔒 등록한 분만 수정 가능</span>`
      : `${(o.status === 'pending' && task.category === '결제일') ? `<a class="hr-edit-link" onclick="openPerCompleteModal('${o.id}')">완료</a> <a class="hr-edit-link" onclick="perSkip('${o.id}')">건너뜀</a> ` : ''}
          <a class="hr-edit-link" onclick="editPersonalTask('${o.task_id}')">수정</a>
          <a class="hr-edit-link" onclick="deletePersonalOccurrence('${o.id}')">이 날짜만 삭제</a>
          <a class="hr-edit-link" onclick="deletePersonalTaskDirect('${o.task_id}')" style="color:var(--red);">전체 삭제</a>`;
    return `
      <tr>
        <td>${esc(o.due_date)}${task.date_type === 'lunar' ? ' <span style="font-size:10px; color:var(--accent);">(음력)</span>' : ''}</td>
        <td><span class="member-chip" style="background:${color}; font-size:11px;">${esc(task.member_name || '-')}</span></td>
        <td>${categoryEmoji(task.category)} ${esc(personalCategoryLabel(task.category))}</td>
        <td>${esc(task.title || '-')}${task.recurrence_type === 'once' && task.end_date && task.end_date > o.due_date ? ` <span style="font-size:11px; color:var(--text-muted);">(~${esc(task.end_date)})</span>` : ''}${task.is_private ? ' 🔒' : ''}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${[task.note ? esc(task.note) : null, o.completed_note ? '완료메모: ' + esc(o.completed_note) : null].filter(Boolean).join('<br>') || '-'}</td>
        <td>${statusLabel}</td>
        <td style="white-space:nowrap;">${actionsHtml}</td>
      </tr>
    `;
  }).join('');
}

async function loadPersonalOccurrences() {
  const tbody = $('perOccTbody');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  const status = $('perStatusFilter').value;
  const member = $('perMemberFilter').value;

  if (!$('perRangeFrom').value || !$('perRangeTo').value) {
    setPerRangePreset('month'); // 기본값: 이번달 (재귀 호출로 이어서 조회됨)
    return;
  }
  const from = $('perRangeFrom').value;
  const to = $('perRangeTo').value;
  try {
    const list = await fetchPersonalOccurrencesShared(from, to);
    renderPersonalOccurrences(list);
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
    const res = await fetch(`${apiBase()}/api/personal_schedule`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ type: 'complete', occurrence_id: pendingPerCompleteOccId, done: true, note: $('pc_note').value.trim() || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || `처리 실패 (상태코드 ${res.status})`);
    }
    closePerCompleteModal();
    loadPersonalOccurrences();
    loadPerCalendar();
    loadPersonalReminderBanner();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

async function perSkip(occId) {
  if (!await appConfirm('이 일정을 건너뛰시겠습니까?', '일정 건너뛰기')) return;
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ type: 'skip', occurrence_id: occId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.detail || `처리 실패 (상태코드 ${res.status})`);
    }
    loadPersonalOccurrences();
    loadPerCalendar();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

async function deletePersonalOccurrence(occId) {
  if (!await appConfirm('이 날짜의 일정을 삭제하시겠습니까?', '일정 삭제')) return;
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
  if (!await appConfirm('이 일정을 완전히 삭제하시겠습니까? (반복되는 모든 날짜가 함께 삭제됩니다)', '일정 전체 삭제')) return;
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
  const isOnce = $('pe_recurrence').value === 'once';
  const isWeekly = $('pe_recurrence').value === 'weekly';
  const isYearly = $('pe_recurrence').value === 'yearly';
  $('peIntervalWrap').style.display = isWeekly ? 'inline' : 'none';
  $('peLunarWrap').style.display = isYearly ? 'flex' : 'none';
  $('peEndDateLabel').firstChild.textContent = isOnce ? '기간 종료일(선택) ' : '반복 종료일(선택) ';
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
  $('pe_is_private').checked = false;
  togglePersonalRecurrenceFields();
  $('personalEventModalMsg').textContent = '';
  $('personalEventModal').style.display = 'flex';
}
function closePersonalEventModal() { $('personalEventModal').style.display = 'none'; }

async function editPersonalTask(taskId) {
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?tasks=1&skip_prepare=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    personalTasksCache = data.tasks || [];
    const t = personalTasksCache.find(x => x.id === taskId);
    if (!t) { alert('일정을 찾을 수 없습니다.'); return; }

    const currentRole = sessionStorage.getItem('chwork_hr_role') === 'family' ? 'family' : 'admin';
    const lockedForOther = currentRole !== 'admin' && t.created_by_role && t.created_by_role !== currentRole;
    if (lockedForOther) {
      alert('이 일정은 처음 등록하신 분(계정)만 수정할 수 있습니다.');
      return;
    }

    editingPersonalTaskId = taskId;
    $('personalEventModalTitle').textContent = '일정 수정';
    $('personalEventDeleteBtn').style.display = 'inline-block';
    $('pe_member').value = t.member_name;
    $('pe_category').value = t.category === '학원' ? '학교' : (t.category || '일정');
    $('pe_title').value = t.title || '';
    const uiRecurrence = (t.recurrence_type === 'monthly' && t.interval_value === 12) ? 'yearly' : t.recurrence_type;
    $('pe_recurrence').value = uiRecurrence;
    $('pe_anchor_date').value = t.anchor_date || '';
    $('pe_interval').value = t.recurrence_type === 'weekly' ? (t.interval_value || 1) : 1;
    $('pe_is_lunar').checked = t.date_type === 'lunar';
    $('pe_end_date').value = t.end_date || '';
    $('pe_reminder_days').value = t.reminder_days_before != null ? t.reminder_days_before : 1;
    $('pe_note').value = t.note || '';
    $('pe_is_private').checked = !!t.is_private;
    togglePersonalRecurrenceFields();
    $('personalEventModalMsg').textContent = '';
    $('personalEventModal').style.display = 'flex';
  } catch (e) {
    alert('불러오기 실패');
  }
}

async function deletePersonalTaskFromModal() {
  if (!editingPersonalTaskId) return;
  if (!await appConfirm('이 일정을 완전히 삭제하시겠습니까? (반복되는 모든 날짜가 함께 삭제됩니다)', '일정 전체 삭제')) return;
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
  const endDate = $('pe_end_date').value || null;
  if (uiRecurrence === 'once' && endDate && endDate < anchorDate) {
    $('personalEventModalMsg').textContent = '기간 종료일은 시작일보다 빠를 수 없습니다.';
    return;
  }

  const payload = {
    member_name: memberName,
    category: $('pe_category').value,
    title,
    recurrence_type,
    interval_value,
    anchor_date: anchorDate,
    date_type: isLunar ? 'lunar' : 'solar',
    end_date: endDate,
    reminder_days_before: Number($('pe_reminder_days').value) || 0,
    note: $('pe_note').value.trim() || null,
    is_private: $('pe_is_private').checked,
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
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // data.detail에 Supabase가 돌려준 실제 원인(예: 컬럼 없음 등)이 담겨있는 경우가 많아서
      // data.error(예: "supabase_error")만 보여주면 원인 파악이 안 됨 → detail을 우선 표시
      const detailMsg = typeof data.detail === 'string' ? data.detail
        : (data.detail && (data.detail.message || JSON.stringify(data.detail))) || null;
      throw new Error(detailMsg || data.error || `저장 실패 (상태코드 ${res.status})`);
    }
    closePersonalEventModal();
    loadPerCalendar();
    loadPersonalOccurrences();
    loadPersonalReminderBanner();
  } catch (e) {
    $('personalEventModalMsg').textContent = '저장 중 오류가 발생했습니다: ' + (e.message || '');
  }
}

/* ── 학교 시간표 ── */
async function loadTimetable() {
  const tbody = $('ttTbody');
  tbody.innerHTML = `<tr><td colspan="6" style="padding:24px; color:var(--text-muted);">불러오는 중…</td></tr>`;
  try {
    const child = $('te_child') ? ($('te_child').value.trim() || '하진') : '하진';
    const res = await fetch(`${apiBase()}/api/timetable?bundle=1&child=${encodeURIComponent(child)}`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '시간표 조회 실패');
    periodsCache = data.periods || [];
    entriesCache = data.entries || [];
    teachersCache = data.teachers || [];
    renderTimetable(periodsCache, entriesCache);
    renderPeriodList(periodsCache);
    renderTeachers();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px; color:var(--red);">불러오기 실패</td></tr>`;
  }
}

let periodsCache = [];
let entriesCache = [];

function renderTimetable(periods, entries) {
  subjectColorMap = {};
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
      // 가로 병합(여러 요일에 걸쳐 합치기): 0교시/점심시간처럼 "요일 공통" 칸만.
      // 세로 병합(같은 요일 연속 교시가 같은 과목이면 합치기): 요일공통칸 + 방과후/학원도 허용.
      // 정규수업(regular)만 세로 병합도 하지 않고 요일마다 독립된 칸으로 보여줌.
      const isWholeRowPeriod = WHOLE_ROW_PERIODS.includes(p.period_label);
      const colspanMergeable = isWholeRowPeriod;
      const rowspanMergeable = isWholeRowPeriod || e.subject_type === 'afterschool' || e.subject_type === 'academy';

      // 가로 병합 범위 계산
      let colspan = 1;
      if (colspanMergeable) {
        while (wd + colspan <= 5) {
          const nextE = entryMap[`${p.period_label}__${wd + colspan}`];
          if (nextE && nextE.subject_name === e.subject_name && (nextE.note||'') === (e.note||'')) colspan++;
          else break;
        }
      }
      // 세로 병합은 가로 병합이 안 일어났을 때만(1칸 너비일 때만) 시도
      let rowspan = 1;
      if (rowspanMergeable && colspan === 1) {
        let nextIdx = periodIdx + 1;
        while (nextIdx < periods.length) {
          const nextP = periods[nextIdx];
          const nextE = entryMap[`${nextP.period_label}__${wd}`];
          if (nextE && nextE.subject_name === e.subject_name && (nextE.note||'') === (e.note||'')) {
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
      const bgColor = getSubjectColor(e);
      cells += `
        <td${spanAttrs} style="background:${bgColor};">
          <div class="tt-cell-subject">${esc(e.subject_name)}</div>
          ${e.note ? `<div class="tt-cell-teacher" style="font-style:italic;">${esc(e.note)}</div>` : ''}
          <span class="tt-cell-edit" onclick="openTimetableEntryModal('${p.period_label}', ${wd}, '${e.id}')" title="수정">✏️</span>
        </td>
      `;
    }
    const isWholeRow = WHOLE_ROW_PERIODS.includes(p.period_label);
    return `
      <tr>
        <td>${esc(p.period_label)}<br><span style="font-size:10px; color:var(--text-muted);">${esc((p.start_time||'').slice(0,5))}~${esc((p.end_time||'').slice(0,5))}</span>
          ${!isWholeRow ? `<div class="tt-cell-edit" style="position:static; margin-top:4px; font-size:10px; color:var(--accent);" onclick="openBulkPeriodModal('${p.period_label}')">📝 일괄입력</div>` : ''}
        </td>
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
      <td><a class="hr-edit-link" onclick="editPeriod('${p.id}')">수정</a> <a class="hr-edit-link" onclick="quickDeletePeriod('${p.id}')">삭제</a></td>
    </tr>
  `).join('');
}

async function printTimetable() {
  await loadTeachers(); // 인쇄 직전에 다시 한번 확실하게 불러와서, "불러오는 중" 상태로 인쇄되는 것 방지
  const titleText = '하진 시간표';
  const tableHTML = $('ttTable').outerHTML;
  const teacherHTML = $('teacherTable').outerHTML;
  $('ttPrintTimetableBody').innerHTML = `
    <div class="tt-print-copy">
      <h3>${esc(titleText)}</h3>
      ${tableHTML}
      <h4>선생님 연락처</h4>
      ${teacherHTML}
    </div>
  `;
  $('ttPrintTeacherBody').innerHTML = '';
  $('ttFullPrintArea').style.display = 'block';

  const style = document.createElement('style');
  style.id = 'ttPrintStyle';
  style.textContent = `
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      body * { visibility: hidden; }
      #ttFullPrintArea, #ttFullPrintArea * { visibility: visible; }
      #ttFullPrintArea { position: absolute; left: 0; top: 0; width: 100%; }
      @page { size: portrait; margin: 10mm; }
      .tt-print-copy h3 { font-size: 16px; margin: 0 0 8px; }
      .tt-print-copy h4 { font-size: 13px; margin: 18px 0 6px; font-weight:700; }
      .tt-print-copy table { font-size: 11px; border-collapse: collapse !important; width: 100%; table-layout: fixed; }
      .tt-print-copy th, .tt-print-copy td {
        padding: 4px 6px;
        border: 1.5px solid #000000 !important;
      }
      .tt-cell-edit { display: none !important; }
      /* 선생님 연락처 표의 "수정/삭제" 링크 칸(마지막 열)은 인쇄에서 제외하고, 과목명 칸을 넓힘 */
      .tt-print-copy #teacherTable th:last-child,
      .tt-print-copy #teacherTable td:last-child { display: none !important; }
      .tt-print-copy #teacherTable th:first-child,
      .tt-print-copy #teacherTable td:first-child { width: 34%; }
    }
  `;
  document.head.appendChild(style);
  window.print();
  document.head.removeChild(style);
  $('ttFullPrintArea').style.display = 'none';
}

// 과목별 색상 — 정규수업은 과목마다 다른 색(팔레트 순환), 방과후/학원은 각각 한 가지 색으로 통일
const SUBJECT_COLOR_PALETTE = ['#fde2e2', '#fdead0', '#fdf6d0', '#e3f5d3', '#d3f0ea', '#d3e3fb', '#e3d7fb', '#f7d3ec', '#e0e0e0'];
const AFTERSCHOOL_COLOR = '#dfe6ec';
const ACADEMY_COLOR = '#dce9fb';
let subjectColorMap = {};

function getSubjectColor(entry) {
  if (entry.subject_type === 'afterschool') return AFTERSCHOOL_COLOR;
  if (entry.subject_type === 'academy') return ACADEMY_COLOR;
  if (!subjectColorMap[entry.subject_name]) {
    const idx = Object.keys(subjectColorMap).length % SUBJECT_COLOR_PALETTE.length;
    subjectColorMap[entry.subject_name] = SUBJECT_COLOR_PALETTE[idx];
  }
  return subjectColorMap[entry.subject_name];
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
  if (!await appConfirm('이 교시를 삭제하시겠습니까? (배정된 과목도 함께 정리해주세요)', '교시 삭제')) return;
  await quickDeletePeriod(editingPeriodId);
  closePeriodModal();
}

async function quickDeletePeriod(id) {
  if (!await appConfirm('이 교시를 삭제하시겠습니까?', '교시 삭제')) return;
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
  const isWholeRow = WHOLE_ROW_PERIODS.includes(periodLabel);
  const weekdayNames = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };
  $('ttEntryModalTitle').textContent = entryId ? '과목 수정' : '과목 등록';
  $('ttEntryModalSub').textContent = isWholeRow
    ? `${periodLabel} (요일 전체 공통 — 한 번만 입력하면 월~금 전부 적용돼요)`
    : `${weekdayNames[weekday] || ''}요일 · ${periodLabel}`;
  $('ttEntryDeleteBtn').style.display = entryId ? 'inline-block' : 'none';
  if (entryId) {
    const e = entriesCache.find(x => x.id === entryId);
    $('te_subject').value = e ? e.subject_name : '';
    $('te_subject_type').value = e ? (e.subject_type || 'regular') : 'regular';
    $('te_note').value = e ? (e.note || '') : '';
  } else if (isWholeRow) {
    // 이미 다른 요일에 등록되어 있으면 그 내용을 그대로 불러와 보여줌
    const existing = entriesCache.find(x => x.period_label === periodLabel);
    $('te_subject').value = existing ? existing.subject_name : '';
    $('te_subject_type').value = existing ? (existing.subject_type || 'regular') : 'regular';
    $('te_note').value = existing ? (existing.note || '') : '';
  } else {
    $('te_subject').value = '';
    $('te_subject_type').value = 'regular';
    $('te_note').value = '';
  }
  $('ttEntryModalMsg').textContent = '';
  $('ttEntryModal').style.display = 'flex';
  setTimeout(() => $('te_subject').focus(), 50);
}
function closeTimetableEntryModal() { $('ttEntryModal').style.display = 'none'; }

async function saveTimetableEntry() {
  const subject = $('te_subject').value.trim();
  if (!subject) {
    $('ttEntryModalMsg').textContent = '과목명은 필수입니다.';
    return;
  }
  const isWholeRow = WHOLE_ROW_PERIODS.includes(pendingEntryPeriodLabel);
  const basePayload = {
    child_name: '하진',
    period_label: pendingEntryPeriodLabel,
    subject_name: subject,
    subject_type: $('te_subject_type').value,
    note: $('te_note').value.trim() || null,
  };
  try {
    if (isWholeRow) {
      // 요일 전체(월~금) 공통 한 번에 저장 — 기존 등록분은 자동으로 upsert됨
      for (let wd = 1; wd <= 5; wd++) {
        const existing = entriesCache.find(x => x.period_label === pendingEntryPeriodLabel && x.weekday === wd);
        const payload = { ...basePayload, weekday: wd };
        if (existing) {
          await fetch(`${apiBase()}/api/timetable?id=${existing.id}`, {
            method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(payload),
          });
        } else {
          await fetch(`${apiBase()}/api/timetable`, {
            method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
          });
        }
      }
    } else {
      const payload = { ...basePayload, weekday: pendingEntryWeekday };
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
    }
    closeTimetableEntryModal();
    loadTimetable();
  } catch (e) {
    $('ttEntryModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function deleteTimetableEntryFromModal() {
  if (!editingTimetableEntryId) return;
  const isWholeRow = WHOLE_ROW_PERIODS.includes(pendingEntryPeriodLabel);
  if (!await appConfirm(isWholeRow ? '이 교시(월~금 전체)를 삭제하시겠습니까?' : '이 칸의 과목을 삭제하시겠습니까?', '시간표 삭제')) return;
  try {
    if (isWholeRow) {
      const all = entriesCache.filter(x => x.period_label === pendingEntryPeriodLabel);
      for (const e of all) {
        await fetch(`${apiBase()}/api/timetable?id=${e.id}`, { method: 'DELETE', headers: authHeaders() });
      }
    } else {
      await fetch(`${apiBase()}/api/timetable?id=${editingTimetableEntryId}`, { method: 'DELETE', headers: authHeaders() });
    }
    closeTimetableEntryModal();
    loadTimetable();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 정규수업 요일별 일괄입력 ── */
let pendingBulkPeriodLabel = null;
const BULK_WEEKDAY_FIELDS = { 1: 'bp_mon', 2: 'bp_tue', 3: 'bp_wed', 4: 'bp_thu', 5: 'bp_fri' };

function openBulkPeriodModal(periodLabel) {
  pendingBulkPeriodLabel = periodLabel;
  $('bulkPeriodModalTitle').textContent = `요일별 일괄입력 — ${periodLabel}`;
  const existingForType = entriesCache.find(x => x.period_label === periodLabel);
  $('bp_subject_type').value = existingForType ? (existingForType.subject_type || 'regular') : 'regular';
  for (let wd = 1; wd <= 5; wd++) {
    const e = entriesCache.find(x => x.period_label === periodLabel && x.weekday === wd);
    $(BULK_WEEKDAY_FIELDS[wd]).value = e ? e.subject_name : '';
  }
  $('bulkPeriodModalMsg').textContent = '';
  $('bulkPeriodModal').style.display = 'flex';
}
function closeBulkPeriodModal() { $('bulkPeriodModal').style.display = 'none'; }

async function saveBulkPeriod() {
  const subjectType = $('bp_subject_type').value;
  try {
    for (let wd = 1; wd <= 5; wd++) {
      const value = $(BULK_WEEKDAY_FIELDS[wd]).value.trim();
      const existing = entriesCache.find(x => x.period_label === pendingBulkPeriodLabel && x.weekday === wd);
      if (!value) {
        // 비워두면: 기존에 등록되어 있던 건 지워줌 (없으면 그냥 넘어감)
        if (existing) {
          await fetch(`${apiBase()}/api/timetable?id=${existing.id}`, { method: 'DELETE', headers: authHeaders() });
        }
        continue;
      }
      const payload = {
        child_name: '하진',
        weekday: wd,
        period_label: pendingBulkPeriodLabel,
        subject_name: value,
        subject_type: subjectType,
      };
      if (existing) {
        await fetch(`${apiBase()}/api/timetable?id=${existing.id}`, {
          method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(payload),
        });
      } else {
        await fetch(`${apiBase()}/api/timetable`, {
          method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
        });
      }
    }
    closeBulkPeriodModal();
    loadTimetable();
  } catch (e) {
    $('bulkPeriodModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

/* ── 선생님 연락처 (과목별) ── */
/* ── 선생님 연락처 (과목별) ── */
let teachersCache = [];
let editingTeacherId = null;

const SUBJECT_TYPE_BADGE = {
  regular: { label: '정규', color: '#e3f0ff', text: '#1a5fb4' },
  afterschool: { label: '방과후', color: '#e6f7e6', text: '#2e7d32' },
  academy: { label: '학원', color: '#fdeee0', text: '#c25e00' },
};

function getSubjectType(subjectName) {
  // 시간표(entriesCache)에서 이 과목명의 등록 타입을 찾음. 같은 과목명이 여러 요일에
  // 걸쳐 있을 때, 방과후/학원으로 등록된 게 하나라도 있으면 그걸 우선(정규가 섞여있어도 안 흔들리게).
  // 매칭되는 게 하나도 없으면 null(= "기타")
  const matches = (entriesCache || []).filter(e => e.subject_name === subjectName && e.subject_type);
  if (matches.length === 0) return null;
  const chosen = matches.find(e => e.subject_type !== 'regular') || matches[0];
  return chosen.subject_type;
}

function subjectTypeBadge(subjectName) {
  const type = getSubjectType(subjectName);
  if (!type) return '';
  const info = SUBJECT_TYPE_BADGE[type];
  if (!info) return '';
  return `<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:8px; background:${info.color}; color:${info.text}; margin-left:4px; vertical-align:middle;">${info.label}</span>`;
}

async function loadTeachers() {
  const tbody = $('teacherTbody');
  try {
    const child = $('te_child') ? ($('te_child').value.trim() || '하진') : '하진';
    const res = await fetch(`${apiBase()}/api/timetable?teachers=1&child=${encodeURIComponent(child)}`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    teachersCache = data.teachers || [];
    renderTeachers();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function renderTeachers() {
    const tbody = $('teacherTbody');
    $('subjectNameList').innerHTML = teachersCache.map(t => `<option value="${esc(t.subject_name)}">`).join('');
    if (teachersCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 선생님이 없습니다.</td></tr>`;
      return;
    }
    // 학원 → 방과후 → 정규 → 기타(시간표에 미등록) 순으로 모아서 보여줌
    const TYPE_SORT_ORDER = { academy: 0, afterschool: 1, regular: 2 };
    const sorted = [...teachersCache].sort((a, b) => {
      const ta = TYPE_SORT_ORDER[getSubjectType(a.subject_name)] ?? 3;
      const tb = TYPE_SORT_ORDER[getSubjectType(b.subject_name)] ?? 3;
      return ta - tb;
    });
    tbody.innerHTML = sorted.map(t => `
      <tr>
        <td>${esc(t.subject_name)} ${subjectTypeBadge(t.subject_name)}</td>
        <td>${esc(t.teacher_name || '-')}</td>
        <td>${esc(t.teacher_phone || '-')}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${esc(t.note || '-')}</td>
        <td>
          <a class="hr-edit-link" onclick="editTeacher('${t.id}')">수정</a>
          <a class="hr-edit-link" onclick="deleteTeacher('${t.id}')">삭제</a>
        </td>
      </tr>
    `).join('');
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
  if (!await appConfirm('이 선생님 정보를 삭제하시겠습니까?', '선생님 정보 삭제')) return;
  try {
    await fetch(`${apiBase()}/api/timetable?id=${id}&type=teacher`, { method: 'DELETE', headers: authHeaders() });
    loadTeachers();
    loadTimetable();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 가족 공유 메모 ── */
let familyNotesCache = [];
let editingFamilyNoteId = null;

function currentAccountRole() {
  return sessionStorage.getItem('chwork_hr_role') === 'family' ? 'family' : 'admin';
}

async function loadFamilyNotes() {
  const wrap = $('familyNoteList');
  wrap.innerHTML = `<div class="dash-empty">불러오는 중…</div>`;
  const status = $('familyNoteStatusFilter').value;
  try {
    const res = await fetch(`${apiBase()}/api/family_notes?status=${status}`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    familyNotesCache = data.notes || [];
    $('familyNoteCount').textContent = `총 ${familyNotesCache.length}건`;
    if (familyNotesCache.length === 0) {
      wrap.innerHTML = `<div class="dash-empty">해당하는 메모가 없습니다.</div>`;
      return;
    }
    const myRole = currentAccountRole();
    const STATUS_LABEL = { pending: '🔔 미확인', checked: '👀 확인함', done: '✅ 처리완료' };
    const STATUS_COLOR = { pending: '#fff3d6', checked: '#e3f0ff', done: '#e6f7e6' };
    wrap.innerHTML = familyNotesCache.map(n => {
      const mine = myRole === 'admin' || n.created_by_role === myRole;
      const writerLabel = n.created_by_role === 'family' ? '가족' : '나';
      return `
        <div style="padding:12px; background:${STATUS_COLOR[n.status] || 'var(--bg)'}; border-radius:var(--radius-sm);">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
            <span class="member-chip" style="background:${memberColor(n.target_member)}; font-size:11px;">${esc(n.target_member)}</span>
            <span style="font-size:11px; color:var(--text-muted);">${STATUS_LABEL[n.status] || n.status}</span>
            <span style="font-size:11px; color:var(--text-muted); margin-left:auto;">작성: ${writerLabel} · ${new Date(n.created_at).toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
          </div>
          <div style="font-size:14px; white-space:pre-wrap;">${esc(n.content)}</div>
          <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
            ${n.status !== 'checked' ? `<a class="hr-edit-link" onclick="setFamilyNoteStatus('${n.id}','checked')">확인함으로 표시</a>` : ''}
            ${n.status !== 'done' ? `<a class="hr-edit-link" onclick="setFamilyNoteStatus('${n.id}','done')">처리완료로 표시</a>` : ''}
            ${n.status !== 'pending' ? `<a class="hr-edit-link" onclick="setFamilyNoteStatus('${n.id}','pending')">미확인으로 되돌리기</a>` : ''}
            ${mine ? `<a class="hr-edit-link" onclick="editFamilyNote('${n.id}')">수정</a><a class="hr-edit-link" style="color:var(--red);" onclick="deleteFamilyNote('${n.id}')">삭제</a>` : `<span style="font-size:11px; color:var(--text-muted);">🔒 작성자만 수정/삭제 가능</span>`}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty" style="color:var(--red);">불러오기 실패</div>`;
  }
}

function populateFamilyNoteTargetSelect() {
  const sel = $('fn_target');
  const names = (membersCache || []).map(m => m.name);
  sel.innerHTML = `<option value="전체">전체</option>` + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

function openFamilyNoteModal() {
  editingFamilyNoteId = null;
  $('familyNoteModalTitle').textContent = '메모 남기기';
  populateFamilyNoteTargetSelect();
  $('fn_target').value = '전체';
  $('fn_content').value = '';
  $('familyNoteModalMsg').textContent = '';
  $('familyNoteModal').style.display = 'flex';
}

function editFamilyNote(id) {
  const n = familyNotesCache.find(x => x.id === id);
  if (!n) return;
  editingFamilyNoteId = id;
  $('familyNoteModalTitle').textContent = '메모 수정';
  populateFamilyNoteTargetSelect();
  $('fn_target').value = n.target_member;
  $('fn_content').value = n.content;
  $('familyNoteModalMsg').textContent = '';
  $('familyNoteModal').style.display = 'flex';
}

function closeFamilyNoteModal() {
  $('familyNoteModal').style.display = 'none';
}

async function saveFamilyNote() {
  const target_member = $('fn_target').value;
  const content = $('fn_content').value.trim();
  if (!content) {
    $('familyNoteModalMsg').textContent = '내용을 입력해주세요.';
    return;
  }
  try {
    const isEdit = !!editingFamilyNoteId;
    const url = isEdit ? `${apiBase()}/api/family_notes?id=${editingFamilyNoteId}` : `${apiBase()}/api/family_notes`;
    const res = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ target_member, content }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      $('familyNoteModalMsg').textContent = data.error || '저장 중 오류가 발생했습니다.';
      return;
    }
    closeFamilyNoteModal();
    loadFamilyNotes();
  } catch (e) {
    $('familyNoteModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  }
}

async function setFamilyNoteStatus(id, status) {
  try {
    const res = await fetch(`${apiBase()}/api/family_notes?id=${id}`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('failed');
    loadFamilyNotes();
  } catch (e) {
    alert('상태 변경 중 오류가 발생했습니다.');
  }
}

async function deleteFamilyNote(id) {
  if (!await appConfirm('이 메모를 삭제하시겠습니까?', '메모 삭제')) return;
  try {
    const res = await fetch(`${apiBase()}/api/family_notes?id=${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '삭제 중 오류가 발생했습니다.');
      return;
    }
    loadFamilyNotes();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 하진이 알림장 / 사진 앨범 (personal_media) ── */
let noticeMediaCache = [];
let albumMediaCache = [];
let pendingMediaUploadCategory = null;

function fileTypeIcon(contentType) {
  if ((contentType || '').startsWith('image/')) return '🖼️';
  if (contentType === 'application/pdf') return '📄';
  return '📎';
}

async function loadPersonalMedia(category) {
  const listEl = category === 'notice' ? $('noticeList') : $('albumGrid');
  listEl.innerHTML = `<div class="dash-empty">불러오는 중…</div>`;
  try {
    const res = await fetch(`${apiBase()}/api/personal_media?category=${category}`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '불러오기 실패');
    const items = data.items || [];
    if (category === 'notice') {
      noticeMediaCache = items;
      $('noticeCount').textContent = `총 ${items.length}건`;
      renderNoticeList(items);
    } else {
      albumMediaCache = items;
      $('albumCount').textContent = `총 ${items.length}장`;
      renderAlbumGrid(items);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="dash-empty" style="color:var(--red);">불러오기 실패</div>`;
  }
}

function mediaCanDelete(item) {
  const role = currentAccountRole();
  return role === 'admin' || item.uploaded_by_role === role;
}

function renderNoticeList(items) {
  const listEl = $('noticeList');
  if (items.length === 0) {
    listEl.innerHTML = `<div class="dash-empty">등록된 자료가 없습니다.</div>`;
    return;
  }
  listEl.innerHTML = items.map(it => {
    const isImage = (it.content_type || '').startsWith('image/');
    const isPdf = it.content_type === 'application/pdf';
    const uploaderLabel = it.uploaded_by_role === 'family' ? '가족' : '나';
    const dateLabel = new Date(it.created_at).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' });
    const previewHtml = isImage && it.view_url
      ? `<img src="${esc(it.view_url)}" style="width:100%; max-width:260px; border-radius:var(--radius-sm); display:block; margin-bottom:8px; cursor:pointer;" onclick="openAlbumViewerUrl('${esc(it.view_url)}')">`
      : isPdf
        ? `<a class="hr-edit-link" onclick="openPersonalMediaFile('${it.id}')" style="display:inline-block; margin-bottom:6px;">📄 PDF 미리보기</a>`
        : '';
    return `
      <div style="padding:12px; background:var(--bg); border-radius:var(--radius-sm);">
        ${previewHtml}
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span>${fileTypeIcon(it.content_type)} ${esc(it.file_name)}</span>
          <span style="font-size:11px; color:var(--text-muted); margin-left:auto;">등록: ${uploaderLabel} · ${dateLabel}</span>
        </div>
        ${it.note ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${esc(it.note)}</div>` : ''}
        <div style="margin-top:8px; display:flex; gap:10px;">
          ${!isImage ? `<a class="hr-edit-link" onclick="openPersonalMediaFile('${it.id}')">${isPdf ? '미리보기' : '다운로드'}</a>` : ''}
          ${mediaCanDelete(it) ? `<a class="hr-edit-link" style="color:var(--red);" onclick="deletePersonalMedia('${it.id}', '${it.category}')">삭제</a>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderAlbumGrid(items) {
  const grid = $('albumGrid');
  if (items.length === 0) {
    grid.innerHTML = `<div class="dash-empty">등록된 사진이 없습니다.</div>`;
    return;
  }
  grid.innerHTML = items.map(it => `
    <div style="position:relative;">
      <img src="${esc(it.view_url || '')}" style="width:100%; aspect-ratio:1; object-fit:cover; border-radius:var(--radius-sm); cursor:pointer; background:var(--bg);"
           onclick="openAlbumViewerUrl('${esc(it.view_url || '')}')">
      ${mediaCanDelete(it) ? `<a class="hr-edit-link" style="position:absolute; top:4px; right:4px; background:rgba(0,0,0,0.55); color:#fff; border:none; padding:2px 8px; border-radius:10px; font-size:11px;" onclick="event.stopPropagation(); deletePersonalMedia('${it.id}', 'album')">삭제</a>` : ''}
    </div>
  `).join('');
}

function openAlbumViewerUrl(url) {
  if (!url) return;
  $('albumViewerImg').src = url;
  $('albumViewerModal').style.display = 'flex';
}
function closeAlbumViewer() { $('albumViewerModal').style.display = 'none'; }

async function openPersonalMediaFile(id) {
  try {
    const res = await fetch(`${apiBase()}/api/personal_media?category=notice&file_id=${id}`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '열람 실패');
    window.open(data.view_url, '_blank');
  } catch (e) {
    alert('파일을 여는 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}

function openMediaUploadModal(category) {
  pendingMediaUploadCategory = category;
  $('mediaUploadModalTitle').textContent = category === 'notice' ? '알림장 자료 추가' : '앨범 사진 추가';
  $('mediaUploadFileLabel').firstChild.textContent = category === 'notice'
    ? '파일 선택 (이미지/PDF/문서, 3MB 이하) '
    : '사진 선택 (여러 장 가능, 각 3MB 이하) ';
  $('mu_file').value = '';
  $('mu_file').multiple = category === 'album';
  $('mu_file').accept = category === 'album' ? 'image/*' : '';
  $('mu_note').value = '';
  $('mediaUploadModalMsg').textContent = '';
  $('mediaUploadModal').style.display = 'flex';
}
function closeMediaUploadModal() { $('mediaUploadModal').style.display = 'none'; }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveMediaUpload() {
  const files = Array.from($('mu_file').files || []);
  if (files.length === 0) {
    $('mediaUploadModalMsg').textContent = '파일을 선택해주세요.';
    return;
  }
  const note = $('mu_note').value.trim() || null;
  const btn = $('mediaUploadSaveBtn');
  btn.disabled = true;
  let okCount = 0;
  for (const file of files) {
    // base64로 인코딩하면 용량이 약 33% 커지고, 여기에 Vercel 서버리스 함수 자체의
    // 요청 크기 제한(약 4.5MB)까지 겹쳐서, 원본이 3MB만 넘어도 휴대폰 사진 같은
    // 경우 전송 자체가 거부될 수 있음(그러면 서버가 JSON이 아닌 오류 페이지를
    // 돌려줘서 "Unexpected token" 같은 파싱 오류로 보임) — 여유 있게 3MB로 제한.
    if (file.size > 3 * 1024 * 1024) {
      $('mediaUploadModalMsg').textContent = `"${file.name}" 파일이 너무 큽니다(3MB 이하로 올려주세요). 휴대폰 사진은 보통 원본이 커서, 갤러리 공유 시 "용량 줄이기/저용량"으로 보내거나 캡처본을 이용해주세요.`;
      continue;
    }
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch(`${apiBase()}/api/personal_media`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          category: pendingMediaUploadCategory,
          file_name: file.name,
          content_type: file.type,
          file_base64: base64,
          note,
        }),
      });
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        // 서버(Vercel)가 JSON이 아닌 오류 페이지를 돌려준 경우 — 대부분 용량 초과
        throw new Error('파일이 너무 커서 업로드에 실패했습니다. 더 작은 사진으로 다시 시도해주세요.');
      }
      if (!res.ok) throw new Error(data.error || '업로드 실패');
      okCount += 1;
    } catch (e) {
      $('mediaUploadModalMsg').textContent = `"${file.name}" 업로드 중 오류: ${e.message || ''}`;
    }
  }
  btn.disabled = false;
  if (okCount > 0) {
    closeMediaUploadModal();
    loadPersonalMedia(pendingMediaUploadCategory);
  }
}

async function deletePersonalMedia(id, category) {
  if (!await appConfirm('이 자료를 삭제하시겠습니까?', '자료 삭제')) return;
  try {
    const res = await fetch(`${apiBase()}/api/personal_media?id=${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '삭제 실패');
    loadPersonalMedia(category);
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다: ' + (e.message || ''));
  }
}
