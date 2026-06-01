/**
 * (로컬) 영업시간 일괄 수집 — PC 없이 하려면 GitHub Actions 사용 권장
 *
 * GitHub: Actions → "Prefetch map hours" → Run workflow
 * (repo Secrets에 MAPS_PASSWORD 필요)
 *
 * 로컬 실행:
 *   set MAPS_PASSWORD=asdf1234
 *   node scripts/prefetch-map-hours.js
 */

const fs = require('fs');
const path = require('path');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const BASE = process.env.MAPS_BASE_URL || 'https://soma.ai.kr';

const leads = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../private/leads.json'), 'utf8'),
).leads;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runBatch() {
  const res = await fetch(`${BASE}/api/prefetch-hours-batch?limit=3`, {
    headers: { 'x-prefetch-secret': PASSWORD },
  });
  return res.json();
}

async function main() {
  console.log(`서버 배치 API 사용 (${BASE}), 대상 ${leads.length}건`);
  let round = 0;
  let last = null;

  while (round < 300) {
    round += 1;
    last = await runBatch();
    if (!last.ok && last.error) {
      console.error(last);
      process.exit(1);
    }
    console.log(`[${round}] cached=${last.cached} remaining=${last.remaining}`, last.results?.map(r => `${r.name}:${r.ok ? 'OK' : 'SKIP'}`).join(', '));
    if (last.done || last.remaining === 0) break;
    await sleep(6000);
  }

  console.log('\n완료:', last);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
