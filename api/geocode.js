const crypto = require('crypto');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || '';

module.exports = async (req, res) => {
  const authed = (req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`);
  if (!authed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!KAKAO_KEY) {
    return res.status(503).json({ error: 'KAKAO_REST_API_KEY not configured' });
  }

  const address = (req.query.address || '').trim();
  if (!address) {
    return res.status(400).json({ error: 'address required' });
  }

  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
    const kakaoRes = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    });
    const data = await kakaoRes.json();

    if (data.documents && data.documents.length) {
      const doc = data.documents[0];
      return res.status(200).json({
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x),
        source: 'address',
      });
    }

    const kw = (req.query.keyword || address).trim();
    const kwUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(kw)}`;
    const kwRes = await fetch(kwUrl, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    });
    const kwData = await kwRes.json();

    if (kwData.documents && kwData.documents.length) {
      const doc = kwData.documents[0];
      return res.status(200).json({
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x),
        source: 'keyword',
      });
    }

    return res.status(404).json({ error: 'not found' });
  } catch (err) {
    return res.status(500).json({ error: 'Geocoding failed' });
  }
};
