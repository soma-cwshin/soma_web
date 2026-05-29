const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');
const LEADS_PATH = path.join(process.cwd(), 'private', 'leads.json');

module.exports = (req, res) => {
  const authed = (req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`);
  if (!authed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const data = fs.readFileSync(LEADS_PATH, 'utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(data);
  } catch {
    return res.status(500).json({ error: 'Data not found' });
  }
};
