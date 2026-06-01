const crypto = require('crypto');
const { getHoursCache, saveHoursCache } = require('./maps-supabase');

const PASSWORD = process.env.MAPS_PASSWORD || 'asdf1234';
const AUTH_TOKEN = crypto.createHash('sha256').update(`${PASSWORD}|soma-maps-v1`).digest('hex');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function isAuthed(req) {
  return (req.headers.cookie || '').includes(`soma_maps_auth=${AUTH_TOKEN}`);
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9가-힣]/g, '');
}

function extractApolloState(html) {
  const marker = 'window.__APOLLO_STATE__';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const brace = html.indexOf('{', html.indexOf('=', start));
  if (brace === -1) return null;
  let depth = 0;
  for (let i = brace; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(brace, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchHtml(url, referer) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml',
      Referer: referer || 'https://map.naver.com/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function scorePlace(item, name, address) {
  const nName = normalize(name);
  const nItem = normalize(item.name);
  let score = 0;
  if (nItem === nName) score += 100;
  else if (nItem.includes(nName) || nName.includes(nItem)) score += 60;
  else {
    const a = nName.slice(0, Math.min(6, nName.length));
    if (a && nItem.includes(a)) score += 25;
  }
  const addr = normalize(address);
  const itemAddr = normalize(item.roadAddress || item.address || item.fullAddress || '');
  if (addr && itemAddr && (itemAddr.includes(addr.slice(0, 10)) || addr.includes(itemAddr.slice(0, 10)))) {
    score += 30;
  }
  return score;
}

function simplifyAddressForSearch(address, name) {
  let addr = String(address || '').trim();
  if (!addr) return '';

  addr = addr
    .replace(/\s+\d+\s*층.*$/u, '')
    .replace(/\s*,\s*\d+\s*층.*$/u, '')
    .replace(/\s+지하\s*\d*\s*층.*$/u, '')
    .replace(/\s+B\d+.*$/i, '')
    .replace(/\s+\d+호.*$/u, '')
    .trim();

  const n = String(name || '').trim();
  if (n && addr.endsWith(n)) {
    addr = addr.slice(0, -n.length).trim();
  }

  return addr;
}

function buildSearchQueries(name, address) {
  const n = name.trim();
  const full = address.trim();
  const simple = simplifyAddressForSearch(full, n);
  const queries = [];

  if (simple) queries.push(`${n} ${simple}`);
  queries.push(n);
  if (full && full !== simple) queries.push(`${n} ${full}`);

  return [...new Set(queries.filter(Boolean))];
}

async function searchPlaceId(name, address) {
  const queries = buildSearchQueries(name, address);
  let lastApollo = null;

  for (const query of queries) {
    const searchUrl = `https://pcmap.place.naver.com/place/list?query=${encodeURIComponent(query)}`;
    const searchHtml = await fetchHtml(searchUrl);
    const searchApollo = extractApolloState(searchHtml);
    if (!searchApollo) continue;
    lastApollo = searchApollo;
    const placeId = findPlaceId(searchApollo, name, address || simplifyAddressForSearch(address, name));
    if (placeId) return { placeId, searchUrl };
  }

  return { placeId: null, searchApollo: lastApollo };
}

function findPlaceId(apollo, name, address) {
  const items = Object.entries(apollo)
    .filter(([k]) => k.startsWith('PlaceListBusinessesItem:'))
    .map(([, v]) => v)
    .filter(v => v && v.id);

  if (!items.length) return null;

  let best = items[0];
  let bestScore = -1;
  for (const item of items) {
    const s = scorePlace(item, name, address);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return bestScore >= 20 ? String(best.id) : String(items[0].id);
}

function resolveRefs(apollo, obj, seen = new Set()) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (obj.__ref) {
    if (seen.has(obj.__ref)) return null;
    seen.add(obj.__ref);
    return resolveRefs(apollo, apollo[obj.__ref], seen);
  }
  if (Array.isArray(obj)) return obj.map(item => resolveRefs(apollo, item, seen));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = resolveRefs(apollo, v, seen);
  }
  return out;
}

function getPlaceDetailNode(apollo, placeId) {
  const root = apollo.ROOT_QUERY;
  if (root) {
    const key = Object.keys(root).find(k => k.startsWith('placeDetail') && k.includes(placeId));
    if (key) return resolveRefs(apollo, root[key]);
  }
  return apollo[`PlaceDetailBase:${placeId}`] || null;
}

function formatDaySchedule(businessHours) {
  if (!Array.isArray(businessHours)) return [];
  return businessHours.map(row => {
    const day = row.day || '';
    const bh = row.businessHours;
    if (bh && bh.start && bh.end) {
      return { day, hours: `${bh.start} - ${bh.end}` };
    }
    if (row.description) {
      const bh = row.businessHours;
      const range = bh && bh.start && bh.end ? `${bh.start} - ${bh.end} · ` : '';
      return { day, hours: `${range}${row.description}`.replace(/^ · /, '') };
    }
    return null;
  }).filter(Boolean);
}

function parseHoursFromDetail(apollo, placeId) {
  const detail = getPlaceDetailNode(apollo, placeId);
  const base = apollo[`PlaceDetailBase:${placeId}`];
  if (!detail && !base) return null;

  const blocks = detail?.newBusinessHours || base?.newBusinessHours;
  if (!Array.isArray(blocks) || !blocks.length) {
    const summaryText =
      detail?.businessHours?.description ||
      base?.businessHours?.description ||
      base?.openingHours ||
      '';
    if (summaryText) {
      return {
        status: '',
        statusDetail: String(summaryText),
        schedule: [],
        note: '',
        placeName: base?.name || detail?.name || '',
        placeId: String(placeId),
      };
    }
    return null;
  }

  const block = blocks[0];
  const desc = block.businessStatusDescription || {};
  const schedule = formatDaySchedule(block.businessHours);
  const note = block.freeText || base?.businessHoursDescription || '';

  return {
    status: desc.status || '',
    statusDetail: desc.description || desc.blindDescription || '',
    schedule,
    note: typeof note === 'string' ? note : '',
    placeName: base?.name || detail?.name || '',
    placeId: String(placeId),
  };
}

async function fetchSummaryHours(placeId) {
  const url = `https://map.naver.com/p/api/place/summary/${placeId}?lang=ko`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://map.naver.com/',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const detail = data?.data?.placeDetail;
  if (!detail?.businessHours?.description) return null;
  return {
    status: '',
    statusDetail: detail.businessHours.description,
    schedule: [],
    note: '',
    placeName: detail.name || '',
    placeId: String(placeId),
  };
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const name = (req.query.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name required' });
  }
  const address = (req.query.address || '').trim();
  const leadId = (req.query.leadId || '').trim();

  try {
    if (leadId) {
      const cached = await getHoursCache(leadId);
      if (cached) {
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.status(200).json({ ...cached, fromCache: true });
      }
    }

    const { placeId, searchUrl, searchApollo } = await searchPlaceId(name, address);
    if (!placeId) {
      if (!searchApollo) {
        return res.status(404).json({ error: 'not_found', message: '네이버 검색 결과를 찾지 못했습니다.' });
      }
      return res.status(404).json({ error: 'not_found', message: '업체를 찾지 못했습니다.' });
    }

    const detailUrl = `https://pcmap.place.naver.com/place/${placeId}/home`;
    const detailHtml = await fetchHtml(detailUrl, searchUrl);
    const detailApollo = extractApolloState(detailHtml);
    if (!detailApollo) {
      return res.status(404).json({ error: 'not_found', message: '상세 정보를 불러오지 못했습니다.' });
    }

    let hours = parseHoursFromDetail(detailApollo, placeId);
    if (!hours || (!hours.status && !hours.statusDetail && !hours.schedule.length && !hours.note)) {
      hours = await fetchSummaryHours(placeId);
    }
    if (!hours || (!hours.status && !hours.statusDetail && !hours.schedule.length && !hours.note)) {
      return res.status(404).json({
        error: 'no_hours',
        message: '영업시간 정보가 없습니다.',
        placeId,
        placeName: detailApollo[`PlaceDetailBase:${placeId}`]?.name || name,
      });
    }

    const payload = { ok: true, ...hours };
    if (leadId) {
      await saveHoursCache(leadId, payload);
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'fetch_failed', message: err.message || '조회 실패' });
  }
};
