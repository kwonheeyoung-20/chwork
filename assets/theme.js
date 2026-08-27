/* ───────── theme.js — 다크/화이트 모드 + 로그아웃 공통 ───────── */

function openSettingsModal() {
  updateThemeToggleUI();
  initFontSelectUI();
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
  const settingsModal = document.getElementById('settingsModal');
  const logoutRow = settingsModal && settingsModal.querySelector('button[onclick="logoutUser()"]');
  const isAdmin = sessionStorage.getItem('chwork_hr_role') === 'admin';
  if (isAdmin && logoutRow && !settingsModal.querySelector('[data-settings-backup="1"]')) {
    const backupRow = document.createElement('button');
    backupRow.className = 'settings-row';
    backupRow.dataset.settingsBackup = '1';
    backupRow.onclick = openDataBackupSettings;
    backupRow.innerHTML = '<span>💾 데이터 백업</span>';
    logoutRow.parentNode.insertBefore(backupRow, logoutRow);
  }
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
