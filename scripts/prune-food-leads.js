/**
 * leads.json 에서 음식점 오탐 제거 후 chains 재생성
 * node scripts/prune-food-leads.js
 */
const fs = require('fs');
const path = require('path');
const { isFoodLead } = require('./lead-filters');

const LEADS_PATH = path.join(__dirname, '..', 'private', 'leads.json');

const data = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
const before = data.leads.length;
const removed = data.leads.filter(isFoodLead);
data.leads = data.leads.filter(l => !isFoodLead(l));
data.total = data.leads.length;
data.updatedAt = new Date().toISOString().slice(0, 19);

fs.writeFileSync(LEADS_PATH, JSON.stringify(data, null, 2), 'utf8');
console.log(`Removed ${removed.length} food leads (${before} → ${data.total})`);
removed.slice(0, 20).forEach(l => console.log(' -', l.name));

require('child_process').execSync('node scripts/build-map-chains.js', {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});
