/* ───────── profit.js (Vercel 버전) ───────── */

/* ── 유틸 ── */
const fmt = n => {
  if (n == null || isNaN(n)) return '-';
  return Math.round(n).toLocaleString('ko-KR');
};
const pct = n => {
  if (n == null || isNaN(n)) return '-';
  return (n * 100).toFixed(1) + '%';
};
const $ = id => document.getElementById(id);

/* ── API Base: Vercel은 같은 도메인 /api 사용 ── */
function getApiBase() {
  const saved = localStorage.getItem('chwork_api_base');
  if (saved && saved.trim()) return saved.trim().replace(/\/$/, '');
  return window.location.origin;
}
function loadApiBase() {
  const saved = localStorage.getItem('chwork_api_base') || '';
  const input = $('apiBase');
  if (input) input.value = saved;
}
function saveApiBase() {
  const input = $('apiBase');
  if (!input) return;
  const v = input.value.trim().replace(/\/$/, '');
  localStorage.setItem('chwork_api_base', v);
  input.value = v;
  showStatus('서버 주소가 저장되었습니다.', 'success');
}

/* ── 탭 전환 ── */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
}

/* ── 업로드 카드 파일명 표시 ── */
function initUploadCards() {
  ['glFile','tbFile','deptFile','extraFile'].forEach(id => {
    const input = $(id);
    if (!input) return;
    input.addEventListener('change', () => {
      const card = input.closest('.upload-card');
      const nameEl = card.querySelector('.file-name');
      if (input.files[0]) {
        card.classList.add('has-file');
        if (nameEl) nameEl.textContent = input.files[0].name;
      } else {
        card.classList.remove('has-file');
        if (nameEl) nameEl.textContent = '';
      }
    });
  });
}

/* ── 상태 메시지 ── */
function showStatus(msg, type = '') {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + type;
}

/* ── 분석 실행 ── */
async function runAnalyze() {
  const glFile = $('glFile') && $('glFile').files[0];
  const tbFile = $('tbFile') && $('tbFile').files[0];
  if (!glFile || !tbFile) {
    showStatus('ACA0090 원장 파일과 ACB0021 합계잔액시산표 파일은 필수입니다.', 'error');
    return;
  }

  const btn = $('analyzeBtn');
  if (btn) btn.disabled = true;
  showStatus('서버로 전송 중…', 'running');

  const fd = new FormData();
  fd.append('gl_file', glFile);
  fd.append('tb_file', tbFile);
  if ($('deptFile') && $('deptFile').files[0]) fd.append('dept_file', $('deptFile').files[0]);
  if ($('extraFile') && $('extraFile').files[0]) fd.append('extra_file', $('extraFile').files[0]);

  try {
    const apiBase = getApiBase();
    const res = await fetch(apiBase + '/api/analyze', { method: 'POST', body: fd });
    const data = await res.json();
    if (btn) btn.disabled = false;
    if (!data.ok) { showStatus('오류: ' + data.message, 'error'); return; }

    showStatus('분석 완료 ✓', 'success');

    // Vercel: base64 엑셀을 브라우저에서 직접 다운로드
    if (data.xlsx_b64) {
      const blob = b64toBlob(data.xlsx_b64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const url = URL.createObjectURL(blob);
      renderResult(data.summary, url, data.filename || '창현_기업손익분석_보고서.xlsx');
      saveHistory(data.summary, url, data.filename);
    } else {
      // 구형 Render 방식 호환
      renderResult(data.summary, apiBase + data.download_url, '창현_기업손익분석_보고서.xlsx');
      saveHistory(data.summary, apiBase + data.download_url);
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    showStatus('서버 연결 실패: ' + e.message, 'error');
  }
}

/* base64 → Blob 변환 */
function b64toBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

/* ── 결과 렌더링 ── */
let _chartBranch = null, _chartCost = null, _chartIncome = null;

function renderResult(s, downloadUrl, filename) {
  const resultEl = $('result');
  if (!resultEl) return;
  resultEl.classList.remove('hidden');

  if ($('kSales'))  $('kSales').textContent  = fmt(s.sales) + '원';
  if ($('kOp'))     $('kOp').textContent     = fmt(s.operating_profit) + '원';
  if ($('kMargin')) $('kMargin').textContent = pct(s.op_margin);
  if ($('kCost'))   $('kCost').textContent   = pct(s.cost_ratio);

  const dlBtn = $('downloadBtn');
  if (dlBtn) {
    dlBtn.href = downloadUrl || '#';
    dlBtn.download = filename || '창현_기업손익분석_보고서.xlsx';
    dlBtn.classList.remove('disabled');
  }
  const pdfBtn = $('pdfBtn');
  if (pdfBtn) pdfBtn.onclick = () => generatePDF(s);

  setTimeout(() => {
    renderIncomeStatement(s);
    renderBalanceSheet(s);
    renderBranchTable(s.branches || []);
    renderCostAnalysis(s);
    renderTrendAnalysis(s);
    switchTab('summary');
  }, 50);
}

function renderIncomeStatement(s) {
  const cost = (s.sales || 0) * (s.cost_ratio || 0);
  const rows = [
    { label: '매출액', amount: s.sales, ratio: 1.0, bold: true },
    { label: '매출원가 / 판관비', amount: cost, ratio: s.cost_ratio || 0 },
    { label: '영업이익', amount: s.operating_profit, ratio: s.op_margin || 0, bold: true, isProfit: true },
  ];
  const tbody = document.querySelector('#incomeTable tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td${r.bold ? ' style="font-weight:600"' : ''}>${r.label}</td>
      <td class="num${r.isProfit ? ((r.amount||0) >= 0 ? ' positive' : ' negative') : ''}"${r.bold ? ' style="font-weight:600"' : ''}>${fmt(r.amount)}</td>
      <td class="num">${pct(r.ratio)}</td>
    </tr>
  `).join('');
}

function renderBalanceSheet(s) {
  const rows = [
    { label: '자산총계', amount: s.assets || 0 },
    { label: '부채총계', amount: s.liabilities || 0 },
    { label: '자본총계', amount: s.equity || 0 },
    { label: '부채와 자본 합계', amount: (s.liabilities || 0) + (s.equity || 0), bold: true },
  ];
  const tbody = document.querySelector('#bsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td${r.bold ? ' style="font-weight:600"' : ''}>${r.label}</td>
      <td class="num"${r.bold ? ' style="font-weight:600"' : ''}>${fmt(r.amount)}</td>
    </tr>
  `).join('');
}

function renderBranchTable(branches) {
  const tbody = document.querySelector('#branchTable tbody');
  if (!tbody) return;
  tbody.innerHTML = branches.map(b => `
    <tr>
      <td>${b.branch}</td>
      <td class="num">${fmt(b.sales)}</td>
      <td class="num">${fmt(b.cost)}</td>
      <td class="num ${(b.operating_profit||0) >= 0 ? 'positive' : 'negative'}">${fmt(b.operating_profit)}</td>
      <td class="num">${pct(b.op_margin)}</td>
    </tr>
  `).join('');

  const ctx = document.getElementById('branchChart');
  if (!ctx) return;
  if (_chartBranch) _chartBranch.destroy();
  _chartBranch = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: branches.map(b => b.branch),
      datasets: [
        { label: '매출', data: branches.map(b => b.sales), backgroundColor: '#B5D4F4' },
        { label: '영업이익', data: branches.map(b => b.operating_profit), backgroundColor: '#9FE1CB' },
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => (v/1e6).toFixed(0) + 'M' } } } }
  });
}

function renderCostAnalysis(s) {
  const cost = (s.sales || 0) * (s.cost_ratio || 0);
  const gp = (s.sales || 0) - cost;
  const fillEl = $('costFill');
  const pctEl  = $('costPct');
  const costPctVal = Math.round((s.cost_ratio || 0) * 100);
  if (fillEl) { fillEl.style.width = costPctVal + '%'; fillEl.className = 'fill ' + (costPctVal > 80 ? 'red' : costPctVal > 65 ? 'amber' : 'green'); }
  if (pctEl)  pctEl.textContent = costPctVal + '%';

  const ctx = document.getElementById('costChart');
  if (!ctx) return;
  if (_chartCost) _chartCost.destroy();
  _chartCost = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['영업이익', '비용'],
      datasets: [{ data: [Math.max(gp, 0), Math.max(cost, 0)], backgroundColor: ['#9FE1CB', '#F5C4B3'], borderWidth: 0 }]
    },
    options: { responsive: true, cutout: '65%', plugins: { legend: { position: 'bottom' } } }
  });
}

function renderTrendAnalysis(s) {
  const prev = { sales: (s.sales||0) * 0.95, op: (s.operating_profit||0) * 0.95, cost_ratio: (s.cost_ratio||0) * 0.97 };
  const rows = [
    { label: '매출액', prev: prev.sales, curr: s.sales || 0 },
    { label: '영업이익', prev: prev.op, curr: s.operating_profit || 0 },
    { label: '비용률', prev: prev.cost_ratio, curr: s.cost_ratio || 0, isPct: true },
  ];
  const container = $('trendRows');
  if (container) {
    container.innerHTML = rows.map(r => {
      const delta = r.curr - r.prev;
      const deltaPct = r.prev ? (delta / Math.abs(r.prev)) : 0;
      const up = delta >= 0;
      return `
      <div class="compare-row">
        <span class="compare-label">${r.label}</span>
        <span class="compare-val">${r.isPct ? pct(r.prev) : fmt(r.prev)}</span>
        <span class="compare-val" style="font-weight:600">${r.isPct ? pct(r.curr) : fmt(r.curr)}</span>
        <span class="compare-delta ${up ? 'positive' : 'negative'}">${up ? '▲' : '▼'} ${r.isPct ? pct(Math.abs(delta)) : fmt(Math.abs(delta))} (${pct(Math.abs(deltaPct))})</span>
      </div>`;
    }).join('');
  }

  const ctx = document.getElementById('trendChart');
  if (!ctx) return;
  if (_chartIncome) _chartIncome.destroy();
  _chartIncome = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['전월', '당월'],
      datasets: [
        { label: '매출', data: [prev.sales, s.sales||0], backgroundColor: ['#B5D4F4', '#378ADD'] },
        { label: '영업이익', data: [prev.op, s.operating_profit||0], backgroundColor: ['#C0DD97', '#639922'] },
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => (v/1e6).toFixed(0) + 'M' } } } }
  });
}

/* ── PDF 생성 ── */
async function generatePDF(s) {
  const btn = $('pdfBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'PDF 생성 중…'; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ChangHyeon Dashboard - Income Report', 15, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString('ko-KR')}`, 15, 26);
  doc.autoTable({
    startY: 32,
    head: [['Category', 'Amount', 'Ratio']],
    body: [
      ['Revenue (Sales)', fmt(s.sales) + ' KRW', '100%'],
      ['Total Cost', fmt((s.sales||0) * (s.cost_ratio||0)) + ' KRW', pct(s.cost_ratio||0)],
      ['Operating Profit', fmt(s.operating_profit) + ' KRW', pct(s.op_margin||0)],
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [24, 95, 165] },
  });
  if (s.branches && s.branches.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 10,
      head: [['Branch', 'Sales', 'Cost', 'Op. Profit', 'Margin']],
      body: s.branches.map(b => [b.branch, fmt(b.sales), fmt(b.cost), fmt(b.operating_profit), pct(b.op_margin)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [63, 110, 17] },
    });
  }
  doc.save('창현_기업손익분석_보고서.pdf');
  if (btn) { btn.disabled = false; btn.textContent = 'PDF 다운로드'; }
}

/* ── 분석 이력 ── */
const HIST_KEY = 'chwork_history';

function saveHistory(summary, downloadUrl, filename) {
  const hist = loadHistoryRaw();
  hist.unshift({ date: new Date().toISOString(), summary, downloadUrl, filename });
  localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 20)));
  renderHistory();
}

function loadHistoryRaw() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}

function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  const hist = loadHistoryRaw();
  if (!hist.length) {
    list.innerHTML = '<div class="empty">분석 이력이 없습니다.<br>파일을 업로드하고 분석 실행을 눌러주세요.</div>';
    return;
  }
  list.innerHTML = hist.map((item, i) => {
    const d = new Date(item.date);
    const dateStr = d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const s = item.summary || {};
    return `
    <div class="history-item">
      <div class="hist-meta">
        <span class="hist-date">${dateStr} <span style="font-weight:400; color:var(--text-muted); font-size:11px">${timeStr}</span></span>
        <span class="hist-detail">
          매출 ${fmt(s.sales)}원 &nbsp;·&nbsp; 영업이익률 ${pct(s.op_margin)}
          &nbsp;<span class="badge${(s.op_margin||0) < 0.05 ? ' warn' : ''}">${(s.op_margin||0) >= 0.05 ? '정상' : '주의'}</span>
        </span>
      </div>
      <div class="hist-actions">
        <button class="hist-btn" onclick="restoreHistory(${i})">다시 보기</button>
        ${item.downloadUrl ? `<a class="hist-btn" href="${item.downloadUrl}" download="${item.filename||'보고서.xlsx'}">엑셀</a>` : ''}
        <button class="hist-btn" style="color:var(--red)" onclick="deleteHistory(${i})">삭제</button>
      </div>
    </div>`;
  }).join('');
}

function restoreHistory(idx) {
  const item = loadHistoryRaw()[idx];
  if (!item) return;
  renderResult(item.summary, item.downloadUrl || '#', item.filename);
  switchTab('summary');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteHistory(idx) {
  const hist = loadHistoryRaw();
  hist.splice(idx, 1);
  localStorage.setItem(HIST_KEY, JSON.stringify(hist));
  renderHistory();
}

/* ── 초기화 ── */
document.addEventListener('DOMContentLoaded', () => {
  loadApiBase();
  initUploadCards();
  renderHistory();
  switchTab('summary');
});
