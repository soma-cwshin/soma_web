/**
 * leads.json → private/chains.json (3지점+ 브랜드, maps 체인 탭용)
 * node scripts/build-map-chains.js
 */
const fs = require('fs');
const path = require('path');

const LEADS_PATH = path.join(__dirname, '..', 'private', 'leads.json');
const OUT_PATH = path.join(__dirname, '..', 'private', 'chains.json');
const MIN_LOCATIONS = 3;

const BRAND_RULES = [
  ['스포애니', /스포애니/i],
  ['프리원핏', /프리원핏/i],
  ['짐박스', /짐박스/i],
  ['헬스보이', /헬스보이/i],
  ['에이블짐', /에이블\s*짐|에이블짐/i],
  ['F45', /\bf45\b/i],
  ['휘트니스피플', /휘트니스\s*피플|휘트니스피플/i],
  ['좋은습관', /좋은\s*습관|좋은습관/i],
  ['카인드짐', /카인드\s*짐|카인드짐/i],
  ['커브스', /커브스/i],
  ['바디채널', /바디\s*채널|바디채널/i],
  ['휘트니스엠', /휘트니스\s*[mM]|휘트니스엠/i],
  ['버핏그라운드', /버핏\s*그라운드|버핏그라운드/i],
  ['스포짐', /스포\s*짐|스포짐/i],
  ['아크로짐', /아크로\s*짐|아크로짐/i],
  ['와이투짐', /와이\s*투\s*짐|와이투\s*짐|와이투짐/i],
  ['랩스휘트니스', /랩스\s*휘트니스|랩스휘트니스/i],
  ['더블에스', /더블\s*에스|더블에스/i],
  ['인싸짐', /인싸\s*짐|인싸짐/i],
  ['휴메이크휘트니스', /휴메이크\s*휘트니스|휴메이크휘트니스/i],
  ['빅브로', /빅\s*브로|빅브로/i],
  ['엔터핏', /엔터\s*핏|엔터핏/i],
  ['바디앤짐', /바디\s*[&＆]\s*짐|바디앤\s*짐|바디앤짐/i],
  ['모던필라테스', /모던\s*필라테스|모던필라테스/i],
  ['어반필드', /어반\s*필드|어반필드/i],
  ['빌리프짐', /빌리프\s*짐|빌리프짐/i],
  ['비타민휘트니스', /비타민\s*휘트니스|비타민휘트니스/i],
  ['스포벡', /스포\s*벡|스포벡/i],
  ['온플릭', /온\s*플릭|온플릭/i],
  ['어메이징휘트니스', /어메이징\s*휘트니스|어메이징휘트니스/i],
  ['골드스짐', /골드\s*스\s*짐|gold'?s?\s*gym|골드스짐/i],
  ['애니타임', /애니\s*타임|anytime\s*fitness|애니타임/i],
  ['UFC짐', /\bUFC\b/i],
  ['1986피트니스', /1986\s*피트니스|1986피트니스/i],
  ['빌드업피트니스', /빌드\s*업\s*피트니스|빌드업피트니스/i],
  ['MVM피트니스', /mvm\s*피트니스/i],
  ['원티어', /원\s*티어|원티어/i],
  ['짐퍼스트', /짐\s*퍼스트|짐퍼스트/i],
  ['건강해짐', /건강해\s*짐|건강해짐/i],
];

function metroArea(addr) {
  const a = String(addr || '');
  if (/서울/.test(a)) return '서울';
  if (/경기/.test(a)) return '경기';
  if (/인천/.test(a)) return '인천';
  return null;
}

function detectBrand(name) {
  const n = String(name || '');
  for (const [brand, re] of BRAND_RULES) {
    if (re.test(n)) return brand;
  }
  return null;
}

function main() {
  const data = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  const leads = data.leads || [];
  const groups = new Map();

  for (const lead of leads) {
    const area = metroArea(lead.address);
    if (!area) continue;
    const brand = detectBrand(lead.name);
    if (!brand) continue;
    if (!groups.has(brand)) {
      groups.set(brand, { brand, leadIds: [], areas: { 서울: 0, 경기: 0, 인천: 0 } });
    }
    const g = groups.get(brand);
    g.leadIds.push(lead.id);
    g.areas[area] += 1;
  }

  const chains = [...groups.values()]
    .filter(g => g.leadIds.length >= MIN_LOCATIONS)
    .map(g => ({
      brand: g.brand,
      total: g.leadIds.length,
      areas: g.areas,
      crossMetro: Object.values(g.areas).filter(n => n > 0).length >= 2,
      leadIds: g.leadIds,
    }))
    .sort((a, b) => b.total - a.total || a.brand.localeCompare(b.brand, 'ko'));

  const payload = {
    updatedAt: new Date().toISOString().slice(0, 19),
    minLocations: MIN_LOCATIONS,
    total: chains.length,
    chains,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${chains.length} chains -> ${OUT_PATH}`);
  chains.slice(0, 15).forEach((c, i) => {
    console.log(`${i + 1}. ${c.brand} (${c.total}) 서울${c.areas.서울} 경기${c.areas.경기} 인천${c.areas.인천}`);
  });
}

main();
