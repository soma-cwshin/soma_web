/**
 * leads.json → private/chains.json (3지점+ 브랜드, maps 체인 탭용)
 * 업체명에서 브랜드를 자동 추출 — 화이트리스트 없음
 *
 * node scripts/build-map-chains.js
 */
const fs = require('fs');
const path = require('path');

const LEADS_PATH = path.join(__dirname, '..', 'private', 'leads.json');
const OUT_PATH = path.join(__dirname, '..', 'private', 'chains.json');
const MIN_LOCATIONS = 2;

const BLOCKLIST = new Set([
  '올리브영', '샐러디', '스타벅스', '이디야', '투썸', '맥도날드', '버거킹', '파리바게뜨',
  'cu', 'gs25', '세븐일레븐', '이마트', '다이소', '네일', '미용', '뷰티', '학원', '어린이',
]);

const GENERIC_BRANDS = new Set([
  '헬스', '피티', 'pt', '짐', 'gym', '바디', '센터', '클럽', '스튜디오', '피트니스', '트레이닝',
  '필라테스', 'pilates', '요가', 'yoga', '퍼스널', 'personal', '크로스핏', 'crossfit',
  '여성', '여성전용', '남성', '키즈', '프리미엄', '24시', '24', 'the', 'the짐',
  '스포', '데일리', '라이프', '위드', '보이', '인싸', '더', 'new', 'vip', 'pro',
]);

const BRANCH_TAIL =
  /\s+(?:\d+\s*호?\s*)?(?:[\w가-힣]{1,10}(?:역|본|지)?점|본점|지점|점)\s*$/gi;
const TRAILING_NOISE =
  /\s+(?:pt|피티|헬스|헬스장|피트니스|짐|gym|fitness|휘트니스|필라테스|pilates|요가|yoga|studio|스튜디오|클럽|club|personal|training|트레이닝|샵|shop|센터|center)\b.*$/gi;

/** 긴 브랜드명은 우선 매칭 (표기 통일) */
const KNOWN_BRANDS = [
  '스포애니', '프리원핏', '짐박스피트니스', '짐박스', '헬스보이', '에이블짐', '휘트니스피플',
  '좋은습관', '카인드짐', '바디채널', '휘트니스엠', '버핏그라운드', '와이투짐', '랩스휘트니스',
  '더블에스휘트니스', '더블에스', '휴메이크휘트니스', '비타민휘트니스', '어메이징휘트니스',
  '온플릭휘트니스', '온플릭', '스포벡휘트니스', '스포벡', '건강과땀', '건강해짐', '건강해',
  '1986피트니스', '빌드업피트니스', '원티어피트니스', 'MVM피트니스', '골드스짐', '애니타임',
  '어반필드', '모던필라테스', '바디앤짐', '빌리프짐', '아크로짐', '스포짐', '인싸짐', '엔터핏',
  '빅브로', '커브스', 'F45', 'UFC',
];

function metroArea(addr) {
  const a = String(addr || '');
  if (/서울/.test(a)) return '서울';
  if (/경기/.test(a)) return '경기';
  if (/인천/.test(a)) return '인천';
  return null;
}

function normalizeBrandKey(brand) {
  return String(brand || '').toLowerCase().replace(/\s+/g, '');
}

function detectKnownBrand(name) {
  const n = String(name || '');
  const lower = n.toLowerCase();
  for (const brand of KNOWN_BRANDS.sort((a, b) => b.length - a.length)) {
    if (lower.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

function extractBrand(name) {
  const known = detectKnownBrand(name);
  if (known) return known;

  let s = String(name || '').trim();
  if (!s) return '';

  s = s.split(/\s+[&＆]\s+/)[0].trim();
  s = s.replace(BRANCH_TAIL, '').trim();
  s = s.replace(TRAILING_NOISE, '').trim();
  s = s.replace(BRANCH_TAIL, '').trim();

  const tokens = s.split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';

  const first = tokens[0];
  if (/^[A-Za-z0-9]{2,}$/.test(first)) return first.toUpperCase();
  if (/^[가-힣]{2,12}$/.test(first)) return first;
  if (tokens.length >= 2 && /^[가-힣]{2,}$/.test(tokens[0]) && /^[가-힣]{1,4}$/.test(tokens[1])) {
    return tokens[0] + tokens[1];
  }
  const ko = s.match(/[가-힣]{2,10}/);
  return ko ? ko[0] : first.slice(0, 10);
}

function isFitnessLead(name) {
  if (detectKnownBrand(name)) return true;
  const n = String(name || '').toLowerCase();
  if (/필라테스|pilates|yoga|요가/.test(n) && !/헬스|pt|피티|짐|gym|fitness|휘트니스|건강|스포|트레이닝|땀/.test(n)) {
    return false;
  }
  return true;
}

function looksLikePlaceName(brand) {
  if (/^[가-힣]{2,8}동$/.test(brand)) return true;
  if (/^[가-힣]{2,8}구$/.test(brand)) return true;
  if (/^[가-힣]{2,8}역$/.test(brand)) return true;
  return false;
}

function isValidChain(brand, entries) {
  const key = normalizeBrandKey(brand);
  if (!key || key.length < 2) return false;
  if (BLOCKLIST.has(key) || BLOCKLIST.has(brand)) return false;
  if (GENERIC_BRANDS.has(key)) return false;
  if (looksLikePlaceName(brand)) return false;

  const matchCount = entries.filter(e => e.name.includes(brand) || normalizeBrandKey(e.name).includes(key)).length;
  const minMatch = Math.max(2, Math.ceil(entries.length * 0.45));
  if (matchCount < minMatch) return false;

  if (GENERIC_BRANDS.has(key) || brand.length <= 2) return false;
  return true;
}

function main() {
  const data = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  const leads = data.leads || [];
  const groups = new Map();

  for (const lead of leads) {
    const area = metroArea(lead.address);
    if (!area) continue;
    if (!isFitnessLead(lead.name)) continue;

    const brand = extractBrand(lead.name);
    if (!brand) continue;

    const bKey = normalizeBrandKey(brand);
    if (!groups.has(bKey)) {
      groups.set(bKey, { brand, entries: new Map() });
    }
    const g = groups.get(bKey);
    g.entries.set(lead.id, { id: lead.id, name: lead.name, area });
  }

  const chains = [];
  for (const g of groups.values()) {
    const entries = [...g.entries.values()];
    if (entries.length < MIN_LOCATIONS) continue;
    if (!isValidChain(g.brand, entries)) continue;

    const areas = { 서울: 0, 경기: 0, 인천: 0 };
    entries.forEach(e => { areas[e.area] += 1; });

    chains.push({
      brand: g.brand,
      total: entries.length,
      areas,
      crossMetro: Object.values(areas).filter(n => n > 0).length >= 2,
      leadIds: entries.map(e => e.id),
    });
  }

  chains.sort((a, b) => b.total - a.total || a.brand.localeCompare(b.brand, 'ko'));

  const payload = {
    updatedAt: new Date().toISOString().slice(0, 19),
    minLocations: MIN_LOCATIONS,
    total: chains.length,
    chains,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${chains.length} chains -> ${OUT_PATH}`);

  const sample = ['건강과땀', '스포애니', '프리원핏', '좋은습관'];
  sample.forEach(name => {
    const c = chains.find(x => x.brand === name || normalizeBrandKey(x.brand) === normalizeBrandKey(name));
    console.log(`  ${name}: ${c ? c.total + '지점' : '없음 (데이터 ' + (groups.get(normalizeBrandKey(name))?.entries.size || 0) + '곳)'}`);
  });

  chains.slice(0, 20).forEach((c, i) => {
    console.log(`${i + 1}. ${c.brand} (${c.total}) 서울${c.areas.서울} 경기${c.areas.경기} 인천${c.areas.인천}`);
  });
}

main();
