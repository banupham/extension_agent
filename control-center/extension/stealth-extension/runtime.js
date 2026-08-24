function stopHeartbeat(){
  if(heartbeatTimer)clearInterval(heartbeatTimer);
  heartbeatTimer=null;
}

function startHeartbeat(){
  stopHeartbeat();
  heartbeatTimer=setInterval(()=>send({type:'heartbeat',role:'extension',ts:Date.now()}),HEARTBEAT_INTERVAL);
}

function scheduleReconnect(){
  clearTimeout(reconnectTimer);
  const delay=reconnectDelay;
  reconnectDelay=Math.min(reconnectDelay*2,RECONNECT_MAX_DELAY);
  reconnectTimer=setTimeout(connect,delay);
}

async function serverReady(){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),1200);
  try{
    const response=await fetch(HEALTH_URL,{cache:'no-store',signal:controller.signal});
    return response.ok;
  }catch{return false}
  finally{clearTimeout(timer)}
}

async function connect(){
  if(connectInFlight)return;
  if(socket&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(socket.readyState))return;

  connectInFlight=true;
  const ready=await serverReady();
  connectInFlight=false;
  if(!ready){scheduleReconnect();return}

  socket=new WebSocket(SERVER);
  socket.onopen=async()=>{
    reconnectDelay=RECONNECT_MIN_DELAY;
    clearTimeout(reconnectTimer);
    const identity=await getAgentIdentity();
    const meta=await registrationMeta();
    send({type:'register',role:'extension',agentId:identity.agentId,meta:{...meta,label:identity.agentLabel}});
    send({type:'status',role:'extension',agentId:identity.agentId,tabs:await listTabs(),meta});
    startHeartbeat();
  };

  socket.onmessage=async event=>{
    let msg;
    try{msg=JSON.parse(event.data)}catch{return}

    if(msg.type==='heartbeat'){
      send({type:'heartbeat_ack',role:'extension',ts:Date.now()});
      return;
    }
    if(msg.type==='heartbeat_ack'||msg.type!=='command')return;

    try{
      const{action,tabId,data}=msg.payload||{};
      const result=action==='sequence'
        ?await runSequence(tabId,data||{},msg.commandId)
        :(await executeAction(action,tabId,data||{})).result;
      send({type:'result',commandId:msg.commandId,result});
    }catch(err){
      send({type:'result',commandId:msg.commandId,result:{ok:false,error:String(err?.message||err)}});
    }
  };

  socket.onerror=()=>{};
  socket.onclose=()=>{
    stopHeartbeat();
    socket=null;
    scheduleReconnect();
  };
}

async function runSequence(tabId,data={},commandId=null){
  const steps=Array.isArray(data.steps)?data.steps:[];
  const results=[];
  let currentTabId=tabId??null;
  const progress=payload=>{
    if(commandId)send({type:'status',role:'extension',commandId,progress:payload});
  };

  progress({phase:'sequence_start',totalSteps:steps.length,completedSteps:0});

  for(let i=0;i<steps.length;i++){
    const step=steps[i]||{};
    const delayMs=Math.max(0,Number(step.delay)||0);
    progress({phase:'step_wait',step:i,stepNumber:i+1,totalSteps:steps.length,completedSteps:i,action:step.action||'unknown',delayMs});
    if(delayMs)await sleep(delayMs);

    const startedAt=Date.now();
    progress({phase:'step_start',step:i,stepNumber:i+1,totalSteps:steps.length,completedSteps:i,action:step.action||'unknown',startedAt});

    const out=await executeAction(step.action,currentTabId,step.data||{});
    if(Number.isInteger(out.tabId))currentTabId=out.tabId;
    const endedAt=Date.now();
    const result=out.result;
    const failed=result===false||result===null||(result&&typeof result==='object'&&result.ok===false);

    results.push({
      step:i,action:step.action,tabId:out.tabId,delayMs,startedAt,endedAt,
      durationMs:endedAt-startedAt,result
    });

    progress({
      phase:failed?'step_failed':'step_done',
      step:i,stepNumber:i+1,totalSteps:steps.length,completedSteps:i+1,
      action:step.action||'unknown',durationMs:endedAt-startedAt,tabId:out.tabId,
      error:failed&&result&&typeof result==='object'?(result.error||null):null
    });

    if(failed){
      progress({phase:'sequence_failed',step:i,stepNumber:i+1,totalSteps:steps.length,completedSteps:i+1,action:step.action||'unknown'});
      return{ok:false,failedStep:i,tabId:currentTabId,results};
    }
  }

  progress({phase:'sequence_done',totalSteps:steps.length,completedSteps:steps.length});
  return{ok:true,tabId:currentTabId,results};
}

chrome.debugger.onDetach.addListener(source=>{
  if(source&&Number.isInteger(source.tabId))debugSessions.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener(tabId=>{
  debugSessions.delete(tabId);
  mousePositionByTab.delete(tabId);
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
console.log('Stealth Executor 1.5.0 modular runtime loaded');
