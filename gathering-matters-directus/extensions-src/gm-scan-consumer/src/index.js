// gm-scan-consumer: scheduled Directus hook that consumes GuardDuty Malware
// Protection scan-result events from SQS and updates file_scan + folder state.
//
// A valid event can beat the intake transaction to SQS. Such a message is left
// visible for retry and eventually reaches the configured DLQ; it is never
// converted into a synthetic clean result and never deleted as "no record".

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { evaluateScanEvent, decideAction, ALERT_STATUSES } from './scan-event.js';

const on = (v) => v === true || v === 'true';
const numberOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function attr(msg, name) {
  return msg?.Attributes?.[name] ?? null;
}

export async function processScanMessage({ msg, database, cfg, pendingFolder, cleanFolder, logger }) {
  let raw;
  try {
    raw = JSON.parse(msg?.Body || '');
  } catch {
    logger.warn('gm-scan-consumer: malformed JSON message deleted');
    return { ack: true, disposition: 'invalid' };
  }

  const ev = evaluateScanEvent(raw, cfg);
  if (!ev.valid) {
    logger.warn(`gm-scan-consumer: invalid event deleted: ${ev.reason}`);
    return { ack: true, disposition: 'invalid' };
  }

  const result = await database.transaction(async (trx) => {
    const current = await trx('file_scan')
      .where('object_key', ev.objectKey)
      .orderBy('updated_at', 'desc')
      .forUpdate()
      .first();

    if (!current) {
      // The upload flow may still be committing submission_file/file_scan. Do
      // not delete a valid event here; SQS redelivery is the race repair.
      return { ack: false, disposition: 'retry-unmatched' };
    }

    const decision = decideAction(current, ev);
    if (decision.action === 'retry-no-record') {
      return { ack: false, disposition: decision.action };
    }
    if (decision.action !== 'apply') {
      return { ack: true, disposition: decision.action };
    }

    await trx('file_scan').where('id', current.id).update({
      scan_status: ev.status,
      guardduty_event_id: ev.eventId,
      event_time: ev.eventTime,
      object_version_id: ev.versionId || current.object_version_id || null,
      etag: ev.etag || current.etag || null,
      bucket: current.bucket || ev.bucket || null,
      last_processed_at: trx.fn.now(),
      reason: ALERT_STATUSES.has(ev.status) ? ev.status : null,
      updated_at: trx.fn.now(),
    });

    // Every result gets a fail-closed folder. Clean means staff review only;
    // the editorial gate is the only code allowed to make a file public.
    const target = decision.release ? cleanFolder : pendingFolder;
    await trx('directus_files').where('id', current.directus_file_id).update({ folder: target });
    return { ack: true, disposition: 'applied', releasedToStaffReview: decision.release };
  });

  const receiveCount = attr(msg, 'ApproximateReceiveCount');
  const sentTimestamp = Number(attr(msg, 'SentTimestamp'));
  const ageMs = Number.isFinite(sentTimestamp) && sentTimestamp > 0 ? Date.now() - sentTimestamp : null;
  if (!result.ack) {
    logger.warn(`gm-scan-consumer: ${result.disposition}; leaving message for retry (receive=${receiveCount ?? 'unknown'}, age_ms=${ageMs ?? 'unknown'})`);
  }
  return result;
}

export default ({ schedule }, { database, env, logger }) => {
  if (!on(env.GM_SCAN_CONSUMER_ENABLED)) return;

  const queueUrl = env.GM_GUARDDUTY_SCAN_QUEUE_URL;
  const region = env.STORAGE_S3_REGION || env.GM_SCAN_AWS_REGION || 'us-west-2';
  const pendingFolder = env.GM_PENDING_FOLDER_ID;
  const cleanFolder = env.GM_CLEAN_REVIEW_FOLDER_ID;
  const cfg = {
    account: env.GM_SCAN_EXPECTED_ACCOUNT || undefined,
    region,
    bucket: env.STORAGE_S3_BUCKET || undefined,
  };
  const cron = env.GM_SCAN_CONSUMER_CRON || '*/1 * * * *';
  const visibilityTimeout = numberOr(env.GM_SCAN_CONSUMER_VISIBILITY_TIMEOUT, 90);
  const maxReceiveCount = numberOr(env.GM_SCAN_MAX_RECEIVE_COUNT, 5);
  const maxUnmatchedAgeMs = numberOr(env.GM_SCAN_MAX_UNMATCHED_AGE_MS, 15 * 60 * 1000);

  if (!queueUrl || !pendingFolder || !cleanFolder) {
    logger.error('gm-scan-consumer enabled but GM_GUARDDUTY_SCAN_QUEUE_URL / GM_PENDING_FOLDER_ID / GM_CLEAN_REVIEW_FOLDER_ID missing; consumer will not run.');
    return;
  }

  const credentials = (env.STORAGE_S3_KEY && env.STORAGE_S3_SECRET)
    ? { accessKeyId: env.STORAGE_S3_KEY, secretAccessKey: env.STORAGE_S3_SECRET }
    : undefined;
  const sqs = new SQSClient({ region, ...(credentials ? { credentials } : {}) });

  let running = false;
  schedule(cron, async () => {
    if (running) return;
    running = true;
    try {
      const out = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
        VisibilityTimeout: visibilityTimeout,
        AttributeNames: ['ApproximateReceiveCount', 'SentTimestamp', 'ApproximateFirstReceiveTimestamp'],
      }));

      for (const msg of out.Messages || []) {
        try {
          const sent = Number(attr(msg, 'SentTimestamp'));
          const ageMs = Number.isFinite(sent) && sent > 0 ? Date.now() - sent : null;
          const receiveCount = Number(attr(msg, 'ApproximateReceiveCount') || 0);
          const result = await processScanMessage({ msg, database, cfg, pendingFolder, cleanFolder, logger });

          if (!result.ack) {
            // The queue's RedrivePolicy is the bounded retry mechanism. Keep
            // the message unacknowledged so it is retried and then DLQ'd.
            if (receiveCount >= maxReceiveCount || (ageMs != null && ageMs >= maxUnmatchedAgeMs)) {
              logger.warn(`gm-scan-consumer: unmatched event remains unacknowledged at retry bound (receive=${receiveCount}, age_ms=${ageMs ?? 'unknown'}); SQS will redrive it to the DLQ`);
            }
            continue;
          }

          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
        } catch (e) {
          // Database and folder-transition failures deliberately leave the
          // message for redelivery. A delete failure after a durable commit is
          // also safe: the next delivery is idempotent.
          logger.error(`gm-scan-consumer: message processing/delete failed (will retry/DLQ): ${e.message}`);
        }
      }
    } catch (e) {
      logger.error(`gm-scan-consumer: SQS receive failed: ${e.message}`);
    } finally {
      running = false;
    }
  });
};
