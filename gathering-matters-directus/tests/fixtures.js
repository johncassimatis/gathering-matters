export function testFixtures() {
  const runId = process.env.TEST_RUN_ID;
  if (!runId) {
    throw new Error('TEST_RUN_ID is required. Run the suite with npm run test:render.');
  }

  return {
    runId,
    contentTypeSlug: `e2e-${runId}-article-type`,
    publishedSlug: `e2e-${runId}-published`,
    draftSlug: `e2e-${runId}-draft`,
    email: `e2e-${runId}@test.invalid`,
    successTitlePrefix: `E2E ${runId} success`,
    duplicateTitlePrefix: `E2E ${runId} duplicate`,
    rateLimitTitlePrefix: `E2E ${runId} rate-limit`,
  };
}
