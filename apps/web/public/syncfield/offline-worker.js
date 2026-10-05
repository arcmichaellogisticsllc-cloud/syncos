const CACHE='syncos-offline-shell-v1';
const ASSETS=['/syncfield/offline.html','/syncfield/offline-view.js','/syncfield/offline.css'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('syncos-offline-shell-')&&key!==CACHE).map(key=>caches.delete(key))))])));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET')return;
 if(ASSETS.includes(url.pathname)){event.respondWith(caches.match(url.pathname).then(cached=>cached||fetch(event.request)));return;}
 if(event.request.mode==='navigate'&&url.pathname.startsWith('/syncfield/'))event.respondWith(fetch(event.request).catch(()=>caches.match('/syncfield/offline.html')));
});
