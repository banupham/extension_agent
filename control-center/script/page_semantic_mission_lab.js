'use strict';

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8091;

function html() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Semantic Mission Lab</title>
  <style>
    body{font-family:Arial,sans-serif;margin:24px;line-height:1.4}
    button,a{display:inline-block;margin:8px;padding:10px 14px}
    #evidence{margin-top:18px;padding:12px;border:1px solid #aaa;min-height:60px}
  </style>
</head>
<body>
  <h1>Semantic Mission Lab</h1>
  <div id="controls">
    <button id="atlas" aria-label="Mission Atlas">Mission Atlas</button>
    <button id="orion" aria-label="Mission Orion">Mission Orion</button>
  </div>
  <div id="evidence" aria-label="Mission Evidence"></div>
  <script>
    const evidence = document.getElementById('evidence');
    document.getElementById('atlas').addEventListener('click', () => {
      history.pushState({}, '', '/mission/atlas');
      evidence.innerHTML = '<a href="#robotics" aria-label="Robotics field guide">Robotics field guide</a>';
    });
    document.getElementById('orion').addEventListener('click', () => {
      history.pushState({}, '', '/mission/orion');
      evidence.innerHTML = [
        '<a href="#hcm" aria-label="Hồ Chí Minh forecast">Hồ Chí Minh forecast</a>',
        '<a href="#three-days" aria-label="3 ngày tới">3 ngày tới</a>'
      ].join(' ');
    });
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (url.pathname === '/mission' || url.pathname.startsWith('/mission/')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(html());
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`SEMANTIC MISSION LAB: http://${HOST}:${PORT}/mission`);
  console.log('The title intentionally stays constant; success must come from URL + semantic UI evidence.');
  console.log('Stop with Ctrl+C.');
});
