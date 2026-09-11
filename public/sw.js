const ROOT=new URL('./',self.location.href);
const PREFIX='toolbox-shell-'+ROOT.pathname+'-';
const CACHE=PREFIX+'__BUILD_VERSION__';
const ASSETS=/*__PRECACHE__*/['./','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(p=>new URL(p,ROOT).href))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname)||request.headers.has('authorization'))return;
  const relative=url.pathname.slice(ROOT.pathname.length);
  if(relative.startsWith('api/')||relative.includes('signin')||relative.includes('callback'))return;
  if(request.mode==='navigate'&&(relative===''||relative==='index.html')){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok&&!response.redirected){
        const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(ROOT.href,copy)));
      }
      return response;
    }).catch(async()=>await caches.match(ROOT.href)||new Response('Open Toolbox online once to enable offline capture.',{status:503})));
  }else if(/\.(js|css|png|svg|woff2|webmanifest)$/.test(relative)){
    event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      if(response.ok&&!response.redirected){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}
      return response;
    })));
  }
});
