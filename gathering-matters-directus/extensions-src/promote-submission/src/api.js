// extensions/operations/promote-submission/api.js
// Promote an APPROVED submission into a DRAFT content_item in ONE transaction.
// Invoked by a manual "Promote Submission to Content" Flow (accountability: $trigger).
// Depends on V202607 columns: submission.promoted_at/promoted_by, audit_event table.
// ESM to match the current Directus scaffold. If your scaffold emits CommonJS, convert accordingly.
import { createError, ForbiddenError } from '@directus/errors';

const PromotionError = createError('PROMOTION_NOT_ALLOWED', 'Submission cannot be promoted.', 422);

export default {
  id: 'promote-submission',
  handler: async (options, context) => {
    const { submission_id } = options;
    const { database: knex, accountability, env, logger } = context;

    if (!submission_id) {
      throw new PromotionError({ reason: 'submission_id is required' });
    }

    // --- Authorization (server-side; a hidden Studio button is not access control) ---
    if (!accountability?.user) {
      // No authenticated actor => no valid audit attribution. Fail early and clearly.
      throw new ForbiddenError();
    }
    const allowedRoleIds = new Set(
      (env.GM_PROMOTION_ROLE_IDS ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    );
    const isAdmin = accountability.admin === true;
    const isAllowedRole = allowedRoleIds.has(accountability.role);
    if (!isAdmin && !isAllowedRole) {
      throw new ForbiddenError();
    }

    const newContentItemId = await knex.transaction(async (trx) => {
      const submission = await trx('submission')
        .where({ id: submission_id })
        .forUpdate()
        .first();

      if (!submission) throw new PromotionError({ reason: 'submission not found' });
      if (submission.status !== 'approved') {
        throw new PromotionError({ reason: `submission must be 'approved', is '${submission.status}'` });
      }
      if (submission.content_item_id) {
        throw new PromotionError({ reason: 'submission is already linked to a content_item' });
      }
      if (!submission.promotion_content_type_id) {
        throw new PromotionError({ reason: 'promotion_content_type_id is not set' });
      }
      const title = (submission.title || '').trim();
      if (title === '') {
        throw new PromotionError({ reason: 'submission has no usable title' });
      }

      const contentType = await trx('content_type')
        .where({ id: submission.promotion_content_type_id })
        .first();
      if (!contentType || contentType.is_active !== true) {
        throw new PromotionError({ reason: 'destination content_type missing or inactive' });
      }

      const inactiveTags = await trx('submission_tag as st')
        .join('tag as t', 't.id', 'st.tag_id')
        .where('st.submission_id', submission_id)
        .where('t.is_active', false)
        .pluck('t.slug');
      if (inactiveTags.length > 0) {
        throw new PromotionError({
          reason: `replace inactive tags before promotion: ${inactiveTags.join(', ')}`,
        });
      }

      // Create DRAFT content_item; DB default generates the UUIDv7. Copy source (provenance);
      // never copy PII columns or moderation_notes. body is copied but still requires privacy
      // review before publish (enforced by the V202607 publish gate).
      const [contentItem] = await trx('content_item')
        .insert({
          status: 'draft',
          title,
          body: submission.body,
          content_type_id: submission.promotion_content_type_id,
          source: submission.source,
          date_created: trx.fn.now(),
          user_created: accountability.user,
        })
        .returning(['id']);
      const contentItemId = contentItem.id;

      // Copy reviewer-approved (active) tags. Junction id is the DB default (uuidv7()).
      await trx.raw(
        `INSERT INTO content_item_tag (content_item_id, tag_id)
         SELECT ?, st.tag_id
         FROM submission_tag st
         WHERE st.submission_id = ?`,
        [contentItemId, submission_id]
      );

      await trx('submission')
        .where({ id: submission_id })
        .update({
          status: 'promoted',
          content_item_id: contentItemId,
          promoted_at: trx.fn.now(),
          promoted_by: accountability.user,
          date_updated: trx.fn.now(),
          user_updated: accountability.user,
        });

      // Durable audit (Directus activity feed does not capture raw Knex writes).
      await trx('audit_event').insert({
        actor_type: 'user',
        actor_user_id: accountability.user,
        action: 'submission_promoted',
        submission_id,
        content_item_id: contentItemId,
        metadata: JSON.stringify({ promoted_from_status: 'approved', source: submission.source }),
      });

      return contentItemId;
    });

    logger.info(
      { submission_id, content_item_id: newContentItemId, actor_user_id: accountability.user },
      'promote-submission succeeded'
    );
    return { content_item_id: newContentItemId };
  },
};
