'use strict';
const crypto = require('node:crypto');
const catalog = require('../private/soma-review-catalog.json');

// Only the SHA-256 digest of a high-entropy review-only code is deployed.
// Set SOMA_REVIEW_CODE_SHA256 to rotate the code without changing the client.
const DEFAULT_CODE_HASH = 'f6dcc5b57688b432a40b89121e4e1d4e401c544b95b070327dc954c10d2f8469';
const PREFIX = 'soma-review-v1:';
const AREAS = new Set(['general', 'name', 'image', 'instruction', 'coaching', 'dosage', 'safety', 'reference']);
const PRIORITIES = new Set(['normal', 'important', 'urgent']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function authorized(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ') || header.length > 160) return false;
  const expected = process.env.SOMA_REVIEW_CODE_SHA256 || DEFAULT_CODE_HASH;
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const actual = crypto.createHash('sha256').update(header.slice(7)).digest();
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function validItem(body) {
  if (typeof body.library !== 'string' || typeof body.cardId !== 'string') return null;
  if (!Object.hasOwn(catalog, body.library) || !Object.hasOwn(catalog[body.library], body.cardId)) return null;
  return catalog[body.library][body.cardId];
}

function text(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

async function database(query, options = {}) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error('NOT_CONFIGURED');
  return fetch(`${url.replace(/\/$/, '')}/rest/v1/maps_sales_sync?${query}`, {
    ...options,
    signal: AbortSignal.timeout(12000),
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Prefer: options.method === 'POST' ? 'resolution=ignore-duplicates,return=representation' : 'return=representation',
    },
  });
}

function publicRecord(row) {
  const value = row.visit_state;
  if (!row.id?.startsWith(PREFIX) || !value || value.schemaVersion !== 1) return null;
  return value;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  // A file opened directly on the expert's computer has the literal origin "null".
  // No cookies or MAPS session credentials are accepted by this endpoint.
  const origins = new Set(['null', 'https://soma.ai.kr', 'https://www.soma.ai.kr']);
  if (origin && !origins.has(origin)) return res.status(403).json({ error: '이 주소에서는 검토 저장을 사용할 수 없습니다.' });
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  }
  if (!authorized(req)) return res.status(401).json({ error: '검토 코드가 올바르지 않습니다. 전달받은 코드를 확인해 주세요.' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ error: 'MAPS 저장소 연결 설정을 확인해야 합니다.' });

  let body;
  try {
    if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) > 24000) throw new Error();
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch { return res.status(400).json({ error: '요청 형식을 확인해 주세요.' }); }

  try {
    if (body.action === 'session') {
      const check = await database(new URLSearchParams({ id: 'eq.default', select: 'id', limit: '1' }));
      if (!check.ok) throw new Error('DATABASE');
      if (body.verifyWrite === true) {
        // Integration check uses an isolated disposable row, never a review or map row.
        const probeId = `soma-review-check-v1:${crypto.randomUUID()}`;
        const nonce = crypto.randomUUID();
        const probe = await database(new URLSearchParams({ on_conflict: 'id' }), { method: 'POST', body: JSON.stringify({ id: probeId, visit_state: { probe: nonce }, updated_at: new Date().toISOString() }) });
        if (!probe.ok) throw new Error('DATABASE');
        const cleanup = await database(new URLSearchParams({ id: `eq.${probeId}`, select: 'id,visit_state' }), { method: 'DELETE' });
        if (!cleanup.ok) throw new Error('DATABASE');
        const removed = await cleanup.json();
        if (removed.length !== 1 || removed[0].id !== probeId || removed[0].visit_state?.probe !== nonce) throw new Error('DATABASE');
        return res.status(200).json({ ok: true, version: 1, storage: 'maps', writeVerified: true, temporaryRecordRemoved: true });
      }
      return res.status(200).json({ ok: true, version: 1, storage: 'maps' });
    }
    const item = validItem(body);
    if (!item) return res.status(400).json({ error: '알 수 없는 검사·운동입니다. 최신 자료를 열어 주세요.' });
    const itemPrefix = `${PREFIX}${body.library}:${body.cardId}:`;

    if (body.action === 'list') {
      const query = new URLSearchParams({ id: `like.${itemPrefix.replace(/[\\%_]/g, '\\$&')}*`, select: 'id,visit_state,updated_at', order: 'updated_at.desc,id.desc', limit: '51' });
      if (body.before) {
        const { id: beforeId, at } = body.before;
        if (typeof beforeId !== 'string' || !beforeId.startsWith(itemPrefix) || beforeId.length > 200 || !/^[a-zA-Z0-9_:\-.]+$/.test(beforeId) || typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(at) || !Number.isFinite(Date.parse(at))) return res.status(400).json({ error: '목록 위치를 확인해 주세요.' });
        query.set('or', `(updated_at.lt.${at},and(updated_at.eq.${at},id.lt.${beforeId}))`);
      }
      const loaded = await database(query);
      if (!loaded.ok) throw new Error('DATABASE');
      const rows = await loaded.json();
      const visible = rows.slice(0, 50);
      return res.status(200).json({ records: visible.map(publicRecord).filter(Boolean), next: rows.length > 50 ? { id: visible.at(-1).id, at: visible.at(-1).updated_at } : null });
    }

    if (body.action !== 'submit') return res.status(400).json({ error: '지원하지 않는 작업입니다.' });
    const reviewer = text(body.reviewer, 80);
    const proposal = text(body.proposal, 5000);
    if (!reviewer || !proposal || !UUID.test(body.requestId || '') || !AREAS.has(body.area) || !PRIORITIES.has(body.priority) || !['all', '1', '2', '3'].includes(body.stage)) return res.status(400).json({ error: '검토자 이름과 수정 제안 내용을 확인해 주세요.' });
    if (body.contentHash !== item.hash) return res.status(409).json({ error: '검토 자료의 버전이 달라졌습니다. 최신 HTML을 열어 주세요. 작성 중인 내용은 임시저장되어 있습니다.' });

    // One immutable row per request avoids overwriting map state or other reviewers.
    // The fixed request UUID also makes retry after a lost response idempotent.
    const id = itemPrefix + body.requestId;
    const record = { schemaVersion: 1, reviewId: body.requestId, library: body.library, cardId: body.cardId, cardName: item.name, contentHash: item.hash, reviewer, area: body.area, stage: body.stage, priority: body.priority, proposal, createdAt: new Date().toISOString() };
    const saved = await database(new URLSearchParams({ on_conflict: 'id' }), {
      method: 'POST', body: JSON.stringify({ id, visit_state: record, updated_at: record.createdAt }),
    });
    if (!saved.ok) throw new Error('DATABASE');
    const confirmed = await database(new URLSearchParams({ id: `eq.${id}`, select: 'id,visit_state', limit: '1' }));
    if (!confirmed.ok) throw new Error('DATABASE');
    const row = (await confirmed.json())[0];
    const stored = row && publicRecord(row);
    if (!stored) throw new Error('DATABASE');
    if (['reviewer', 'area', 'stage', 'priority', 'proposal', 'contentHash'].some(key => stored[key] !== record[key])) return res.status(409).json({ error: '같은 저장 요청에 다른 내용이 있습니다. 내용을 별도 의견으로 다시 작성해 주세요.' });
    return res.status(200).json({ ok: true, record: stored });
  } catch {
    return res.status(503).json({ error: '서버 저장을 확인하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 저장해 주세요.' });
  }
};
