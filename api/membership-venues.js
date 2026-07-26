const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');

function isAuthed(req) {
  return (req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`);
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const file = path.join(process.cwd(), 'private', 'membership-venues.json');
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load venues' });
  }
};
