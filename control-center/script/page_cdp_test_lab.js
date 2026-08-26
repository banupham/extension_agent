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

function frameHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Batch Lab Frame</title></head>
<body>
  <h2>IFRAME READY</h2>
  <button id="frameTarget" aria-label="Frame Action Target">Frame Action Target</button>
  <script>
    document.getElementById('frameTarget').addEventListener('click', event => {
      document.title = 'FRAME CLICK PASS';
      document.body.dataset.result = 'FRAME CLICK PASS';
      document.querySelector('h2').textContent = 'FRAME CLICK PASS';
      event.currentTarget.textContent = 'FRAME CLICK PASS';
      event.currentTarget.setAttribute('aria-label', 'FRAME CLICK PASS');
    });
  </script>
</body></html>`;
}

function mainHtml(url) {
  const waitCase = url.searchParams.get('case') === 'wait';
  const tabCase = String(url.searchParams.get('tab') || '').trim().toLowerCase();
  const initialTitle = ['alpha', 'beta', 'disposable'].includes(tabCase)
    ? `UI TAB ${tabCase.toUpperCase()}`
    : 'PAGE_CDP Batch Lab';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${initialTitle}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:20px;line-height:1.35}
    section{border:1px solid #aaa;border-radius:8px;padding:14px;margin:14px 0}
    h2{margin-top:0}
    label,button,select,input{margin:6px}
    .row{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
    #hoverDetail{margin-left:12px}
    #dialog{padding:10px;border:1px solid #c66;background:#fee;display:inline-block}
    iframe{width:100%;height:180px;border:1px solid #777}
    #state{position:sticky;top:0;background:#fffbe6;border:1px solid #cc9;padding:8px;z-index:2}
  </style>
</head>
<body>
  <h1>PAGE_CDP BATCH LAB</h1>
  <div id="state">READY</div>

  <section id="forms">
    <h2>Forms</h2>
    <div class="row">
      <label><input id="setChecked" type="checkbox" aria-label="SetChecked Target"> SetChecked Target</label>
      <label><input id="toggle" type="checkbox" aria-label="Toggle Target"> Toggle Target</label>
      <label>Select:
        <select id="selectOption" aria-label="Select Option Target">
          <option value="0">Alpha</option>
          <option value="1">Beta</option>
          <option value="2">Gamma</option>
        </select>
      </label>
      <form id="submitForm">
        <button type="submit" aria-label="Submit Target">Submit Target</button>
      </form>
    </div>
  </section>

  <section id="observation">
    <h2>Observation / UI</h2>
    <button id="hoverObserve" aria-label="Hover Observe Target">Hover Observe Target</button>
    <span id="hoverSlot"></span>
    <div id="dialog">
      <span>Dismissible panel</span>
      <button id="dismiss" aria-label="Dismiss Target">Dismiss Target</button>
    </div>
    <div id="waitSlot">${waitCase ? 'WAIT CASE ARMED' : 'Open ?case=wait for waitAndObserve gate'}</div>
  </section>

  <section id="media">
    <h2>Media semantics</h2>
    <div class="row">
      <button id="play" aria-label="Media Play">Media Play</button>
      <button id="pause" aria-label="Media Pause">Media Pause</button>
      <button id="mute" aria-label="Media Mute">Media Mute</button>
      <button id="unmute" aria-label="Media Unmute">Media Unmute</button>
      <label>Volume <input id="volume" type="range" min="0" max="100" value="20" aria-label="Volume Target"></label>
      <label>Seek <input id="seek" type="range" min="0" max="100" value="10" aria-label="Seek Target"></label>
      <label>Rate
        <select id="rate" aria-label="Playback Rate Target">
          <option value="1">1x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
        </select>
      </label>
    </div>
  </section>

  <section id="frames">
    <h2>Multi-frame</h2>
    <iframe src="/frame" title="Batch Lab Child Frame"></iframe>
  </section>

  <script>
    const state = document.getElementById('state');
    function mark(text){ state.textContent=text; document.title=text; }

    document.getElementById('setChecked').addEventListener('change', e => {
      mark(e.target.checked ? 'SETCHECKED PASS' : 'SETCHECKED FALSE');
    });
    document.getElementById('toggle').addEventListener('change', e => {
      mark(e.target.checked ? 'TOGGLE PASS' : 'TOGGLE FALSE');
    });
    document.getElementById('selectOption').addEventListener('change', e => {
      mark(e.target.value === '2' ? 'SELECTOPTION PASS' : 'SELECTOPTION VALUE '+e.target.value);
    });
    document.getElementById('submitForm').addEventListener('submit', e => {
      e.preventDefault(); mark('SUBMIT PASS');
    });

    document.getElementById('hoverObserve').addEventListener('mouseenter', () => {
      if (document.getElementById('hoverDetail')) return;
      setTimeout(() => {
        const b=document.createElement('button');
        b.id='hoverDetail'; b.setAttribute('aria-label','Hover Detail'); b.textContent='Hover Detail';
        document.getElementById('hoverSlot').appendChild(b);
        mark('HOVERANDOBSERVE PASS');
      },120);
    });
    document.getElementById('dismiss').addEventListener('click', () => {
      document.getElementById('dialog').remove(); mark('DISMISS PASS');
    });

    document.getElementById('play').addEventListener('click',()=>mark('PLAY PASS'));
    document.getElementById('pause').addEventListener('click',()=>mark('PAUSE PASS'));
    document.getElementById('mute').addEventListener('click',()=>mark('MUTE PASS'));
    document.getElementById('unmute').addEventListener('click',()=>mark('UNMUTE PASS'));
    document.getElementById('volume').addEventListener('input',e=>mark(Number(e.target.value)>=70?'SETVOLUME PASS':'SETVOLUME '+e.target.value));
    document.getElementById('seek').addEventListener('input',e=>mark(Number(e.target.value)>=70?'SEEK PASS':'SEEK '+e.target.value));
    document.getElementById('rate').addEventListener('change',e=>mark(e.target.value==='2'?'PLAYBACKRATE PASS':'PLAYBACKRATE '+e.target.value));

    if (${waitCase ? 'true' : 'false'}) {
      document.title='WAITANDOBSERVE ARMED';
      setTimeout(() => {
        const b=document.createElement('button');
        b.id='waitReady'; b.setAttribute('aria-label','Wait Ready'); b.textContent='Wait Ready';
        document.getElementById('waitSlot').appendChild(b);
        mark('WAITANDOBSERVE PASS');
      },650);
    }
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (url.pathname === '/frame') return sendHtml(res, frameHtml());
  if (url.pathname === '/' || url.pathname === '/lab') return sendHtml(res, mainHtml(url));
  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`PAGE_CDP batch lab: http://${HOST}:${PORT}/`);
  console.log(`waitAndObserve case: http://${HOST}:${PORT}/?case=wait`);
  console.log(`Browser UI tabs: http://${HOST}:${PORT}/?tab=alpha | ?tab=beta | ?tab=disposable`);
  console.log('Stop with Ctrl+C. Keep this fixed port for all batch gates.');
});
