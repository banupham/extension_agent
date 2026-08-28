'use strict';

const assert = require('assert');
const http = require('http');
const { URL } = require('url');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8791;
const PORT = Number(process.env.TEACHING_LAB_PORT || DEFAULT_PORT);

/*
 * Teaching Lab design rule:
 * - One server for human-teaching fixtures.
 * - One generic route shape for core scenarios: /teaching/<scenario-id>.
 * - Scenarios are data, not separate handlers/files.
 * - Reusable compatibility fixtures live as routes here, not as new servers.
 * - Add a scenario/file only when it teaches a genuinely new capability or
 *   requires a genuinely different execution context.
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

function successTitleFor(scenarioId) {
  return `PASS_${String(scenarioId || '').trim().toUpperCase()}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function layout(scenarioId, scenario, stageHtml, script = '') {
  const successTitle = successTitleFor(scenarioId);
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
<body data-teaching-scenario="${esc(scenarioId)}">
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
function success(text){const el=document.getElementById('result');el.textContent=text;el.style.display='block';document.body.dataset.success='true';document.title=${JSON.stringify(successTitle)};}
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

// Reused legacy Strategy teaching fixture. It stays available for coverage
// contracts, but no longer owns a second HTTP server/file/port.
function strategyTeachingFixtureHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Strategy Teaching Fixture</title>
  <style>
    body{font-family:Arial,sans-serif;margin:24px;line-height:1.4}
    section{border:1px solid #aaa;border-radius:8px;padding:16px;margin:14px 0}
    label{display:block;margin-bottom:8px;font-weight:600}
    input,button{font-size:16px;padding:8px 10px;margin-right:8px}
    #state{position:sticky;top:0;background:#fffbe6;border:1px solid #cc9;padding:10px;z-index:2}
  </style>
</head>
<body>
  <h1>Strategy Teaching Fixture</h1>
  <div id="state">READY</div>
  <section>
    <h2>Topic search</h2>
    <form id="topicForm">
      <label for="topicInput">Topic Search</label>
      <input id="topicInput" aria-label="Topic Search" autocomplete="off">
      <button type="submit" aria-label="Topic Search Submit">Topic Search Submit</button>
    </form>
  </section>
  <section>
    <h2>Message composer</h2>
    <form id="messageForm">
      <label for="messageInput">Message Composer</label>
      <input id="messageInput" aria-label="Message Composer" autocomplete="off">
      <button type="submit" aria-label="Message Send">Message Send</button>
    </form>
  </section>
  <section>
    <h2>Independent click task</h2>
    <button id="confirm" aria-label="Teaching Confirm">Teaching Confirm</button>
  </section>
  <script>
    const state = document.getElementById('state');
    document.getElementById('topicForm').addEventListener('submit', event => {
      event.preventDefault(); state.textContent = 'TOPIC SUBMITTED'; document.body.dataset.lastAction = 'topic-submit';
    });
    document.getElementById('messageForm').addEventListener('submit', event => {
      event.preventDefault(); state.textContent = 'MESSAGE SENT'; document.body.dataset.lastAction = 'message-submit';
    });
    document.getElementById('confirm').addEventListener('click', () => {
      state.textContent = 'TEACHING CONFIRMED'; document.body.dataset.lastAction = 'teaching-confirm';
    });
  </script>
</body>
</html>`;
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
<p><a href="/teaching/strategy-fixture">Strategy teaching compatibility fixture</a></p>
</section></main></body></html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(html);
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname === '/' || url.pathname === '/teaching') {
      return sendHtml(res, 200, indexPage());
    }

    if (url.pathname === '/teaching/strategy-fixture') {
      return sendHtml(res, 200, strategyTeachingFixtureHtml());
    }

    const match = url.pathname.match(/^\/teaching\/(TL\d{2})$/i);
    if (match) {
      const id = match[1].toUpperCase();
      const scenario = SCENARIOS[id];
      if (scenario) return sendHtml(res, 200, renderScenario(id, scenario));
    }

    return sendHtml(res, 404, '<h1>404</h1><p><a href="/teaching">Teaching Lab</a></p>');
  });
}

function runSelfTest() {
  assert.strictEqual(DEFAULT_PORT, 8791, 'Teaching Lab default port must remain isolated from Control Center');
  assert.ok(SCENARIOS && typeof SCENARIOS === 'object', 'Teaching Lab must expose SCENARIOS');
  assert.deepStrictEqual(Object.keys(SCENARIOS), ['TL01', 'TL02', 'TL03', 'TL04', 'TL05']);
  assert.deepStrictEqual(Object.values(SCENARIOS).map(item => item.type), ['delay', 'replace', 'ambiguity', 'moving', 'recovery']);
  assert.strictEqual(successTitleFor('TL01'), 'PASS_TL01');
  assert.ok(renderScenario('TL01', SCENARIOS.TL01).includes("document.title=\"PASS_TL01\""));
  assert.ok(!renderScenario('TL03', SCENARIOS.TL03).includes('success(' + JSON.stringify(SCENARIOS.TL03.expected)));
  const fixture = strategyTeachingFixtureHtml();
  assert.ok(fixture.includes('aria-label="Topic Search"'));
  assert.ok(fixture.includes('aria-label="Message Composer"'));
  assert.ok(fixture.includes('aria-label="Teaching Confirm"'));
  console.log(`Teaching Lab self-test: PASS (${Object.keys(SCENARIOS).length} core scenarios + deterministic PASS evidence + shared strategy fixture on port ${DEFAULT_PORT})`);
  return true;
}

const server = createServer();

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    server.listen(PORT, HOST, () => {
      console.log(`Teaching Lab listening on http://${HOST}:${PORT}/teaching`);
      console.log(`Core scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
      console.log(`Strategy fixture: http://${HOST}:${PORT}/teaching/strategy-fixture`);
    });
  }
}

module.exports = {
  HOST,
  DEFAULT_PORT,
  PORT,
  SCENARIOS,
  successTitleFor,
  renderScenario,
  strategyTeachingFixtureHtml,
  indexPage,
  createServer,
  runSelfTest,
  server
};
