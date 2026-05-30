const crypto = require('crypto');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function isAuthed(req) {
  return (req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`);
}

async function supabaseFetch(path, options = {}) {
  if (!SUPABASE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
  });
  return res;
}

const EMPTY = {
  visitState: {},
  routePlan: {},
  coordOverrides: {},
  geocodeSkipped: [],
  updatedAt: null,
};

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_KEY) {
    if (req.method === 'GET') {
      return res.status(200).json({ ...EMPTY, syncAvailable: false });
    }
    return res.status(503).json({ error: 'Sync not configured' });
  }

  try {
    if (req.method === 'GET') {
      const sbRes = await supabaseFetch('maps_sales_sync?id=eq.default&select=*');
      if (!sbRes.ok) {
        return res.status(500).json({ error: 'Failed to load sync data' });
      }
      const rows = await sbRes.json();
      const row = rows[0];
      if (!row) {
        return res.status(200).json({ ...EMPTY, syncAvailable: true });
      }
      return res.status(200).json({
        visitState: row.visit_state || {},
        routePlan: row.route_plan || {},
        coordOverrides: row.coord_overrides || {},
        geocodeSkipped: row.geocode_skipped || [],
        updatedAt: row.updated_at,
        syncAvailable: true,
      });
    }

    if (req.method === 'PUT') {
      let body = {};
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const payload = {
        visit_state: body.visitState || {},
        route_plan: body.routePlan || {},
        coord_overrides: body.coordOverrides || {},
        geocode_skipped: body.geocodeSkipped || [],
        updated_at: new Date().toISOString(),
      };

      const sbRes = await supabaseFetch('maps_sales_sync?id=eq.default', {
        method: 'PATCH',
        prefer: 'return=representation',
        body: JSON.stringify(payload),
      });

      if (sbRes.ok) {
        const rows = await sbRes.json();
        const row = rows[0] || {};
        return res.status(200).json({
          ok: true,
          updatedAt: row.updated_at || payload.updated_at,
        });
      }

      const insertRes = await supabaseFetch('maps_sales_sync', {
        method: 'POST',
        prefer: 'return=representation',
        body: JSON.stringify({ id: 'default', ...payload }),
      });

      if (!insertRes.ok) {
        const errText = await insertRes.text();
        return res.status(500).json({ error: 'Failed to save sync data', detail: errText });
      }

      const rows = await insertRes.json();
      return res.status(200).json({
        ok: true,
        updatedAt: rows[0]?.updated_at || payload.updated_at,
      });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
};
