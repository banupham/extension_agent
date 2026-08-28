'use strict';

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8091;

function sendHtml(res, html) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}

function labHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>TARGET GUARD LAB</title>
  <style>
    body{font-family:Arial,sans-serif;margin:20px;line-height:1.35}
    #state{position:sticky;top:0;background:#fffbe6;border:1px solid #cc9;padding:8px;z-index:10}
    .lane{position:relative;height:74px;max-width:760px;border:1px solid #aaa;border-radius:8px;margin:14px 0;overflow:hidden}
    .lane-label{position:absolute;left:8px;top:8px;font-size:12px;color:#555}
    .mover{position:absolute;left:8px;top:30px;will-change:transform}
    input{width:180px}
    button,input{min-height:28px}
  </style>
</head>
<body>
  <h1>MOVING TARGET GUARD LAB</h1>
  <div id="state">TARGET GUARD ARMED</div>

  <div class="lane">
    <span class="lane-label">replaceText</span>
    <input class="mover" data-moving-target id="guardReplace" aria-label="Guard Replace Target" value="OLD">
  </div>

  <div class="lane">
    <span class="lane-label">clear</span>
    <input class="mover" data-moving-target id="guardClear" aria-label="Guard Clear Target" value="TOCLEAR">
  </div>

  <div class="lane">
    <span class="lane-label">submit</span>
    <form class="mover" data-moving-target id="guardSubmitForm">
      <button type="submit" aria-label="Guard Submit Target">Guard Submit Target</button>
    </form>
  </div>

  <div class="lane">
    <span class="lane-label">hoverAndObserve</span>
    <button class="mover" data-moving-target id="guardHover" aria-label="Guard Hover Target">Guard Hover Target</button>
  </div>

  <script>
    const state = document.getElementById('state');
    const mark = text => { state.textContent = text; document.body.dataset.result = text; };

    document.getElementById('guardReplace').addEventListener('input', e => mark('REPLACE MUTATED:' + e.target.value));
    document.getElementById('guardClear').addEventListener('input', e => mark('CLEAR MUTATED:' + e.target.value));
    document.getElementById('guardSubmitForm').addEventListener('submit', e => { e.preventDefault(); mark('SUBMIT MUTATED'); });
    document.getElementById('guardHover').addEventListener('mouseenter', () => mark('HOVER MUTATED'));

    const movers = [...document.querySelectorAll('[data-moving-target]')];
    const started = performance.now();
    function animate(now) {
      const elapsed = now - started;
      // Deliberately continuous geometry drift. A 350ms test wait changes x by ~42px,
      // well above the Runtime's 2px live-geometry tolerance while remaining on-screen.
      const phase = (elapsed * 0.12) % 420;
      const dx = phase <= 210 ? phase : 420 - phase;
      movers.forEach(element => { element.style.transform = 'translateX(' + dx.toFixed(2) + 'px)'; });
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (url.pathname === '/' || url.pathname === '/guard') return sendHtml(res, labHtml());
  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Moving-target guard lab: http://${HOST}:${PORT}/guard`);
  console.log('Stop with Ctrl+C. This reuses the fixed project test port 8091.');
});
