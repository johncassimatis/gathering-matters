// Blocking editorial gate for file release state.
//
// Security-relevant folder transitions run from Directus filter hooks with the
// transaction supplied by Directus. A failed folder update throws and aborts
// the originating editorial mutation; there is no post-commit best-effort path
// that can leave a revoked file public.

import { createError } from '@directus/errors';
import { targetFolderFor } from './publish-gate.js';

const GateError = createError('PUBLIC_FILE_GATE_FAILED', 'The file cannot enter the requested public state.', 422);
const on = (v) => v === true || v === 'true';
const asDate = (value) => value instanceof Date ? value : new Date(value);

function isPublished(ci) {
  return ci && ci.status === 'published' && ci.published_at && !Number.isNaN(asDate(ci.published_at).getTime()) && asDate(ci.published_at) <= new Date();
}

function payloadForKey(payload, key) {
  if (Array.isArray(payload)) return payload.find((row) => String(row.id) === String(key)) || {};
  return payload || {};
}

export default ({ filter }, { database, env, logger }) => {
  if (!on(env.GM_SCAN_GATING_ENABLED)) return;

  const folders = {
    pending: env.GM_PENDING_FOLDER_ID,
    review: env.GM_CLEAN_REVIEW_FOLDER_ID,
    public: env.GM_PUBLIC_DOWNLOADS_FOLDER_ID,
  };
  if (!folders.pending || !folders.review || !folders.public) {
    logger.error('gm-publish-gate enabled but managed folder IDs are incomplete; not registering.');
    return;
  }

  async function isPublicSubmissionFile(trx, fileId) {
    const row = await trx('file_scan').where({ directus_file_id: fileId }).first('origin');
    return row?.origin === 'PUBLIC_SUBMISSION';
  }

  async function moveFile(trx, fileId, target) {
    const updated = await trx('directus_files').where('id', fileId).update({ folder: target });
    if (updated !== 1) throw new GateError({ reason: 'file folder transition did not update exactly one file' });
  }

  async function recomputeForContentItem(trx, ciId, patch = {}) {
    const ci = await trx('content_item').where('id', ciId).first('status', 'published_at', 'featured_image_id');
    if (!ci) return;
    const effective = { ...ci, ...patch };
    const rows = await trx('content_item_file as cif')
      .leftJoin('file_scan as fs', 'fs.directus_file_id', 'cif.directus_file_id')
      .where('cif.content_item_id', ciId)
      .select('cif.directus_file_id', 'cif.is_download', 'fs.scan_status');

    for (const row of rows) {
      const target = targetFolderFor({
        scanStatus: row.scan_status,
        published: isPublished(effective),
        isDownload: row.is_download === true,
        associationActive: true,
      }, folders);
      await moveFile(trx, row.directus_file_id, target);
    }
  }

  async function assertFeaturedImageAllowed(trx, fileId) {
    if (!fileId) return;
    if (await isPublicSubmissionFile(trx, fileId)) {
      throw new GateError({ reason: 'public-submitted documents cannot be featured images' });
    }
  }

  // Publication, unpublication, archiving, and future-dating are all blocked
  // until their attached files have been moved in the same transaction.
  filter('content_item.items.update', async (payload, meta, context) => {
    const trx = context?.database || database;
    for (const key of meta.keys || []) {
      const patch = payloadForKey(payload, key);
      await assertFeaturedImageAllowed(trx, patch.featured_image_id);
      await recomputeForContentItem(trx, key, patch);
    }
    return payload;
  });

  filter('content_item.items.create', async (payload, _meta, context) => {
    const trx = context?.database || database;
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const row of rows) await assertFeaturedImageAllowed(trx, row?.featured_image_id);
    return payload;
  });

  // Deleting a content item cascades its association rows in PostgreSQL, so the
  // association delete hook is not guaranteed to run. Demote first here.
  filter('content_item.items.delete', async (keys, _meta, context) => {
    const trx = context?.database || database;
    const rows = await trx('content_item_file').whereIn('content_item_id', keys).select('directus_file_id');
    for (const row of rows) {
      const scan = await trx('file_scan').where({ directus_file_id: row.directus_file_id }).first('scan_status');
      await moveFile(trx, row.directus_file_id, targetFolderFor({
        scanStatus: scan?.scan_status,
        published: false,
        isDownload: false,
        associationActive: false,
      }, folders));
    }
    return keys;
  });

  filter('content_item_file.items.create', async (payload, _meta, context) => {
    const trx = context?.database || database;
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const row of rows) {
      if (!row?.content_item_id || !row?.directus_file_id) continue;
      const ci = await trx('content_item').where('id', row.content_item_id).first('status', 'published_at');
      const scan = await trx('file_scan').where({ directus_file_id: row.directus_file_id }).first('scan_status');
      await moveFile(trx, row.directus_file_id, targetFolderFor({
        scanStatus: scan?.scan_status,
        published: isPublished(ci),
        isDownload: row.is_download === true,
        associationActive: true,
      }, folders));
    }
    return payload;
  });

  filter('content_item_file.items.update', async (payload, meta, context) => {
    const trx = context?.database || database;
    for (const key of meta.keys || []) {
      const before = await trx('content_item_file').where('id', key).first();
      if (!before) continue;
      const patch = payloadForKey(payload, key);
      const next = { ...before, ...patch };
      const ci = await trx('content_item').where('id', next.content_item_id).first('status', 'published_at');
      const scan = await trx('file_scan').where({ directus_file_id: next.directus_file_id }).first('scan_status');
      await moveFile(trx, next.directus_file_id, targetFolderFor({
        scanStatus: scan?.scan_status,
        published: isPublished(ci),
        isDownload: next.is_download === true,
        associationActive: true,
      }, folders));
    }
    return payload;
  });

  filter('content_item_file.items.delete', async (keys, _meta, context) => {
    const trx = context?.database || database;
    const rows = await trx('content_item_file').whereIn('id', keys).select('directus_file_id');
    for (const row of rows) {
      const scan = await trx('file_scan').where({ directus_file_id: row.directus_file_id }).first('scan_status');
      await moveFile(trx, row.directus_file_id, targetFolderFor({
        scanStatus: scan?.scan_status,
        published: false,
        isDownload: false,
        associationActive: false,
      }, folders));
    }
    return keys;
  });

  // Direct folder edits cannot bypass the editorial state machine. Staff may
  // still manage files through the normal authenticated workflow, but public
  // placement is only valid when every current gate is true.
  filter('directus_files.items.update', async (payload, meta, context) => {
    const trx = context?.database || database;
    for (const fileId of meta.keys || []) {
      const patch = payloadForKey(payload, fileId);
      if (patch.folder !== folders.public) continue;
      if (await isPublicSubmissionFile(trx, fileId)) {
        const rows = await trx('content_item_file as cif')
          .join('content_item as ci', 'ci.id', 'cif.content_item_id')
          .join('file_scan as fs', 'fs.directus_file_id', 'cif.directus_file_id')
          .where('cif.directus_file_id', fileId)
          .where('cif.is_download', true)
          .where('fs.scan_status', 'NO_THREATS_FOUND')
          .select('ci.status', 'ci.published_at');
        if (!rows.some(isPublished)) throw new GateError({ reason: 'public submission file lacks a published downloadable association' });
      } else {
        throw new GateError({ reason: 'manual public folder placement is not allowed; use the editorial association workflow' });
      }
    }
    return payload;
  });
};
