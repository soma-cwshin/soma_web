const crypto = require('crypto');

const PASSWORD = process.env.SUBS_PASSWORD || 'qwer1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-subs-v1`).digest('hex');
const SOMA_PROD_URL = process.env.SOMA_PROD_SUPABASE_URL || 'https://qbreoqkdusrrobilwidk.supabase.co';
const INSIGHTS_SECRET = process.env.MAPS_INSIGHTS_SECRET || '';
const DEFAULT_SINCE = '2026-08-10T00:00:00+09:00';

function isAuthed(req) {
  return (req.headers.cookie || '').includes(`soma_subs_auth=${AUTH_TOKEN}`);
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!INSIGHTS_SECRET) {
    return res.status(503).json({ error: 'not_configured', message: 'MAPS_INSIGHTS_SECRET 미설정' });
  }

  const since = (req.query.since || DEFAULT_SINCE).trim() || DEFAULT_SINCE;
  const params = new URLSearchParams({ since });

  try {
    const fnRes = await fetch(`${SOMA_PROD_URL}/functions/v1/subs-trial-dashboard?${params}`, {
      headers: {
        'x-maps-insights-key': INSIGHTS_SECRET,
        'Content-Type': 'application/json',
      },
    });
    const data = await fnRes.json();
    if (!fnRes.ok) {
      return res.status(fnRes.status).json(data);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'fetch_failed', message: err.message || '조회 실패' });
  }
};
