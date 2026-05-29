const crypto = require('crypto');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');

module.exports = (req, res) => {
  const authed = (req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`);
  if (!authed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(200).json({
    kakaoJsKey: process.env.KAKAO_JAVASCRIPT_KEY || '5596f90a80c8ed0b8877c09370d5f29b',
  });
};
