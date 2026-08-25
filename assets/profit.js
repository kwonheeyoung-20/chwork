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
  document.querySelectorAll('#profitTabBar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
}

/* ── 업로드 카드 파일명 표시 ── */
function initUploadCards() {
  ['glFile','tbFile','deptFile','extraFile','mcBsFile','mcIsFile','mcPlCurrentFile','mcPlPriorFile'].forEach(id => {
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

/* ── 월결산서 생성 (① 미리보기 → 내역 수정 → ② 확정) ── */
let mcPreviewFiles = null; // 확정 단계에서 같은 파일을 다시 보내야 하므로 보관
let mcFullSummaryCache = null; // 보고서 인쇄용 요약 데이터(당기/전년동기/전기/월별추이)
let mcDatesCache = null; // 보고서 인쇄용 기준일자/작성일자

async function runMonthlyClosing() {
  const baseDate = $('mcBaseDate').value;
  if (!baseDate) {
    showMcStatus('기준일자를 먼저 선택해주세요.', 'error');
    return;
  }
  const files = {
    bs_file: $('mcBsFile').files[0],
    is_file: $('mcIsFile').files[0],
    pl_current_file: $('mcPlCurrentFile').files[0],
    pl_prior_file: $('mcPlPriorFile').files[0],
  };
  if (!files.bs_file && !files.is_file && !files.pl_current_file && !files.pl_prior_file) {
    showMcStatus('백데이터 파일을 최소 1개 이상 업로드해주세요.', 'error');
    return;
  }
  mcPreviewFiles = files;
  const finalizedBadge = $('mcFinalizedBadge');
  if (finalizedBadge) finalizedBadge.style.display = 'none';

  const btn = $('mcGenerateBtn');
  if (btn) btn.disabled = true;
  showMcStatus('서버로 전송 중…', 'running');
  $('mcPreviewPanel').style.display = 'none';

  const fd = new FormData();
  fd.append('mode', 'preview');
  fd.append('base_date', baseDate);
  const preparedDate = $('mcPreparedDate').value;
  if (preparedDate) fd.append('prepared_date', preparedDate);
  Object.entries(files).forEach(([key, file]) => { if (file) fd.append(key, file); });

  try {
    const apiBase = getApiBase();
    const res = await fetch(apiBase + '/api/monthly_closing', { method: 'POST', body: fd });
    const data = await res.json();
    if (btn) btn.disabled = false;
    if (!data.ok) { showMcStatus('오류: ' + data.message, 'error'); return; }

    showMcStatus('미리보기 생성 완료 ✓ 아래에서 확인·수정 후 확정해주세요. (아직 목록에 저장 안 됨)', 'success');
    renderMcKpi(data.summary || {});
    mcFullSummaryCache = data.full_summary || null;
    mcDatesCache = { base_date: data.base_date, prepared_date: data.prepared_date };

    const blob = b64toBlob(data.xlsx_b64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const url = URL.createObjectURL(blob);
    const dl = $('mcDownloadBtn');
    dl.href = url;
    dl.download = data.filename || '월결산서_미리보기.xlsx';

    $('mcPreviewPanel').style.display = 'block';
    loadMcRemarks();
  } catch (e) {
    if (btn) btn.disabled = false;
    showMcStatus('서버 연결 실패: ' + e.message, 'error');
  }
}

function renderMcKpi(summary) {
  const labels = [
    ['매출액', '매출액'], ['영업이익', '영업이익'], ['당기순이익', '당기순이익'],
    ['자산총계', '자산총계'], ['부채총계', '부채총계'], ['자본총계', '자본총계'],
  ];
  const grid = $('mcKpiGrid');
  const usable = labels.filter(([k]) => typeof summary[k] === 'number');
  if (usable.length === 0) {
    grid.innerHTML = `<div class="dash-empty">핵심지표를 계산할 데이터가 없습니다 (손익계산서·재무상태표 백데이터를 업로드하면 표시돼요).</div>`;
    return;
  }
  grid.innerHTML = usable.map(([key, label]) => `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${summary[key].toLocaleString('ko-KR')}</div>
    </div>
  `).join('');
}

function mcEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadMcRemarks() {
  const wrap = $('mcRemarksTable');
  wrap.innerHTML = `<div class="dash-empty" style="padding:12px;">불러오는 중…</div>`;
  try {
    const apiBase = getApiBase();
    const res = await fetch(apiBase + '/api/monthly_closing?remarks=1');
    const data = await res.json();
    if (!data.ok) {
      wrap.innerHTML = `<div class="dash-empty" style="padding:12px; color:var(--red);">${data.message || '불러오기 실패'}</div>`;
      return;
    }
    const bySheet = data.remarks_by_sheet || {};
    const sheetNames = Object.keys(bySheet);
    const specialNote = (data.special_notes && data.special_notes.summary_special_note) || '';
    $('mcSpecialNote').value = specialNote;
    if (sheetNames.length === 0) {
      wrap.innerHTML = `<div class="dash-empty" style="padding:12px;">내역(비고) 항목이 없습니다.</div>`;
      return;
    }
    wrap.innerHTML = sheetNames.map(sheetName => {
      const list = bySheet[sheetName];
      // 같은 계정명이 몇 번 나오는지 미리 세어서, 2번 이상이면 "(N번째)" 표시를 붙임
      const totalByLabel = {};
      list.forEach(r => { totalByLabel[r.account_label] = (totalByLabel[r.account_label] || 0) + 1; });
      const seenSoFar = {};
      return `
        <div style="padding:10px 12px 4px; font-size:13px; font-weight:600; background:var(--bg); position:sticky; top:0;">📄 ${mcEsc(sheetName)}</div>
        <table class="table" style="width:100%;">
          <thead><tr><th style="white-space:nowrap;">계정과목</th><th>내역(비고)</th></tr></thead>
          <tbody>
            ${list.map(r => {
              seenSoFar[r.account_label] = (seenSoFar[r.account_label] || 0) + 1;
              const dupSuffix = totalByLabel[r.account_label] > 1
                ? ` <span style="color:var(--text-muted); font-size:11px;">(${seenSoFar[r.account_label]}번째, 위/아래 항목 참고)</span>`
                : '';
              return `
              <tr>
                <td style="white-space:nowrap;">${mcEsc(r.account_label)}${dupSuffix}</td>
                <td><input type="text" class="hr-input mc-remark-input" data-key="${mcEsc(r.account_key)}" data-label="${mcEsc(r.account_label)}" value="${mcEsc(r.note || '')}" style="width:100%;"></td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      `;
    }).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty" style="padding:12px; color:var(--red);">불러오기 실패</div>`;
  }
}

async function finalizeMonthlyClosing() {
  if (!mcPreviewFiles) {
    alert('먼저 "① 미리보기 생성"을 실행해주세요.');
    return;
  }
  const baseDate = $('mcBaseDate').value;
  const preparedDate = $('mcPreparedDate').value;

  const remarksList = Array.from(document.querySelectorAll('.mc-remark-input')).map(input => ({
    account_key: input.dataset.key,
    account_label: input.dataset.label,
    note: input.value.trim() || null,
  }));

  if (!confirm('이 내용으로 확정(마감)하시겠습니까? 확정하면 저장 목록에 등록됩니다.')) return;

  const btn = $('mcFinalizeBtn');
  if (btn) btn.disabled = true;
  showMcFinalizeStatus('확정 처리 중…', 'running');

  const fd = new FormData();
  fd.append('mode', 'finalize');
  fd.append('base_date', baseDate);
  if (preparedDate) fd.append('prepared_date', preparedDate);
  fd.append('remarks_json', JSON.stringify(remarksList));
  fd.append('summary_special_note', $('mcSpecialNote').value);
  Object.entries(mcPreviewFiles).forEach(([key, file]) => { if (file) fd.append(key, file); });

  try {
    const apiBase = getApiBase();
    const res = await fetch(apiBase + '/api/monthly_closing', { method: 'POST', body: fd });
    const data = await res.json();
    if (btn) btn.disabled = false;
    if (!data.ok) { showMcFinalizeStatus('오류: ' + data.message, 'error'); return; }

    showMcFinalizeStatus('✅ 확정 완료! 아래 "저장된 월결산서 목록"에 등록됐어요.' + (data.save_warning ? ' (' + data.save_warning + ')' : ''), data.save_warning ? 'error' : 'success');
    mcFullSummaryCache = data.full_summary || mcFullSummaryCache;
    mcDatesCache = { base_date: data.base_date, prepared_date: data.prepared_date };
    const badge = $('mcFinalizedBadge');
    if (badge) badge.style.display = 'inline-block';
    const blob = b64toBlob(data.xlsx_b64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const url = URL.createObjectURL(blob);
    const dl = $('mcDownloadBtn');
    dl.href = url;
    dl.download = data.filename || '월결산서.xlsx';
    loadMonthlyClosingList();
  } catch (e) {
    if (btn) btn.disabled = false;
    showMcFinalizeStatus('서버 연결 실패: ' + e.message, 'error');
  }
}

function showMcStatus(msg, type = '') {
  const el = $('mcStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

function showMcFinalizeStatus(msg, type = '') {
  const el = $('mcFinalizeStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

/* ── 저장된 월별 목록 ── */
async function loadMonthlyClosingList() {
  const wrap = $('mcReportList');
  if (!wrap) return;
  wrap.innerHTML = `<div class="dash-empty">불러오는 중…</div>`;
  try {
    const apiBase = getApiBase();
    const res = await fetch(apiBase + '/api/monthly_closing?list=1');
    const data = await res.json();
    if (!data.ok) {
      wrap.innerHTML = `<div class="dash-empty" style="color:var(--red);">${data.message || '불러오기 실패'}</div>`;
      return;
    }
    const list = data.reports || [];
    if (list.length === 0) {
      wrap.innerHTML = `<div class="dash-empty">아직 저장된 월결산서가 없습니다.</div>`;
      return;
    }
    wrap.innerHTML = list.map(r => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--bg); border-radius:var(--radius-sm); font-size:13px;">
        <b style="min-width:90px;">${r.period_key}</b>
        <span style="color:var(--text-secondary);">기준일 ${r.base_date}</span>
        ${r.prepared_date ? `<span style="color:var(--text-secondary);">· 작성일 ${r.prepared_date}</span>` : ''}
        <span style="color:var(--text-muted); font-size:11px; margin-left:auto;">
          ${r.updated_at ? new Date(r.updated_at).toLocaleString('ko-KR') : ''}
        </span>
        <button class="secondary" style="font-size:11px; padding:3px 10px;" onclick="openMonthlyClosingReport('${r.period_key}')">열기</button>
      </div>
    `).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="dash-empty" style="color:var(--red);">불러오기 실패</div>`;
  }
}

async function openMonthlyClosingReport(periodKey) {
  try {
    const apiBase = getApiBase();
    const res = await fetch(apiBase + '/api/monthly_closing?period_key=' + encodeURIComponent(periodKey));
    const data = await res.json();
    if (!data.ok) { alert('오류: ' + data.message); return; }
    window.open(data.url, '_blank');
  } catch (e) {
    alert('열기 실패: ' + e.message);
  }
}

/* ── 보고서 인쇄 (보고용 요약) ── */
function mcFmtNum(n) {
  if (typeof n !== 'number') return '-';
  return Math.round(n / 1000).toLocaleString('ko-KR'); // 보고서 인쇄는 천원 단위로 표시
}
function mcFmtPct(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number' || prev === 0) return '-';
  return ((cur - prev) / Math.abs(prev) * 100).toFixed(1) + '%';
}

function printMonthlyClosingReport() {
  if (!mcFullSummaryCache) {
    alert('먼저 "① 미리보기 생성"을 실행해주세요.');
    return;
  }
  const dates = mcDatesCache || {};
  $('mc_print_title').textContent = '월차 결산 보고서';
  $('mc_print_sub').textContent = `기준일자: ${dates.base_date || '-'}  ·  작성일자: ${dates.prepared_date || '-'}  ·  (단위: 천원)`;

  const INCOME_LABELS = [
    ['매출액', '매출액'], ['매출원가', '매출원가'], ['매출총이익', '매출총이익'],
    ['판매관리비', '판매관리비'], ['영업이익', '영업이익'], ['영업외수익', '영업외수익'],
    ['영업외비용', '영업외비용'], ['법인세차감전순이익', '법인세차감전순이익'], ['당기순이익', '당기순이익'],
  ];
  const income = mcFullSummaryCache.income || {};
  $('mc_print_income_tbody').innerHTML = INCOME_LABELS.map(([key, label]) => {
    const v = income[key] || {};
    const cur = v['당기'], prevYear = v['전년동기'], prevTerm = v['전기'];
    const diff = (typeof cur === 'number' && typeof prevYear === 'number') ? cur - prevYear : null;
    return `
      <tr>
        <td>${label}</td>
        <td class="num">${mcFmtNum(cur)}</td>
        <td class="num">${mcFmtNum(prevYear)}</td>
        <td class="num">${diff === null ? '-' : mcFmtNum(diff)}</td>
        <td class="num">${mcFmtPct(cur, prevYear)}</td>
        <td class="num">${mcFmtNum(prevTerm)}</td>
      </tr>
    `;
  }).join('');

  const BALANCE_LABELS = [['자산총계', '자산총계'], ['부채총계', '부채총계'], ['자본총계', '자본총계']];
  const balance = mcFullSummaryCache.balance || {};
  $('mc_print_balance_tbody').innerHTML = BALANCE_LABELS.map(([key, label]) => {
    const v = balance[key] || {};
    const cur = v['당기'], prev = v['전기'];
    const diff = (typeof cur === 'number' && typeof prev === 'number') ? cur - prev : null;
    return `
      <tr>
        <td>${label}</td>
        <td class="num">${mcFmtNum(cur)}</td>
        <td class="num">${mcFmtNum(prev)}</td>
        <td class="num">${diff === null ? '-' : mcFmtNum(diff)}</td>
        <td class="num">${mcFmtPct(cur, prev)}</td>
      </tr>
    `;
  }).join('');

  const trend = mcFullSummaryCache.trend || {};
  const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
  $('mc_print_trend_thead').innerHTML = `<th>구분</th>` + monthLabels.map(m => `<th class="num">${m}</th>`).join('');
  $('mc_print_trend_tbody').innerHTML = Object.entries(trend).map(([label, values]) => `
    <tr>
      <td>${label}</td>
      ${(values || []).map(v => `<td class="num">${typeof v === 'number' ? mcFmtNum(v) : '-'}</td>`).join('')}
    </tr>
  `).join('');

  $('mcPrintArea').style.display = 'block';
  window.print();
  $('mcPrintArea').style.display = 'none';
}

/* ── 초기화 ── */
document.addEventListener('DOMContentLoaded', () => {
  loadApiBase();
  initUploadCards();
  renderHistory();
  switchTab('summary');
  if ($('mcBaseDate') && !$('mcBaseDate').value) {
    $('mcBaseDate').value = new Date().toISOString().slice(0, 10);
  }
  if ($('mcPreparedDate') && !$('mcPreparedDate').value) {
    $('mcPreparedDate').value = new Date().toISOString().slice(0, 10);
  }
  loadMonthlyClosingList();
});
