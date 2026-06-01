/**
 * 380개 영업 리스트 영업시간 일괄 수집 → soma-maps DB hours_cache 저장
 *
 * 사용 (soma_web 폴더에서):
 *   set MAPS_PASSWORD=asdf1234
 *   set SUPABASE_URL=https://xxxx.supabase.co
 *   set SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   node scripts/prefetch-map-hours.js
 *
 * 주의: 네이버 차단(429) 방지를 위해 3초 간격. 전체 약 20~30분.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const BASE = process.env.MAPS_BASE_URL || 'https://soma.ai.kr';
const DELAY_MS = Number(process.env.PREFETCH_DELAY_MS || 3000);

const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');
const leads = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../private/leads.json'), 'utf8'),
).leads;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function login() {
  const res = await fetch(`${BASE}/api/maps-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/soma_maps_auth=([^;]+)/);
  if (!m) throw new Error('로그인 실패 — MAPS_PASSWORD 확인');
  return `soma_maps_auth=${m[1]}`;
}

async function fetchHours(cookie, lead) {
  const q = new URLSearchParams({
    leadId: lead.id,
    name: lead.name,
    address: lead.address || '',
  });
  const res = await fetch(`${BASE}/api/place-hours?${q}`, {
    headers: { Cookie: cookie },
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  console.log(`대상 ${leads.length}건, 간격 ${DELAY_MS}ms`);
  const cookie = await login();
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    try {
      const { status, data } = await fetchHours(cookie, lead);
      if (status === 200 && data.ok) {
        ok += 1;
        console.log(`[${i + 1}/${leads.length}] OK ${lead.name}`);
      } else {
        fail += 1;
        console.log(`[${i + 1}/${leads.length}] SKIP ${lead.name} — ${data.message || data.error || status}`);
      }
    } catch (err) {
      fail += 1;
      console.log(`[${i + 1}/${leads.length}] ERR ${lead.name} — ${err.message}`);
    }
    if (i < leads.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n완료: 성공 ${ok}, 실패/없음 ${fail}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
