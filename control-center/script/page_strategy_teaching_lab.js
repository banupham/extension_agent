'use strict';

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8092;

function teachingHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Strategy Teaching Lab</title>
  <style>
    body{font-family:Arial,sans-serif;margin:24px;line-height:1.4}
    section{border:1px solid #aaa;border-radius:8px;padding:16px;margin:14px 0}
    label{display:block;margin-bottom:8px;font-weight:600}
    input,button{font-size:16px;padding:8px 10px;margin-right:8px}
    #state{position:sticky;top:0;background:#fffbe6;border:1px solid #cc9;padding:10px;z-index:2}
  </style>
</head>
<body>
  <h1>Strategy Teaching Lab</h1>
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
      event.preventDefault();
      state.textContent = 'TOPIC SUBMITTED';
      document.body.dataset.lastAction = 'topic-submit';
    });
    document.getElementById('messageForm').addEventListener('submit', event => {
      event.preventDefault();
      state.textContent = 'MESSAGE SENT';
      document.body.dataset.lastAction = 'message-submit';
    });
    document.getElementById('confirm').addEventListener('click', () => {
      state.textContent = 'TEACHING CONFIRMED';
      document.body.dataset.lastAction = 'teaching-confirm';
    });
  </script>
</body>
</html>`;
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname !== '/') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(teachingHtml());
  });
}

function main() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Strategy teaching lab: http://${HOST}:${PORT}/`);
    console.log('Stop with Ctrl+C.');
  });
  return server;
}

if (require.main === module) main();

module.exports = {
  HOST,
  PORT,
  teachingHtml,
  createServer,
  main
};
