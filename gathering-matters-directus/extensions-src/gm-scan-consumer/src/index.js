// gm-scan-consumer: scheduled Directus hook that consumes GuardDuty Malware
// Protection scan-result events from SQS and updates file_scan + folder state.
//
// Delivery: EventBridge -> SQS (scan-result queue) -> this scheduled consumer.
// (No unauthenticated public webhook.) The queue has a dead-letter queue; failed
// messages are redriven there and alarmed on.
//
// Guarantees:
//   * Idempotent + stale-safe (see scan-event.js decideAction).
//   * A clean result moves a file ONLY from "Pending Malware Scan" to
//     "Clean Staff Review" - never to "Public Downloads".
//   * file_scan update + folder move happen in ONE DB transaction; any failure
//     leaves the file inaccessible (still in Pending). The SQS message is
//     deleted only after the transaction commits, so a crash mid-process just
//     redelivers (at-least-once) and idempotency makes reprocessing harmless.
//   * Never logs credentials or file contents.
//
// Disabled unless GM_SCAN_CONSUMER_ENABLED=true.

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { evaluateScanEvent, decideAction, ALERT_STATUSES } from './scan-event.js';

const on = (v) => v === true || v === 'true';

export default ({ schedule }, { database, env, logger }) => {
  if (!on(env.GM_SCAN_CONSUMER_ENABLED)) return; // feature off: never poll

  const queueUrl = env.GM_GUARDDUTY_SCAN_QUEUE_URL;
  const region = env.STORAGE_S3_REGION || env.GM_SCAN_AWS_REGION || 'us-west-2';
  const pendingFolder = env.GM_PENDING_FOLDER_ID;
  const cleanFolder = env.GM_CLEAN_REVIEW_FOLDER_ID;
  const cfg = { account: env.GM_SCAN_EXPECTED_ACCOUNT || undefined, region, bucket: env.STORAGE_S3_BUCKET || undefined };
  const cron = env.GM_SCAN_CONSUMER_CRON || '*/1 * * * *';

  if (!queueUrl || !pendingFolder || !cleanFolder) {
    logger.error('gm-scan-consumer enabled but GM_GUARDDUTY_SCAN_QUEUE_URL / GM_PENDING_FOLDER_ID / GM_CLEAN_REVIEW_FOLDER_ID missing; consumer will not run.');
    return;
  }

  // Reuse the Directus S3 app credentials (same least-privilege IAM user, now
  // also granted SQS receive/delete on the scan queue). Fall back to the SDK
  // default chain if not set explicitly.
  const credentials = (env.STORAGE_S3_KEY && env.STORAGE_S3_SECRET)
    ? { accessKeyId: env.STORAGE_S3_KEY, secretAccessKey: env.STORAGE_S3_SECRET } : undefined;
  const sqs = new SQSClient({ region, ...(credentials ? { credentials } : {}) });

  let running = false;
  schedule(cron, async () => {
    if (running) return; // no overlapping runs
    running = true;
    try {
      const out = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 2, VisibilityTimeout: 60,
      }));
      for (const msg of out.Messages || []) {
        try {
          await processMessage(msg);
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
        } catch (e) {
          // Leave the message for redelivery -> eventually the dead-letter queue.
          logger.error(`gm-scan-consumer: message processing failed (will retry/DLQ): ${e.message}`);
        }
      }
    } catch (e) {
      logger.error(`gm-scan-consumer: SQS receive failed: ${e.message}`);
    } finally { running = false; }
  });

  async function processMessage(msg) {
    let raw;
    try { raw = JSON.parse(msg.Body); } catch { throw new Error('malformed message body'); }
    // EventBridge wraps the event; detail/source/etc. are at top level for EB->SQS.
    const ev = evaluateScanEvent(raw, cfg);
    if (!ev.valid) { logger.warn(`gm-scan-consumer: invalid event ignored: ${ev.reason}`); return; } // drop invalid (delete)

    await database.transaction(async (trx) => {
      const current = await trx('file_scan').where('object_key', ev.objectKey).forUpdate().first();
      const decision = decideAction(current, ev);
      if (decision.action !== 'apply') {
        logger.info(`gm-scan-consumer: ${decision.action} for ${ev.objectKey} (${ev.status})`);
        return;
      }
      await trx('file_scan').where('id', current.id).update({
        scan_status: ev.status, guardduty_event_id: ev.eventId, event_time: ev.eventTime,
        object_version_id: ev.versionId, etag: ev.etag, last_processed_at: trx.fn.now(),
        reason: ALERT_STATUSES.has(ev.status) ? ev.status : null, updated_at: trx.fn.now(),
      });
      if (decision.release) {
        // Move Pending -> Clean Staff Review, but ONLY if still in Pending (guard).
        await trx('directus_files').where({ id: current.directus_file_id, folder: pendingFolder }).update({ folder: cleanFolder });
      }
      // Non-clean: file stays in Pending (inaccessible). Alerting is via the
      // separate SNS EventBridge rule, not this consumer.
    });
  }
};
