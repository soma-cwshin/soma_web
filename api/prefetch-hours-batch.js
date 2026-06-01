const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fetchPlaceHoursFromNaver } = require('./place-hours-core');
const { getSyncRow, saveHoursCache, isMapsDbConfigured, isFreshHoursEntry } = require('./maps-supabase');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');
const LEADS_PATH = path.join(process.cwd(), 'private', 'leads.json');
const DELAY_MS = Number(process.env.PREFETCH_DELAY_MS || 2500);
const MAX_LIMIT = 8;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isPrefetchAuthed(req) {
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.authorization === `Bearer ${cron}`) return true;
  if ((req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`)) return true;
  const secret = process.env.PREFETCH_HOURS_SECRET || PASSWORD;
  const header = req.headers['x-prefetch-secret'] || req.query.secret || '';
  return header === secret;
}

function loadLeads() {
  const raw = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  return raw.leads || raw;
}

module.exports = async (req, res) => {
  if (!isPrefetchAuthed(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isMapsDbConfigured()) {
    return res.status(503).json({ error: 'not_configured', message: 'SUPABASE_URL / SERVICE_ROLE_KEY 미설정' });
  }

  const force = req.query.force === '1';
  const limit = Math.min(Math.max(parseInt(req.query.limit || '3', 10) || 3, 1), MAX_LIMIT);

  try {
    const leads = loadLeads();
    const row = await getSyncRow();
    const cache = row?.hours_cache || {};

    const pending = leads.filter(lead => force || !isFreshHoursEntry(cache[lead.id]));
    const batch = pending.slice(0, limit);
    const results = [];

    for (let i = 0; i < batch.length; i += 1) {
      const lead = batch[i];
      if (i > 0) await sleep(DELAY_MS);

      try {
        const result = await fetchPlaceHoursFromNaver(lead.name, lead.address || '');
        await saveHoursCache(lead.id, result);
        results.push({
          id: lead.id,
          name: lead.name,
          ok: result.ok,
          error: result.ok ? undefined : result.error,
          message: result.ok ? undefined : result.message,
        });
      } catch (err) {
        const fail = { ok: false, error: 'fetch_failed', message: err.message || '조회 실패' };
        await saveHoursCache(lead.id, fail);
        results.push({ id: lead.id, name: lead.name, ok: false, error: fail.error, message: fail.message });
      }
    }

    const remaining = Math.max(0, pending.length - batch.length);
    const cachedCount = leads.length - pending.length;

    return res.status(200).json({
      ok: true,
      total: leads.length,
      cached: cachedCount,
      processed: batch.length,
      remaining,
      done: remaining === 0,
      results,
      hint: remaining > 0 ? '같은 API를 다시 호출하거나 GitHub Actions 워크플로를 실행하세요.' : '전체 수집 완료',
    });
  } catch (err) {
    return res.status(500).json({ error: 'batch_failed', message: err.message || '배치 실패' });
  }
};
