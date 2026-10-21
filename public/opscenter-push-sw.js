self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
/* No fetch handler, data fetches or Cache API: authenticated content is never cached. */
self.addEventListener('push', event => {
  let message={};try{message=event.data?(event.data.json()||{}):{};}catch{}
  const title=typeof message.title==='string'?message.title.slice(0,100):'OpsCenter';
  const body=typeof message.body==='string'?message.body.slice(0,700):'Operational updates are available. Open OpsCenter to review.';
  const tag=/^[a-f0-9]{64}$/.test(message.eventId||'')?'opscenter-'+message.eventId:'opscenter-operational-updates';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/opscenter-app-192.png', badge: '/opscenter-app-192.png',
    tag, renotify: true,
    data: { path: '/desktop?workspace=Command' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Fixed same-origin destination; never trust a payload URL or expose a record.
  const destination = new URL('/desktop?workspace=Command', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing = windows.find(client => client.url === destination);
    if (existing) return existing.focus();
    return self.clients.openWindow(destination);
  })());
});
// Subscription rotation is deliberately user-driven on the next authenticated visit.
