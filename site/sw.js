const VERSION='crc-mvp-static-v12';
const ASSETS=['/','/styles.css','/app.js','/battle-insights.js','/owned-options.js','/offline-coach.js','/coach-chat.js','/backend-client.js','/catalog.json','/guides.json','/icon.svg'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('crc-mvp-static-')&&key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request, u=new URL(req.url);
  if(req.method!=='GET'||u.origin!==self.location.origin||!ASSETS.includes(u.pathname))return;
  event.respondWith(fetch(req).then(async response=>{
    if(response.ok){const c=await caches.open(VERSION);await c.put(req,response.clone());}
    return response;
  }).catch(async()=>await caches.match(req,{ignoreSearch:true})||new Response('Offline asset unavailable',{status:503})));
});
