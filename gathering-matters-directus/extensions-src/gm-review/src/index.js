// Restricted reviewer metadata endpoint for private submission attachments.
// It intentionally does not return storage fields, GuardDuty internals, or
// file content. Clean file IDs are returned only to explicitly configured
// review-download roles; those roles use Directus' normal authenticated asset
// permission for Clean Staff Review files.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ids(value) {
  return new Set(String(value || '').split(',').map((v) => v.trim()).filter(Boolean));
}

function state(scanStatus) {
  if (scanStatus === 'NO_THREATS_FOUND') return 'CLEAN';
  if (scanStatus === 'PENDING') return 'PENDING';
  return 'UNAVAILABLE';
}

export default {
  id: 'gm-review',
  handler: (router, { database: db, env, logger }) => {
    const reviewRoleIds = ids(env.GM_REVIEW_ROLE_IDS);
    const downloadRoleIds = ids(env.GM_REVIEW_DOWNLOAD_ROLE_IDS || env.GM_REVIEW_ROLE_IDS);

    router.get('/submissions/:submissionId/files', async (req, res) => {
      const submissionId = String(req.params.submissionId || '').trim();
      if (!UUID.test(submissionId)) return res.status(404).json({ error: 'not_found' });

      const accountability = req.accountability;
      const isAdmin = accountability?.admin === true;
      const role = accountability?.role ? String(accountability.role) : '';
      if (!isAdmin && !reviewRoleIds.has(role)) return res.status(403).json({ error: 'forbidden' });

      try {
        const rows = await db('submission_file as sf')
          .join('directus_files as df', 'df.id', 'sf.directus_file_id')
          .leftJoin('file_scan as fs', 'fs.directus_file_id', 'df.id')
          .where('sf.submission_id', submissionId)
          .select(
            'sf.submission_id', 'sf.directus_file_id', 'sf.label', 'sf.sort',
            'df.filename_download', 'df.filesize', 'df.uploaded_on', 'fs.scan_status'
          )
          .orderBy('sf.sort').orderBy('sf.id');

        const canDownloadClean = isAdmin || downloadRoleIds.has(role);
        const data = rows.map((row) => {
          const clean = row.scan_status === 'NO_THREATS_FOUND';
          return {
            submission_id: row.submission_id,
            filename: row.label || row.filename_download || 'attachment',
            size: row.filesize == null ? null : Number(row.filesize),
            uploaded_at: row.uploaded_on || null,
            scan_state: state(row.scan_status),
            ...(clean && canDownloadClean ? { file_id: row.directus_file_id } : {}),
          };
        });

        return res.json({ data });
      } catch (err) {
        logger.error(err, 'gm-review/submissions files failed');
        return res.status(500).json({ error: 'review_unavailable' });
      }
    });
  },
};
