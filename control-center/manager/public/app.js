const $=id=>document.getElementById(id);
let S={agents:[],launchers:[],scenarios:[],schedules:[],runs:[],runtime:{}};
const selectedAgents=new Set();
const selectedScenarios=new Set();
let loading=false;
let selectedVariantBase='';
let runFilter='all';
const manualAssignments=new Map();

async function api(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Request failed');return j;}
function toast(msg,bad=false){const n=$('notice');n.textContent=msg;n.className='toast show '+(bad?'bad':'good');clearTimeout(toast._t);toast._t=setTimeout(()=>n.className='toast',3500)}
function shortId(v){v=String(v||'');return v.length>18?v.slice(0,8)+'…'+v.slice(-6):v}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtTime(v){if(!v)return '—';try{return new Date(v).toLocaleString()}catch{return v}}
function onlineAgent(id){return S.agents.some(a=>a.agentId===id&&a.connected)}

function renderAgents(){
  const el=$('agents');
  if(!S.agents.length){el.innerHTML='<div class="empty-state"><strong>Chưa có browser online</strong><span>Mở Chrome/GPM đã cài extension. Khi extension kết nối broker, browser sẽ xuất hiện ở đây.</span></div>';return;}
  el.innerHTML=S.agents.map(a=>{
    const checked=selectedAgents.has(a.agentId)?'checked':'';
    const tab=a.activeTab||{};
    return `<article class="browser-card ${checked?'selected':''}">
      <div class="browser-select"><input class="agent-check" data-id="${esc(a.agentId)}" type="checkbox" ${checked}></div>
      <div class="browser-main">
        <div class="browser-title"><div><strong>${esc(a.displayName)}</strong><div class="mono">${esc(shortId(a.agentId))}</div></div><span class="badge good">ONLINE</span></div>
        <div class="browser-facts">
          <div><span>Active tab</span><b>${esc(tab.title||'Không có HTTP/HTTPS tab active')}</b></div>
          <div><span>URL</span><b class="url-text">${esc(tab.url||'—')}</b></div>
          <div><span>Tabs</span><b>${esc(a.tabCount)}</b></div>
          <div><span>Extension</span><b>${esc(a.extensionVersion||'—')}</b></div>
        </div>
        <div class="agent-meta">${esc(a.userAgent||'')}</div>
        <div class="card-actions"><button class="btn secondary rename-agent" data-id="${esc(a.agentId)}">Đổi tên</button>${a.launcherId?`<button class="btn ghost launch-linked" data-id="${esc(a.launcherId)}">Mở launcher đã link</button>`:''}</div>
      </div>
    </article>`;
  }).join('');
}

function renderLaunchers(){
  const el=$('launchers');
  if(!S.launchers.length){el.innerHTML='<div class="empty-state compact"><strong>Chưa đăng ký browser launcher</strong><span>Không bắt buộc. Chỉ cần khi muốn dashboard/API tự mở một chrome.exe nằm ở nơi khác.</span></div>';return;}
  el.innerHTML=S.launchers.map(x=>`<article class="launcher-card"><div class="launcher-head"><div><strong>${esc(x.name)}</strong><div class="mono">${esc(x.id)}</div></div><span class="badge ${x.running?'good':'muted'}">${x.running?'RUNNING':'SAVED'}</span></div><div class="launcher-path">${esc(x.exePath)}</div><div class="launcher-args">${esc((x.args||[]).join(' '))||'<span class="muted-text">No args</span>'}</div><div class="card-actions"><button class="btn primary launch-browser" data-id="${esc(x.id)}">Launch</button><button class="btn secondary edit-launcher" data-id="${esc(x.id)}">Edit</button><button class="btn ghost remove-launcher" data-id="${esc(x.id)}">Remove</button></div></article>`).join('');
}

function renderScenarios(){
  $('scenarios').innerHTML=S.scenarios.map(s=>`<label class="scenario-row"><input class="scenario-check" data-id="${esc(s.id)}" type="checkbox" ${selectedScenarios.has(s.id)?'checked':''}><span>${esc(s.name)}</span><span class="kind">${esc(s.kind)}</span></label>`).join('')||'<div class="empty-state compact">No scenarios</div>';

  const bases=S.scenarios.filter(s=>s.kind!=='variant' && !/__variant_\d+/i.test(s.name||''));
  if(!bases.some(s=>s.id===selectedVariantBase)) selectedVariantBase=bases[0]?.id||'';
  const select=$('variantBase');
  select.innerHTML=bases.map(s=>`<option value="${esc(s.id)}" ${s.id===selectedVariantBase?'selected':''}>${esc(s.name)}</option>`).join('');
  select.disabled=!bases.length;
}

function selectedOnlineAgents(){return [...selectedAgents].filter(onlineAgent)}
function selectedScenarioList(){return [...selectedScenarios].filter(id=>S.scenarios.some(s=>s.id===id))}
function scenarioName(id){return S.scenarios.find(s=>s.id===id)?.name || id}
function agentName(id){return S.agents.find(a=>a.agentId===id)?.displayName || shortId(id)}
function ensureManualAssignments(){
  const scenarios=selectedScenarioList();
  const agents=selectedOnlineAgents();
  for(const id of [...manualAssignments.keys()]) if(!agents.includes(id)) manualAssignments.delete(id);
  agents.forEach((agentId,i)=>{
    if(!scenarios.includes(manualAssignments.get(agentId))){
      manualAssignments.set(agentId, scenarios[i % Math.max(1,scenarios.length)] || '');
    }
  });
}
function currentAssignments(){
  const mode=$('assignmentMode').value;
  const agents=selectedOnlineAgents();
  const scenarios=selectedScenarioList();
  const pairs=[];
  if(!agents.length||!scenarios.length)return pairs;
  if(mode==='all') agents.forEach(a=>scenarios.forEach(s=>pairs.push([a,s])));
  else if(mode==='pair') agents.forEach((a,i)=>pairs.push([a,scenarios[i%scenarios.length]]));
  else if(mode==='random') agents.forEach(a=>pairs.push([a,'__RANDOM__']));
  else if(mode==='manual'){
    ensureManualAssignments();
    agents.forEach(a=>pairs.push([a,manualAssignments.get(a)]));
  }
  return pairs;
}
function renderManualAssignments(){
  const el=$('manualAssignments');
  if(!el)return;
  const manual=$('assignmentMode').value==='manual';
  el.hidden=!manual;
  if(!manual){el.innerHTML='';return;}
  ensureManualAssignments();
  const scenarios=selectedScenarioList();
  const agents=selectedOnlineAgents();
  el.innerHTML=agents.map(agentId=>`
    <label class="manual-assignment-row">
      <span>${esc(agentName(agentId))}</span>
      <select class="manual-scenario" data-agent="${esc(agentId)}">
        ${scenarios.map(s=>`<option value="${esc(s)}" ${manualAssignments.get(agentId)===s?'selected':''}>${esc(scenarioName(s))}</option>`).join('')}
      </select>
    </label>`).join('') || '<div class="muted-text">Chọn browser và scenario trước.</div>';
  document.querySelectorAll('.manual-scenario').forEach(sel=>{
    sel.onchange=()=>{manualAssignments.set(sel.dataset.agent,sel.value);updateSummary();};
  });
}
function renderAssignmentPreview(){
  const el=$('assignmentPreview');
  if(!el)return;
  const pairs=currentAssignments();
  const mode=$('assignmentMode').value;
  if(!pairs.length){el.textContent='Chưa có phân công.';return;}
  if(mode==='all'){el.textContent=`Sẽ tạo ${pairs.length} run: mọi browser × mọi scenario`;return;}
  if(mode==='random'){el.textContent=`${pairs.length} browser • mỗi browser sẽ nhận ngẫu nhiên 1 scenario khi bấm Run`;return;}
  el.innerHTML=pairs.map(([a,s])=>`${esc(agentName(a))} → <b>${esc(scenarioName(s))}</b>`).join(' &nbsp; • &nbsp; ');
}

function updateSummary(){
  const online=selectedOnlineAgents().length;
  const assignmentMode=$('assignmentMode').value;
  const assignmentLabel=({all:'tất cả × tất cả',pair:'ghép thứ tự',random:'ngẫu nhiên',manual:'tự gán'})[assignmentMode]||assignmentMode;
  $('selectionSummary').textContent=`${online} browser online • ${selectedScenarios.size} scenario • ${assignmentLabel} • ${$('mode').value==='parallel'?'song song':'lần lượt'}`;
  $('run').disabled=online<1||selectedScenarios.size<1;
  renderManualAssignments();
  renderAssignmentPreview();
}
function renderSchedules(){
  $('schedules').innerHTML=S.schedules.map(s=>`<div class="schedule-card"><div class="agent-title"><strong>${esc(s.name)}</strong><span class="badge ${s.enabled?'good':'muted'}">${s.enabled?'ACTIVE':'DONE'}</span></div><div class="agent-meta">${esc((s.agentIds||[]).length)} browser • ${esc((s.scenarioIds||[]).length)} scenario<br>Next: ${esc(fmtTime(s.nextRunAt))}${s.lastError?`<br><span class="bad-text">${esc(s.lastError)}</span>`:''}</div><div class="card-actions"><button class="btn ghost remove-schedule" data-id="${esc(s.id)}">Remove</button></div></div>`).join('')||'<div class="muted-text">Chưa có lịch.</div>';
}
function runStatusLabel(status){return ({queued:'ĐANG CHỜ',running:'ĐANG CHẠY',done:'HOÀN TẤT',failed:'LỖI',stopped:'ĐÃ DỪNG',interrupted:'GIÁN ĐOẠN'})[status]||String(status||'').toUpperCase()}
function actionLabel(action){return ({openUrl:'Mở URL',waitForSelector:'Chờ phần tử',getPageInfo:'Đọc thông tin trang',clickFirstMatch:'Click mục tiêu',clickRecorded:'Click đã ghi',type:'Nhập dữ liệu',pressKey:'Bấm phím',scroll:'Cuộn trang',scrollTo:'Cuộn tới vị trí',scrollBy:'Cuộn tương đối',getElementText:'Đọc kết quả',detach:'Ngắt debugger'})[action]||action||'Chuẩn bị'}
function phaseLabel(r){
  if(r.status==='queued'){const d=r.lastDiagnostic?` • ${r.lastDiagnostic}`:'';return `Chờ tới lượt${queuePosition(r)>1?' #'+queuePosition(r):''}${d}`;}
  if(r.status==='done')return 'Workflow đã chạy hết các bước';
  if(r.status==='failed')return r.error?`Lỗi: ${r.error}`:'Workflow gặp lỗi kỹ thuật';
  if(r.status==='stopped')return 'Đã dừng theo yêu cầu';
  if(r.status==='interrupted')return r.error||'Control Center đã restart';
  const p=r.currentPhase||'';
  if(p==='step_wait')return `Đang chờ trước bước ${Number(r.currentStep||0)+1}`;
  if(p==='step_start')return `Đang thực hiện: ${actionLabel(r.currentAction)}`;
  if(p==='step_done')return `Vừa xong: ${actionLabel(r.currentAction)}`;
  if(p==='preparing'||p==='starting')return 'Đang chuẩn bị runner';
  if(p==='sequence_start')return 'Bắt đầu workflow';
  if(p==='stopping')return 'Đang dừng...';
  return actionLabel(r.currentAction);
}
function queuePosition(r){
  if(r.status!=='queued')return 0;
  const q=S.runs.filter(x=>x.agentId===r.agentId&&x.status==='queued').sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  return Math.max(1,q.findIndex(x=>x.id===r.id)+1);
}
function runPct(r){
  const total=Number(r.totalSteps||0), done=Number(r.completedSteps||0);
  if(r.status==='done')return 100;
  if(!total)return r.status==='running'?3:0;
  return Math.max(0,Math.min(100,Math.round(done/total*100)));
}
function elapsed(r){
  const start=r.startedAt?new Date(r.startedAt).getTime():null;if(!start)return '—';
  const end=r.endedAt?new Date(r.endedAt).getTime():Date.now();const ms=Math.max(0,end-start);const sec=Math.floor(ms/1000);const m=Math.floor(sec/60),s=sec%60;return m?`${m}m ${s}s`:`${s}s`;
}
function renderRunOverview(){
  const list=S.runs||[];const counts={running:0,queued:0,done:0,failed:0,stopped:0};list.forEach(r=>{if(counts[r.status]!=null)counts[r.status]++});
  $('runOverview').innerHTML=`<div class="overview-stat"><span>Đang chạy</span><strong>${counts.running}</strong></div><div class="overview-stat"><span>Đang chờ</span><strong>${counts.queued}</strong></div><div class="overview-stat good"><span>Hoàn tất</span><strong>${counts.done}</strong></div><div class="overview-stat bad"><span>Lỗi</span><strong>${counts.failed}</strong></div>`;
}
function renderRuns(){
  renderRunOverview();
  let list=[...S.runs].reverse();
  if(runFilter!=='all') list=list.filter(r=>runFilter==='failed'?(r.status==='failed'||r.status==='stopped'):r.status===runFilter);
  list=list.slice(0,40);
  $('runs').innerHTML=list.map(r=>{
    const pct=runPct(r), total=Number(r.totalSteps||0), completed=Number(r.completedSteps||0);
    const stepText=total?`${Math.min(completed,total)}/${total} bước`:(r.status==='queued'?'Chưa bắt đầu':'Đang khởi tạo');
    const statusClass=r.status==='done'?'done':r.status;
    const detail=r.status==='failed'&&r.failedStep!=null?` • lỗi tại bước ${Number(r.failedStep)+1}`:'';
    return `<article class="run-card run-${esc(r.status)}">
      <div class="run-head">
        <div class="run-title-wrap"><div class="run-title-line"><strong>${esc(r.scenarioId)}</strong><span class="status ${esc(statusClass)}">${esc(runStatusLabel(r.status))}</span></div><div class="run-meta">Browser: ${esc(r.agentName||shortId(r.agentId))} • ${esc(fmtTime(r.startedAt||r.createdAt))} • ${esc(elapsed(r))}${detail}</div></div>
        <div class="run-actions">${r.status==='running'?`<button class="btn ghost stop-run" data-id="${esc(r.id)}">Stop</button>`:''}</div>
      </div>
      <div class="run-progress-area">
        <div class="run-progress-label"><span>${esc(phaseLabel(r))}</span><b>${esc(stepText)} • ${pct}%</b></div>
        <div class="progress-track" aria-label="Tiến độ ${pct}%"><div class="progress-fill ${esc(statusClass)}" style="width:${pct}%"></div></div>
        ${r.currentAction&&r.status==='running'?`<div class="current-step"><span class="pulse-dot"></span><strong>${esc(actionLabel(r.currentAction))}</strong>${r.lastStepDurationMs!=null?`<span>step trước: ${esc(r.lastStepDurationMs)}ms</span>`:''}</div>`:''}
        ${r.error?`<div class="run-error">${esc(r.error)}</div>`:''}
      </div>
      <details class="log-details"><summary>Log chẩn đoán / stdout <span>${esc(r.id)}</span></summary><pre>${esc(((r.diagnostics||[]).map(d=>`[${d.ts}] ${d.event} ${JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k])=>!['ts','event'].includes(k))))}`).join('\n')+'\n--- STDOUT ---\n'+(r.log||'(chưa có output)')).trim())}</pre></details>
    </article>`;
  }).join('')||'<div class="empty-state compact"><strong>Không có run trong bộ lọc này</strong></div>';
}

function bindDynamic(){
  document.querySelectorAll('.run-filter').forEach(b=>{b.classList.toggle('active',b.dataset.filter===runFilter);b.onclick=()=>{runFilter=b.dataset.filter;renderRuns();bindDynamic();};});
  document.querySelectorAll('.agent-check').forEach(x=>x.onchange=()=>{x.checked?selectedAgents.add(x.dataset.id):selectedAgents.delete(x.dataset.id);renderAgents();bindDynamic();updateSummary()});
  document.querySelectorAll('.scenario-check').forEach(x=>x.onchange=()=>{x.checked?selectedScenarios.add(x.dataset.id):selectedScenarios.delete(x.dataset.id);renderScenarios();bindDynamic();updateSummary()});
  document.querySelectorAll('.rename-agent').forEach(b=>b.onclick=()=>{const a=S.agents.find(x=>x.agentId===b.dataset.id);$('renameAgentId').value=a.agentId;$('renameAgentName').value=a.alias||'';$('renameDialog').showModal()});
  document.querySelectorAll('.launch-browser,.launch-linked').forEach(b=>b.onclick=async()=>{try{await api('/api/launcher/launch',{id:b.dataset.id});toast('Đã gửi lệnh mở browser')}catch(e){toast(e.message,true)}});
  document.querySelectorAll('.edit-launcher').forEach(b=>b.onclick=()=>openLauncher(S.launchers.find(x=>x.id===b.dataset.id)));
  document.querySelectorAll('.remove-launcher').forEach(b=>b.onclick=async()=>{if(!confirm('Xoá launcher này?'))return;try{await api('/api/launcher/remove',{id:b.dataset.id});toast('Đã xoá launcher');load()}catch(e){toast(e.message,true)}});
  document.querySelectorAll('.remove-schedule').forEach(b=>b.onclick=async()=>{try{await api('/api/schedule/remove',{id:b.dataset.id});load()}catch(e){toast(e.message,true)}});
  document.querySelectorAll('.stop-run').forEach(b=>b.onclick=async()=>{try{await api('/api/run/stop',{id:b.dataset.id});toast('Đã gửi Stop')}catch(e){toast(e.message,true)}});
}
function openLauncher(x=null){$('launcherId').value=x?.id||'';$('launcherName').value=x?.name||'';$('launcherExe').value=x?.exePath||'';$('launcherArgs').value=(x?.args||[]).map(v=>/\s/.test(v)?`"${v}"`:v).join(' ');$('launcherCwd').value=x?.cwd||'';$('launcherNotes').value=x?.notes||'';$('launcherTitle').textContent=x?'Sửa browser launcher':'Thêm browser launcher';$('launcherDialog').showModal()}

async function load(){if(loading)return;loading=true;try{const r=await fetch('/api/state',{cache:'no-store'});const j=await r.json();if(!j.ok)throw Error(j.error);S=j;const onlineIds=new Set(S.agents.map(a=>a.agentId));for(const id of [...selectedAgents])if(!onlineIds.has(id))selectedAgents.delete(id);$('brokerBadge').textContent=`Manager v${S.runtime.managerVersion||'?'} • Broker v${S.runtime.broker?.brokerVersion||'?'} • ${S.agents.length} online`;$('brokerBadge').className='badge '+(S.runtime.broker?'good':'bad');$('apiToken').textContent=S.runtime.apiToken||'';$('apiExample').textContent=JSON.stringify({launcherId:S.launchers[0]?.id||'launcher-1'},null,2);renderAgents();renderLaunchers();renderScenarios();renderSchedules();renderRuns();if($('managerDiagnostics'))$('managerDiagnostics').textContent=S.runtime.managerLog||'(chưa có log)';bindDynamic();updateSummary()}catch(e){toast(e.message,true)}finally{loading=false}}

$('refresh').onclick=load;
$('openExtension').onclick=async()=>{try{await api('/api/open-extension-folder',{});toast('Đã mở thư mục extension')}catch(e){toast(e.message,true)}};
$('selectAllAgents').onclick=()=>{S.agents.forEach(a=>selectedAgents.add(a.agentId));renderAgents();bindDynamic();updateSummary()};
$('clearAgents').onclick=()=>{selectedAgents.clear();renderAgents();bindDynamic();updateSummary()};
$('selectAllScenarios').onclick=()=>{S.scenarios.forEach(s=>selectedScenarios.add(s.id));renderScenarios();bindDynamic();updateSummary()};
$('clearScenarios').onclick=()=>{selectedScenarios.clear();renderScenarios();bindDynamic();updateSummary()};
$('variantBase').onchange=()=>{selectedVariantBase=$('variantBase').value;};
$('mode').onchange=updateSummary;
$('assignmentMode').onchange=updateSummary;
$('run').onclick=async()=>{try{
  ensureManualAssignments();
  const assignments=Object.fromEntries([...manualAssignments.entries()]);
  const r=await api('/api/run',{
    scenarioIds:[...selectedScenarios],
    agentIds:[...selectedAgents],
    mode:$('mode').value,
    assignmentMode:$('assignmentMode').value,
    assignments,
    tracePlan:$('trace').checked
  });
  toast(`Đã tạo ${r.runs.length} run`);
  load()
}catch(e){toast(e.message,true)}};
$('addLauncher').onclick=()=>openLauncher();
$('confirmRename').onclick=async e=>{e.preventDefault();try{await api('/api/agent/rename',{agentId:$('renameAgentId').value,name:$('renameAgentName').value});$('renameDialog').close();toast('Đã đổi tên browser');load()}catch(err){toast(err.message,true)}};
$('confirmLauncher').onclick=async e=>{e.preventDefault();try{await api('/api/launcher/save',{id:$('launcherId').value||undefined,name:$('launcherName').value,exePath:$('launcherExe').value,args:$('launcherArgs').value,cwd:$('launcherCwd').value,notes:$('launcherNotes').value});$('launcherDialog').close();toast('Đã lưu launcher');load()}catch(err){toast(err.message,true)}};
$('makeVariants').onclick=async()=>{try{selectedVariantBase=$('variantBase').value;if(!selectedVariantBase)throw Error('Không có scenario gốc để tạo variant');const r=await api('/api/variants',{scenarioId:selectedVariantBase,count:+$('variantCount').value,minScale:+$('minScale').value,maxScale:+$('maxScale').value,maxJitter:+$('maxJitter').value});toast(`Đã tạo ${r.made.length} variant từ ${r.baseName||selectedVariantBase}`);load()}catch(e){toast(e.message,true)}};
$('importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await api('/api/scenario/import',{filename:f.name,content:await f.text()});toast('Đã import scenario');load()}catch(err){toast(err.message,true)}e.target.value=''};
$('saveSchedule').onclick=async()=>{try{const at=$('scheduleAt').value;if(!at)throw Error('Chọn thời gian bắt đầu');if(!selectedAgents.size||!selectedScenarios.size)throw Error('Chọn browser online và scenario trước');await api('/api/schedule/save',{name:$('scheduleName').value||'Scheduled run',startAt:new Date(at).toISOString(),repeatMinutes:+$('repeatMinutes').value,mode:$('scheduleMode').value,assignmentMode:$('assignmentMode').value,assignments:Object.fromEntries([...manualAssignments.entries()]),scenarioIds:[...selectedScenarios],agentIds:[...selectedAgents],enabled:true});toast('Đã lưu lịch');load()}catch(e){toast(e.message,true)}};

load();setInterval(load,2500);
