// extensions/endpoints/gm-intake/index.js
// Public intake endpoint: POST /gm-intake/submissions.
// The public Directus role must not have direct create access to `submission`;
// this endpoint owns workflow and consent fields server-side.
//
// Optional public document attachments (Option A scan-gating) are handled here
// behind GM_PUBLIC_FILE_UPLOADS_ENABLED (default off). Files are validated
// (documents only), stored in the "Pending Malware Scan" folder (no role can
// read that folder), and recorded PENDING in file_scan. Only the async scan
// consumer + editorial workflow can later move a file toward release.
//
// IP-based checks here are best-effort telemetry only. Enforce public abuse
// limits at the edge and through Directus rate limiting.

import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import busboy from 'busboy';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createError } from '@directus/errors';
import { validateDocument, FileRejected } from './file-validation.js';

const BadRequestError = createError('INVALID_REQUEST', 'Invalid submission payload.', 400);
const ValidationError = createError('VALIDATION_FAILED', 'Submission validation failed.', 422);
const PayloadTooLargeError = createError('PAYLOAD_TOO_LARGE', 'Uploaded file(s) exceed the allowed size.', 413);
const RateLimitError  = createError('RATE_LIMITED', 'Too many submissions from this origin.', 429);
const SubmissionError = createError('SUBMISSION_FAILED', 'Submission could not be saved.', 500);

const MAX_TITLE = 160, MAX_BODY = 5000, MAX_NAME = 120, MAX_EMAIL = 254, MAX_PHONE = 32, MAX_UA = 512;
const WINDOW_MINUTES = 60, MAX_PER_WINDOW = 5, DUP_WINDOW_HOURS = 24;
const SOURCES = new Set(['listening_program', 'young_adult_initiative']);
const AGE_RANGES = new Set(['under_18','18_24','25_34','35_44','45_54','55_64','65_plus','prefer_not_to_say']);
const EMAIL_REQUIRED_SOURCES = new Set(['listening_program', 'young_adult_initiative']);
const CONTACT_CONSENT_REQUIRED_SOURCES = new Set(['listening_program', 'young_adult_initiative']);
const FOLLOW_UP_METHODS = new Set(['email', 'phone', 'video']);
const FOLLOW_UP_REQUIRED_SOURCES = new Set(['young_adult_initiative']);

// Upload defaults (overridable via env).
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_FILE_BYTES = 15 * 1024 * 1024;  // 15 MB per document
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB per submission

function s3KeyFor(env, filenameDisk) {
  const root = String(env.STORAGE_S3_ROOT || '').replace(/^\/+|\/+$/g, '');
  const key = String(filenameDisk || '').replace(/^\/+/, '');
  return root ? `${root}/${key}` : key;
}

function normalizeEtag(value) {
  return value == null ? null : String(value).replace(/^"|"$/g, '');
}

async function readObjectIdentity(env, storageLocation, filenameDisk) {
  if (storageLocation !== 's3') return { bucket: null, objectKey: filenameDisk || null, objectVersionId: null, etag: null };

  const bucket = String(env.STORAGE_S3_BUCKET || '').trim();
  const region = String(env.STORAGE_S3_REGION || 'us-west-2');
  if (!bucket) throw new Error('STORAGE_S3_BUCKET is not configured');

  const credentials = env.STORAGE_S3_KEY && env.STORAGE_S3_SECRET
    ? { accessKeyId: env.STORAGE_S3_KEY, secretAccessKey: env.STORAGE_S3_SECRET }
    : undefined;
  const client = new S3Client({ region, ...(credentials ? { credentials } : {}) });
  const head = await client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: s3KeyFor(env, filenameDisk),
  }));

  return {
    bucket,
    objectKey: s3KeyFor(env, filenameDisk),
    objectVersionId: head.VersionId ?? null,
    etag: normalizeEtag(head.ETag),
  };
}

const normalizeTitle = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
function normalizeBody(v) {
  return String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const normalizeInline = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isValidEmail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const hmacHex = (secret, input) => crypto.createHmac('sha256', secret).update(input).digest('hex');
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
// JSON bodies send booleans; multipart sends strings.
const asBool = (v) => v === true || v === 'true';
const flagOn = (v) => v === true || v === 'true';

function getRequestIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

// Parse multipart/form-data into { fields, files, flags } with streaming caps.
// Files are buffered in memory (bounded by the per-file + total caps) so they
// can be validated BEFORE any storage write.
function parseMultipart(req, { maxFiles, maxFileBytes, maxTotalBytes }) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { files: maxFiles, fileSize: maxFileBytes, fields: 40, fieldSize: 1024 * 1024, parts: maxFiles + 60 } });
    } catch (err) { reject(err); return; }
    const fields = {}; const files = [];
    const flags = { tooManyFiles: false, oversizeFile: false, totalExceeded: false, unexpectedFile: false };
    let total = 0, pending = 0, finished = false;
    const done = () => { if (finished && pending === 0) resolve({ fields, files, flags }); };
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('filesLimit', () => { flags.tooManyFiles = true; });
    bb.on('file', (name, stream, info) => {
      if (name !== 'attachments') {
        flags.unexpectedFile = true;
        stream.resume();
        return;
      }
      pending += 1; const chunks = []; let truncated = false;
      stream.on('data', (c) => { total += c.length; if (total > maxTotalBytes) flags.totalExceeded = true; if (!flags.totalExceeded) chunks.push(c); });
      stream.on('limit', () => { truncated = true; flags.oversizeFile = true; });
      stream.on('close', () => { if (!truncated && !flags.totalExceeded) files.push({ filename: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks) }); pending -= 1; done(); });
      stream.on('error', (e) => reject(e));
    });
    bb.on('error', (e) => reject(e));
    req.once('aborted', () => reject(new Error('request aborted')));
    bb.on('close', () => { finished = true; done(); });
    req.pipe(bb);
  });
}

export default {
  id: 'gm-intake',
  handler: (router, { database: db, env, logger, services, getSchema }) => {
    router.post('/submissions', async (req, res, next) => {
      const storedFileIds = [];
      let filesService = null;
      try {
        const secret = env.GM_RISK_HASH_SECRET;
        const reviewNoticeVersion = env.GM_SUBMISSION_CONSENT_VERSION || 'v1';
        const contactNoticeVersion = env.GM_CONTACT_CONSENT_VERSION || reviewNoticeVersion;
        const updatesNoticeVersion = env.GM_UPDATES_CONSENT_VERSION || reviewNoticeVersion;
        if (!secret) throw new SubmissionError({ reason: 'GM_RISK_HASH_SECRET is not configured' });

        // ---- upload feature config ----
        const uploadsEnabled = flagOn(env.GM_PUBLIC_FILE_UPLOADS_ENABLED);
        const maxFiles = Number(env.GM_PUBLIC_UPLOAD_MAX_FILES ?? DEFAULT_MAX_FILES);
        const maxFileBytes = Number(env.GM_PUBLIC_UPLOAD_MAX_BYTES ?? DEFAULT_MAX_FILE_BYTES);
        const maxTotalBytes = Number(env.GM_PUBLIC_UPLOAD_MAX_TOTAL_BYTES ?? DEFAULT_MAX_TOTAL_BYTES);
        const pendingFolderId = String(env.GM_PENDING_FOLDER_ID || '').trim();
        const storageLocation = String(env.STORAGE_LOCATIONS || 'local').split(',')[0].trim() || 'local';

        // ---- read fields (+ files only when the feature is on) ----
        let raw = {}; let uploads = []; let pf = { tooManyFiles: false, oversizeFile: false, totalExceeded: false, unexpectedFile: false };
        if (uploadsEnabled && req.is('multipart/form-data')) {
          if (!isUuid(pendingFolderId)) throw new SubmissionError({ reason: 'GM_PENDING_FOLDER_ID is not configured' });
          let parsed;
          try { parsed = await parseMultipart(req, { maxFiles, maxFileBytes, maxTotalBytes }); }
          catch { throw new BadRequestError({ reason: 'malformed multipart request' }); }
          raw = parsed.fields; uploads = parsed.files; pf = parsed.flags;
        } else {
          raw = req.body ?? {};
        }

        const title = normalizeTitle(raw.title);
        const body = normalizeBody(raw.body);
        const source = normalizeInline(raw.source);
        const submitterName = normalizeInline(raw.submitter_name);
        const submitterEmail = normalizeInline(raw.submitter_email).toLowerCase();
        const submitterPhone = normalizeInline(raw.submitter_phone);
        const submitterAgeRange = normalizeInline(raw.submitter_age_range);
        const honeypot = normalizeInline(raw.website);
        const consentToReview = asBool(raw.consent_to_review);
        const consentToContact = asBool(raw.consent_to_contact);
        const consentToUpdates = asBool(raw.consent_to_updates);
        const preferredFollowUp = normalizeInline(raw.preferred_follow_up).toLowerCase();
        const requestedTestRunId = req.headers['x-gm-test-run-id'];
        const testRunId = env.GM_TEST_MODE === true || env.GM_TEST_MODE === 'true'
          ? (isUuid(requestedTestRunId) ? requestedTestRunId : null) : null;
        const injectedFailure = (env.GM_TEST_MODE === true || env.GM_TEST_MODE === 'true')
          ? String(req.headers['x-gm-test-failure'] || '')
          : '';
        const failIf = (stage) => {
          if (injectedFailure === stage) throw new Error(`GM_TEST_MODE injected failure: ${stage}`);
        };

        const ip = getRequestIp(req);
        const ipHash = ip ? hmacHex(secret, ip) : null;
        const userAgent = String(req.headers['user-agent'] ?? '').slice(0, MAX_UA);
        const fingerprint = hmacHex(secret, `${source}|${title.toLowerCase()}|${body.toLowerCase()}|${submitterEmail}`);
        const riskDetails = () => JSON.stringify({ source, ...(testRunId ? { test_run_id: testRunId } : {}) });
        const logRisk = (event_type, submission_id = null) => db('risk_event').insert({
          submission_id, event_type, ip_hash: ipHash, user_agent: userAgent,
          request_fingerprint: fingerprint, details: riskDetails(), created_at: db.fn.now(),
        });

        // Honeypot short-circuits before any file storage/validation.
        if (honeypot !== '') { await logRisk('honeypot_triggered'); return res.status(202).json({ data: { status: 'accepted' } }); }

        if (!SOURCES.has(source)) throw new BadRequestError({ reason: 'invalid source' });
        if (EMAIL_REQUIRED_SOURCES.has(source) && !submitterEmail) throw new ValidationError({ reason: 'submitter_email is required' });
        if (title.length > MAX_TITLE) throw new ValidationError({ reason: `title max ${MAX_TITLE}` });
        if (body.length < 20 || body.length > MAX_BODY) throw new ValidationError({ reason: `body 20..${MAX_BODY}` });
        if (submitterName.length > MAX_NAME) throw new ValidationError({ reason: `submitter_name max ${MAX_NAME}` });
        if (submitterEmail.length > MAX_EMAIL || !isValidEmail(submitterEmail)) throw new ValidationError({ reason: 'invalid email' });
        if (submitterPhone.length > MAX_PHONE) throw new ValidationError({ reason: `submitter_phone max ${MAX_PHONE}` });
        if (submitterAgeRange && !AGE_RANGES.has(submitterAgeRange)) throw new ValidationError({ reason: 'invalid age_range' });
        if (!consentToReview) throw new ValidationError({ reason: 'consent_to_review must be true' });
        if (CONTACT_CONSENT_REQUIRED_SOURCES.has(source) && !consentToContact) throw new ValidationError({ reason: 'consent_to_contact is required for this source' });
        if (preferredFollowUp && !FOLLOW_UP_METHODS.has(preferredFollowUp)) throw new ValidationError({ reason: 'invalid preferred_follow_up' });
        if (FOLLOW_UP_REQUIRED_SOURCES.has(source) && !preferredFollowUp) throw new ValidationError({ reason: 'preferred_follow_up is required for this source' });
        const hasContactInfo = Boolean(submitterEmail || submitterPhone);

        if (ipHash) {
          const [{ count }] = await db('risk_event').where('ip_hash', ipHash).where('event_type', 'submission_received')
            .where('created_at', '>=', db.raw(`now() - interval '${WINDOW_MINUTES} minutes'`)).count({ count: '*' });
          if (Number(count) >= MAX_PER_WINDOW) { await logRisk('rate_limited'); throw new RateLimitError(); }
        }
        const dup = await db('risk_event').where('request_fingerprint', fingerprint).where('event_type', 'submission_received')
          .where('created_at', '>=', db.raw(`now() - interval '${DUP_WINDOW_HOURS} hours'`)).first('submission_id');
        if (dup) { await logRisk('duplicate_suspected', dup.submission_id); return res.status(202).json({ data: { status: 'accepted' } }); }

        // ---- file guards + validation (after cheap rejections, before storage) ----
        if (pf.oversizeFile) throw new PayloadTooLargeError({ reason: `a file exceeds ${maxFileBytes} bytes` });
        if (pf.totalExceeded) throw new PayloadTooLargeError({ reason: `attachments exceed ${maxTotalBytes} bytes total` });
        if (pf.tooManyFiles || uploads.length > maxFiles) throw new ValidationError({ reason: `max ${maxFiles} attachments` });
        if (pf.unexpectedFile) throw new ValidationError({ reason: 'files must use the attachments field' });
        for (const up of uploads) {
          try { const v = validateDocument({ filename: up.filename, declaredMime: up.mimeType, buffer: up.buffer, maxBytes: maxFileBytes }); up.mime = v.mime; up.safeName = v.safeName; }
          catch (e) { if (e instanceof FileRejected) throw new ValidationError({ reason: `attachment rejected: ${e.reason}` }); throw e; }
        }

        // ---- store files into the Pending folder (no role can read that folder) ----
        if (uploads.length) {
          failIf('files_upload');
          const schema = await getSchema();
           // The public request must not inherit public Directus collection
           // permissions for the storage write. This is a narrow, server-side
           // process action; the endpoint has already performed the complete
           // document validation and always places files in Pending.
           filesService = new services.FilesService({ schema, knex: db, accountability: { admin: true } });
          for (const up of uploads) {
            const fileId = await filesService.uploadOne(Readable.from(up.buffer), {
              storage: storageLocation, filename_download: up.safeName, type: up.mime, title: up.safeName, folder: pendingFolderId,
            });
            storedFileIds.push(fileId); up.fileId = fileId;
          }
        }

        // Test-only failure point: proves that files written before the database
        // transaction are cleaned up if the submission cannot be persisted.
        failIf('submission_insert');

        const contactConsentFields = (hasContactInfo && consentToContact)
          ? { contact_consent: true, contact_consent_at: db.fn.now(), contact_consent_notice_version: contactNoticeVersion }
          : { contact_consent: false, contact_consent_at: null, contact_consent_notice_version: null };
        const updatesConsentFields = consentToUpdates
          ? { updates_consent: true, updates_consent_at: db.fn.now(), updates_consent_notice_version: updatesNoticeVersion }
          : { updates_consent: false, updates_consent_at: null, updates_consent_notice_version: null };

        const submissionId = await db.transaction(async (trx) => {
          const [inserted] = await trx('submission').insert({
            source, body, title: title || null, status: 'pending',
            submitter_name: submitterName || null, submitter_email: submitterEmail || null,
            submitter_phone: submitterPhone || null, submitter_age_range: submitterAgeRange || null,
            preferred_follow_up: preferredFollowUp || null,
            consent: true, consent_at: trx.fn.now(), consent_notice_version: reviewNoticeVersion,
            ...contactConsentFields, ...updatesConsentFields,
            date_created: trx.fn.now(), date_updated: trx.fn.now(),
          }).returning(['id']);

          failIf('submission_insert_after');

          await trx('risk_event').insert({
            submission_id: inserted.id, event_type: 'submission_received',
            ip_hash: ipHash, user_agent: userAgent, request_fingerprint: fingerprint,
            details: riskDetails(), created_at: trx.fn.now(),
          });

          if (uploads.length) {
            // Correlate each stored file to its storage key (S3 object key when on S3).
            const keys = await trx('directus_files').whereIn('id', uploads.map((u) => u.fileId)).select('id', 'filename_disk');
            const keyById = new Map(keys.map((k) => [k.id, k.filename_disk]));
            const identityById = new Map();
            for (const key of keys) {
              identityById.set(key.id, await readObjectIdentity(env, storageLocation, key.filename_disk));
            }
            await trx('submission_file').insert(uploads.map((up, i) => ({ submission_id: inserted.id, directus_file_id: up.fileId, label: up.safeName, sort: i })));
            failIf('submission_file_insert');
            await trx('file_scan').insert(uploads.map((up) => ({
              directus_file_id: up.fileId, origin: 'PUBLIC_SUBMISSION', object_key: identityById.get(up.fileId)?.objectKey || keyById.get(up.fileId) || null,
              bucket: identityById.get(up.fileId)?.bucket || null,
              object_version_id: identityById.get(up.fileId)?.objectVersionId || null,
              etag: identityById.get(up.fileId)?.etag || null,
              scan_status: 'PENDING', created_at: trx.fn.now(), updated_at: trx.fn.now(),
            })));
            failIf('cleanup');
            failIf('file_scan_insert');
          }
          return inserted.id;
        });

        return res.status(201).json({
          data: {
            id: submissionId, status: 'pending', attachment_count: uploads.length,
            message: uploads.length
              ? 'Thanks. Your submission was received and any attachment is being checked before review.'
              : 'Thanks. Your submission has been received for review.',
          },
        });
      } catch (error) {
        // Orphan cleanup: remove any files stored before a later failure.
        if (storedFileIds.length && filesService) {
          for (const id of storedFileIds) {
            try { failIf('cleanup'); await filesService.deleteOne(id); }
            catch (e) { logger.error(e, `gm-intake: failed to clean up orphaned file ${id}`); }
          }
        }
        const code = error.code;
        if (code === 'INVALID_REQUEST' || code === 'VALIDATION_FAILED' || code === 'PAYLOAD_TOO_LARGE' || code === 'RATE_LIMITED') return next(error);
        logger.error(error, 'gm-intake/submissions failed');
        return next(new SubmissionError());
      }
    });
  },
};
