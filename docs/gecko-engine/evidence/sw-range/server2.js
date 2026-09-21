const http=require('http'),fs=require('fs'),path=require('path');
const FILE=path.join(__dirname,'big.webm');
const SIZE=fs.statSync(FILE).size;
const originHits=[];

// video src points at a DIFFERENT origin that nothing serves.
const REMOTE='http://127.0.0.1:8098/assets/big.webm';

const PAGE=`<!doctype html><meta charset=utf-8><title>swtest2</title>
<video id=v src="${REMOTE}" preload=auto muted></video>
<img id=i src="http://127.0.0.1:8098/assets/pic.png">
<script>
window.__cors=null;
window.__font=null;
navigator.serviceWorker.register('/sw.js').then(async()=>{await navigator.serviceWorker.ready;window.__swready=true;})
 .catch(e=>window.__swerr=String(e));
</script>`;

const SW=`
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  const u=new URL(req.url);
  if(u.origin===self.location.origin) return;      // our own stuff: untouched
  event.respondWith((async()=>{
    const range=req.headers.get('range');
    const cs=await self.clients.matchAll();
    cs.forEach(c=>c.postMessage({t:'saw',url:req.url,range:range||null,mode:req.mode,dest:req.destination}));
    const h=new Headers();
    if(range) h.set('range',range);
    // everything foreign is proxied through our own endpoint
    if(u.pathname.endsWith('/probe.json')) return fetch('/cors-probe');
    return fetch('/proxy?u='+encodeURIComponent(req.url),{headers:h});
  })());
});
`;

function serveRange(req,res,ct){
  const range=req.headers.range;
  originHits.push(range||'FULL');
  if(!range){
    res.writeHead(200,{'Content-Type':ct,'Content-Length':SIZE,'Accept-Ranges':'bytes'});
    return fs.createReadStream(FILE).pipe(res);
  }
  const m=/bytes=(\d*)-(\d*)/.exec(range);
  let start=m[1]?parseInt(m[1]):0, end=m[2]?parseInt(m[2]):SIZE-1;
  if(start>=SIZE){res.writeHead(416,{'Content-Range':`bytes */${SIZE}`});return res.end();}
  res.writeHead(206,{'Content-Type':ct,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${SIZE}`});
  fs.createReadStream(FILE,{start,end}).pipe(res);
}
const PNG=Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' +
 '01f15c4890000000a49444154789c6300010000050001','hex');

http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(PAGE);}
  if(u.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript','Service-Worker-Allowed':'/'});return res.end(SW);}
  if(u.pathname==='/proxy'){
    const target=u.searchParams.get('u')||'';
    if(target.endsWith('.png')){res.writeHead(200,{'Content-Type':'image/png','Content-Length':PNG.length});return res.end(PNG);}
    return serveRange(req,res,'video/webm');
  }
  if(u.pathname==='/cors-probe'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true}');}
  if(u.pathname==='/__hits'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(originHits));}
  res.writeHead(404);res.end();
}).listen(8099,()=>console.log('up2'));
