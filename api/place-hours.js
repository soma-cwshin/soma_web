const crypto = require('crypto');
const { getHoursCache, saveHoursCache } = require('./maps-supabase');
const { fetchPlaceHoursFromNaver } = require('./place-hours-core');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');

function isAuthed(req) {
  return (req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`);
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const name = (req.query.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name required' });
  }
  const address = (req.query.address || '').trim();
  const leadId = (req.query.leadId || '').trim();

  try {
    if (leadId) {
      const cached = await getHoursCache(leadId);
      if (cached) {
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.status(200).json({ ...cached, fromCache: true });
      }
    }

    const result = await fetchPlaceHoursFromNaver(name, address);
    if (!result.ok) {
      const status = result.error === 'fetch_failed' ? 500 : 404;
      return res.status(status).json(result);
    }

    if (leadId) {
      await saveHoursCache(leadId, result);
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'fetch_failed', message: err.message || '조회 실패' });
  }
};
