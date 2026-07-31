import { test } from 'node:test';
import assert from 'node:assert/strict';
import extension from '../src/index.js';

const fileId = '11111111-1111-4111-8111-111111111111';

class EmptyQuery {
  join() { return this; }
  leftJoin() { return this; }
  where() { return this; }
  whereRaw() { return this; }
  select() { return this; }
  orderBy() { return this; }
  first() { return Promise.resolve(undefined); }
  then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); }
}

function setup() {
  const routes = new Map();
  const router = { get(path, handler) { routes.set(path, handler); } };
  const db = () => new EmptyQuery();
  extension.handler(router, {
    database: db,
    env: { GM_SCAN_GATING_ENABLED: 'true', GM_PUBLIC_DOWNLOAD_REQUIRE_VERSION: 'true' },
    logger: { warn() {}, error() {} },
  });
  return routes;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
    end() {},
    destroy() {},
  };
}

test('public download rejects a revoked or missing current association without storage access', async () => {
  const handler = setup().get('/downloads/:fileId');
  const res = response();
  await handler({ params: { fileId } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('public download rejects malformed IDs before querying storage', async () => {
  const handler = setup().get('/downloads/:fileId');
  const res = response();
  await handler({ params: { fileId: 'not-an-id' } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});
