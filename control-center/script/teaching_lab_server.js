'use strict';

const http = require('http');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.TEACHING_LAB_PORT || 8791);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function shell({ id, title, task, body, script = '', tall = false }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(id)} - ${esc(title)}</title>
<style>
body{font:16px system-ui,sans-serif;margin:0;background:#f5f7fb;color:#172033}.wrap{max-width:860px;margin:32px auto;padding:0 20px}.card{background:white;border:1px solid #d9deea;border-radius:14px;padding:22px;box-shadow:0 8px 24px #0000000d}.meta{font-size:13px;color:#667085}.task{padding:14px;background:#eef4ff;border-radius:10px;margin:14px 0}.stage{position:relative;min-height:${tall ? '900px' : '280px'};border:1px dashed #b8c0cf;border-radius:12px;padding:20px;overflow:hidden;background:#fbfcff}.row{display:flex;gap:14px;flex-wrap:wrap;align-items:center}.panel{padding:14px;border:1px solid #d9deea;border-radius:10px;min-width:220px;background:#fff}.btn,button{font:inherit;padding:11px 16px;border:1px solid #98a2b3;border-radius:9px;background:#fff;cursor:pointer}.btn:disabled,button:disabled{opacity:.42;cursor:not-allowed}.primary{background:#175cd3;color:#fff;border-color:#175cd3}.danger{background:#b42318;color:#fff;border-color:#b42318}.result{margin-top:18px;padding:12px;border-radius:9px;background:#ecfdf3;color:#027a48;font-weight:700;display:none}.spinner{display:none;margin:16px 0}.muted{color:#667085}.menu{position:relative;display:inline-block}.submenu{display:none;position:absolute;top:100%;left:0;background:white;border:1px solid #d0d5dd;border-radius:8px;padding:8px;min-width:220px;z-index:5}.menu:hover .submenu{display:block}.spacer{height:650px}.moving{position:absolute;transition:left .18s linear,top .18s linear}
</style></head><body><div class="wrap"><div class="card"><div class="meta">Teaching Lab • ${esc(id)}</div><h1>${esc(title)}</h1><div class="task"><b>Task:</b> ${esc(task)}</div><div class="stage">${body}</div><div id="result" class="result"></div></div></div>
<script>
function success(text){const el=document.getElementById('result');el.textContent=text;el.style.display='block';document.body.dataset.success='true';}
${script}
</script></body></html>`;
}

const scenarios = {
  '/teaching/delay-confirm-1500': () => shell({ id:'TB13-001', title:'Delayed Confirm 1500 ms', task:'Mở báo cáo rồi xác nhận báo cáo.', body:'<button id="open" class="primary">Open Report</button><button id="confirm" style="display:none">Confirm Report</button>', script:`open.onclick=()=>{open.disabled=true;setTimeout(()=>confirm.style.display='inline-block',1500)};confirm.onclick=()=>success('Report Confirmed');` }),
  '/teaching/delay-next-3000': () => shell({ id:'TB13-002', title:'Delayed Next Step 3000 ms', task:'Bắt đầu quá trình và chuyển sang bước tiếp theo khi có thể.', body:'<button id="start" class="primary">Start Process</button><div id="spin" class="spinner">Loading process…</div><button id="next" style="display:none">Next Step</button>', script:`start.onclick=()=>{start.disabled=true;spin.style.display='block';setTimeout(()=>{spin.style.display='none';next.style.display='inline-block'},3000)};next.onclick=()=>success('Step 2 Ready');` }),
  '/teaching/delay-result-2000': () => shell({ id:'TB13-003', title:'Delayed Result Link', task:'Chạy kiểm tra rồi mở kết quả.', body:'<button id="run" class="primary">Run Check</button><a id="view" href="#" style="display:none;margin-left:12px">View Result</a>', script:`run.onclick=()=>{run.disabled=true;setTimeout(()=>view.style.display='inline',2000)};view.onclick=e=>{e.preventDefault();success('Check Result: PASS')};` }),
  '/teaching/delay-save-ready': () => shell({ id:'TB13-004', title:'Save Becomes Enabled', task:'Chỉnh trạng thái và lưu khi nút lưu sẵn sàng.', body:'<button id="edit">Enable Editing</button><button id="save" class="primary" disabled>Save Changes</button>', script:`edit.onclick=()=>{edit.disabled=true;setTimeout(()=>save.disabled=false,1200)};save.onclick=()=>success('Changes Saved');` }),
  '/teaching/delay-menu-load': () => shell({ id:'TB13-005', title:'Delayed Project List', task:'Mở danh sách dự án rồi chọn Project Delta.', body:'<button id="load" class="primary">Load Projects</button><div id="projects" class="row" style="margin-top:16px"></div>', script:`load.onclick=()=>{load.disabled=true;setTimeout(()=>{projects.innerHTML='<button>Project Alpha</button><button>Project Beta</button><button id="delta">Project Delta</button>';delta.onclick=()=>success('Project Delta Selected')},2000)};` }),

  '/teaching/replace-target': () => shell({ id:'TB14-001', title:'Target Replaced', task:'Mở phiên làm việc rồi xác nhận phiên mới.', body:'<div id="slot"><button id="open" class="primary">Open Session</button></div>', script:`open.onclick=()=>{slot.innerHTML='<span class="muted">Opening…</span>';setTimeout(()=>{slot.innerHTML='<button id="confirm">Confirm Session</button>';confirm.onclick=()=>success('Session Confirmed')},800)};` }),
  '/teaching/button-renamed': () => shell({ id:'TB14-002', title:'Button Renamed', task:'Tiếp tục quá trình cho đến khi hoàn tất.', body:'<button id="step" class="primary">Continue</button>', script:`let phase=0;step.onclick=()=>{if(!phase){phase=1;step.textContent='Finish';return;}success('Process Complete');step.disabled=true};` }),
  '/teaching/card-replaced': () => shell({ id:'TB14-003', title:'Card Replacement', task:'Mở yêu cầu đang chờ rồi phê duyệt yêu cầu mới xuất hiện.', body:'<div id="slot" class="panel"><b>Pending Request</b><br><br><button id="pending">Open Request</button></div>', script:`pending.onclick=()=>{slot.innerHTML='<b>Approval Required</b><br><br><button id="approve" class="primary">Approve</button>';approve.onclick=()=>success('Request Approved')};` }),
  '/teaching/stale-target': () => shell({ id:'TB14-004', title:'Stale Primary Server', task:'Chọn máy chủ Primary đang khả dụng.', body:'<div id="area" style="position:relative;height:210px"><button id="old" class="primary" style="position:absolute;left:20px;top:20px">Primary Server</button></div>', script:`setTimeout(()=>{old.remove();const b=document.createElement('button');b.textContent='Primary Server';b.className='primary';b.style.cssText='position:absolute;right:30px;bottom:30px';area.appendChild(b);b.onclick=()=>success('Primary Server Selected')},1000);` }),
  '/teaching/re-render-list': () => shell({ id:'TB14-005', title:'Re-rendered Order List', task:'Chọn Order 482 sau khi danh sách cập nhật.', body:'<div id="list" class="row"></div><div class="muted" style="margin-top:12px">Danh sách sẽ re-render sau 1 giây.</div>', script:`function render(){list.innerHTML=['481','482','483'].map(n=>'<button data-order="'+n+'">Order '+n+'</button>').join('');[...list.querySelectorAll('button')].forEach(b=>b.onclick=()=>{if(b.dataset.order==='482')success('Order 482 Opened')})}render();setTimeout(render,1000);` }),

  '/teaching/ambiguous-identical': () => shell({ id:'TB15-001', title:'Identical Ambiguous Targets', task:'Chọn Control Node.', body:'<div class="row"><button>Control Node</button><button>Control Node</button></div><p class="muted">Không có thông tin nào khác để phân biệt hai target.</p>' }),
  '/teaching/ambiguous-context': () => shell({ id:'TB15-002', title:'Same Label, Different Context', task:'Chọn Primary Control Node.', body:'<div class="row"><div class="panel"><b>Primary System</b><br><br><button id="p">Control Node</button></div><div class="panel"><b>Backup System</b><br><br><button id="b">Control Node</button></div></div>', script:`p.onclick=()=>success('Primary Control Node Selected');b.onclick=()=>{}` }),
  '/teaching/same-label-different-role': () => shell({ id:'TB15-003', title:'Same Label, Different Card', task:'Mở phần Details của Shipment.', body:'<div class="row"><div class="panel"><b>Shipment</b><br><br><button id="ship">Details</button></div><div class="panel"><b>Invoice</b><br><br><button>Details</button></div></div>', script:`ship.onclick=()=>success('Shipment Details Open');` }),
  '/teaching/same-label-disabled': () => shell({ id:'TB15-004', title:'Same Label, One Disabled', task:'Tiếp tục.', body:'<div class="row"><button disabled>Continue</button><button id="go" class="primary">Continue</button></div>', script:`go.onclick=()=>success('Continued Successfully');` }),
  '/teaching/same-label-context-insufficient': () => shell({ id:'TB15-005', title:'Insufficient Context', task:'Mở bản ghi Active.', body:'<div class="row"><div class="panel"><b>Active</b></div><div class="panel"><b>Active</b></div></div><p class="muted">Hai bản ghi cố ý không có metadata phân biệt.</p>' }),

  '/teaching/moving-horizontal': () => shell({ id:'TB16-001', title:'Moving Horizontal Target', task:'Mở Track Package.', body:'<button id="m" class="primary moving" style="left:20px;top:110px">Track Package</button>', script:`let i=0;const xs=[20,140,280,430,600];const t=setInterval(()=>{i++;if(i>=xs.length){clearInterval(t);return}m.style.left=xs[i]+'px'},500);m.onclick=()=>success('Package Opened');` }),
  '/teaching/moving-vertical': () => shell({ id:'TB16-002', title:'Moving Vertical Target', task:'Chọn Moving Target.', body:'<button id="m" class="primary moving" style="left:320px;top:20px">Moving Target</button>', script:`let i=0;const ys=[20,80,145,210];const t=setInterval(()=>{i++;if(i>=ys.length){clearInterval(t);return}m.style.top=ys[i]+'px'},500);m.onclick=()=>success('Target Acquired');` }),
  '/teaching/moving-with-distractor': () => shell({ id:'TB16-003', title:'Moving Target with Distractor', task:'Chọn Approve Request.', body:'<button id="approve" class="primary moving" style="left:20px;top:100px">Approve Request</button><button id="reject" class="danger" style="position:absolute;right:30px;top:100px">Reject Request</button>', script:`let i=0;const xs=[20,180,350,520];const t=setInterval(()=>{i++;if(i>=xs.length){clearInterval(t);return}approve.style.left=xs[i]+'px'},550);approve.onclick=()=>success('Request Approved');` }),
  '/teaching/moving-then-stop': () => shell({ id:'TB16-004', title:'Moving Then Stops', task:'Mở Live Channel.', body:'<button id="m" class="primary moving" style="left:20px;top:120px">Live Channel</button>', script:`let i=0;const xs=[20,160,300,440,580];const t=setInterval(()=>{i++;if(i>=xs.length){clearInterval(t);return}m.style.left=xs[i]+'px'},500);m.onclick=()=>success('Live Channel Opened');` }),
  '/teaching/moving-switch-position': () => shell({ id:'TB16-005', title:'Switching Position Target', task:'Xác nhận Deployment.', body:'<button id="m" class="primary moving" style="left:40px;top:100px">Confirm Deployment</button>', script:`let i=0;const xs=[40,560,80,500];const t=setInterval(()=>{i++;if(i>=xs.length){clearInterval(t);return}m.style.left=xs[i]+'px'},600);m.onclick=()=>success('Deployment Confirmed');` }),

  '/teaching/no-effect-first-click': () => shell({ id:'TB17-001', title:'First Click Has No Effect', task:'Mở Relay Console.', body:'<button id="open" class="primary">Open Relay Console</button><div id="hint" class="muted" style="margin-top:12px"></div>', script:`let ready=false,clicked=false;open.onclick=()=>{if(!clicked){clicked=true;hint.textContent='No visible effect yet';setTimeout(()=>{ready=true;hint.textContent='Relay is ready for another attempt'},1000);return}if(ready)success('Relay Console Open')};` }),
  '/teaching/effect-delayed': () => shell({ id:'TB17-002', title:'Delayed Visible Effect', task:'Kích hoạt hệ thống.', body:'<button id="activate" class="primary">Activate System</button><div id="hint" class="muted" style="margin-top:12px"></div>', script:`activate.onclick=()=>{activate.disabled=true;hint.textContent='Activation accepted…';setTimeout(()=>success('System Active'),2000)};` }),
  '/teaching/retry-different-action': () => shell({ id:'TB17-003', title:'Retry with Different Action', task:'Gửi ghi chú.', body:'<input id="note" aria-label="Relay Note" placeholder="Type note" style="padding:10px;width:320px"><button id="send" class="primary">Send Note</button><div id="hint" class="muted" style="margin-top:12px">Enter intentionally does not submit on this lab.</div>', script:`note.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();hint.textContent='Enter had no effect. Try another available action.'}};send.onclick=()=>{if(note.value.trim())success('Note Sent')};` }),
  '/teaching/menu-close-recover': () => shell({ id:'TB17-004', title:'Hover Menu Recovery', task:'Mở Advanced Settings.', body:'<div class="menu"><button>Settings</button><div class="submenu"><button id="advanced">Advanced Settings</button><button>Basic Settings</button></div></div><p class="muted">Rê chuột ra ngoài menu sẽ làm submenu đóng theo CSS hover bình thường.</p>', script:`advanced.onclick=()=>success('Advanced Settings Open');` }),
  '/teaching/target-not-found-until-scroll': () => shell({ id:'TB17-005', title:'Target Below Fold', task:'Mở Archive Report.', tall:true, body:'<div class="muted">Archive Report nằm phía dưới. Hãy scroll như người dùng bình thường.</div><div class="spacer"></div><button id="archive" class="primary">Archive Report</button>', script:`archive.onclick=()=>success('Archive Report Open');` })
};

function indexPage() {
  const groups = {};
  for (const [route, make] of Object.entries(scenarios)) {
    const html = make();
    const id = (html.match(/Teaching Lab • ([^<]+)/) || [])[1] || route;
    const group = id.split('-')[0];
    (groups[group] ||= []).push({ id, route });
  }
  const rows = Object.entries(groups).sort().map(([group, items]) => `<h2>${esc(group)}</h2><ul>${items.map(x=>`<li><a href="${x.route}">${esc(x.id)} — ${esc(x.route)}</a></li>`).join('')}</ul>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Teaching Lab</title><style>body{font:16px system-ui,sans-serif;max-width:900px;margin:36px auto;padding:0 20px}a{color:#175cd3}code{background:#f2f4f7;padding:2px 5px;border-radius:5px}</style></head><body><h1>Teaching Lab TB13–TB17</h1><p>Server: <code>http://${HOST}:${PORT}</code>. Reload một bài để reset trạng thái.</p>${rows}</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const route = url.pathname.replace(/\/$/, '') || '/';
  let html = null;
  if (route === '/' || route === '/teaching') html = indexPage();
  else if (scenarios[route]) html = scenarios[route]();
  if (!html) {
    res.writeHead(404, { 'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store' });
    res.end('Teaching Lab route not found');
    return;
  }
  res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
  res.end(html);
});

server.listen(PORT, HOST, () => {
  console.log(`Teaching Lab listening on http://${HOST}:${PORT}/teaching`);
  console.log(`First delayed task: http://${HOST}:${PORT}/teaching/delay-confirm-1500`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
