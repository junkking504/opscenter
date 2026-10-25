// Validate again at click time; notification data may outlive this worker version.
function notificationPath(value) {
  if(typeof value==='string') {
    if(/^\/desktop\?workspace=(Command|Schedule|Krewe|Fleet)$/.test(value))return value;
    const match=value.match(/^\/jobs\?date=(\d{4}-\d{2}-\d{2})#job-jk[0-9]{1,12}$/);
    if(match) {
      const date=new Date(match[1]+'T12:00:00Z');
      if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===match[1])return value;
    }
  }
  return '/desktop?workspace=Command';
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
/* No fetch handler, data fetches or Cache API: authenticated content is never cached. */
self.addEventListener('push', event => {
  let message={};try{message=event.data?(event.data.json()||{}):{};}catch{}
  const title=typeof message.title==='string'?message.title.slice(0,100):'OpsCenter';
  const body=typeof message.body==='string'?Array.from(message.body).slice(0,1601).join(''):'Operational updates are available. Open OpsCenter to review.';
  const tag=/^[a-f0-9]{64}$/.test(message.eventId||'')?'opscenter-'+message.eventId:'opscenter-operational-updates';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/opscenter-app-192.png', badge: '/opscenter-app-192.png',
    tag, renotify: true,
    data: { path: notificationPath(message.path) }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Only the allowlisted same-origin route; normal authentication remains required.
  const destination = new URL(notificationPath(event.notification.data?.path), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing = windows.find(client => client.url === destination);
    if (existing) return existing.focus();
    const app = windows.find(client => {
      const url=new URL(client.url);
      return url.origin===self.location.origin && (url.pathname==='/desktop'||url.pathname==='/jobs');
    });
    if(app){try{const navigated=await app.navigate(destination);if(navigated)return navigated.focus();}catch{/* Open the destination when navigation is refused. */}}
    return self.clients.openWindow(destination);
  })());
});
// Subscription rotation is deliberately user-driven on the next authenticated visit.
