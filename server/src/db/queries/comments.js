import db from "../client.js";

export async function getCommentByInteractionId(interactionId, runner = db) {
  const sql = `SELECT * FROM bill_comments WHERE interaction_id = $1`;
  const {
    rows: [comment],
  } = await runner.query(sql, [interactionId]);
  return comment ?? null;
}

export async function getCommentById(commentId, runner = db) {
  const sql = `SELECT * FROM bill_comments WHERE id = $1`;
  const {
    rows: [comment],
  } = await runner.query(sql, [commentId]);
  return comment ?? null;
}

export async function upsertDraftComment(
  { interactionId, userId, billId, repBioguideId, draftText },
  runner = db,
) {
  const sql = `
    INSERT INTO bill_comments (
      interaction_id,
      user_id,
      bill_id,
      rep_bioguide_id,
      draft_text,
      moderation_status,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 'draft', now())
    ON CONFLICT (interaction_id) DO UPDATE SET
      draft_text = EXCLUDED.draft_text,
      moderation_status = 'draft',
      moderation_reason = NULL,
      moderation_categories = NULL,
      updated_at = now()
    RETURNING *
  `;
  const {
    rows: [comment],
  } = await runner.query(sql, [
    interactionId,
    userId,
    billId,
    repBioguideId,
    draftText,
  ]);
  return comment;
}

export async function getOrCreateCommentContactDrafts(
  { interactionId, generateDrafts, expectedStance },
  runner = db,
) {
  const { rows: [comment] } = await runner.query(`SELECT c.*, c.updated_at::text AS source_version,
    i.stance AS source_stance FROM bill_comments c
    JOIN interactions i ON i.id = c.interaction_id WHERE c.interaction_id = $1`, [interactionId]);
  if (!comment) return null;
  if (comment.source_stance !== expectedStance) {
    throw Object.assign(new Error("Response changed. Please retry contact drafts."), { status: 409 });
  }

  const approvedText = comment.approved_text?.trim() ?? "";
  const cachedCallScript = comment.call_script?.trim() ?? "";
  const cachedMessageTemplate = comment.message_template?.trim() ?? "";

  if (!approvedText) {
    return null;
  }

  if (cachedCallScript && cachedMessageTemplate) {
    return {
      callScript: cachedCallScript,
      messageTemplate: cachedMessageTemplate,
      source: "cache",
      comment,
    };
  }

  const generatedDrafts = await generateDrafts(comment);
  const callScript = generatedDrafts?.callScript?.trim() ?? "";
  const messageTemplate = generatedDrafts?.messageTemplate?.trim() ?? "";

  if (!callScript || !messageTemplate) {
    throw new Error("Generated contact drafts are incomplete");
  }

  const sql = `
    UPDATE bill_comments
    SET call_script = $2,
        message_template = $3,
        updated_at = now()
    WHERE interaction_id = $1
      AND updated_at::text = $4
      AND EXISTS (SELECT 1 FROM interactions i WHERE i.id = $1 AND i.stance IS NOT DISTINCT FROM $5::text)
    RETURNING call_script, message_template
  `;
  const {
    rows: [savedDrafts],
  } = await runner.query(sql, [interactionId, callScript, messageTemplate, comment.source_version, expectedStance]);
  if (!savedDrafts) {
    throw Object.assign(new Error("Comment or response changed. Please retry contact drafts."), { status: 409 });
  }

  return {
    callScript: savedDrafts?.call_script ?? callScript,
    messageTemplate: savedDrafts?.message_template ?? messageTemplate,
    source: "generated",
    comment,
  };
}

export async function applyCommentModerationResult(
  { interactionId, status, moderationReason, moderationCategories },
  runner = db,
) {
  const sql = `
    UPDATE bill_comments
    SET moderation_status = $2,
        moderation_reason = $3,
        moderation_categories = $4,
        approved_text = CASE
          WHEN $2 = 'approved' THEN draft_text
          ELSE approved_text
        END,
        call_script = CASE
          WHEN $2 = 'approved' THEN NULL
          ELSE call_script
        END,
        message_template = CASE
          WHEN $2 = 'approved' THEN NULL
          ELSE message_template
        END,
        last_submitted_at = now(),
        last_moderated_at = now(),
        updated_at = now()
    WHERE interaction_id = $1
    RETURNING *
  `;
  const {
    rows: [comment],
  } = await runner.query(sql, [
    interactionId,
    status,
    moderationReason,
    moderationCategories,
  ]);
  return comment ?? null;
}

export async function setCommentPublicVisibility(
  { commentId, userId, isPublic },
  runner = db,
) {
  const sql = `
    UPDATE bill_comments
    SET is_public = $3,
        published_at = CASE
          WHEN $3 = true THEN COALESCE(published_at, now())
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = $1
      AND user_id = $2
    RETURNING *
  `;
  const {
    rows: [comment],
  } = await runner.query(sql, [commentId, userId, isPublic]);
  return comment ?? null;
}

export async function listPublicCommentsByBillId(
  billId,
  { viewerUserId = null } = {},
  runner = db,
) {
  const sql = `
    WITH useful_counts AS (
      SELECT
        comment_id,
        COUNT(*)::integer AS useful_count
      FROM comment_useful_votes
      GROUP BY comment_id
    ),
    viewer_votes AS (
      SELECT comment_id
      FROM comment_useful_votes
      WHERE user_id = $2
    )
    SELECT
      bill_comments.id,
      bill_comments.approved_text AS text,
      bill_comments.published_at,
      bill_comments.updated_at,
      COALESCE(NULLIF(TRIM(users.first_name), ''), 'Constituent') AS author_display_name,
      COALESCE(useful_counts.useful_count, 0)::integer AS useful_count,
      CASE
        WHEN $2::integer IS NULL THEN false
        ELSE viewer_votes.comment_id IS NOT NULL
      END AS viewer_has_marked_useful,
      CASE
        WHEN $2::integer IS NULL THEN false
        ELSE bill_comments.user_id = $2
      END AS is_owned_by_viewer
    FROM bill_comments
    JOIN users ON users.id = bill_comments.user_id
    LEFT JOIN useful_counts ON useful_counts.comment_id = bill_comments.id
    LEFT JOIN viewer_votes ON viewer_votes.comment_id = bill_comments.id
    WHERE bill_comments.bill_id = $1
      AND bill_comments.is_public = true
      AND bill_comments.moderation_status = 'approved'
      AND bill_comments.approved_text IS NOT NULL
    ORDER BY
      COALESCE(bill_comments.published_at, bill_comments.updated_at, bill_comments.created_at) DESC,
      bill_comments.id DESC
  `;
  const { rows } = await runner.query(sql, [billId, viewerUserId]);
  return rows;
}

export async function toggleCommentUsefulVote(
  { commentId, userId },
  runner = db,
) {
  const sql = `
    WITH deleted AS (
      DELETE FROM comment_useful_votes
      WHERE comment_id = $1
        AND user_id = $2
      RETURNING 1
    ),
    inserted AS (
      INSERT INTO comment_useful_votes (comment_id, user_id)
      SELECT $1, $2
      WHERE NOT EXISTS (SELECT 1 FROM deleted)
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM inserted) AS viewer_has_marked_useful,
      (
        SELECT COUNT(*)::integer
        FROM comment_useful_votes
        WHERE comment_id = $1
      ) AS useful_count
  `;
  const {
    rows: [summary],
  } = await runner.query(sql, [commentId, userId]);
  return summary ?? { viewer_has_marked_useful: false, useful_count: 0 };
}
