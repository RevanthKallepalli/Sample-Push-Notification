// public/sw.js — make sure this is deployed exactly as-is
self.addEventListener('install', (event) => {
  // activate new worker immediately (so update on deploy works)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // take control of all pages under scope immediately
  event.waitUntil(self.clients.claim());
});

// debug logging to SW console to help triage pushes
self.addEventListener('push', (event) => {
  console.log('[sw] push event', event);
  let data = { title: 'Alert', body: 'You have a notification', url: '/', tag: 'alert' };

  if (event.data) {
    try {
      const incoming = event.data.json();
      data = Object.assign(data, incoming || {});
      console.log('[sw] push payload (json):', data);
    } catch (err) {
      data.body = event.data.text();
      console.log('[sw] push payload (text):', data.body);
    }
  } else {
    console.log('[sw] no event.data');
  }

  const options = {
    body: data.body,
    tag: data.tag,
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || '/' },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
      .then(() => console.log('[sw] showNotification success'))
      .catch(err => console.error('[sw] showNotification failed:', err))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        if (new URL(client.url).origin === self.location.origin) {
          if ('focus' in client) return client.focus();
        }
      } catch (_) {}
    }
    if (clients.openWindow) return clients.openWindow(new URL(urlToOpen, self.location.origin).href);
  })());
});
