const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
  const ctx=await b.newContext(); const p=await ctx.newPage();
  const saw=[]; await p.exposeFunction('__report',m=>saw.push(m));
  await p.addInitScript(()=>{navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.t==='saw')window.__report(e.data)})});
  await p.goto('http://localhost:8099/');
  await p.waitForFunction('window.__swready===true',null,{timeout:20000});
  await p.reload();
  await p.waitForFunction('navigator.serviceWorker.controller!==null',null,{timeout:20000});

  const out={};
  out.meta=await p.evaluate(()=>new Promise(r=>{
    const v=document.getElementById('v');
    if(v.readyState>=1) return r({ok:true,dur:v.duration});
    v.addEventListener('loadedmetadata',()=>r({ok:true,dur:v.duration}));
    v.addEventListener('error',()=>r({ok:false,err:v.error&&v.error.message}));
    setTimeout(()=>r({ok:false,err:'timeout ns='+v.networkState+' e='+(v.error&&v.error.message)}),20000);
  }));
  out.img=await p.evaluate(()=>{const i=document.getElementById('i');return {complete:i.complete,w:i.naturalWidth};});
  out.play=await p.evaluate(()=>new Promise(async r=>{
    const v=document.getElementById('v');
    try{await v.play()}catch(e){return r({ok:false,err:e.message})}
    setTimeout(()=>r({ok:v.currentTime>0.1,t:v.currentTime}),3000);
  }));
  out.corsFetch=await p.evaluate(async()=>{
    try{ const r=await fetch('http://127.0.0.1:8098/assets/probe.json',{mode:'cors'});
         return {ok:r.ok,status:r.status,type:r.type,body:await r.text()}; }
    catch(e){ return {ok:false,err:String(e)}; }
  });
  const hitsBefore=(await (await ctx.request.get('http://localhost:8099/__hits')).json()).length;
  out.seekFar=await p.evaluate(()=>new Promise(r=>{
    const v=document.getElementById('v'); const want=270;
    v.addEventListener('seeked',()=>r({ok:Math.abs(v.currentTime-want)<2,t:v.currentTime}),{once:true});
    v.addEventListener('error',()=>r({ok:false,err:'media error'}),{once:true});
    v.currentTime=want;
    setTimeout(()=>r({ok:false,err:'seek timeout',t:v.currentTime}),25000);
  }));
  const hits=await (await ctx.request.get('http://localhost:8099/__hits')).json();
  out.newRangeRequestsAfterSeek=hits.length-hitsBefore;
  console.log(JSON.stringify({out,originRanges:hits,swSaw:saw},null,2));
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
