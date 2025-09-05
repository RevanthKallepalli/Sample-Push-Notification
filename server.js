// server.js
const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const path = require('path');
const fs = require('fs');
// p-limit may export as default (ESM build). Support both shapes:
const pLimitImport = require('p-limit');
const pLimit = (typeof pLimitImport === 'function') ? pLimitImport : (pLimitImport && pLimitImport.default) ? pLimitImport.default : null;
if (!pLimit) throw new Error('p-limit import failed; try `npm install p-limit@2` or use the no-deps implementation.');


const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

/* VAPID keys - keep privateKey secret */
const vapidKeys = {
  publicKey: 'BGA3DeqFQ5KavZqM2ykl9dqlvuYTFXon5dsItS4SQoWvFgJXq_G1Dcfz7Vd_wLAW9Fv8RcuVtrKri3SCPwm5iOw',
  privateKey: '8E6AS-OcEco7Os0rdy16RUXNv3xsk97g3kVjwR_8OS8'
};

webpush.setVapidDetails(
  'mailto:revanthkallepalli28@gmail.com', // replace with contact email for production
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ---------------- storage helpers ----------------
// persists a list of subscriptions in subscriptions.json
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];

/** load subscriptions from disk at startup */
function loadSubscriptions() {
  if (!fs.existsSync(SUBS_FILE)) {
    subscriptions = [];
    return;
  }
  try {
    const raw = fs.readFileSync(SUBS_FILE, 'utf8');
    subscriptions = JSON.parse(raw) || [];
    console.log(`Loaded ${subscriptions.length} subscriptions from disk.`);
  } catch (e) {
    console.warn('Failed to load subscriptions.json — starting with empty list.', e);
    subscriptions = [];
  }
}

/** save subscriptions to disk */
function persistSubscriptions() {
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2));
  } catch (e) {
    console.error('Failed to persist subscriptions to disk:', e);
  }
}

/** add subscription if not already present (unique by endpoint) */
function addSubscription(sub) {
  if (!sub || !sub.endpoint) return false;
  const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
  if (exists) return false;
  subscriptions.push(sub);
  persistSubscriptions();
  return true;
}

/** remove subscription by endpoint */
function removeSubscriptionByEndpoint(endpoint) {
  const before = subscriptions.length;
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  if (subscriptions.length !== before) persistSubscriptions();
  return subscriptions.length !== before;
}

/** clear all subscriptions (admin) */
function clearAllSubscriptions() {
  subscriptions = [];
  persistSubscriptions();
}

// load at startup
loadSubscriptions();

// --------------- helper to send to one subscription ---------------
async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const status = err && err.statusCode;
    // treat 404/410 as expired
    const expired = status === 410 || status === 404;
    return { ok: false, status, expired, error: err };
  }
}

// --------------- endpoints ---------------

// client calls this to register subscription
app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ success: false, error: 'Invalid subscription' });

  const added = addSubscription(sub);
  console.log(`${added ? 'Added' : 'Subscription existed'}: ${sub.endpoint}`);
  res.json({ success: true, added });
});

// client can call to unsubscribe (optional)
app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ success: false, error: 'Missing endpoint' });
  const removed = removeSubscriptionByEndpoint(endpoint);
  console.log(`Unsubscribe requested for ${endpoint}: ${removed ? 'removed' : 'not found'}`);
  res.json({ success: true, removed });
});

// admin: list subscriptions (GET)
app.get('/admin/subscriptions', (req, res) => {
  res.json({ success: true, count: subscriptions.length, subscriptions });
});

// admin UI (serves public/admin.html automatically since static middleware points to public)

// Admin endpoint: send to all subscriptions
/*
 POST /admin/send-all
 body:
  {
    parkingId?: string,
    userName?: string,
    url?: string,
    severity?: 'info'|'warning'|'critical',
    message?: string // override body
  }
 Response: report of sends and removals
*/
app.post('/admin/send-all', async (req, res) => {
  if (!subscriptions || subscriptions.length === 0) {
    return res.status(400).json({ success: false, message: 'No subscriptions registered' });
  }

  const {
    parkingId = null,
    userName = '',
    url = '/',
    severity = 'warning',
    message = null
  } = req.body || {};

  const title = 'Vehicle parked incorrectly';
  const body = message || (userName
    ? `${userName}, your vehicle is parked wrong — move it to avoid a ticket.`
    : 'Your vehicle is parked wrong — move it to avoid a ticket.');

  const payload = {
    title,
    body,
    url,
    tag: parkingId ? `parking-${parkingId}` : 'parking-alert',
    parkingId,
    severity,
    timestamp: Date.now()
  };

  // concurrency limiter to avoid hammering endpoints
  const limit = pLimit(12); // 12 concurrent
  const tasks = subscriptions.map(sub => limit(async () => {
    const result = await sendToSubscription(sub, payload);
    return { endpoint: sub.endpoint, result };
  }));

  const results = await Promise.all(tasks);

  // collect failures and remove expired
  const removed = [];
  const failed = [];
  for (const r of results) {
    if (!r.result.ok) {
      if (r.result.expired) {
        removeSubscriptionByEndpoint(r.endpoint);
        removed.push({ endpoint: r.endpoint, status: r.result.status });
      } else {
        failed.push({ endpoint: r.endpoint, status: r.result.status });
      }
    }
  }

  persistSubscriptions();

  res.json({
    success: true,
    attempted: results.length,
    removedCount: removed.length,
    removed,
    failedCount: failed.length,
    failed
  });
});

// admin: clear all subscriptions (danger)
app.post('/admin/clear-all', (req, res) => {
  clearAllSubscriptions();
  res.json({ success: true, message: 'All subscriptions removed' });
});

// small health
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
