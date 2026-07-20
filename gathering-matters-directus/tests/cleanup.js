export async function cleanupTestData(client, fixtures) {
  await client.query('BEGIN');
  try {
    await client.query(
      `DELETE FROM risk_event WHERE details->>'test_run_id' = $1`,
      [fixtures.runId]
    );

    await client.query(
      `DELETE FROM submission_tag
       WHERE submission_id IN (
         SELECT id FROM submission
         WHERE submitter_email = $1 OR title LIKE $2
       )`,
      [fixtures.email, `${fixtures.rateLimitTitlePrefix}%`]
    );

    await client.query(
      `DELETE FROM submission
       WHERE submitter_email = $1 OR title LIKE $2`,
      [fixtures.email, `${fixtures.rateLimitTitlePrefix}%`]
    );

    await client.query(
      `DELETE FROM content_item_file
       WHERE content_item_id IN (
         SELECT id FROM content_item WHERE slug = ANY($1::text[])
       )`,
      [[fixtures.publishedSlug, fixtures.draftSlug]]
    );

    await client.query(
      `DELETE FROM content_item_tag
       WHERE content_item_id IN (
         SELECT id FROM content_item WHERE slug = ANY($1::text[])
       )`,
      [[fixtures.publishedSlug, fixtures.draftSlug]]
    );

    await client.query(
      `DELETE FROM content_item WHERE slug = ANY($1::text[])`,
      [[fixtures.publishedSlug, fixtures.draftSlug]]
    );

    await client.query(
      `DELETE FROM content_type WHERE slug = $1`,
      [fixtures.contentTypeSlug]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
