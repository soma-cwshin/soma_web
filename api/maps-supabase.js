const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function isMapsDbConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function supabaseFetch(path, options = {}) {
  if (!isMapsDbConfigured()) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
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

async function getSyncRow() {
  const sbRes = await supabaseFetch('maps_sales_sync?id=eq.default&select=hours_cache,updated_at');
  if (!sbRes.ok) return null;
  const rows = await sbRes.json();
  return rows[0] || null;
}

const HOURS_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function isFreshHoursEntry(entry) {
  if (!entry || entry.error) return false;
  const at = entry.fetchedAt ? new Date(entry.fetchedAt).getTime() : 0;
  if (!at || Number.isNaN(at)) return false;
  return Date.now() - at < HOURS_CACHE_MAX_AGE_MS;
}

async function getHoursCache(leadId) {
  if (!leadId || !isMapsDbConfigured()) return null;
  const row = await getSyncRow();
  const entry = row?.hours_cache?.[leadId];
  return isFreshHoursEntry(entry) ? entry : null;
}

async function saveHoursCache(leadId, data) {
  if (!leadId || !isMapsDbConfigured()) return;
  const row = await getSyncRow();
  const hours_cache = { ...(row?.hours_cache || {}) };
  hours_cache[leadId] = {
    ...data,
    fetchedAt: new Date().toISOString(),
  };

  const payload = { hours_cache, updated_at: new Date().toISOString() };
  const patchRes = await supabaseFetch('maps_sales_sync?id=eq.default', {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify(payload),
  });

  if (patchRes.ok) return;

  await supabaseFetch('maps_sales_sync', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      id: 'default',
      visit_state: {},
      route_plan: {},
      coord_overrides: {},
      geocode_skipped: [],
      hours_cache,
      updated_at: payload.updated_at,
    }),
  });
}

module.exports = {
  isMapsDbConfigured,
  getHoursCache,
  saveHoursCache,
  HOURS_CACHE_MAX_AGE_MS,
};
