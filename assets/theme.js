/* ───────── theme.js — 다크/화이트 모드 + 로그아웃 공통 ───────── */

function openSettingsModal() {
  updateThemeToggleUI();
  initFontSelectUI();
  syncSettingsBackupRow();
  $('settingsModal').style.display = 'flex';
}
function closeSettingsModal() {
  $('settingsModal').style.display = 'none';
}

function openDataBackupSettings() {
  closeSettingsModal();
  if (typeof openDataBackupModal === 'function') {
    openDataBackupModal();
  } else {
    window.location.href = 'hr.html#data-backup';
  }
}

function syncSettingsBackupRow() {
  const settingsModal = document.getElementById('settingsModal');
  if (!settingsModal) return;
  const existingRow = settingsModal.querySelector('[data-settings-backup="1"]');
  const isAdmin = sessionStorage.getItem('chwork_hr_role') === 'admin';
  if (!isAdmin) {
    if (existingRow) existingRow.remove();
    return;
  }
  if (existingRow) return;
  const logoutRow = settingsModal.querySelector('button[onclick="logoutUser()"]');
  if (!logoutRow) return;
  const backupRow = document.createElement('button');
  backupRow.className = 'settings-row';
  backupRow.dataset.settingsBackup = '1';
  backupRow.onclick = openDataBackupSettings;
  backupRow.innerHTML = '<span>💾 데이터 백업</span>';
  logoutRow.parentNode.insertBefore(backupRow, logoutRow);
}

function applyFont(font) {
  document.documentElement.setAttribute('data-font', font);
  localStorage.setItem('chwork_font', font);
}

function initFontSelectUI() {
  const sel = document.getElementById('fontSelect');
  if (sel) sel.value = localStorage.getItem('chwork_font') || 'default';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('chwork_theme', next);
  updateThemeToggleUI();
}

function updateThemeToggleUI() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const label = current === 'dark' ? '☀️ 화이트 모드로 전환' : '🌙 다크 모드로 전환';
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => { btn.textContent = label; });
  const settingsLabel = document.getElementById('settingsThemeLabel');
  if (settingsLabel) settingsLabel.textContent = label;
}

let appConfirmResolver = null;
let appPromptResolver = null;
const appAlertQueue = [];
let appAlertVisible = false;

function ensureAppAlertModal() {
  if (document.getElementById('appAlertModal')) return;
  const modal = document.createElement('div');
  modal.id = 'appAlertModal';
  modal.className = 'hr-modal-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="hr-modal" style="width:460px; max-width:calc(100vw - 32px);">
      <h2 id="appAlertTitle" style="margin-bottom:10px;">안내</h2>
      <div id="appAlertMessage" style="font-size:13px; line-height:1.65; color:var(--text-secondary); white-space:pre-wrap; word-break:keep-all;"></div>
      <div style="display:flex; justify-content:flex-end; margin-top:20px;">
        <button class="primary" onclick="finishAppAlert()">확인</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function appAlert(message, title = '안내') {
  appAlertQueue.push({ message: String(message ?? ''), title });
  showNextAppAlert();
}

function showNextAppAlert() {
  if (appAlertVisible || appAlertQueue.length === 0) return;
  ensureAppAlertModal();
  const next = appAlertQueue.shift();
  document.getElementById('appAlertTitle').textContent = next.title;
  document.getElementById('appAlertMessage').textContent = next.message;
  document.getElementById('appAlertModal').style.display = 'flex';
  appAlertVisible = true;
}

function finishAppAlert() {
  const modal = document.getElementById('appAlertModal');
  if (modal) modal.style.display = 'none';
  appAlertVisible = false;
  showNextAppAlert();
}

// 기존의 모든 완료·오류 문구는 유지하고 표시 방식만 앱 안내창으로 통일합니다.
window.alert = appAlert;

function ensureAppPromptModal() {
  if (document.getElementById('appPromptModal')) return;
  const modal = document.createElement('div');
  modal.id = 'appPromptModal';
  modal.className = 'hr-modal-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="hr-modal" style="width:440px; max-width:calc(100vw - 32px);">
      <h2 id="appPromptTitle" style="margin-bottom:10px;">입력</h2>
      <div id="appPromptMessage" style="font-size:13px; line-height:1.65; color:var(--text-secondary); white-space:pre-wrap; word-break:keep-all; margin-bottom:12px;"></div>
      <input id="appPromptInput" class="hr-input" style="width:100%;" autocomplete="off">
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
        <button class="secondary" onclick="finishAppPrompt(null)">취소</button>
        <button class="primary" onclick="finishAppPrompt(document.getElementById('appPromptInput').value)">확인</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) finishAppPrompt(null); });
  modal.querySelector('#appPromptInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') finishAppPrompt(e.target.value);
    if (e.key === 'Escape') finishAppPrompt(null);
  });
  document.body.appendChild(modal);
}

function appPrompt(message, defaultValue = '', title = '입력') {
  ensureAppPromptModal();
  if (appPromptResolver) appPromptResolver(null);
  document.getElementById('appPromptTitle').textContent = title;
  document.getElementById('appPromptMessage').textContent = message;
  const input = document.getElementById('appPromptInput');
  input.value = defaultValue;
  document.getElementById('appPromptModal').style.display = 'flex';
  requestAnimationFrame(() => input.focus());
  return new Promise(resolve => { appPromptResolver = resolve; });
}

function finishAppPrompt(result) {
  const modal = document.getElementById('appPromptModal');
  if (modal) modal.style.display = 'none';
  const resolve = appPromptResolver;
  appPromptResolver = null;
  if (resolve) resolve(result);
}

function ensureAppConfirmModal() {
  if (document.getElementById('appConfirmModal')) return;
  const modal = document.createElement('div');
  modal.id = 'appConfirmModal';
  modal.className = 'hr-modal-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="hr-modal" style="width:440px; max-width:calc(100vw - 32px);">
      <h2 id="appConfirmTitle" style="margin-bottom:10px;">확인</h2>
      <div id="appConfirmMessage" style="font-size:13px; line-height:1.65; color:var(--text-secondary); white-space:pre-wrap; word-break:keep-all;"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
        <button class="secondary" onclick="finishAppConfirm(false)">취소</button>
        <button class="primary" id="appConfirmOkBtn" onclick="finishAppConfirm(true)">확인</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) finishAppConfirm(false); });
  document.body.appendChild(modal);
}

function appConfirm(message, title = '확인') {
  ensureAppConfirmModal();
  if (appConfirmResolver) appConfirmResolver(false);
  document.getElementById('appConfirmTitle').textContent = title;
  document.getElementById('appConfirmMessage').textContent = message;
  document.getElementById('appConfirmModal').style.display = 'flex';
  return new Promise(resolve => { appConfirmResolver = resolve; });
}

function finishAppConfirm(result) {
  const modal = document.getElementById('appConfirmModal');
  if (modal) modal.style.display = 'none';
  const resolve = appConfirmResolver;
  appConfirmResolver = null;
  if (resolve) resolve(result);
}

async function logoutUser() {
  if (!await appConfirm('로그아웃 하시겠습니까?', '로그아웃')) return;
  sessionStorage.removeItem('chwork_hr_pw');
  sessionStorage.removeItem('chwork_hr_role');
  window.location.href = 'index.html';
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('mainSidebar');
  const overlay = document.getElementById('mobileSidebarOverlay');
  if (!sidebar) return;
  sidebar.classList.toggle('mobile-open');
  if (overlay) overlay.classList.toggle('show');
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeToggleUI();
  syncSettingsBackupRow();
  document.querySelectorAll('.nav a').forEach(a => {
    a.addEventListener('click', () => {
      const sidebar = document.getElementById('mainSidebar');
      const overlay = document.getElementById('mobileSidebarOverlay');
      if (sidebar && sidebar.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('show');
      }
    });
  });
});
