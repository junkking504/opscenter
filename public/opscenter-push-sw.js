/* No fetch handler, data fetches or Cache API: authenticated content is never cached. */
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('OpsCenter', {
    body: 'Operational updates are available. Open OpsCenter to review.',
    icon: '/opscenter-app-192.png', badge: '/opscenter-app-192.png',
    tag: 'opscenter-operational-updates', renotify: true,
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
