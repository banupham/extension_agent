'use strict';

const http = require('http');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.TEACHING_LAB_PORT || 8791);

/*
 * Teaching Lab design rule:
 * - One server.
 * - One generic route shape: /teaching/<scenario-id>.
 * - Scenarios are data, not separate handlers/files.
 * - Add a scenario only when it teaches a genuinely new capability.
 */
const SCENARIOS = Object.freeze({
  TL01: {
    family: 'DELAY',
    title: 'Delayed target',
    task: 'Mở báo cáo rồi xác nhận báo cáo.',
    expected: 'Report Confirmed',
    type: 'delay',
    delayMs: 1500,
    firstLabel: 'Open Report',
    secondLabel: 'Confirm Report'
  },
  TL02: {
    family: 'REPLACE',
    title: 'Target replacement',
    task: 'Mở phiên làm việc rồi xác nhận phiên mới.',
    expected: 'Session Confirmed',
    type: 'replace',
    delayMs: 800,
    firstLabel: 'Open Session',
    secondLabel: 'Confirm Session'
  },
  TL03: {
    family: 'AMBIGUITY',
    title: 'Indistinguishable targets',
    task: 'Chọn Control Node.',
    expected: 'Do not click; stop as ambiguous',
    type: 'ambiguity',
    label: 'Control Node'
  },
  TL04: {
    family: 'MOVING',
    title: 'Moving target',
    task: 'Mở Track Package.',
    expected: 'Package Opened',
    type: 'moving',
    label: 'Track Package'
  },
  TL05: {
    family: 'RECOVERY',
    title: 'No-effect then retry',
    task: 'Mở Relay Console.',
    expected: 'Relay Console Open',
    type: 'recovery',
    label: 'Open Relay Console',
    retryReadyMs: 1000
  }
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function layout(scenarioId, scenario, stageHtml, script = '') {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(scenarioId)} · ${esc(scenario.title)}</title>
<style>
  body{font:16px system-ui,sans-serif;margin:0;background:#f5f7fb;color:#172033}
  main{max-width:820px;margin:32px auto;padding:0 20px}
  .card{background:#fff;border:1px solid #d9deea;border-radius:14px;padding:22px}
  .meta{font-size:13px;color:#667085}.task{padding:13px;background:#eef4ff;border-radius:10px;margin:14px 0}
  .stage{position:relative;min-height:280px;border:1px dashed #b8c0cf;border-radius:12px;padding:22px;overflow:hidden}
  button{font:inherit;padding:11px 16px;border:1px solid #98a2b3;border-radius:9px;background:#fff;cursor:pointer}
  .primary{background:#175cd3;color:#fff;border-color:#175cd3}.row{display:flex;gap:14px;flex-wrap:wrap}
  .muted{color:#667085}.result{margin-top:18px;padding:12px;border-radius:9px;background:#ecfdf3;color:#027a48;font-weight:700;display:none}
  .moving{position:absolute;transition:left .18s linear}
  a{color:#175cd3}
</style>
</head>
<body>
<main>
  <p><a href="/teaching">← Teaching Lab</a></p>
  <section class="card">
    <div class="meta">${esc(scenarioId)} · ${esc(scenario.family)}</div>
    <h1>${esc(scenario.title)}</h1>
    <div class="task"><b>Task Episode:</b> ${esc(scenarioId)} | ${esc(scenario.task)}</div>
    <div class="stage">${stageHtml}</div>
    <div id="result" class="result"></div>
    <p class="meta"><b>Expected:</b> ${esc(scenario.expected)}</p>
  </section>
</main>
<script>
function success(text){const el=document.getElementById('result');el.textContent=text;el.style.display='block';document.body.dataset.success='true';}
${script}
</script>
</body>
</html>`;
}

function renderScenario(id, s) {
  if (s.type === 'delay') {
    return layout(id, s,
      `<button id="first" class="primary">${esc(s.firstLabel)}</button> <button id="second" style="display:none">${esc(s.secondLabel)}</button>`,
      `first.onclick=()=>{first.disabled=true;setTimeout(()=>second.style.display='inline-block',${Number(s.delayMs)});};second.onclick=()=>success(${JSON.stringify(s.expected)});`
    );
  }

  if (s.type === 'replace') {
    return layout(id, s,
      `<div id="slot"><button id="first" class="primary">${esc(s.firstLabel)}</button></div>`,
      `first.onclick=()=>{slot.innerHTML='<span class="muted">Opening…</span>';setTimeout(()=>{slot.innerHTML='<button id="second">${esc(s.secondLabel)}</button>';second.onclick=()=>success(${JSON.stringify(s.expected)});},${Number(s.delayMs)});};`
    );
  }

  if (s.type === 'ambiguity') {
    return layout(id, s,
      `<div class="row"><button>${esc(s.label)}</button><button>${esc(s.label)}</button></div><p class="muted">Hai target cố ý giống hệt nhau và không có context phân biệt. Không có đáp án click đúng.</p>`
    );
  }

  if (s.type === 'moving') {
    return layout(id, s,
      `<button id="target" class="primary moving" style="left:24px;top:120px">${esc(s.label)}</button>`,
      `let i=0;const xs=[24,150,300,460,620];const timer=setInterval(()=>{i+=1;if(i>=xs.length){clearInterval(timer);return;}target.style.left=xs[i]+'px';},500);target.onclick=()=>success(${JSON.stringify(s.expected)});`
    );
  }

  if (s.type === 'recovery') {
    return layout(id, s,
      `<button id="target" class="primary">${esc(s.label)}</button><p id="hint" class="muted"></p>`,
      `let clicked=false,ready=false;target.onclick=()=>{if(!clicked){clicked=true;hint.textContent='No visible effect yet';setTimeout(()=>{ready=true;hint.textContent='Relay is ready for another attempt';},${Number(s.retryReadyMs)});return;}if(ready)success(${JSON.stringify(s.expected)});};`
    );
  }

  return layout(id, s, '<p>Unsupported scenario type.</p>');
}

function indexPage() {
  const rows = Object.entries(SCENARIOS).map(([id, s]) => `
    <tr>
      <td><b>${esc(id)}</b></td>
      <td>${esc(s.family)}</td>
      <td>${esc(s.task)}</td>
      <td><a href="/teaching/${encodeURIComponent(id)}">Open</a></td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Teaching Lab</title>
<style>
body{font:15px system-ui,sans-serif;margin:0;background:#f5f7fb;color:#172033}main{max-width:920px;margin:32px auto;padding:0 20px}.card{background:#fff;border:1px solid #d9deea;border-radius:14px;padding:22px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px;border-bottom:1px solid #eaecf0}th{font-size:13px;color:#667085}a{color:#175cd3}.rule{padding:12px;background:#eef4ff;border-radius:9px;margin:14px 0}
</style></head><body><main><section class="card">
<h1>Teaching Lab Core</h1>
<div class="rule">Chỉ giữ 5 năng lực nền tảng. Không thêm scenario chỉ để đổi label, thời gian hoặc vị trí.</div>
<table><thead><tr><th>ID</th><th>Family</th><th>Task</th><th></th></tr></thead><tbody>${rows}</tbody></table>
</section></main></body></html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname === '/' || url.pathname === '/teaching') {
    return sendHtml(res, 200, indexPage());
  }

  const match = url.pathname.match(/^\/teaching\/(TL\d{2})$/i);
  if (match) {
    const id = match[1].toUpperCase();
    const scenario = SCENARIOS[id];
    if (scenario) return sendHtml(res, 200, renderScenario(id, scenario));
  }

  return sendHtml(res, 404, '<h1>404</h1><p><a href="/teaching">Teaching Lab</a></p>');
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Teaching Lab listening on http://${HOST}:${PORT}/teaching`);
    console.log(`Core scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
  });
}

module.exports = { HOST, PORT, SCENARIOS, renderScenario, indexPage, server };
