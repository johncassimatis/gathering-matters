import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const BASE = String(process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
const FLOW_ID = process.env.GM_PROMOTION_FLOW_ID || '';
const SESSION_COOKIE = process.env.GM_PROMOTION_SESSION_COOKIE || '';
const BEARER_TOKEN = process.env.GM_PROMOTION_BEARER_TOKEN || '';
let cases = {};
try { cases = JSON.parse(process.env.GM_PROMOTION_CASES || '{}'); } catch {}
const LIVE = Boolean(BASE && FLOW_ID && (SESSION_COOKIE || BEARER_TOKEN) && cases.approved);
const skip = LIVE ? {} : { skip: 'set promotion flow, session, and case fixtures' };
let db;

after(async () => { if (db) await db.end(); });

async function promote(submissionId) {
  const response = await fetch(`${BASE}/flows/trigger/${FLOW_ID}`, {
    method: 'POST',
    headers: {
      ...(SESSION_COOKIE ? { cookie: SESSION_COOKIE } : {}),
      ...(BEARER_TOKEN ? { authorization: `Bearer ${BEARER_TOKEN}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ keys: [submissionId] }),
  });
  let body = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}

async function submissionRow(id) {
  const result = await db.query('SELECT status, content_item_id FROM submission WHERE id = $1', [id]);
  return result.rows[0];
}

test('approved submission with no attachment promotes to a draft and emits the existing workflow result', skip, async () => {
  db = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: process.env.TEST_DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await db.connect();
  const result = await promote(cases.approved);
  assert.equal(result.response.status, 200);
  assert.ok(result.body);
  const row = await submissionRow(cases.approved);
  assert.equal(row.status, 'promoted');
  assert.ok(row.content_item_id);
});

for (const state of ['pending', 'threats', 'unsupported', 'failed', 'clean']) {
  test(`promotion leaves ${state} attachment submission-only`, { skip: skip.skip || !cases[state] ? `missing ${state} fixture` : undefined }, async () => {
    const result = await promote(cases[state]);
    assert.equal(result.response.status, 200);
    const row = await submissionRow(cases[state]);
    assert.equal(row.status, 'promoted');
    const attachments = await db.query('SELECT count(*)::int AS count FROM content_item_file WHERE content_item_id = $1', [row.content_item_id]);
    assert.equal(attachments.rows[0].count, 0);
  });
}

test('duplicate promotion and re-promotion remain rejected', { skip: skip.skip || !cases.duplicate ? 'missing duplicate fixture' : undefined }, async () => {
  const first = await promote(cases.duplicate);
  assert.equal(first.response.status, 200);
  const second = await promote(cases.duplicate);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.code, 'PROMOTION_NOT_ALLOWED');
  assert.equal(second.body.status, 422);
  const row = await submissionRow(cases.duplicate);
  const count = await db.query('SELECT count(*)::int AS count FROM content_item WHERE id = $1', [row.content_item_id]);
  assert.equal(count.rows[0].count, 1);
});

test('YAI promotion preserves source/provenance but does not copy attachment links', { skip: skip.skip || !cases.yai ? 'missing yai fixture' : undefined }, async () => {
  const result = await promote(cases.yai);
  assert.equal(result.response.status, 200);
  const row = await submissionRow(cases.yai);
  const item = await db.query('SELECT source, featured_image_id FROM content_item WHERE id = $1', [row.content_item_id]);
  assert.equal(item.rows[0].source, 'young_adult_initiative');
  assert.equal(item.rows[0].featured_image_id, null);
  const attachments = await db.query('SELECT count(*)::int AS count FROM content_item_file WHERE content_item_id = $1', [row.content_item_id]);
  assert.equal(attachments.rows[0].count, 0);
});

test('promotion role gate is enforced by the actual Flow request', { skip: skip.skip || (!process.env.GM_PROMOTION_DENIED_SESSION_COOKIE && !process.env.GM_PROMOTION_DENIED_BEARER_TOKEN) ? 'missing denied role session' : undefined }, async () => {
  const response = await fetch(`${BASE}/flows/trigger/${FLOW_ID}`, {
    method: 'POST',
    headers: {
      ...(process.env.GM_PROMOTION_DENIED_SESSION_COOKIE ? { cookie: process.env.GM_PROMOTION_DENIED_SESSION_COOKIE } : {}),
      ...(process.env.GM_PROMOTION_DENIED_BEARER_TOKEN ? { authorization: `Bearer ${process.env.GM_PROMOTION_DENIED_BEARER_TOKEN}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ keys: [cases.approved] }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.code, 'FORBIDDEN');
  assert.equal(body.status, 403);
});
