/* ───────── schedule.js ───────── */

const $ = id => document.getElementById(id);

function apiBase() { return window.location.origin; }
function hrPassword() { return sessionStorage.getItem('chwork_hr_pw') || ''; }

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── 로그인 (hr.html과 세션 공유: 같은 X-HR-Password) ── */
async function schLogin() {
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
  $('schMain').style.display = 'flex';
  setPresetRange('thisMonth');
  loadReminderBanner();
  loadTasks();
  loadOccurrences();
  loadCalendar();
}

window.addEventListener('DOMContentLoaded', () => {
  if (hrPassword() && sessionStorage.getItem('chwork_hr_role') !== 'family') showMain();
  else if (hrPassword()) { window.location.href = 'personal.html'; return; }
  $('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') schLogin(); });
});

function authHeaders(json) {
  const h = { 'X-HR-Password': hrPassword() };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function handle401(res) {
  if (res.status === 401) {
    sessionStorage.removeItem('chwork_hr_pw');
    $('loginPanel').style.display = 'block';
    $('schMain').style.display = 'none';
    $('loginMsg').textContent = '세션이 만료되었습니다. 다시 로그인해주세요.';
    return true;
  }
  return false;
}

/* ── 알림 배너 ── */
async function loadReminderBanner() {
  const wrap = $('reminderBannerWrap');
  try {
    const res = await fetch(`${apiBase()}/api/schedule?upcoming=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) {
      wrap.innerHTML = '';
      return;
    }
    const overdue = list.filter(x => x.days_left < 0);
    const soon = list.filter(x => x.days_left >= 0);

    let html = '';
    if (overdue.length > 0) {
      html += `<div class="sch-banner danger"><h3>⚠ 기한이 지난 미완료 업무 (${overdue.length}건)</h3>`;
      html += overdue.map(x => `
        <div class="sch-banner-row">
          <span><span class="dday">D+${Math.abs(x.days_left)}</span>${esc(x.title)}${x.category ? ` <span style="color:var(--text-muted);">(${esc(x.category)})</span>` : ''} — ${esc(x.due_date)}</span>
        </div>
      `).join('');
      html += `</div>`;
    }
    if (soon.length > 0) {
      html += `<div class="sch-banner warn"><h3>🔔 다가오는 일정 (${soon.length}건)</h3>`;
      html += soon.map(x => `
        <div class="sch-banner-row">
          <span><span class="dday">${x.days_left === 0 ? 'D-DAY' : 'D-' + x.days_left}</span>${esc(x.title)}${x.category ? ` <span style="color:var(--text-muted);">(${esc(x.category)})</span>` : ''} — ${esc(x.due_date)}</span>
        </div>
      `).join('');
      html += `</div>`;
    }
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = '';
  }
}

/* ── 기간 프리셋 ── */
function toISO(d) {
  // 로컬 날짜 기준으로 YYYY-MM-DD 생성 (toISOString()은 UTC 변환이라
  // 한국 시간대에서는 날짜가 하루 밀리는 문제가 있어 직접 조립합니다)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function setPresetRange(type) {
  const now = new Date();
  if (type === 'thisMonth') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    $('f_from').value = toISO(from);
    $('f_to').value = toISO(to);
  } else if (type === 'next3') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    $('f_from').value = toISO(from);
    $('f_to').value = toISO(to);
  }
  loadOccurrences();
}

/* ── 일정 목록 ── */
let occCache = [];

async function loadOccurrences() {
  const tbody = $('occTbody');
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">불러오는 중…</td></tr>`;
  const from = $('f_from').value;
  const to = $('f_to').value;
  const status = $('f_status').value;
  const category = $('f_category').value;
  try {
    const url = `${apiBase()}/api/schedule?from=${from}&to=${to}&status=${status}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    let list = data.occurrences || [];
    if (category) {
      list = list.filter(o => (o.tax_schedule_tasks?.category || '') === category);
    }
    occCache = list;
    renderOccurrences(list);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--red); padding:24px;">불러오기 실패</td></tr>`;
  }
}

function dDayBadge(dueDateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dueDateStr + 'T00:00:00');
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
  let cls = 'normal';
  let label = diff === 0 ? 'D-DAY' : (diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`);
  if (diff < 0) cls = 'overdue';
  else if (diff <= 7) cls = 'soon';
  return `<span class="sch-dday ${cls}">${label}</span>`;
}

const KOR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function weekdayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return KOR_WEEKDAYS[d.getDay()];
}

function weekdayClass(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 ? 'sun' : (day === 6 ? 'sat' : '');
}

function renderOccurrences(list) {
  $('occCount').textContent = `총 ${list.length}건`;
  const tbody = $('occTbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">해당 기간에 일정이 없습니다.</td></tr>`;
    return;
  }
  const recurrenceLabel = (task) => {
    if (!task) return '-';
    if (task.recurrence_type === 'once') return '일회성';
    if (task.recurrence_type === 'weekly') return `매${task.interval_value > 1 ? task.interval_value + '주' : '주'}`;
    if (task.recurrence_type === 'monthly') {
      const iv = task.interval_value;
      if (iv === 1) return '매월';
      if (iv === 3) return '분기';
      if (iv === 6) return '반기';
      if (iv === 12) return '매년';
      return `${iv}개월마다`;
    }
    return '-';
  };
  const statusBadge = (s) => {
    if (s === 'done') return `<span class="hr-badge yes">완료</span>`;
    if (s === 'skipped') return `<span class="hr-badge no">건너뜀</span>`;
    return `<span class="hr-badge active">미완료</span>`;
  };

  tbody.innerHTML = list.map(o => {
    const task = o.tax_schedule_tasks || {};
    const isDone = o.status === 'done';
    return `
    <tr>
      <td>
        <label class="hr-checkbox">
          <input type="checkbox" ${isDone ? 'checked' : ''} onchange="onCompleteToggle('${o.id}', this.checked)">
          완료
        </label>
      </td>
      <td>${esc(o.due_date)} <span style="font-size:11px; color:${weekdayClass(o.due_date) === 'sun' ? 'var(--red)' : (weekdayClass(o.due_date) === 'sat' ? '#3366cc' : 'var(--text-muted)')};">(${weekdayLabel(o.due_date)})</span> ${dDayBadge(o.due_date)}</td>
      <td>${esc(task.title || '-')}</td>
      <td>${esc(task.category || '-')}</td>
      <td>${recurrenceLabel(task)}</td>
      <td style="font-size:12px; color:var(--text-secondary);">${[task.note ? esc(task.note) : null, o.completed_note ? '완료메모: ' + esc(o.completed_note) : null].filter(Boolean).join('<br>') || '-'}</td>
      <td>${statusBadge(o.status)}</td>
      <td>
        ${o.status === 'pending' ? `<a class="hr-edit-link" onclick="skipOccurrence('${o.id}')">건너뛰기</a> · ` : ''}
        <a class="hr-edit-link" onclick="deleteOccurrence('${o.id}')">삭제</a>
      </td>
    </tr>
  `;
  }).join('');
}

let pendingCompleteOccId = null;

function onCompleteToggle(occId, checked) {
  if (checked) {
    pendingCompleteOccId = occId;
    $('complete_note').value = '';
    $('completeModal').style.display = 'flex';
  } else {
    setCompleteStatus(occId, false, null);
  }
}

function openCompleteModal() { $('completeModal').style.display = 'flex'; }
function closeCompleteModal() {
  $('completeModal').style.display = 'none';
  loadOccurrences(); // 체크박스 취소했을 때 원상복귀 되도록 다시 로드
}

async function confirmComplete() {
  const note = $('complete_note').value.trim() || null;
  await setCompleteStatus(pendingCompleteOccId, true, note);
  $('completeModal').style.display = 'none';
}

async function setCompleteStatus(occId, done, note) {
  try {
    const res = await fetch(`${apiBase()}/api/schedule`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ type: 'complete', occurrence_id: occId, done, note }),
    });
    if (!res.ok) throw new Error('failed');
    loadOccurrences();
    loadReminderBanner();
    loadCalendar();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
    loadOccurrences();
  }
}

async function skipOccurrence(occId) {
  if (!confirm('이 일정을 건너뛰시겠습니까? (완료가 아니라 "해당 없음/생략" 처리됩니다)')) return;
  try {
    const res = await fetch(`${apiBase()}/api/schedule`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ type: 'skip', occurrence_id: occId }),
    });
    if (!res.ok) throw new Error('failed');
    loadOccurrences();
    loadReminderBanner();
    loadCalendar();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

async function deleteOccurrence(occId) {
  if (!confirm('이 일정(마감일 1건)을 삭제하시겠습니까?\n반복 업무라면 다음 조회시 같은 날짜로 다시 생성될 수 있습니다 (완전히 없애려면 아래 "업무 원본 관리"에서 삭제하세요).')) return;
  try {
    const res = await fetch(`${apiBase()}/api/schedule?occurrence_id=${occId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('failed');
    loadOccurrences();
    loadReminderBanner();
    loadCalendar();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 업무 원본 관리 ── */
let taskCache = [];
let editingTaskId = null;

function toggleTaskListOverview() {
  const wrap = $('taskListWrap');
  const isHidden = wrap.style.display === 'none';
  wrap.style.display = isHidden ? 'block' : 'none';
  $('taskListToggleBtn').textContent = isHidden ? '접기' : '펼치기';
}

async function loadTasks() {
  try {
    const res = await fetch(`${apiBase()}/api/schedule?tasks=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    taskCache = data.tasks || [];
    renderTasks();
    populateCategoryFilter();
  } catch (e) {
    $('taskTbody').innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--red); padding:16px;">불러오기 실패</td></tr>`;
  }
}

function populateCategoryFilter() {
  const cats = [...new Set(taskCache.map(t => t.category).filter(Boolean))].sort();
  const sel = $('f_category');
  const current = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = current;
}

function recurrenceLabelFull(t) {
  if (t.recurrence_type === 'once') return '일회성';
  if (t.recurrence_type === 'weekly') return `매${t.interval_value > 1 ? t.interval_value + '주' : '주'}(요일반복)`;
  if (t.recurrence_type === 'monthly') {
    const iv = t.interval_value;
    if (iv === 1) return '매월';
    if (iv === 3) return '분기(3개월)';
    if (iv === 6) return '반기(6개월)';
    if (iv === 12) return '매년';
    return `${iv}개월마다`;
  }
  return '-';
}

function renderTasks() {
  $('taskCount').textContent = `총 ${taskCache.length}건`;
  const tbody = $('taskTbody');
  if (taskCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:16px;">등록된 업무가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = taskCache.map(t => `
    <tr>
      <td>${esc(t.title)}</td>
      <td>${esc(t.category || '-')}</td>
      <td>${recurrenceLabelFull(t)}${t.day_mode === 'last_day' ? ' · 말일고정' : ''}</td>
      <td>${esc(t.anchor_date)}</td>
      <td>${t.reminder_days_before}일 전</td>
      <td><span class="hr-badge ${t.active ? 'active' : 'retired'}">${t.active ? '사용중' : '중지됨'}</span></td>
      <td style="font-size:12px; color:var(--text-secondary);">${esc(t.note || '-')}</td>
      <td>
        <a class="hr-edit-link" onclick="editTask('${t.id}')">수정</a>
        · <a class="hr-edit-link" onclick="toggleTaskActive('${t.id}', ${!t.active})">${t.active ? '중지' : '재개'}</a>
        · <a class="hr-edit-link" onclick="deleteTask('${t.id}', '${esc(t.title)}')">삭제</a>
      </td>
    </tr>
  `).join('');
}

async function toggleTaskActive(id, newActive) {
  try {
    const res = await fetch(`${apiBase()}/api/schedule?id=${id}`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({ active: newActive }),
    });
    if (!res.ok) throw new Error('failed');
    loadTasks();
    loadOccurrences();
    loadReminderBanner();
    loadCalendar();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

async function deleteTask(id, title) {
  if (!confirm(`"${title}" 업무를 완전히 삭제하시겠습니까?\n이 업무의 모든 마감일 기록(완료 이력 포함)이 함께 삭제됩니다. 되돌릴 수 없습니다.\n\n(과거 이력은 남기고 앞으로만 안 나오게 하려면 삭제 대신 "중지"를 사용하세요.)`)) return;
  try {
    const res = await fetch(`${apiBase()}/api/schedule?id=${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('failed');
    loadTasks();
    loadOccurrences();
    loadReminderBanner();
    loadCalendar();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

/* ── 업무 등록/수정 모달 ── */
function presetToRecurrence(preset) {
  if (preset === 'once') return { type: 'once', interval: 1 };
  if (preset === 'weekly') return { type: 'weekly', interval: Number($('t_weekly_interval').value) || 1 };
  if (preset === 'monthly1') return { type: 'monthly', interval: 1 };
  if (preset === 'monthly3') return { type: 'monthly', interval: 3 };
  if (preset === 'monthly6') return { type: 'monthly', interval: 6 };
  if (preset === 'monthly12') return { type: 'monthly', interval: 12 };
  if (preset === 'monthlyCustom') return { type: 'monthly', interval: Number($('t_monthly_interval').value) || 1 };
  return { type: 'once', interval: 1 };
}

function recurrenceToPreset(type, interval) {
  if (type === 'once') return 'once';
  if (type === 'weekly') return 'weekly';
  if (type === 'monthly') {
    if (interval === 1) return 'monthly1';
    if (interval === 3) return 'monthly3';
    if (interval === 6) return 'monthly6';
    if (interval === 12) return 'monthly12';
    return 'monthlyCustom';
  }
  return 'once';
}

function toggleRecurrenceFields() {
  const preset = $('t_preset').value;
  $('t_weekly_interval_wrap').style.display = 'none';
  $('t_monthly_interval_wrap').style.display = 'none';
  $('t_lastday_wrap').style.display = 'none';

  if (preset === 'once') {
    $('t_anchor_label').firstChild.textContent = '마감일 ';
  } else if (preset === 'weekly') {
    $('t_anchor_label').firstChild.textContent = '기준 날짜(이 날짜의 요일로 매주 반복) ';
    $('t_weekly_interval_wrap').style.display = 'flex';
  } else {
    $('t_anchor_label').firstChild.textContent = "기준 마감일(이 날짜의 '일'이 매번 반복됨) ";
    $('t_lastday_wrap').style.display = 'flex';
    if (preset === 'monthlyCustom') {
      $('t_monthly_interval_wrap').style.display = 'flex';
    }
  }
}

function openTaskModal() {
  editingTaskId = null;
  $('taskModalTitle').textContent = '새 일정 등록';
  $('t_title').value = '';
  $('t_category').value = '';
  $('t_preset').value = 'once';
  $('t_anchor_date').value = '';
  $('t_weekly_interval').value = '1';
  $('t_monthly_interval').value = '1';
  $('t_last_day').checked = false;
  $('t_end_date').value = '';
  $('t_reminder_days').value = '5';
  $('t_note').value = '';
  $('taskModalMsg').textContent = '';
  toggleRecurrenceFields();
  $('taskSaveBtn').disabled = false;
  $('taskModal').style.display = 'flex';
}

function editTask(id) {
  const t = taskCache.find(x => x.id === id);
  if (!t) return;
  editingTaskId = id;
  $('taskModalTitle').textContent = `업무 수정 — ${t.title}`;
  $('t_title').value = t.title || '';
  $('t_category').value = t.category || '';
  $('t_preset').value = recurrenceToPreset(t.recurrence_type, t.interval_value);
  $('t_anchor_date').value = t.anchor_date || '';
  $('t_weekly_interval').value = t.recurrence_type === 'weekly' ? t.interval_value : 1;
  $('t_monthly_interval').value = t.recurrence_type === 'monthly' ? t.interval_value : 1;
  $('t_last_day').checked = t.day_mode === 'last_day';
  $('t_end_date').value = t.end_date || '';
  $('t_reminder_days').value = t.reminder_days_before != null ? t.reminder_days_before : 5;
  $('t_note').value = t.note || '';
  $('taskModalMsg').textContent = '';
  toggleRecurrenceFields();
  $('taskSaveBtn').disabled = false;
  $('taskModal').style.display = 'flex';
}

function closeTaskModal() {
  $('taskModal').style.display = 'none';
}

async function saveTask() {
  const btn = $('taskSaveBtn');
  if (btn.disabled) return;
  btn.disabled = true;

  const title = $('t_title').value.trim();
  const anchorDate = $('t_anchor_date').value;
  if (!title || !anchorDate) {
    $('taskModalMsg').textContent = '제목과 날짜는 필수입니다.';
    btn.disabled = false;
    return;
  }

  const preset = $('t_preset').value;
  const rec = presetToRecurrence(preset);

  const payload = {
    title,
    category: $('t_category').value.trim() || null,
    recurrence_type: rec.type,
    interval_value: rec.interval,
    anchor_date: anchorDate,
    day_mode: $('t_last_day').checked ? 'last_day' : 'fixed',
    end_date: $('t_end_date').value || null,
    reminder_days_before: Number($('t_reminder_days').value) || 0,
    note: $('t_note').value.trim() || null,
  };

  try {
    let res;
    if (editingTaskId) {
      res = await fetch(`${apiBase()}/api/schedule?id=${editingTaskId}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${apiBase()}/api/schedule`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error('save failed');
    closeTaskModal();
    loadTasks();
    loadOccurrences();
    loadReminderBanner();
    loadCalendar();
  } catch (e) {
    $('taskModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  } finally {
    btn.disabled = false;
  }
}

/* ── 엑셀 양식 다운로드 / 업로드 (일괄 등록) ── */
function downloadScheduleTemplate() {
  const headers = ['제목', '분류', '반복유형', '반복간격(사용자지정일때만)', '기준일자', '말일고정(예/아니오)', '종료일(선택)', '사전알림일수', '비고'];
  const example = [
    ['원천세 신고·납부', '원천세', '매월', '', '2026-01-10', '아니오', '', '5', '매월 10일까지'],
    ['재고실사', '기타', '사용자지정', '2', '2026-01-15', '아니오', '', '3', '2개월마다 실시'],
    ['창립기념일 행사 준비', '기타', '일회성', '', '2026-09-01', '아니오', '', '7', ''],
  ];
  const guide = [
    ['업무일정 엑셀 업로드 양식 — 작성 안내'],
    [''],
    ['1. 반복유형에 들어갈 수 있는 값: 일회성, 매주, 매월, 분기, 반기, 매년, 사용자지정'],
    ['2. 반복간격은 "사용자지정"일 때만 숫자로 입력 (몇 개월마다인지). "매주"를 여러 주 간격으로 하고 싶을 때도 이 칸에 숫자 입력 (비워두면 1)'],
    ['3. 기준일자 — 일회성은 마감일 그 자체, 매주는 그 날짜의 요일이 매주 반복 기준, 매월/분기/반기/매년/사용자지정은 그 날짜의 "일(day)"이 매번 반복됩니다'],
    ['4. 날짜는 YYYY-MM-DD 형식으로 입력해주세요 (예: 2026-01-10)'],
    ['5. 말일고정에 "예"를 입력하면 매번 그 달의 말일로 계산됩니다 (2월은 28/29일, 4월은 30일 등) — 월 단위 반복에만 적용됩니다'],
    ['6. 사전알림일수를 비워두면 5일이 기본 적용됩니다'],
    ['7. "일정목록" 시트의 1행(제목줄)은 그대로 두고, 2행부터 실제 데이터를 입력해주세요'],
  ];
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...example]);
  wsData['!cols'] = headers.map(() => ({ wch: 20 }));
  const wsGuide = XLSX.utils.aoa_to_sheet(guide);
  wsGuide['!cols'] = [{ wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsData, '일정목록');
  XLSX.utils.book_append_sheet(wb, wsGuide, '작성안내');
  XLSX.writeFile(wb, '업무일정_업로드양식.xlsx');
}

function triggerScheduleUpload() {
  $('scheduleUploadInput').click();
}

function mapExcelRecurrence(typeLabel, intervalRaw) {
  const t = String(typeLabel || '').trim();
  const interval = Number(intervalRaw) || 1;
  if (t === '일회성') return { type: 'once', interval: 1 };
  if (t === '매주') return { type: 'weekly', interval };
  if (t === '매월') return { type: 'monthly', interval: 1 };
  if (t === '분기') return { type: 'monthly', interval: 3 };
  if (t === '반기') return { type: 'monthly', interval: 6 };
  if (t === '매년') return { type: 'monthly', interval: 12 };
  if (t === '사용자지정') return { type: 'monthly', interval };
  return null;
}

function normalizeExcelDate(v) {
  if (!v) return null;
  if (v instanceof Date) return toISO(v);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function handleScheduleUploadFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = ''; // 같은 파일 다시 선택해도 change 이벤트 발생하도록

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet = wb.Sheets['일정목록'] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

      const items = [];
      const errors = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length === 0 || !r[0]) continue; // 빈 줄은 건너뜀
        const [title, category, typeLabel, intervalRaw, anchorRaw, lastDayRaw, endRaw, reminderRaw, note] = r;

        const mapped = mapExcelRecurrence(typeLabel, intervalRaw);
        if (!mapped) { errors.push(`${i + 1}행: 반복유형 값을 확인해주세요 ("${typeLabel}")`); continue; }
        const anchorDate = normalizeExcelDate(anchorRaw);
        if (!anchorDate) { errors.push(`${i + 1}행: 기준일자를 확인해주세요 ("${anchorRaw}")`); continue; }

        items.push({
          title: String(title).trim(),
          category: category ? String(category).trim() : null,
          recurrence_type: mapped.type,
          interval_value: mapped.interval,
          anchor_date: anchorDate,
          day_mode: String(lastDayRaw || '').trim() === '예' ? 'last_day' : 'fixed',
          end_date: normalizeExcelDate(endRaw) || null,
          reminder_days_before: reminderRaw ? Number(reminderRaw) : 5,
          note: note ? String(note).trim() : null,
        });
      }

      if (items.length === 0) {
        alert('업로드할 유효한 일정이 없습니다.' + (errors.length ? '\n\n' + errors.join('\n') : ''));
        return;
      }
      let confirmMsg = `${items.length}건을 등록하시겠습니까?`;
      if (errors.length > 0) confirmMsg += `\n\n(형식 오류로 제외되는 ${errors.length}건)\n` + errors.join('\n');
      if (!confirm(confirmMsg)) return;

      const res = await fetch(`${apiBase()}/api/schedule`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ items }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'upload failed');

      let msg = `${result.count}건 등록되었습니다.`;
      if (result.skipped && result.skipped.length > 0) {
        msg += `\n\n서버에서 제외된 항목(${result.skipped.length}건):\n` + result.skipped.join('\n');
      }
      alert(msg);
      loadTasks();
      loadOccurrences();
      loadReminderBanner();
      loadCalendar();
    } catch (err) {
      alert('엑셀 업로드 중 오류가 발생했습니다: ' + (err.message || ''));
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ── 달력 뷰 ── */
let calYear, calMonth; // calMonth: 0-indexed (0=1월)

function initCalendarState() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}
initCalendarState();

function calPrevMonth() {
  calMonth -= 1;
  if (calMonth < 0) { calMonth = 11; calYear -= 1; }
  loadCalendar();
}

function calNextMonth() {
  calMonth += 1;
  if (calMonth > 11) { calMonth = 0; calYear += 1; }
  loadCalendar();
}

function calToday() {
  initCalendarState();
  loadCalendar();
}

async function loadCalendar() {
  $('calMonthLabel').textContent = `${calYear}년 ${calMonth + 1}월`;

  const monthStart = new Date(calYear, calMonth, 1);
  const monthEnd = new Date(calYear, calMonth + 1, 0);
  const fromStr = toISO(monthStart);
  const toStr = toISO(monthEnd);

  try {
    const res = await fetch(`${apiBase()}/api/schedule?from=${fromStr}&to=${toStr}&status=all`, {
      headers: authHeaders(),
    });
    if (handle401(res)) return;
    const data = await res.json();
    renderCalendar(data.occurrences || [], monthStart, monthEnd);
  } catch (e) {
    $('calGrid').innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--red); padding:16px;">달력 불러오기 실패</div>`;
  }
}

// 대한민국 공휴일 (연도별). 음력 기반 명절(설날/추석/부처님오신날)은 매년 날짜가
// 바뀌므로, 새해가 되면 그 해 목록을 추가해줘야 합니다 (정부 발표 월력요항 기준).
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

function renderCalendar(occurrences, monthStart, monthEnd) {
  const byDate = {};
  occurrences.forEach(o => {
    if (!byDate[o.due_date]) byDate[o.due_date] = [];
    byDate[o.due_date].push(o);
  });

  const todayStr = toISO(new Date());
  const firstWeekday = monthStart.getDay(); // 0=일
  const daysInMonth = monthEnd.getDate();

  let html = '';
  // 이번달 1일 이전 빈칸
  for (let i = 0; i < firstWeekday; i++) {
    html += `<div class="sch-cal-cell empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(calYear, calMonth, day);
    const dateStr = toISO(dateObj);
    const weekday = dateObj.getDay();
    const isToday = dateStr === todayStr;
    const holidayName = getHolidayName(dateStr);
    const dayItems = (byDate[dateStr] || []).slice().sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0));

    const maxShow = holidayName ? 2 : 3;
    const itemsHtml = dayItems.slice(0, maxShow).map(o => {
      const task = o.tax_schedule_tasks || {};
      let cls = 'normal';
      if (o.status === 'done') cls = 'done';
      else if (o.status === 'skipped') cls = 'skipped';
      else {
        const diff = Math.round((dateObj - new Date(new Date().setHours(0,0,0,0))) / (1000*60*60*24));
        if (diff < 0) cls = 'overdue';
        else if (diff <= 7) cls = 'soon';
      }
      return `<div class="sch-cal-item ${cls}" title="${esc(task.title || '')}">${esc(task.title || '')}</div>`;
    }).join('');
    const moreHtml = dayItems.length > maxShow ? `<div class="sch-cal-more">+${dayItems.length - maxShow}개 더</div>` : '';
    const holidayHtml = holidayName ? `<div class="sch-cal-holiday" title="${esc(holidayName)}">${esc(holidayName)}</div>` : '';

    // 토/일요일 외에도 공휴일이면 빨간색으로 표시
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

  // 마지막주 뒤 빈칸 (7의 배수로 맞춰서 그리드 깨지지 않도록)
  const totalCells = firstWeekday + daysInMonth;
  const remain = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < remain; i++) {
    html += `<div class="sch-cal-cell empty"></div>`;
  }

  $('calGrid').innerHTML = html;
}
