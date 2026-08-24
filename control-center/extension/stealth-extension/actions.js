async function focusSelector(tabId,selector){
  try{
    const[result]=await chrome.scripting.executeScript({
      target:{tabId},
      func:sel=>{
        const el=document.querySelector(sel);
        if(!el)return{ok:false,error:'Element not found'};
        el.focus({preventScroll:true});
        return{ok:document.activeElement===el};
      },args:[selector]
    });
    return result.result;
  }catch(e){return{ok:false,error:String(e.message||e)}}
}

async function clearInput(tabId,selector=null){
  if(selector){const focused=await focusSelector(tabId,selector);if(!focused?.ok)return focused}
  const selectAll=await keyCombo(tabId,['Control','a']);
  if(!selectAll?.ok)return selectAll;
  return pressKey(tabId,'Backspace');
}

async function replaceText(tabId,selector,text){
  const cleared=await clearInput(tabId,selector);
  if(!cleared?.ok)return cleared;
  return typeText(tabId,text);
}

async function waitForSelector(tabId,selector,timeoutMs=8000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    try{
      const[result]=await chrome.scripting.executeScript({
        target:{tabId},
        func:sel=>{
          const el=document.querySelector(sel);
          if(!el)return null;
          const r=el.getBoundingClientRect();
          return{x:r.left+r.width/2,y:r.top+r.height/2,rect:{left:r.left,top:r.top,width:r.width,height:r.height}};
        },args:[selector]
      });
      if(result.result)return result.result;
    }catch{}
    await sleep(100);
  }
  return{ok:false,error:'waitForSelector timeout'};
}

async function waitForUrl(tabId,data={}){
  const started=Date.now(),timeoutMs=Number(data.timeoutMs)||10000;
  let regex=null;
  if(data.regex){try{regex=new RegExp(String(data.regex))}catch{return{ok:false,error:'Invalid URL regex'}}}
  while(Date.now()-started<timeoutMs){
    const tab=await chrome.tabs.get(tabId),url=tab.url||'';
    const matched=(data.equals!=null&&url===String(data.equals))||(data.contains!=null&&url.includes(String(data.contains)))||(regex&&regex.test(url));
    if(matched)return{ok:true,url};
    await sleep(100);
  }
  return{ok:false,error:'waitForUrl timeout'};
}

async function getElementText(tabId,selector){
  try{
    const[result]=await chrome.scripting.executeScript({
      target:{tabId},
      func:sel=>{const el=document.querySelector(sel);return el?(el.innerText||el.textContent||el.value||''):null},
      args:[selector]
    });
    return result.result;
  }catch{return null}
}

async function getPageInfo(tabId){
  const tab=await chrome.tabs.get(tabId);
  const[result]=await chrome.scripting.executeScript({
    target:{tabId},
    func:()=>({title:document.title,url:location.href,scrollX,scrollY,width:innerWidth,height:innerHeight})
  });
  return{...result.result,tabId,title:tab.title||result.result.title,url:tab.url||result.result.url};
}

async function selectOption(tabId,selector,value,text,index){
  const[result]=await chrome.scripting.executeScript({
    target:{tabId},
    func:(sel,wantedValue,wantedText,wantedIndex)=>{
      const el=document.querySelector(sel);
      if(!(el instanceof HTMLSelectElement))return{ok:false,error:'Select not found'};
      let option=wantedValue!=null?[...el.options].find(o=>o.value===String(wantedValue)):null;
      if(!option&&wantedText!=null)option=[...el.options].find(o=>o.text.trim()===String(wantedText).trim());
      if(!option&&Number.isInteger(wantedIndex))option=el.options[wantedIndex]||null;
      if(!option)return{ok:false,error:'Option not found'};
      el.value=option.value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return{ok:true,value:option.value,text:option.text,index:option.index};
    },args:[selector,value,text,index]
  });
  return result.result;
}

async function setChecked(tabId,selector,checked){
  const[result]=await chrome.scripting.executeScript({
    target:{tabId},
    func:(sel,wanted)=>{
      const el=document.querySelector(sel);
      if(!(el instanceof HTMLInputElement)||!['checkbox','radio'].includes(el.type))return{ok:false,error:'Checkbox/radio not found'};
      if(el.checked!==wanted)el.click();
      return{ok:true,checked:el.checked};
    },args:[selector,!!checked]
  });
  return result.result;
}

async function openUrl(url,newTab=true){
  if(!usableUrl(url))return{ok:false,error:'Only http/https URLs are allowed'};
  let tab;
  if(newTab)tab=await chrome.tabs.create({url,active:true});
  else{
    const current=await getValidTab(null);
    if(!current)return{ok:false,error:'No valid tab'};
    tab=await chrome.tabs.update(current.id,{url,active:true});
  }
  return{ok:true,tabId:tab.id,url};
}

async function executeAction(action,requestedTabId,data={}){
  if(action==='listTabs')return{tabId:null,result:await listTabs()};
  if(action==='openUrl'){
    const result=await openUrl(data.url,data.newTab!==false);
    return{tabId:result.ok?result.tabId:null,result};
  }

  const tab=await getValidTab(requestedTabId);
  if(!tab)return{tabId:null,result:{ok:false,error:'No valid tab',requestedTabId:requestedTabId??null}};

  let result;
  switch(action){
    case'getCapabilities':result={ok:true,version:chrome.runtime.getManifest().version,actions:SUPPORTED_ACTIONS};break;
    case'wait':await sleep(data.ms);result={ok:true,waitedMs:Number(data.ms)||0};break;
    case'reload':await chrome.tabs.reload(tab.id);result={ok:true};break;
    case'goBack':await chrome.tabs.goBack(tab.id);result={ok:true};break;
    case'goForward':await chrome.tabs.goForward(tab.id);result={ok:true};break;
    case'click':result=await humanClick(tab.id,data.x,data.y);break;
    case'moveMouse':{
      const last=mousePositionByTab.get(tab.id)||{x:Number(data.fromX)||0,y:Number(data.fromY)||0};
      result=await moveMouse(tab.id,last.x,last.y,data.toX??data.x,data.toY??data.y,data.steps);break;
    }
    case'clickSelector':result=await clickSelector(tab.id,data.selector);break;
    case'clickFirstMatch':result=await clickFirstMatch(tab.id,data);break;
    case'clickRecorded':result=await clickRecorded(tab.id,data);break;
    case'doubleClickSelector':result=await doubleClickSelector(tab.id,data.selector);break;
    case'hoverSelector':result=await hoverSelector(tab.id,data.selector);break;
    case'dragAndDrop':result=await dragAndDrop(tab.id,data.sourceSelector,data.targetSelector);break;
    case'type':result=await typeText(tab.id,data.text);break;
    case'replaceText':result=await replaceText(tab.id,data.selector||null,data.text);break;
    case'clearInput':result=await clearInput(tab.id,data.selector||null);break;
    case'pressKey':result=await pressKey(tab.id,data.key);break;
    case'keyCombo':result=await keyCombo(tab.id,data.keys||data.combo);break;
    case'scroll':case'scrollTo':result=await smoothScrollTo(tab.id,data.x,data.y);break;
    case'scrollBy':result=await scrollBy(tab.id,data.x,data.y);break;
    case'focusSelector':result=await focusSelector(tab.id,data.selector);break;
    case'selectOption':result=await selectOption(tab.id,data.selector,data.value,data.text,Number.isInteger(data.index)?data.index:null);break;
    case'setChecked':result=await setChecked(tab.id,data.selector,data.checked);break;
    case'waitForSelector':result=await waitForSelector(tab.id,data.selector,Number(data.timeoutMs)||8000);break;
    case'waitForUrl':result=await waitForUrl(tab.id,data);break;
    case'getElementPosition':result=await getElementPos(tab.id,data.selector);break;
    case'getActiveTab':result={id:tab.id,title:tab.title||'',url:tab.url||''};break;
    case'getElementText':result=await getElementText(tab.id,data.selector);break;
    case'getPageInfo':result=await getPageInfo(tab.id);break;
    case'detach':result=await detachDebugger(tab.id);break;
    default:result={ok:false,error:`Unknown action: ${action}`};
  }
  return{tabId:tab.id,result};
}
