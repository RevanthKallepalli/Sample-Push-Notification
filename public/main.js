const publicVapidKey = 'BGA3DeqFQ5KavZqM2ykl9dqlvuYTFXon5dsItS4SQoWvFgJXq_G1Dcfz7Vd_wLAW9Fv8RcuVtrKri3SCPwm5iOw';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
}

document.getElementById('subscribeBtn').addEventListener('click', async () => {
  if (!('serviceWorker' in navigator)) return alert('Service workers not supported');
  const reg = await navigator.serviceWorker.register('/sw.js');
  console.log('Service Worker registered', reg);

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return alert('Notification permission denied');

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
  });

  await fetch('/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });

  alert('Subscribed and sent to server.');
});

document.getElementById('sendBtn').addEventListener('click', async () => {
  const title = prompt('Notification title', 'Hey there!');
  const body = prompt('Notification body', 'This is a test push');
  await fetch('/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, url: '/' }),
  });
  alert('Send request sent to server.');
});
