import crypto from 'node:crypto';
import { testFixtures } from './fixtures.js';

export async function seedDatabase(client, fixtures = testFixtures()) {
  const adminUser = await client.query('SELECT id FROM directus_users ORDER BY id LIMIT 1');
  if (adminUser.rowCount === 0) {
    throw new Error('No users found in directus_users; Directus must bootstrap before tests run.');
  }

  const contentTypeId = crypto.randomUUID();
  const publishedId = crypto.randomUUID();
  const draftId = crypto.randomUUID();

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO content_type (id, name, slug, description, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [contentTypeId, `E2E Test Article ${fixtures.runId}`, fixtures.contentTypeSlug, `Automated test run ${fixtures.runId}`]
    );

    await client.query(
      `INSERT INTO content_item (
         id, status, title, slug, summary, body, external_url,
         featured, published_at, author, source, content_type_id,
         editorial_notes, privacy_reviewed_at, privacy_reviewed_by, metadata
       ) VALUES (
         $1, 'published', $2, $3, $4, $5, $6,
         false, '2023-01-01 10:00:00+00', 'Jane Doe', 'gm_upload', $7,
         $8, '2023-01-01 09:00:00+00', $9, $10
       )`,
      [
        publishedId,
        `E2E Published Article ${fixtures.runId}`,
        fixtures.publishedSlug,
        'This is a valid summary.',
        'This body should be hidden in search but visible in detail.',
        'https://example.com',
        contentTypeId,
        'E2E-only editorial note; must never be exposed by the API.',
        adminUser.rows[0].id,
        JSON.stringify({ test_run_id: fixtures.runId }),
      ]
    );

    await client.query(
      `INSERT INTO content_item (
         id, status, title, slug, summary, body, source, content_type_id, metadata
       ) VALUES ($1, 'draft', $2, $3, $4, $5, 'gm_upload', $6, $7)`,
      [
        draftId,
        `E2E Draft Article ${fixtures.runId}`,
        fixtures.draftSlug,
        'Draft summary.',
        'Draft body.',
        contentTypeId,
        JSON.stringify({ test_run_id: fixtures.runId }),
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return { ...fixtures, contentTypeId, publishedId, draftId };
}
