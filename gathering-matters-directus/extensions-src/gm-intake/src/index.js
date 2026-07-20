// extensions/endpoints/gm-intake/index.js
// Public intake endpoint: POST /gm-intake/submissions.
// The public Directus role must not have direct create access to `submission`;
// this endpoint owns workflow and consent fields server-side.
//
// IP-based checks here are best-effort telemetry only. Enforce public abuse
// limits at the edge and through Directus rate limiting.

import crypto from 'node:crypto';
import { createError } from '@directus/errors';

const BadRequestError = createError('INVALID_REQUEST', 'Invalid submission payload.', 400);
const ValidationError = createError('VALIDATION_FAILED', 'Submission validation failed.', 422);
const RateLimitError  = createError('RATE_LIMITED', 'Too many submissions from this origin.', 429);
const SubmissionError = createError('SUBMISSION_FAILED', 'Submission could not be saved.', 500);

const MAX_TITLE = 160, MAX_BODY = 5000, MAX_NAME = 120, MAX_EMAIL = 254, MAX_PHONE = 32, MAX_UA = 512;
const WINDOW_MINUTES = 60, MAX_PER_WINDOW = 5, DUP_WINDOW_HOURS = 24;
const SOURCES = new Set(['listening_program', 'young_adult_initiative']);
const AGE_RANGES = new Set(['under_18','18_24','25_34','35_44','45_54','55_64','65_plus','prefer_not_to_say']);

const normalizeTitle = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// Preserve paragraph breaks while normalizing line endings and excess whitespace.
function normalizeBody(v) {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const normalizeInline = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isValidEmail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const hmacHex = (secret, input) => crypto.createHmac('sha256', secret).update(input).digest('hex');
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function getRequestIp(req) {
  // Only trustworthy when a controlled proxy overwrites X-Forwarded-For.
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

export default {
  id: 'gm-intake',
  handler: (router, { database: db, env, logger }) => {
    router.post('/submissions', async (req, res, next) => {
      try {
        const secret = env.GM_RISK_HASH_SECRET;
        const reviewNoticeVersion = env.GM_SUBMISSION_CONSENT_VERSION || 'v1';
        const contactNoticeVersion = env.GM_CONTACT_CONSENT_VERSION || reviewNoticeVersion;
        if (!secret) throw new SubmissionError({ reason: 'GM_RISK_HASH_SECRET is not configured' });

        const raw = req.body ?? {};
        const title = normalizeTitle(raw.title);
        const body = normalizeBody(raw.body);
        const source = normalizeInline(raw.source);
        const submitterName = normalizeInline(raw.submitter_name);
        const submitterEmail = normalizeInline(raw.submitter_email).toLowerCase();
        const submitterPhone = normalizeInline(raw.submitter_phone);
        const submitterAgeRange = normalizeInline(raw.submitter_age_range);
        const honeypot = normalizeInline(raw.website);
        const consentToReview = raw.consent_to_review === true;
        const consentToContact = raw.consent_to_contact === true;
        const requestedTestRunId = req.headers['x-gm-test-run-id'];
        const testRunId = env.GM_TEST_MODE === true || env.GM_TEST_MODE === 'true'
          ? (isUuid(requestedTestRunId) ? requestedTestRunId : null)
          : null;

        const ip = getRequestIp(req);
        const ipHash = ip ? hmacHex(secret, ip) : null;
        const userAgent = String(req.headers['user-agent'] ?? '').slice(0, MAX_UA);
        const fingerprint = hmacHex(secret, `${source}|${title.toLowerCase()}|${body.toLowerCase()}|${submitterEmail}`);

        const riskDetails = () => JSON.stringify({
          source,
          ...(testRunId ? { test_run_id: testRunId } : {}),
        });

        const logRisk = (event_type, submission_id = null) =>
          db('risk_event').insert({
            submission_id, event_type, ip_hash: ipHash, user_agent: userAgent,
            request_fingerprint: fingerprint, details: riskDetails(), created_at: db.fn.now(),
          });

        if (honeypot !== '') {
          await logRisk('honeypot_triggered');
          return res.status(202).json({ data: { status: 'accepted' } });
        }

        if (!SOURCES.has(source)) throw new BadRequestError({ reason: 'invalid source' });
        if (title.length < 3 || title.length > MAX_TITLE) throw new ValidationError({ reason: `title 3..${MAX_TITLE}` });
        if (body.length < 20 || body.length > MAX_BODY) throw new ValidationError({ reason: `body 20..${MAX_BODY}` });
        if (submitterName.length > MAX_NAME) throw new ValidationError({ reason: `submitter_name max ${MAX_NAME}` });
        if (submitterEmail.length > MAX_EMAIL || !isValidEmail(submitterEmail)) throw new ValidationError({ reason: 'invalid email' });
        if (submitterPhone.length > MAX_PHONE) throw new ValidationError({ reason: `submitter_phone max ${MAX_PHONE}` });
        if (submitterAgeRange && !AGE_RANGES.has(submitterAgeRange)) throw new ValidationError({ reason: 'invalid age_range' });
        if (!consentToReview) throw new ValidationError({ reason: 'consent_to_review must be true' });
        const hasContactInfo = Boolean(submitterEmail || submitterPhone);
        if (hasContactInfo && !consentToContact) {
          throw new ValidationError({ reason: 'consent_to_contact required when contact info supplied' });
        }

        if (ipHash) {
          const [{ count }] = await db('risk_event')
            .where('ip_hash', ipHash)
            .where('event_type', 'submission_received')
            .where('created_at', '>=', db.raw(`now() - interval '${WINDOW_MINUTES} minutes'`))
            .count({ count: '*' });
          if (Number(count) >= MAX_PER_WINDOW) {
            await logRisk('rate_limited');
            throw new RateLimitError();
          }
        }

        const dup = await db('risk_event')
          .where('request_fingerprint', fingerprint)
          .where('event_type', 'submission_received')
          .where('created_at', '>=', db.raw(`now() - interval '${DUP_WINDOW_HOURS} hours'`))
          .first('submission_id');
        if (dup) {
          await logRisk('duplicate_suspected', dup.submission_id);
          return res.status(202).json({ data: { status: 'accepted' } });
        }

        // Record contact-consent metadata only when the submitter opted in.
        const contactConsentFields = (hasContactInfo && consentToContact)
          ? { contact_consent: true, contact_consent_at: db.fn.now(), contact_consent_notice_version: contactNoticeVersion }
          : { contact_consent: false, contact_consent_at: null, contact_consent_notice_version: null };

        const submissionId = await db.transaction(async (trx) => {
          const [inserted] = await trx('submission')
            .insert({
              source, title, body,
              status: 'pending',
              submitter_name: submitterName || null,
              submitter_email: submitterEmail || null,
              submitter_phone: submitterPhone || null,
              submitter_age_range: submitterAgeRange || null,
              consent: true,
              consent_at: trx.fn.now(),
              consent_notice_version: reviewNoticeVersion,
              ...contactConsentFields,
              date_created: trx.fn.now(),
              date_updated: trx.fn.now(),
            })
            .returning(['id']);

          await trx('risk_event').insert({
            submission_id: inserted.id, event_type: 'submission_received',
            ip_hash: ipHash, user_agent: userAgent, request_fingerprint: fingerprint,
            details: riskDetails(), created_at: trx.fn.now(),
          });

          return inserted.id;
        });

        return res.status(201).json({
          data: {
            id: submissionId,
            status: 'pending',
            message: 'Thanks. Your submission has been received for review.',
          },
        });
      } catch (error) {
        const code = error.extensions?.code;
        if (code === 'INVALID_REQUEST' || code === 'VALIDATION_FAILED' || code === 'RATE_LIMITED') {
          return next(error);
        }

        logger.error(error, 'gm-intake/submissions failed');
        return next(new SubmissionError());
      }
    });
  },
};
