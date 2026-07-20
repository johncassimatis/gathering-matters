export async function recordTestRun(client, runId, event, metadata = {}) {
  await client.query(
    `INSERT INTO test_run_audit (run_id, event, commit_sha, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      runId,
      event,
      process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
      JSON.stringify(metadata),
    ]
  );
}
