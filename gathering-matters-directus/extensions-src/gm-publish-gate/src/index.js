// gm-publish-gate: keeps each file's folder (release state) consistent with the
// editorial gate whenever content publication or download approval changes.
//
// A file moves to "Public Downloads" ONLY when clean + published + is_download +
// active association (see publish-gate.js). Unpublishing, archiving, or revoking
// is_download recomputes to a less permissive folder immediately. Non-clean files
// always resolve to "Pending Malware Scan". All moves happen in a DB transaction.
//
// Disabled unless GM_SCAN_GATING_ENABLED=true (folder placement then follows the
// scan consumer / editorial workflow only; current behaviour is preserved).

import { targetFolderFor } from './publish-gate.js';

const on = (v) => v === true || v === 'true';

export default ({ action, filter }, { database, env, logger }) => {
  if (!on(env.GM_SCAN_GATING_ENABLED)) return;

  const folders = { pending: env.GM_PENDING_FOLDER_ID, review: env.GM_CLEAN_REVIEW_FOLDER_ID, public: env.GM_PUBLIC_DOWNLOADS_FOLDER_ID };
  if (!folders.pending || !folders.review || !folders.public) {
    logger.error('gm-publish-gate enabled but GM_PENDING_FOLDER_ID / GM_CLEAN_REVIEW_FOLDER_ID / GM_PUBLIC_DOWNLOADS_FOLDER_ID missing; not registering.');
    return;
  }

  const isPublished = (ci) => ci && ci.status === 'published' && ci.published_at && new Date(ci.published_at) <= new Date();

  // Recompute + move all files linked to one content item.
  async function recomputeForContentItem(ciId) {
    await database.transaction(async (trx) => {
      const ci = await trx('content_item').where('id', ciId).first('status', 'published_at');
      const published = isPublished(ci);
      const rows = await trx('content_item_file as cif')
        .leftJoin('file_scan as fs', 'fs.directus_file_id', 'cif.directus_file_id')
        .where('cif.content_item_id', ciId)
        .select('cif.directus_file_id', 'cif.is_download', 'fs.scan_status');
      for (const r of rows) {
        const target = targetFolderFor({ scanStatus: r.scan_status, published, isDownload: r.is_download === true, associationActive: true }, folders);
        await trx('directus_files').where('id', r.directus_file_id).update({ folder: target });
      }
    });
  }

  // Files whose association is being removed -> recompute as unassociated
  // (clean => Clean Staff Review, else Pending), never Public.
  async function demoteFiles(fileIds) {
    if (!fileIds.length) return;
    await database.transaction(async (trx) => {
      const scans = await trx('file_scan').whereIn('directus_file_id', fileIds).select('directus_file_id', 'scan_status');
      const byId = new Map(scans.map((s) => [s.directus_file_id, s.scan_status]));
      for (const id of fileIds) {
        const target = targetFolderFor({ scanStatus: byId.get(id), published: false, isDownload: false, associationActive: false }, folders);
        await trx('directus_files').where('id', id).update({ folder: target });
      }
    });
  }

  const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { logger.error(`gm-publish-gate: ${e.message}`); } };

  action('content_item.items.update', safe(async (meta) => { for (const key of meta.keys || []) await recomputeForContentItem(key); }));
  action('content_item_file.items.create', safe(async (meta) => { const ci = meta.payload?.content_item_id; if (ci) await recomputeForContentItem(ci); }));
  action('content_item_file.items.update', safe(async (meta) => {
    for (const key of meta.keys || []) {
      const row = await database('content_item_file').where('id', key).first('content_item_id');
      if (row) await recomputeForContentItem(row.content_item_id);
    }
  }));
  // Capture file ids before the association rows are deleted, then demote after.
  const pendingDeletes = new Map();
  filter('content_item_file.items.delete', async (keys) => {
    const rows = await database('content_item_file').whereIn('id', keys).select('directus_file_id');
    pendingDeletes.set(JSON.stringify(keys), rows.map((r) => r.directus_file_id));
    return keys;
  });
  action('content_item_file.items.delete', safe(async (meta) => {
    const k = JSON.stringify(meta.keys || []);
    const ids = pendingDeletes.get(k) || [];
    pendingDeletes.delete(k);
    await demoteFiles(ids);
  }));
};
