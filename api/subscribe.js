// api/subscribe.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

  try {
    // upsert by endpoint (insert or update)
    const { error } = await supabase
      .from('subscriptions')
      .upsert({ endpoint: sub.endpoint, subscription: sub }, { onConflict: ['endpoint'] });

    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    console.error('subscribe error', err);
    return res.status(500).json({ success: false, error: err.message || err });
  }
}
