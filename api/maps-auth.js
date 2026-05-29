const crypto = require('crypto');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (body.password !== PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
  }

  res.setHeader(
    'Set-Cookie',
    `soma_maps_auth=${AUTH_TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
  return res.status(200).json({ ok: true });
};
