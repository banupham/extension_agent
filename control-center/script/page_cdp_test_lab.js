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

function nestedFrameLevel1Html() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Nested Frame Level 1</title>
<style>body{font-family:Arial,sans-serif;margin:12px} iframe{width:95%;height:120px;border:2px solid #5b7}</style>
</head>
<body>
  <strong>NESTED FRAME LEVEL 1</strong>
  <iframe src="/frame-level2" title="Nested Frame Level 2"></iframe>
</body></html>`;
}

function nestedFrameLevel2Html() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Nested Frame Level 2</title>
<style>body{font-family:Arial,sans-serif;margin:18px} button{padding:10px 16px}</style>
</head>
<body>
  <strong>NESTED FRAME LEVEL 2</strong>
  <button id="nestedFrameTarget" aria-label="Nested Frame Action Target">Nested Frame Action Target</button>
  <script>
    document.getElementById('nestedFrameTarget').addEventListener('click', event => {
      document.title = 'NESTED FRAME CLICK PASS';
      document.body.dataset.result = 'NESTED FRAME CLICK PASS';
      event.currentTarget.textContent = 'NESTED FRAME CLICK PASS';
      event.currentTarget.setAttribute('aria-label', 'NESTED FRAME CLICK PASS');
      try { window.top.postMessage({ type:'NESTED_FRAME_GATE', result:'NESTED FRAME CLICK PASS' }, '*'); } catch (_) {}
    });
  </script>
</body></html>`;
}

function recoveryHtml(url) {
  const horizontalVariant = String(url?.searchParams?.get('variant') || '').trim().toLowerCase() === 'horizontal';
  const initialTitle = horizontalVariant ? 'RECOVERY DRIFT READY' : 'RECOVERY LEARNING READY';
  const spacerStyle = horizontalVariant
    ? 'height:80px;width:1900px;border-top:3px dashed #bbb;margin-top:20px;padding-top:12px'
    : 'height:1100px;border-left:3px dashed #bbb;margin-left:20px;padding-left:12px';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${initialTitle}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:20px;line-height:1.35;${horizontalVariant ? 'overflow-y:hidden;' : ''}}
    #state{position:sticky;top:0;left:0;background:#fffbe6;border:1px solid #cc9;padding:8px;z-index:3;width:max-content;min-width:320px}
    #probe{padding:10px 16px;margin:16px 0}
    #spacer{${spacerStyle}}
    #continue{display:none;position:fixed;right:24px;top:84px;padding:12px 18px;z-index:4}
  </style>
</head>
<body>
  <h1>RECOVERY SELF-LEARNING LAB</h1>
  <div id="state">READY</div>
  <p>The probe intentionally has no task effect. A later environmental action can reveal the next control.</p>
  <button id="probe" aria-label="Recovery Probe">Recovery Probe</button>
  <div id="spacer">Recovery environment ${horizontalVariant ? 'HORIZONTAL DRIFT' : 'VERTICAL'}</div>
  <button id="continue" aria-label="Recovery Continue">Recovery Continue</button>
  <script>
    const state = document.getElementById('state');
    const probe = document.getElementById('probe');
    const next = document.getElementById('continue');
    const horizontalVariant = ${horizontalVariant ? 'true' : 'false'};
    probe.addEventListener('click', () => {
      // Intentionally no semantic task effect. Native click focus is incidental evidence only.
    });
    function revealAfterEnvironmentChange() {
      const progressed = horizontalVariant ? window.scrollX >= 160 : window.scrollY >= 160;
      if (!progressed || next.style.display === 'block') return;
      next.style.display = 'block';
      next.dataset.revealed = 'true';
      state.textContent = 'RECOVERY CONTROL REVEALED';
    }
    window.addEventListener('scroll', revealAfterEnvironmentChange, { passive: true });
    next.addEventListener('click', () => {
      next.remove();
      state.textContent = 'RECOVERY LEARNING PASS';
      document.title = 'RECOVERY LEARNING PASS';
      document.body.dataset.result = 'RECOVERY LEARNING PASS';
    });
  </script>
</body>
</html>`;
}

function movingGuardHtml() {
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

function semanticMissionHtml() {
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

function mainHtml(url) {
  const waitCase = url.searchParams.get('case') === 'wait';
  const tabCase = String(url.searchParams.get('tab') || '').trim().toLowerCase();
  const browserUiTabCase = ['alpha', 'beta', 'disposable'].includes(tabCase);
  const initialTitle = browserUiTabCase
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
    #nestedFrame{height:190px;border:2px solid #5b7}
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

  <section id="discovery">
    <h2>Opaque discovery challenge</h2>
    <div>Goal: reach DISCOVERY PASS. The required order is not shown.</div>
    <div class="row">
      <button id="discoveryAlpha" aria-label="Discovery Alpha">Discovery Alpha</button>
      <button id="discoveryBeta" aria-label="Discovery Beta">Discovery Beta</button>
      <button id="discoveryGamma" aria-label="Discovery Gamma">Discovery Gamma</button>
    </div>
  </section>

  <section id="frames">
    <h2>Multi-frame</h2>
    <iframe src="/frame" title="Batch Lab Child Frame"></iframe>
  </section>

  <section id="nestedFrames">
    <h2>Nested same-origin frame gate</h2>
    <div>TOP → LEVEL 1 → LEVEL 2</div>
    <iframe id="nestedFrame" src="/frame-level1" title="Nested Frame Level 1"></iframe>
  </section>

  <script>
    const state = document.getElementById('state');
    const preserveBrowserUiTabTitle = ${browserUiTabCase ? 'true' : 'false'};
    function mark(text){
      state.textContent=text;
      if (!preserveBrowserUiTabTitle) document.title=text;
    }

    window.addEventListener('message', event => {
      if (event?.data?.type === 'NESTED_FRAME_GATE' && event.data.result === 'NESTED FRAME CLICK PASS') {
        mark('NESTED FRAME CLICK PASS');
      }
    });

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

    const discoveryOrder = ['discoveryBeta', 'discoveryAlpha', 'discoveryGamma'];
    let discoveryIndex = 0;
    for (const id of ['discoveryAlpha', 'discoveryBeta', 'discoveryGamma']) {
      document.getElementById(id).addEventListener('click', event => {
        if (id !== discoveryOrder[discoveryIndex]) return;
        event.currentTarget.disabled = true;
        event.currentTarget.dataset.discoveryAccepted = 'true';
        discoveryIndex += 1;
        if (discoveryIndex === discoveryOrder.length) mark('DISCOVERY PASS');
      });
    }

    if (${waitCase ? 'true' : 'false'}) {
      if (!preserveBrowserUiTabTitle) document.title='WAITANDOBSERVE ARMED';
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

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname === '/frame') return sendHtml(res, frameHtml());
    if (url.pathname === '/frame-level1') return sendHtml(res, nestedFrameLevel1Html());
    if (url.pathname === '/frame-level2') return sendHtml(res, nestedFrameLevel2Html());
    if (url.pathname === '/recovery') return sendHtml(res, recoveryHtml(url));
    if (url.pathname === '/guard') return sendHtml(res, movingGuardHtml());
    if (url.pathname === '/mission' || url.pathname.startsWith('/mission/')) return sendHtml(res, semanticMissionHtml());
    if (url.pathname === '/' || url.pathname === '/lab') return sendHtml(res, mainHtml(url));
    res.statusCode = 404;
    res.end('not found');
  });
}

function main() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`PAGE_CDP shared batch lab: http://${HOST}:${PORT}/`);
    console.log(`waitAndObserve: http://${HOST}:${PORT}/?case=wait`);
    console.log(`Recovery: http://${HOST}:${PORT}/recovery`);
    console.log(`Moving target guard: http://${HOST}:${PORT}/guard`);
    console.log(`Semantic mission fixture: http://${HOST}:${PORT}/mission`);
    console.log(`Browser UI tabs: http://${HOST}:${PORT}/?tab=alpha | ?tab=beta | ?tab=disposable`);
    console.log('Stop with Ctrl+C. Port 8091 is the single regression-fixture server.');
  });
  return server;
}

if (require.main === module) main();

module.exports = {
  HOST,
  PORT,
  frameHtml,
  nestedFrameLevel1Html,
  nestedFrameLevel2Html,
  recoveryHtml,
  movingGuardHtml,
  semanticMissionHtml,
  mainHtml,
  createServer,
  main
};
