/* ───────── theme.js — 다크/화이트 모드 + 로그아웃 공통 ───────── */

function openSettingsModal() {
  updateThemeToggleUI();
  $('settingsModal').style.display = 'flex';
}
function closeSettingsModal() {
  $('settingsModal').style.display = 'none';
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

function logoutUser() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  sessionStorage.removeItem('chwork_hr_pw');
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', updateThemeToggleUI);
