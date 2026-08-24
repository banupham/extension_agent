async function moveMouse(tabId,fromX,fromY,toX,toY,steps=12){
  fromX=Number(fromX)||0;fromY=Number(fromY)||0;toX=Number(toX)||0;toY=Number(toY)||0;
  steps=Math.max(1,Math.min(40,Number(steps)||12));
  await withDebugger(tabId,async()=>{
    for(let i=1;i<=steps;i++){
      const t=i/steps,x=fromX+(toX-fromX)*t,y=fromY+(toY-fromY)*t;
      await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
      if(i<steps)await sleep(5);
    }
  });
  mousePositionByTab.set(tabId,{x:toX,y:toY});
  return{ok:true,x:toX,y:toY};
}

async function humanClick(tabId,x,y){
  x=Number(x)||0;y=Number(y)||0;
  const last=mousePositionByTab.get(tabId)||{x,y};
  await moveMouse(tabId,last.x,last.y,x,y,12);
  await withDebugger(tabId,async()=>{
    await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await sleep(45);
    await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  });
  return{ok:true,x,y};
}

async function getElementPos(tabId,selector){
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
    return result.result;
  }catch{return null}
}

async function clickSelector(tabId,selector){
  const p=await getElementPos(tabId,selector);
  return p?humanClick(tabId,p.x,p.y):{ok:false,error:'Element not found'};
}

async function findFirst(tabId,data){
  const selectors=Array.isArray(data.selectors)?data.selectors:[];
  const texts=Array.isArray(data.texts)?data.texts:[];
  const[result]=await chrome.scripting.executeScript({
    target:{tabId},
    func:(ss,ts)=>{
      const usable=el=>{
        if(!el)return false;
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden';
      };
      for(const sel of ss){
        try{
          for(const el of document.querySelectorAll(sel)){
            if(usable(el)){
              const r=el.getBoundingClientRect();
              return{x:r.left+r.width/2,y:r.top+r.height/2,selector:sel,text:(el.innerText||el.textContent||el.value||'').trim().slice(0,120)};
            }
          }
        }catch{}
      }
      for(const wanted of ts){
        const needle=String(wanted).toLowerCase();
        for(const el of document.querySelectorAll('a,button,[role="button"],[role="link"],input,label,summary')){
          const label=(el.innerText||el.textContent||el.value||el.getAttribute('aria-label')||'').trim();
          if(usable(el)&&label.toLowerCase().includes(needle)){
            const r=el.getBoundingClientRect();
            return{x:r.left+r.width/2,y:r.top+r.height/2,text:label};
          }
        }
      }
      return null;
    },args:[selectors,texts]
  });
  return result.result;
}

async function clickFirstMatch(tabId,data){
  const p=await findFirst(tabId,data);
  return p?humanClick(tabId,p.x,p.y):{ok:false,error:'No matching element'};
}

async function doubleClickSelector(tabId,selector){
  const p=await getElementPos(tabId,selector);
  if(!p)return{ok:false,error:'Element not found'};
  await withDebugger(tabId,async()=>{
    for(let i=1;i<=2;i++){
      await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:i});
      await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:i});
      await sleep(70);
    }
  });
  return{ok:true};
}

async function hoverSelector(tabId,selector){
  const p=await getElementPos(tabId,selector);
  if(!p)return{ok:false,error:'Element not found'};
  const last=mousePositionByTab.get(tabId)||p;
  return moveMouse(tabId,last.x,last.y,p.x,p.y,12);
}

async function dragAndDrop(tabId,sourceSelector,targetSelector){
  const a=await getElementPos(tabId,sourceSelector),b=await getElementPos(tabId,targetSelector);
  if(!a||!b)return{ok:false,error:'Source or target not found'};
  const last=mousePositionByTab.get(tabId)||a;
  await moveMouse(tabId,last.x,last.y,a.x,a.y,10);
  await withDebugger(tabId,()=>chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mousePressed',x:a.x,y:a.y,button:'left',clickCount:1}));
  await moveMouse(tabId,a.x,a.y,b.x,b.y,18);
  await withDebugger(tabId,()=>chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseReleased',x:b.x,y:b.y,button:'left',clickCount:1}));
  return{ok:true};
}

function keyDef(key){
  const raw=String(key||''),k=raw.toLowerCase();
  const named={enter:['Enter','Enter',13],tab:['Tab','Tab',9],escape:['Escape','Escape',27],esc:['Escape','Escape',27],backspace:['Backspace','Backspace',8],delete:['Delete','Delete',46],arrowleft:['ArrowLeft','ArrowLeft',37],arrowup:['ArrowUp','ArrowUp',38],arrowright:['ArrowRight','ArrowRight',39],arrowdown:['ArrowDown','ArrowDown',40],home:['Home','Home',36],end:['End','End',35],pageup:['PageUp','PageUp',33],pagedown:['PageDown','PageDown',34],insert:['Insert','Insert',45],space:[' ','Space',32]};
  if(named[k]){const[a,b,c]=named[k];return{key:a,code:b,vk:c}}
  if(/^f([1-9]|1[0-2])$/i.test(raw)){const n=Number(raw.slice(1));return{key:`F${n}`,code:`F${n}`,vk:111+n}}
  if(raw.length===1){const vk=raw.toUpperCase().charCodeAt(0);return{key:raw,code:/[a-z]/i.test(raw)?`Key${raw.toUpperCase()}`:/\d/.test(raw)?`Digit${raw}`:'',vk,text:raw}}
  return null;
}

async function pressKey(tabId,key,modifiers=0){
  const d=keyDef(key);
  if(!d)return{ok:false,error:`Unsupported key: ${key}`};
  await withDebugger(tabId,async()=>{
    const down={type:'keyDown',key:d.key,code:d.code,windowsVirtualKeyCode:d.vk,nativeVirtualKeyCode:d.vk,modifiers};
    if(d.text)down.text=d.text;
    await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',down);
    await sleep(35);
    await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',{type:'keyUp',key:d.key,code:d.code,windowsVirtualKeyCode:d.vk,nativeVirtualKeyCode:d.vk,modifiers});
  });
  return{ok:true};
}

async function keyCombo(tabId,keys){
  const list=Array.isArray(keys)?keys:String(keys||'').split('+');
  let modifiers=0,main='';
  for(const token of list){
    const k=String(token).trim().toLowerCase();
    if(k==='alt')modifiers|=1;
    else if(k==='control'||k==='ctrl')modifiers|=2;
    else if(k==='meta'||k==='cmd'||k==='command')modifiers|=4;
    else if(k==='shift')modifiers|=8;
    else main=token;
  }
  return main?pressKey(tabId,main,modifiers):{ok:false,error:'Missing main key'};
}

async function typeText(tabId,text){
  text=String(text??'');
  return withDebugger(tabId,async()=>{
    await chrome.debugger.sendCommand({tabId},'Input.insertText',{text});
    return{ok:true,textLength:text.length};
  });
}

async function smoothScrollTo(tabId,x,y){
  x=Math.max(0,Number(x)||0);y=Math.max(0,Number(y)||0);
  const[stateResult]=await chrome.scripting.executeScript({target:{tabId},func:()=>({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})});
  const state=stateResult.result||{x:0,y:0,w:800,h:600};
  const dx=x-state.x,dy=y-state.y;
  if(Math.abs(dx)<1&&Math.abs(dy)<1)return{ok:true,x:state.x,y:state.y,method:'none'};
  const point=mousePositionByTab.get(tabId)||{x:state.w/2,y:state.h/2};
  await withDebugger(tabId,async()=>{
    let rx=dx,ry=dy;
    while(Math.abs(rx)>=1||Math.abs(ry)>=1){
      const sx=Math.abs(rx)<1?0:Math.sign(rx)*Math.min(120,Math.abs(rx));
      const sy=Math.abs(ry)<1?0:Math.sign(ry)*Math.min(120,Math.abs(ry));
      await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX:sx,deltaY:sy});
      rx-=sx;ry-=sy;
      await sleep(16);
    }
  });
  await sleep(60);
  const[verify]=await chrome.scripting.executeScript({target:{tabId},func:()=>({x:scrollX,y:scrollY})});
  return{ok:true,x:verify.result.x,y:verify.result.y,method:'wheel'};
}

async function scrollBy(tabId,x,y){
  const[result]=await chrome.scripting.executeScript({target:{tabId},func:()=>({x:scrollX,y:scrollY})});
  return smoothScrollTo(tabId,(result.result?.x||0)+(Number(x)||0),(result.result?.y||0)+(Number(y)||0));
}
