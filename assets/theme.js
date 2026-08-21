/* ───────── theme.js — 다크/화이트 모드 + 로그아웃 공통 ───────── */

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('chwork_theme', next);
  updateThemeToggleUI();
}

function updateThemeToggleUI() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.textContent = current === 'dark' ? '☀️ 화이트 모드로 전환' : '🌙 다크 모드로 전환';
  });
}

function logoutUser() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  sessionStorage.removeItem('chwork_hr_pw');
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', updateThemeToggleUI);
