/* Aplikacja (PWA): pliki panelu z sieci, a gdy sieci brak — ostatnia zapisana wersja.
   Zapytania do bazy (Supabase) i innych serwerów idą zawsze prosto do sieci. */
const CACHE='pielegniarki-v1';
const SHELL=['./','index.html','i18n.js','pielegniarki.js','czat.js','logi.js','version.json','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const k=r.clone();caches.open(CACHE).then(c=>c.put(e.request,k))}return r})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));
});
