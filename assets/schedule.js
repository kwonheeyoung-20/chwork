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
  $('schMain').style.display = 'flex';
  setPresetRange('thisMonth');
  loadReminderBanner();
  loadTasks();
  loadOccurrences();
}

window.addEventListener('DOMContentLoaded', () => {
  if (hrPassword()) showMain();
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
function toISO(d) { return d.toISOString().slice(0, 10); }

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
      <td>${esc(o.due_date)} ${dDayBadge(o.due_date)}</td>
      <td>${esc(task.title || '-')}</td>
      <td>${esc(task.category || '-')}</td>
      <td>${recurrenceLabel(task)}</td>
      <td style="font-size:12px; color:var(--text-secondary);">${esc(o.completed_note || task.note || '-')}</td>
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
  } catch (e) {
    $('taskModalMsg').textContent = '저장 중 오류가 발생했습니다.';
  } finally {
    btn.disabled = false;
  }
}
