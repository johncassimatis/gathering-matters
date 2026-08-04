import { test } from 'node:test';
import assert from 'node:assert/strict';
import extension from '../src/index.js';

const folders = { GM_PENDING_FOLDER_ID: 'pending', GM_CLEAN_REVIEW_FOLDER_ID: 'review', GM_PUBLIC_DOWNLOADS_FOLDER_ID: 'public' };

class Query {
  constructor(table, state) { this.table = table; this.state = state; }
  where() { return this; }
  whereIn() { return this; }
  join() { return this; }
  leftJoin() { return this; }
  select() { return this; }
  first(...fields) {
    if (this.table === 'file_scan') return Promise.resolve(this.state.scan || undefined);
    if (this.table === 'content_item') return Promise.resolve(this.state.content || undefined);
    if (this.table === 'content_item_file') return Promise.resolve(this.state.association || undefined);
    return Promise.resolve(undefined);
  }
  update(values) {
    this.state.updates.push(values);
    if (this.state.failUpdate) return Promise.reject(new Error('folder update failed'));
    return Promise.resolve(1);
  }
  then(resolve, reject) { return Promise.resolve(this.state.rows || []).then(resolve, reject); }
}

function fakeDb(state) { return (table) => new Query(String(table).split(' ')[0], state); }

function registered(state) {
  const filters = new Map();
  extension({ filter(name, handler) { filters.set(name, handler); } }, {
    database: fakeDb(state), env: { GM_SCAN_GATING_ENABLED: 'true', ...folders }, logger: { error() {} },
  });
  return filters;
}

test('registers the real Directus event names (system collection = files.update, no .items infix)', () => {
  const names = [...registered({ updates: [] }).keys()];
  // directus_files is a SYSTEM collection: Directus emits `files.update`, so the
  // manual public-placement guard MUST register that exact name or it is dead code.
  assert.ok(names.includes('files.update'), `expected files.update to be registered; got ${names.join(', ')}`);
  assert.ok(!names.includes('directus_files.items.update'), 'directus_files.items.update is never emitted by Directus');
  // User collections keep the `<collection>.items.<action>` form.
  assert.ok(names.includes('content_item_file.items.update'));
  assert.ok(names.includes('content_item.items.update'));
});

test('manual public-folder placement is blocked when no clean published download exists', async () => {
  const state = { scan: { origin: 'PUBLIC_SUBMISSION' }, rows: [], updates: [] };
  const handler = registered(state).get('files.update');
  await assert.rejects(
    handler({ folder: 'public' }, { keys: ['file-1'] }, {}),
    /cannot enter the requested public state/,
  );
  assert.deepEqual(state.updates, []);
});

test('folder-transition failure rejects the editorial mutation instead of being swallowed', async () => {
  const state = {
    content: { status: 'published', published_at: new Date(Date.now() - 1000) },
    rows: [{ directus_file_id: 'file-1', is_download: true, scan_status: 'NO_THREATS_FOUND' }],
    updates: [], failUpdate: true,
  };
  const handler = registered(state).get('content_item.items.update');
  await assert.rejects(
    handler({ status: 'published' }, { keys: ['content-1'] }, {}),
    /folder update failed/,
  );
});
