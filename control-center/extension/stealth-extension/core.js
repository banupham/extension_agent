const SERVER='ws://127.0.0.1:3000';
const HEALTH_URL='http://127.0.0.1:3000/health';
const RECONNECT_MIN_DELAY=3000;
const RECONNECT_MAX_DELAY=30000;
const HEARTBEAT_INTERVAL=20000;
const AUTO_DETACH_DELAY=5000;
const SUPPORTED_ACTIONS=['listTabs','getCapabilities','openUrl','reload','goBack','goForward','click','clickSelector','clickFirstMatch','clickRecorded','doubleClickSelector','hoverSelector','moveMouse','dragAndDrop','type','replaceText','clearInput','pressKey','keyCombo','scroll','scrollTo','scrollBy','focusSelector','selectOption','setChecked','wait','waitForSelector','waitForUrl','getElementPosition','getActiveTab','getElementText','getPageInfo','detach'];

let socket=null;
let reconnectTimer=null;
let reconnectDelay=RECONNECT_MIN_DELAY;
let connectInFlight=false;
let heartbeatTimer=null;
const debugSessions=new Map();
const mousePositionByTab=new Map();

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const usableUrl=url=>/^https?:\/\//i.test(String(url||''));

function send(payload){
  if(!socket||socket.readyState!==WebSocket.OPEN)return false;
  try{socket.send(JSON.stringify(payload));return true}catch{return false}
}

async function listTabs(){
  const tabs=await chrome.tabs.query({});
  return tabs.filter(t=>usableUrl(t.url)).map(t=>({
    id:t.id,title:t.title||'',url:t.url||'',active:!!t.active,windowId:t.windowId
  }));
}

async function getValidTab(requestedTabId){
  if(Number.isInteger(requestedTabId)){
    try{
      const t=await chrome.tabs.get(requestedTabId);
      if(usableUrl(t.url))return t;
    }catch{}
  }
  const active=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  const chosen=active.find(t=>usableUrl(t.url));
  if(chosen)return chosen;
  const all=await chrome.tabs.query({});
  return all.find(t=>usableUrl(t.url))||null;
}

async function getAgentIdentity(){
  const stored=await chrome.storage.local.get(['agentId','agentLabel']);
  let agentId=stored.agentId;
  if(!agentId){
    agentId=crypto.randomUUID?crypto.randomUUID():`agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await chrome.storage.local.set({agentId});
  }
  return{agentId,agentLabel:stored.agentLabel||''};
}

async function registrationMeta(){
  const tabs=await listTabs();
  const active=tabs.find(t=>t.active)||tabs[0]||null;
  return{
    userAgent:navigator.userAgent,
    platform:navigator.platform||'',
    extensionVersion:chrome.runtime.getManifest().version,
    supportedActions:SUPPORTED_ACTIONS,
    activeTab:active?{title:active.title,url:active.url}:null,
    tabCount:tabs.length
  };
}

function attachDebugger(tabId){
  return new Promise(resolve=>{
    const existing=debugSessions.get(tabId);
    if(existing){
      clearTimeout(existing.timer);
      existing.timer=setTimeout(()=>detachDebugger(tabId),AUTO_DETACH_DELAY);
      return resolve(true);
    }
    chrome.debugger.attach({tabId},'1.3',()=>{
      if(chrome.runtime.lastError)return resolve(false);
      const timer=setTimeout(()=>detachDebugger(tabId),AUTO_DETACH_DELAY);
      debugSessions.set(tabId,{timer});
      resolve(true);
    });
  });
}

function detachDebugger(tabId){
  const state=debugSessions.get(tabId);
  if(!state)return Promise.resolve(true);
  clearTimeout(state.timer);
  return new Promise(resolve=>{
    chrome.debugger.detach({tabId},()=>{
      debugSessions.delete(tabId);
      resolve(!chrome.runtime.lastError);
    });
  });
}

async function withDebugger(tabId,fn){
  if(!await attachDebugger(tabId))throw new Error('Cannot attach debugger');
  try{return await fn()}
  finally{
    const state=debugSessions.get(tabId);
    if(state){
      clearTimeout(state.timer);
      state.timer=setTimeout(()=>detachDebugger(tabId),AUTO_DETACH_DELAY);
    }
  }
}
