/* Service worker for web push notifications only (no offline caching). */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Notification', { body: data.body || '', data: { link: data.link || '/' }, icon: '/favicon.svg' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url === url && 'focus' in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
