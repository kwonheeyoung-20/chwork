/* ───────── dashboard.js ───────── */

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
    $('dashMain').style.display = 'none';
    $('loginMsg').textContent = '세션이 만료되었습니다. 다시 로그인해주세요.';
    return true;
  }
  return false;
}

/* ── 로그인 ── */
async function dashLogin() {
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
  $('mainSidebar').style.display = '';
  $('loginPanel').style.display = 'none';
  $('dashMain').style.display = 'flex';
  loadScheduleAlerts();
  loadContractAlerts();
  loadPersonalAlerts();
  renderYearEndReminder();
  initTodoState();
  loadTodos();
}

window.addEventListener('DOMContentLoaded', () => {
  if (hrPassword()) showMain();
  $('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') dashLogin(); });
  $('todoInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
});

/* ── 업무 일정관리 알림 ── */
async function loadScheduleAlerts() {
  const wrap = $('scheduleAlertWrap');
  try {
    const res = await fetch(`${apiBase()}/api/schedule?upcoming=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) {
      wrap.innerHTML = `<div class="dash-empty">현재 알릴 일정이 없습니다.</div>`;
      return;
    }
    const overdue = list.filter(x => x.days_left < 0);
    const soon = list.filter(x => x.days_left >= 0);
    let html = '';
    if (overdue.length > 0) {
      html += `<div class="sch-banner danger"><h3>⚠ 기한 지남 (${overdue.length}건)</h3>`;
      html += overdue.slice(0, 5).map(x => `
        <div class="sch-banner-row">
          <a href="schedule.html"><span class="sch-dday overdue">D+${Math.abs(x.days_left)}</span> ${esc(x.title)}</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    if (soon.length > 0) {
      html += `<div class="sch-banner warn"><h3>🔔 다가오는 일정 (${soon.length}건)</h3>`;
      html += soon.slice(0, 5).map(x => `
        <div class="sch-banner-row">
          <a href="schedule.html"><span class="sch-dday soon">${x.days_left === 0 ? 'D-DAY' : 'D-' + x.days_left}</span> ${esc(x.title)}</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty">불러오기 실패</div>`;
  }
}

/* ── 계약/증빙관리 알림 ── */
async function loadContractAlerts() {
  const wrap = $('contractAlertWrap');
  try {
    const res = await fetch(`${apiBase()}/api/contract_docs?upcoming=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) {
      wrap.innerHTML = `<div class="dash-empty">현재 알릴 서류가 없습니다.</div>`;
      return;
    }
    const overdue = list.filter(x => x.days_left < 0);
    const soon = list.filter(x => x.days_left >= 0);
    let html = '';
    if (overdue.length > 0) {
      html += `<div class="sch-banner danger"><h3>⚠ 계약 만료됨 (${overdue.length}건)</h3>`;
      html += overdue.slice(0, 5).map(x => `
        <div class="sch-banner-row">
          <a href="hr.html#contractdocs"><span class="sch-dday overdue">D+${Math.abs(x.days_left)}</span> ${esc(x.vendor_name || '-')} — ${esc(x.contract_title || x.doc_type || '')}</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    if (soon.length > 0) {
      html += `<div class="sch-banner warn"><h3>🔔 만료 임박 (${soon.length}건)</h3>`;
      html += soon.slice(0, 5).map(x => `
        <div class="sch-banner-row">
          <a href="hr.html#contractdocs"><span class="sch-dday soon">${x.days_left === 0 ? 'D-DAY' : 'D-' + x.days_left}</span> ${esc(x.vendor_name || '-')} — ${esc(x.contract_title || x.doc_type || '')}</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty">불러오기 실패</div>`;
  }
}

/* ── 개인 일정관리 알림 ── */
async function loadPersonalAlerts() {
  const wrap = $('personalAlertWrap');
  try {
    const res = await fetch(`${apiBase()}/api/personal_schedule?upcoming=1`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    const list = data.upcoming || [];
    if (list.length === 0) {
      wrap.innerHTML = `<div class="dash-empty">현재 알릴 개인 일정이 없습니다.</div>`;
      return;
    }
    const overdue = list.filter(x => x.days_left < 0);
    const soon = list.filter(x => x.days_left >= 0);
    let html = '';
    if (overdue.length > 0) {
      html += `<div class="sch-banner danger"><h3>⚠ 지난 일정 (${overdue.length}건)</h3>`;
      html += overdue.slice(0, 5).map(x => `
        <div class="sch-banner-row">
          <a href="personal.html"><span class="sch-dday overdue">D+${Math.abs(x.days_left)}</span> [${esc(x.member_name)}] ${esc(x.title)}</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    if (soon.length > 0) {
      html += `<div class="sch-banner warn"><h3>🔔 다가오는 일정 (${soon.length}건)</h3>`;
      html += soon.slice(0, 5).map(x => `
        <div class="sch-banner-row">
          <a href="personal.html"><span class="sch-dday soon">${x.days_left === 0 ? 'D-DAY' : 'D-' + x.days_left}</span> [${esc(x.member_name)}] ${esc(x.title)}</a>
        </div>
      `).join('');
      html += `</div>`;
    }
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty">불러오기 실패</div>`;
  }
}

/* ── 오늘 할 일 메모 ── */
let todoDate; // Date 객체
let todoItemsCache = [];

function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function initTodoState() {
  todoDate = new Date();
  todoDate.setHours(0, 0, 0, 0);
}

function todoDateLabel() {
  const w = ['일', '월', '화', '수', '목', '금', '토'];
  return `${todoDate.getFullYear()}년 ${todoDate.getMonth() + 1}월 ${todoDate.getDate()}일 (${w[todoDate.getDay()]})`;
}

function todoPrevDay() {
  todoDate.setDate(todoDate.getDate() - 1);
  loadTodos();
}

function todoNextDay() {
  todoDate.setDate(todoDate.getDate() + 1);
  loadTodos();
}

function todoGoToday() {
  initTodoState();
  loadTodos();
}

async function loadTodos() {
  $('todoDateLabel').textContent = todoDateLabel();
  const dateStr = localISO(todoDate);
  $('todoListWork').innerHTML = `<div class="dash-empty">불러오는 중…</div>`;
  $('todoListPersonal').innerHTML = '';
  try {
    const res = await fetch(`${apiBase()}/api/daily_todos?date=${dateStr}`, { headers: authHeaders() });
    if (handle401(res)) return;
    const data = await res.json();
    renderTodos(data.todos || []);
  } catch (e) {
    $('todoListWork').innerHTML = `<div class="dash-empty">불러오기 실패</div>`;
  }
}

function renderTodoGroup(containerId, items) {
  const el = $(containerId);
  if (items.length === 0) {
    el.innerHTML = `<div class="dash-empty">없음</div>`;
    return;
  }
  el.innerHTML = items.map(t => `
    <div class="todo-item ${t.done ? 'done' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTodo('${t.id}', this.checked)">
      <span class="todo-text">${esc(t.content)}</span>
      ${!t.done ? `<span class="todo-del" onclick="carryOverTodo('${t.id}')">다음날로 이월</span>` : ''}
      <span class="todo-del" onclick="deleteTodo('${t.id}')">삭제</span>
    </div>
  `).join('');
}

function renderTodos(items) {
  todoItemsCache = items;
  const doneCount = items.filter(t => t.done).length;
  $('todoCount').textContent = items.length > 0 ? `총 ${items.length}개 · ${doneCount}개 완료` : '';
  const workItems = items.filter(t => (t.category || 'work') !== 'personal');
  const personalItems = items.filter(t => t.category === 'personal');
  renderTodoGroup('todoListWork', workItems);
  renderTodoGroup('todoListPersonal', personalItems);
}

let currentTodoCategory = 'work';
function setTodoCategory(cat) {
  currentTodoCategory = cat;
  document.querySelectorAll('#todoCatToggle button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
}

async function addTodo() {
  const input = $('todoInput');
  const content = input.value.trim();
  if (!content) return;
  try {
    const res = await fetch(`${apiBase()}/api/daily_todos`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ todo_date: localISO(todoDate), content, category: currentTodoCategory }),
    });
    if (!res.ok) throw new Error('failed');
    input.value = '';
    loadTodos();
  } catch (e) {
    alert('추가 중 오류가 발생했습니다.');
  }
}

async function toggleTodo(id, done) {
  try {
    const res = await fetch(`${apiBase()}/api/daily_todos?id=${id}`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({ done }),
    });
    if (!res.ok) throw new Error('failed');
    loadTodos();
  } catch (e) {
    alert('처리 중 오류가 발생했습니다.');
  }
}

async function deleteTodo(id) {
  try {
    const res = await fetch(`${apiBase()}/api/daily_todos?id=${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('failed');
    loadTodos();
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다.');
  }
}

async function carryOverTodo(id) {
  const item = (todoItemsCache || []).find(t => t.id === id);
  if (!item) return;
  const nextDay = new Date(todoDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = localISO(nextDay);
  if (!confirm(`이 할 일을 ${nextDayStr}(다음날)로 이월하시겠습니까?\n오늘 목록에서는 사라지고, 다음날 목록에 그대로 추가됩니다.`)) return;
  try {
    const createRes = await fetch(`${apiBase()}/api/daily_todos`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ todo_date: nextDayStr, content: item.content, category: item.category || 'work' }),
    });
    if (!createRes.ok) throw new Error('create failed');

    const deleteRes = await fetch(`${apiBase()}/api/daily_todos?id=${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!deleteRes.ok) throw new Error('delete failed');

    loadTodos();
  } catch (e) {
    alert('이월 처리 중 오류가 발생했습니다.');
  }
}

/* ── 연말/연초 체크리스트 알림 (공휴일 달력·최저임금 업데이트) ── */
function renderYearEndReminder() {
  const wrap = $('yearEndReminderWrap');
  const today = new Date();
  const month = today.getMonth() + 1; // 1~12
  const day = today.getDate();
  const year = today.getFullYear();

  // 12/22 ~ 12/31, 또는 1/1 ~ 1/15 사이에 노출 (해가 바뀌기 10일 전부터 ~ 새해 보름까지)
  const inWindow = (month === 12 && day >= 22) || (month === 1 && day <= 15);
  if (!inWindow) { wrap.innerHTML = ''; return; }

  const targetYear = month === 12 ? year + 1 : year;
  const isBefore = month === 12;
  wrap.innerHTML = `
    <div class="sch-banner warn">
      <h3>🔔 ${isBefore ? '연말' : '연초'} 체크리스트 — ${targetYear}년 준비</h3>
      <div class="sch-banner-row"><span>① 업무 일정관리·개인 일정관리 달력에 ${targetYear}년 공휴일이 반영되어 있는지 확인해주세요</span></div>
      <div class="sch-banner-row"><span>② ${targetYear}년 최저임금이 급여기준표/요율에 반영되어 있는지 확인해주세요</span></div>
    </div>
  `;
}
