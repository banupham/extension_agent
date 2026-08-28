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
 * - Scenarios are data, not separate servers/files.
 * - Core recovery fixtures stay under /teaching/TLxx.
 * - Motor curriculum stays under /teaching/motor/Mxx.
 * - Every positive teaching scenario emits deterministic semantic PASS evidence.
 * - Ambiguity/no-action scenarios must never emit positive PASS evidence.
 */
const SCENARIOS = Object.freeze({
  TL01: { family: 'DELAY', title: 'Delayed target', task: 'Mở báo cáo rồi xác nhận báo cáo.', expected: 'Report Confirmed', type: 'delay', delayMs: 1500, firstLabel: 'Open Report', secondLabel: 'Confirm Report' },
  TL02: { family: 'REPLACE', title: 'Target replacement', task: 'Mở phiên làm việc rồi xác nhận phiên mới.', expected: 'Session Confirmed', type: 'replace', delayMs: 800, firstLabel: 'Open Session', secondLabel: 'Confirm Session' },
  TL03: { family: 'AMBIGUITY', title: 'Indistinguishable targets', task: 'Chọn Control Node.', expected: 'Do not click; stop as ambiguous', type: 'ambiguity', label: 'Control Node' },
  TL04: { family: 'MOVING', title: 'Moving target', task: 'Mở Track Package.', expected: 'Package Opened', type: 'moving', label: 'Track Package', moveIntervalMs: 1200 },
  TL05: { family: 'RECOVERY', title: 'No-effect then retry', task: 'Mở Relay Console.', expected: 'Relay Console Open', type: 'recovery', label: 'Open Relay Console', retryReadyMs: 1000 }
});

const MOTOR_SCENARIOS = Object.freeze({
  M01: { family: 'POINTER', title: 'Basic click', task: 'Mở thẻ Details.', expected: 'Details Opened', type: 'motor-click' },
  M02: { family: 'POINTER', title: 'Double click', task: 'Mở tài liệu bằng cách nhấp đúp.', expected: 'Document Opened', type: 'motor-double-click' },
  M03: { family: 'POINTER', title: 'Hover menu', task: 'Xem menu Tools rồi mở Settings.', expected: 'Settings Opened', type: 'motor-hover-menu' },
  M04: { family: 'DRAG', title: 'Drag to zone', task: 'Kéo Task A sang vùng Completed.', expected: 'Task A Completed', type: 'motor-drag' },
  M05: { family: 'SCROLL', title: 'Vertical scroll', task: 'Tìm Archive ở cuối trang và mở nó.', expected: 'Archive Opened', type: 'motor-scroll-vertical' },
  M06: { family: 'SCROLL', title: 'Horizontal scroll', task: 'Tìm Card Delta trong danh sách ngang.', expected: 'Delta Selected', type: 'motor-scroll-horizontal' },
  M07: { family: 'FORMS', title: 'Type text', task: 'Nhập Nguyen Van An vào Name.', expected: 'Name Entered', type: 'motor-type' },
  M08: { family: 'FORMS', title: 'Replace text', task: 'Thay nội dung Name hiện tại thành Tran Minh.', expected: 'Name Replaced', type: 'motor-replace' },
  M09: { family: 'FORMS', title: 'Clear and type', task: 'Xóa nội dung Search rồi nhập Browser Agent.', expected: 'Search Text Ready', type: 'motor-clear-type' },
  M10: { family: 'KEYBOARD', title: 'Enter submit', task: 'Điền từ khóa Agent rồi nhấn Enter.', expected: 'Search Submitted', type: 'motor-enter' },
  M11: { family: 'KEYBOARD', title: 'Tab traversal', task: 'Điền Email, chuyển sang ô Message bằng Tab rồi gửi.', expected: 'Message Sent', type: 'motor-tab-form' },
  M12: { family: 'FORMS', title: 'Select and checkbox', task: 'Chọn Audi, bật Warranty rồi lưu.', expected: 'Configuration Saved', type: 'motor-select-check' },
  M13: { family: 'FORMS', title: 'Toggle states', task: 'Tắt Notifications rồi bật Dark Mode.', expected: 'Preferences Updated', type: 'motor-toggle' },
  M14: { family: 'TABS', title: 'New tab lifecycle', task: 'Mở trang Help ở tab mới, xem xong rồi quay lại.', expected: 'Returned From Help', type: 'motor-new-tab' },
  M15: { family: 'MEDIA', title: 'Basic media controls', task: 'Phát media, tắt tiếng, tua đến giữa rồi dừng.', expected: 'Media Sequence Complete', type: 'motor-media-basic' },
  M16: { family: 'COMPOSITE', title: 'Scroll form composite', task: "Tìm Project Delta ở cuối trang, mở nó, nhập ghi chú 'Ready for review', bật Approved rồi gửi.", expected: 'Project Submitted', type: 'motor-composite-project' },
  M17: { family: 'COMPOSITE', title: 'Menu deployment composite', task: 'Trong menu Operations, mở Deployment, chọn Production rồi kéo mức Priority lên cao và lưu.', expected: 'Deployment Saved', type: 'motor-composite-deployment' },
  M18: { family: 'WAIT', title: 'Wait for result', task: 'Bắt đầu kiểm tra rồi mở kết quả khi nó sẵn sàng.', expected: 'Result Opened', type: 'motor-wait', delayMs: 1500 },
  M19: { family: 'RECOVERY', title: 'Re-ground replaced target', task: 'Xác nhận target mới sau khi target cũ biến mất.', expected: 'New Target Confirmed', type: 'motor-reground', delayMs: 800 },
  M20: { family: 'SAFETY', title: 'Ambiguity no-action', task: 'Chọn Control Node.', expected: 'Do not click; stop as ambiguous', type: 'ambiguity', label: 'Control Node' },
  M21: { family: 'MEDIA', title: 'Advanced media chain', task: 'Phát media, đặt tốc độ 2x, âm lượng 70%, tua tới khoảng giữa, tắt tiếng, bật tiếng lại rồi dừng.', expected: 'Advanced Media Sequence Complete', type: 'motor-media-advanced' },
  M22: { family: 'TABS', title: 'History and reload chain', task: 'Mở trang Report ở tab mới, chuyển sang đó, quay lại trang trước, đi tới lại, reload, sau đó đóng tab Report.', expected: 'Report Lifecycle Complete', type: 'motor-history-tab' }
});

function scenarioById(id) {
  const key = String(id || '').trim().toUpperCase();
  return SCENARIOS[key] || MOTOR_SCENARIOS[key] || null;
}
function successTitleFor(scenarioId) { return `PASS_${String(scenarioId || '').trim().toUpperCase()}`; }
function successSignalLabelFor(scenarioId) { return `TEACHING_SUCCESS_${String(scenarioId || '').trim().toUpperCase()}`; }
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function layout(scenarioId, scenario, stageHtml, script = '') {
  const successTitle = successTitleFor(scenarioId);
  const successSignalLabel = successSignalLabelFor(scenarioId);
  const motor = /^M\d{2}$/i.test(scenarioId);
  const backHref = motor ? '/teaching/motor' : '/teaching';
  const backText = motor ? '← Motor Curriculum' : '← Teaching Lab';
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(scenarioId)} · ${esc(scenario.title)}</title>
<style>
body{font:16px system-ui,sans-serif;margin:0;background:#f5f7fb;color:#172033}main{max-width:900px;margin:32px auto;padding:0 20px}.card{background:#fff;border:1px solid #d9deea;border-radius:14px;padding:22px}.meta{font-size:13px;color:#667085}.task{padding:13px;background:#eef4ff;border-radius:10px;margin:14px 0}.stage{position:relative;min-height:280px;border:1px dashed #b8c0cf;border-radius:12px;padding:22px;overflow:auto}.stage.tall{min-height:900px}.row{display:flex;gap:14px;flex-wrap:wrap}.column{display:flex;flex-direction:column;gap:12px}.panel{padding:14px;border:1px solid #d0d5dd;border-radius:10px;background:#fff}button,input,select,textarea{font:inherit;padding:10px 12px;border:1px solid #98a2b3;border-radius:8px}button{background:#fff;cursor:pointer}.primary{background:#175cd3;color:#fff;border-color:#175cd3}.muted{color:#667085}.result{margin-top:18px;padding:12px;border-radius:9px;background:#ecfdf3;color:#027a48;font-weight:700;display:none}.moving{position:absolute;transition:left .18s linear}.dropzone{min-height:120px;border:2px dashed #98a2b3;border-radius:12px;padding:16px}.dragitem{display:inline-block;padding:12px 16px;background:#eef4ff;border:1px solid #84adff;border-radius:9px;cursor:grab}.hscroll{display:flex;gap:18px;width:1250px}.hviewport{overflow-x:auto;border:1px solid #d0d5dd;border-radius:10px;padding:16px}.hcard{min-width:230px;height:100px;display:grid;place-items:center;border:1px solid #d0d5dd;border-radius:10px;background:#fff}.menu{position:relative;display:inline-block}.submenu{display:none;position:absolute;left:0;top:44px;z-index:3;padding:8px;background:#fff;border:1px solid #d0d5dd;border-radius:8px}.menu:hover .submenu,.menu.open .submenu{display:block}a{color:#175cd3}audio{width:100%;max-width:620px}.spacer{height:680px}.priority{width:320px}
</style></head>
<body data-teaching-scenario="${esc(scenarioId)}"><main><p><a href="${backHref}">${backText}</a></p><section class="card"><div class="meta">${esc(scenarioId)} · ${esc(scenario.family)}</div><h1>${esc(scenario.title)}</h1><div class="task"><b>Task Episode:</b> ${esc(scenarioId)} | ${esc(scenario.task)}</div><div class="stage">${stageHtml}</div><div id="result" class="result" role="status"></div><p class="meta"><b>Expected:</b> ${esc(scenario.expected)}</p></section></main>
<script>
function success(text){const el=document.getElementById('result');el.textContent=text;el.setAttribute('aria-label',${JSON.stringify(successSignalLabel)});el.style.display='block';document.body.dataset.success='true';document.title=${JSON.stringify(successTitle)};}
function makeTone(media){if(!media||media.src)return;const rate=8000,seconds=6,count=rate*seconds,buf=new ArrayBuffer(44+count*2),v=new DataView(buf);const s=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};s(0,'RIFF');v.setUint32(4,36+count*2,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,count*2,true);for(let i=0;i<count;i++){const x=Math.sin(2*Math.PI*220*i/rate)*0.08;v.setInt16(44+i*2,Math.round(x*32767),true);}media.src=URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));}
${script}
</script></body></html>`;
}

function renderScenario(id, s) {
  if (s.type === 'delay') return layout(id, s, `<button id="first" class="primary">${esc(s.firstLabel)}</button> <button id="second" style="display:none">${esc(s.secondLabel)}</button>`, `first.onclick=()=>{first.disabled=true;setTimeout(()=>second.style.display='inline-block',${Number(s.delayMs)});};second.onclick=()=>success(${JSON.stringify(s.expected)});`);
  if (s.type === 'replace') return layout(id, s, `<div id="slot"><button id="first" class="primary">${esc(s.firstLabel)}</button></div>`, `first.onclick=()=>{slot.innerHTML='<span class="muted">Opening…</span>';setTimeout(()=>{slot.innerHTML='<button id="second">${esc(s.secondLabel)}</button>';second.onclick=()=>success(${JSON.stringify(s.expected)});},${Number(s.delayMs)});};`);
  if (s.type === 'ambiguity') return layout(id, s, `<div class="row"><button>${esc(s.label)}</button><button>${esc(s.label)}</button></div><p class="muted">Hai target cố ý giống hệt nhau và không có context phân biệt. Không có đáp án click đúng.</p>`);
  if (s.type === 'moving') return layout(id, s, `<button id="target" class="primary moving" style="left:24px;top:120px">${esc(s.label)}</button>`, `let i=0;const xs=[24,150,300,460,620];const timer=setInterval(()=>{i+=1;if(i>=xs.length){clearInterval(timer);return;}target.style.left=xs[i]+'px';},${Number(s.moveIntervalMs || 1200)});target.onclick=()=>success(${JSON.stringify(s.expected)});`);
  if (s.type === 'recovery') return layout(id, s, `<button id="target" class="primary">${esc(s.label)}</button><p id="hint" class="muted"></p>`, `let clicked=false,ready=false;target.onclick=()=>{if(!clicked){clicked=true;hint.textContent='No visible effect yet';setTimeout(()=>{ready=true;hint.textContent='Relay is ready for another attempt';},${Number(s.retryReadyMs)});return;}if(ready)success(${JSON.stringify(s.expected)});};`);
  return layout(id, s, '<p>Unsupported scenario type.</p>');
}

function renderMotorScenario(id, s) {
  const done = JSON.stringify(s.expected);
  if (s.type === 'ambiguity') return renderScenario(id, s);
  if (s.type === 'motor-click') return layout(id, s, `<button id="details" class="primary">Details</button><div id="panel" class="panel" hidden>Detail content</div>`, `details.onclick=()=>{panel.hidden=false;success(${done});};`);
  if (s.type === 'motor-double-click') return layout(id, s, `<div id="doc" class="dragitem" tabindex="0">Project Document</div><p class="muted">Chỉ nhấp đúp mới mở tài liệu.</p>`, `doc.ondblclick=()=>success(${done});`);
  if (s.type === 'motor-hover-menu') return layout(id, s, `<div id="tools" class="menu"><button>Tools</button><div class="submenu"><button id="settings">Settings</button></div></div>`, `tools.onmouseenter=()=>tools.classList.add('open');tools.onmouseleave=()=>tools.classList.remove('open');settings.onclick=()=>success(${done});`);
  if (s.type === 'motor-drag') return layout(id, s, `<div class="row"><div><div id="task" class="dragitem" draggable="true">Task A</div></div><div id="completed" class="dropzone" aria-label="Completed drop zone">Completed</div></div>`, `task.ondragstart=e=>e.dataTransfer.setData('text/plain','Task A');completed.ondragover=e=>e.preventDefault();completed.ondrop=e=>{e.preventDefault();completed.appendChild(task);success(${done});};`);
  if (s.type === 'motor-scroll-vertical') return layout(id, s, `<div class="spacer"><p class="muted">Archive nằm ở cuối vùng cuộn.</p></div><button id="archive" class="primary">Archive</button>`, `archive.onclick=()=>success(${done});`);
  if (s.type === 'motor-scroll-horizontal') return layout(id, s, `<div class="hviewport"><div class="hscroll"><div class="hcard">Card Alpha</div><div class="hcard">Card Beta</div><div class="hcard">Card Gamma</div><button id="delta" class="hcard primary">Card Delta</button><div class="hcard">Card Epsilon</div></div></div>`, `delta.onclick=()=>success(${done});`);
  if (s.type === 'motor-type') return layout(id, s, `<label>Name <input id="name" aria-label="Name" autocomplete="off"></label>`, `name.oninput=()=>{if(name.value==='Nguyen Van An')success(${done});};`);
  if (s.type === 'motor-replace') return layout(id, s, `<label>Name <input id="name" aria-label="Name" value="Old Name" autocomplete="off"></label>`, `name.oninput=()=>{if(name.value==='Tran Minh')success(${done});};`);
  if (s.type === 'motor-clear-type') return layout(id, s, `<label>Search <input id="search" aria-label="Search" value="Previous query" autocomplete="off"></label>`, `search.oninput=()=>{if(search.value==='Browser Agent')success(${done});};`);
  if (s.type === 'motor-enter') return layout(id, s, `<form id="form"><label>Keyword <input id="keyword" aria-label="Keyword" autocomplete="off"></label></form>`, `form.onsubmit=e=>{e.preventDefault();if(keyword.value==='Agent')success(${done});};`);
  if (s.type === 'motor-tab-form') return layout(id, s, `<form id="form" class="column"><label>Email <input id="email" type="email" aria-label="Email" autocomplete="off"></label><label>Message <textarea id="message" aria-label="Message"></textarea></label><button class="primary" type="submit">Send</button></form>`, `let tabReached=false;message.onfocus=()=>{tabReached=true;};form.onsubmit=e=>{e.preventDefault();if(email.value&&message.value&&tabReached)success(${done});};`);
  if (s.type === 'motor-select-check') return layout(id, s, `<div class="column"><label>Car <select id="car" aria-label="Car"><option>BMW</option><option>Audi</option><option>Volvo</option></select></label><label><input id="warranty" type="checkbox"> Warranty</label><button id="save" class="primary">Save</button></div>`, `save.onclick=()=>{if(car.value==='Audi'&&warranty.checked)success(${done});};`);
  if (s.type === 'motor-toggle') return layout(id, s, `<div class="column"><label><input id="notifications" type="checkbox" checked> Notifications</label><label><input id="dark" type="checkbox"> Dark Mode</label></div>`, `function check(){if(!notifications.checked&&dark.checked)success(${done});}notifications.onchange=check;dark.onchange=check;`);
  if (s.type === 'motor-new-tab') return layout(id, s, `<button id="help" class="primary">Open Help in New Tab</button><p class="muted">Trong tab Help, bấm “Done & Close”, rồi quay lại tab này.</p>`, `let viewed=false;const bc=new BroadcastChannel('teaching-m14');bc.onmessage=e=>{if(e.data==='viewed'){viewed=true;if(!document.hidden)success(${done});}};document.onvisibilitychange=()=>{if(!document.hidden&&viewed)success(${done});};help.onclick=()=>window.open('/teaching/motor/M14-help','_blank');`);
  if (s.type === 'motor-media-basic') return layout(id, s, `<audio id="media" controls aria-label="Training Media"></audio><p class="muted">Media cục bộ 6 giây.</p>`, `makeTone(media);let played=false,muted=false,seeked=false;media.onplay=()=>played=true;media.onvolumechange=()=>{if(media.muted)muted=true;};media.onseeked=()=>{if(media.duration&&media.currentTime>=media.duration*.45)seeked=true;};media.onpause=()=>{if(played&&muted&&seeked)success(${done});};`);
  if (s.type === 'motor-composite-project') return layout(id, s, `<div class="spacer"><p class="muted">Project Delta nằm ở cuối.</p></div><div class="panel"><button id="open">Project Delta</button><div id="projectForm" hidden class="column"><label>Note <input id="note" aria-label="Note" autocomplete="off"></label><label><input id="approved" type="checkbox"> Approved</label><button id="submit" class="primary">Submit</button></div></div>`, `open.onclick=()=>projectForm.hidden=false;submit.onclick=()=>{if(note.value==='Ready for review'&&approved.checked)success(${done});};`);
  if (s.type === 'motor-composite-deployment') return layout(id, s, `<div id="ops" class="menu"><button>Operations</button><div class="submenu"><button id="deployment">Deployment</button></div></div><div id="deployForm" class="column panel" hidden><label>Environment <select id="env"><option>Staging</option><option>Production</option></select></label><label>Priority <input id="priority" class="priority" type="range" min="0" max="100" value="20"></label><button id="save" class="primary">Save</button></div>`, `ops.onmouseenter=()=>ops.classList.add('open');deployment.onclick=()=>deployForm.hidden=false;save.onclick=()=>{if(env.value==='Production'&&Number(priority.value)>=80)success(${done});};`);
  if (s.type === 'motor-wait') return layout(id, s, `<button id="start" class="primary">Start Check</button><span id="slot"></span>`, `start.onclick=()=>{start.disabled=true;setTimeout(()=>{slot.innerHTML='<button id="openResult">Open Result</button>';openResult.onclick=()=>success(${done});},${Number(s.delayMs)});};`);
  if (s.type === 'motor-reground') return layout(id, s, `<div id="slot"><button id="old" class="primary">Refresh Target</button></div>`, `old.onclick=()=>{slot.innerHTML='<span class="muted">Replacing target…</span>';setTimeout(()=>{slot.innerHTML='<button id="fresh" class="primary">Confirm New Target</button>';fresh.onclick=()=>success(${done});},${Number(s.delayMs)});};`);
  if (s.type === 'motor-media-advanced') return layout(id, s, `<audio id="media" controls aria-label="Advanced Training Media"></audio><p class="muted">Media cục bộ 6 giây.</p>`, `makeTone(media);let played=false,rate=false,volume=false,seeked=false,muted=false,unmuted=false;media.onplay=()=>played=true;media.onratechange=()=>{if(Math.abs(media.playbackRate-2)<.01)rate=true;};media.onvolumechange=()=>{if(media.muted)muted=true;else{if(muted)unmuted=true;if(Math.abs(media.volume-.7)<.08)volume=true;}};media.onseeked=()=>{if(media.duration&&media.currentTime>=media.duration*.45)seeked=true;};media.onpause=()=>{if(played&&rate&&volume&&seeked&&muted&&unmuted)success(${done});};`);
  if (s.type === 'motor-history-tab') return layout(id, s, `<button id="report" class="primary">Open Report in New Tab</button><p class="muted">Trong Report: Back → Forward → Reload → Close.</p>`, `let doneFlag=false;const bc=new BroadcastChannel('teaching-m22');bc.onmessage=e=>{if(e.data==='done'){doneFlag=true;if(!document.hidden)success(${done});}};document.onvisibilitychange=()=>{if(!document.hidden&&doneFlag)success(${done});};report.onclick=()=>window.open('/teaching/motor/M22-report','_blank');`);
  return layout(id, s, '<p>Unsupported motor scenario type.</p>');
}

function motorHelperPage(kind) {
  if (kind === 'M14-help') return `<!doctype html><html><head><meta charset="utf-8"><title>M14 Help</title></head><body><h1>Help</h1><p>Đã xem nội dung Help.</p><button id="close">Done & Close</button><script>const bc=new BroadcastChannel('teaching-m14');close.onclick=()=>{bc.postMessage('viewed');window.close();};</script></body></html>`;
  if (kind === 'M22-report') return `<!doctype html><html><head><meta charset="utf-8"><title>M22 Report</title></head><body><h1>Report</h1><p id="state"></p><button id="close" style="display:none">Close Report</button><script>const k='m22-progress';let p=JSON.parse(sessionStorage.getItem(k)||'{"back":false,"forward":false,"reload":false}');const nav=performance.getEntriesByType('navigation')[0];if(nav&&nav.type==='reload'&&p.back&&p.forward){p.reload=true;sessionStorage.setItem(k,JSON.stringify(p));}if(!history.state){history.replaceState({step:0},'',location.pathname+'?view=summary');history.pushState({step:1},'',location.pathname+'?view=detail');}let sawBack=false;addEventListener('popstate',e=>{if(e.state&&e.state.step===0){sawBack=true;p.back=true;}if(e.state&&e.state.step===1&&sawBack){p.forward=true;}sessionStorage.setItem(k,JSON.stringify(p));render();});function render(){state.textContent='Back: '+p.back+' | Forward: '+p.forward+' | Reload: '+p.reload;close.style.display=(p.back&&p.forward&&p.reload)?'inline-block':'none';}close.onclick=()=>{new BroadcastChannel('teaching-m22').postMessage('done');sessionStorage.removeItem(k);window.close();};render();</script></body></html>`;
  return '<h1>404</h1>';
}

function strategyTeachingFixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Strategy Teaching Fixture</title><style>body{font-family:Arial,sans-serif;margin:24px;line-height:1.4}section{border:1px solid #aaa;border-radius:8px;padding:16px;margin:14px 0}label{display:block;margin-bottom:8px;font-weight:600}input,button{font-size:16px;padding:8px 10px;margin-right:8px}#state{position:sticky;top:0;background:#fffbe6;border:1px solid #cc9;padding:10px;z-index:2}</style></head><body><h1>Strategy Teaching Fixture</h1><div id="state">READY</div><section><h2>Topic search</h2><form id="topicForm"><label for="topicInput">Topic Search</label><input id="topicInput" aria-label="Topic Search" autocomplete="off"><button type="submit" aria-label="Topic Search Submit">Topic Search Submit</button></form></section><section><h2>Message composer</h2><form id="messageForm"><label for="messageInput">Message Composer</label><input id="messageInput" aria-label="Message Composer" autocomplete="off"><button type="submit" aria-label="Message Send">Message Send</button></form></section><section><h2>Independent click task</h2><button id="confirm" aria-label="Teaching Confirm">Teaching Confirm</button></section><script>const state=document.getElementById('state');topicForm.addEventListener('submit',e=>{e.preventDefault();state.textContent='TOPIC SUBMITTED';document.body.dataset.lastAction='topic-submit';});messageForm.addEventListener('submit',e=>{e.preventDefault();state.textContent='MESSAGE SENT';document.body.dataset.lastAction='message-submit';});confirm.addEventListener('click',()=>{state.textContent='TEACHING CONFIRMED';document.body.dataset.lastAction='teaching-confirm';});</script></body></html>`;
}

function tableRows(collection, basePath) {
  return Object.entries(collection).map(([id, s]) => `<tr><td><b>${esc(id)}</b></td><td>${esc(s.family)}</td><td>${esc(s.task)}</td><td><a href="${basePath}/${encodeURIComponent(id)}">Open</a></td></tr>`).join('');
}
function indexPage() {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teaching Lab</title><style>body{font:15px system-ui,sans-serif;margin:0;background:#f5f7fb;color:#172033}main{max-width:980px;margin:32px auto;padding:0 20px}.card{background:#fff;border:1px solid #d9deea;border-radius:14px;padding:22px;margin-bottom:18px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px;border-bottom:1px solid #eaecf0}th{font-size:13px;color:#667085}a{color:#175cd3}.rule{padding:12px;background:#eef4ff;border-radius:9px;margin:14px 0}</style></head><body><main><section class="card"><h1>Teaching Lab Core</h1><div class="rule">Core recovery/safety fixtures.</div><table><thead><tr><th>ID</th><th>Family</th><th>Task</th><th></th></tr></thead><tbody>${tableRows(SCENARIOS, '/teaching')}</tbody></table></section><section class="card"><h2>Motor / Execution Curriculum</h2><p>22 bài thao tác mẫu, dùng chung server và deterministic success evidence.</p><p><a href="/teaching/motor">Mở danh sách M01–M22 →</a></p></section><p><a href="/teaching/strategy-fixture">Strategy teaching compatibility fixture</a></p></main></body></html>`;
}
function motorIndexPage() {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motor Curriculum</title><style>body{font:15px system-ui,sans-serif;margin:0;background:#f5f7fb;color:#172033}main{max-width:1080px;margin:32px auto;padding:0 20px}.card{background:#fff;border:1px solid #d9deea;border-radius:14px;padding:22px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #eaecf0}th{font-size:13px;color:#667085}a{color:#175cd3}</style></head><body><main><p><a href="/teaching">← Teaching Lab</a></p><section class="card"><h1>Motor / Execution Teaching V1</h1><table><thead><tr><th>ID</th><th>Family</th><th>Task</th><th></th></tr></thead><tbody>${tableRows(MOTOR_SCENARIOS, '/teaching/motor')}</tbody></table></section></main></body></html>`;
}
function sendHtml(res, status, html) { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); }
function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname === '/' || url.pathname === '/teaching') return sendHtml(res, 200, indexPage());
    if (url.pathname === '/teaching/motor') return sendHtml(res, 200, motorIndexPage());
    if (url.pathname === '/teaching/strategy-fixture') return sendHtml(res, 200, strategyTeachingFixtureHtml());
    if (url.pathname === '/teaching/motor/M14-help') return sendHtml(res, 200, motorHelperPage('M14-help'));
    if (url.pathname === '/teaching/motor/M22-report') return sendHtml(res, 200, motorHelperPage('M22-report'));
    const core = url.pathname.match(/^\/teaching\/(TL\d{2})$/i);
    if (core) { const id = core[1].toUpperCase(); if (SCENARIOS[id]) return sendHtml(res, 200, renderScenario(id, SCENARIOS[id])); }
    const motor = url.pathname.match(/^\/teaching\/motor\/(M\d{2})$/i);
    if (motor) { const id = motor[1].toUpperCase(); if (MOTOR_SCENARIOS[id]) return sendHtml(res, 200, renderMotorScenario(id, MOTOR_SCENARIOS[id])); }
    return sendHtml(res, 404, '<h1>404</h1><p><a href="/teaching">Teaching Lab</a></p>');
  });
}

function runSelfTest() {
  assert.strictEqual(DEFAULT_PORT, 8791, 'Teaching Lab default port must remain isolated from Control Center');
  assert.deepStrictEqual(Object.keys(SCENARIOS), ['TL01', 'TL02', 'TL03', 'TL04', 'TL05']);
  assert.strictEqual(Object.keys(MOTOR_SCENARIOS).length, 22, 'Motor curriculum must contain M01-M22');
  assert.deepStrictEqual(Object.keys(MOTOR_SCENARIOS), Array.from({ length: 22 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`));
  assert.strictEqual(SCENARIOS.TL04.moveIntervalMs, 1200);
  assert.strictEqual(successSignalLabelFor('M01'), 'TEACHING_SUCCESS_M01');
  assert.strictEqual(scenarioById('M22'), MOTOR_SCENARIOS.M22);
  assert.ok(renderMotorScenario('M01', MOTOR_SCENARIOS.M01).includes('TEACHING_SUCCESS_M01'));
  assert.ok(renderMotorScenario('M15', MOTOR_SCENARIOS.M15).includes('Training Media'));
  assert.ok(renderMotorScenario('M22', MOTOR_SCENARIOS.M22).includes('M22-report'));
  assert.ok(!renderMotorScenario('M20', MOTOR_SCENARIOS.M20).includes(`success(${JSON.stringify(MOTOR_SCENARIOS.M20.expected)})`));
  assert.ok(motorIndexPage().includes('/teaching/motor/M01'));
  assert.ok(motorIndexPage().includes('/teaching/motor/M22'));
  const fixture = strategyTeachingFixtureHtml();
  assert.ok(fixture.includes('aria-label="Topic Search"'));
  assert.ok(fixture.includes('aria-label="Message Composer"'));
  assert.ok(fixture.includes('aria-label="Teaching Confirm"'));
  console.log(`Teaching Lab self-test: PASS (${Object.keys(SCENARIOS).length} core + ${Object.keys(MOTOR_SCENARIOS).length} motor scenarios on port ${DEFAULT_PORT})`);
  return true;
}

const server = createServer();
if (require.main === module) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else server.listen(PORT, HOST, () => { console.log(`Teaching Lab listening on http://${HOST}:${PORT}/teaching`); console.log(`Core scenarios: ${Object.keys(SCENARIOS).join(', ')}`); console.log(`Motor scenarios: ${Object.keys(MOTOR_SCENARIOS).join(', ')}`); });
}
module.exports = { HOST, DEFAULT_PORT, PORT, SCENARIOS, MOTOR_SCENARIOS, scenarioById, successTitleFor, successSignalLabelFor, renderScenario, renderMotorScenario, motorHelperPage, strategyTeachingFixtureHtml, indexPage, motorIndexPage, createServer, runSelfTest, server };
