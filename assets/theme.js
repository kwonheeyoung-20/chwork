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

  // 모바일 메뉴 버튼: onclick 속성이 일부 환경(웹뷰 등)에서 씹히는 경우가 있어
  // addEventListener로 한 번 더 확실하게 연결합니다.
  document.querySelectorAll('.mobile-menu-btn').forEach(btn => {
    btn.addEventListener('click', toggleMobileSidebar);
  });
  document.querySelectorAll('.mobile-sidebar-overlay').forEach(ov => {
    ov.addEventListener('click', toggleMobileSidebar);
  });
});
