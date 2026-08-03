import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = String(process.env.GM_DISABLED_INTEGRATION_BASE_URL || '').replace(/\/$/, '');

test('public multipart uploads are unavailable when the disabled Directus instance is configured false', async () => {
  const form = new FormData();
  form.append('source', 'listening_program');
  form.append('title', 'Disabled integration test');
  form.append('body', 'This request must not create a submission.');
  form.append('submitter_name', 'Integration Test');
  form.append('submitter_email', 'disabled@example.com');
  form.append('consent_to_review', 'true');
  form.append('consent_to_contact', 'false');
  form.append('attachments', new Blob([Buffer.from('%PDF-1.7\n')], { type: 'application/pdf' }), 'disabled.pdf');
  const response = await fetch(`${BASE}/gm-intake/submissions`, { method: 'POST', body: form });
  assert.notEqual(response.status, 201);
  const text = await response.text();
  for (const value of ['filename_disk', 'storage', 'object_key', 'bucket', 'etag', 'version', 'file_id', 'download_url']) {
    assert.equal(text.toLowerCase().includes(value.toLowerCase()), false, `response leaked ${value}`);
  }
});
