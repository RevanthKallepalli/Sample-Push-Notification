// api/admin_send_all.js
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function requireAdmin(req, res) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

// configure VAPID
webpush.setVapidDetails(
  `mailto:you@example.com`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const { parkingId = null, userName = '', url = '/', severity = 'warning', message = null } = req.body || {};
  const title = 'Vehicle parked incorrectly';
  const body = message || (userName ? `${userName}, your vehicle is parked wrong — move it.` : 'Your vehicle is parked wrong — move it to avoid a ticket.');

  try {
    const { data } = await supabase.from('subscriptions').select('id, subscription');
    const subscriptions = (data || []).map(r => ({ id: r.id, subscription: r.subscription }));

    if (!subscriptions.length) return res.status(400).json({ success: false, message: 'No subscriptions registered' });

    const payload = { title, body, url, tag: parkingId ? `parking-${parkingId}` : 'parking-alert', parkingId, timestamp: Date.now() };

    // send in batches to avoid timeouts
    const batchSize = 12;
    const results = [];
    for (let i = 0; i < subscriptions.length; i += batchSize) {
      const batch = subscriptions.slice(i, i + batchSize);
      const batchRes = await Promise.all(batch.map(async (row) => {
        try {
          await webpush.sendNotification(row.subscription, JSON.stringify(payload));
          return { id: row.id, ok: true };
        } catch (err) {
          const status = err && err.statusCode;
          const expired = status === 410 || status === 404;
          return { id: row.id, ok: false, expired, status, error: err && (err.body || err.message) };
        }
      }));
      results.push(...batchRes);
    }

    // remove expired subscriptions
    const expiredIds = results.filter(r => !r.ok && r.expired).map(r => r.id);
    if (expiredIds.length) {
      await supabase.from('subscriptions').delete().in('id', expiredIds);
    }

    const failed = results.filter(r => !r.ok && !r.expired);
    res.json({
      success: true,
      attempted: results.length,
      removedCount: expiredIds.length,
      failedCount: failed.length,
      failed: failed.map(f => ({ id: f.id, status: f.status }))
    });
  } catch (err) {
    console.error('send-all error', err);
    res.status(500).json({ success: false, error: err.message || err });
  }
}
