import db from "../client.js";

// Keep feed totals and the public discussion on exactly the same visibility rule.
const publicVisibility = `bill_comments.is_public = true
  AND bill_comments.moderation_status = 'approved'
  AND bill_comments.approved_text IS NOT NULL`;

function commentDistrict(location) {
  const state = typeof location?.state === "string" ? location.state.trim().replace(/\s+/g, " ") : "";
  const district = location?.district;
  if (!state || !["string", "number"].includes(typeof district) ||
      !/^\d+$/.test(String(district).trim()) || !Number.isSafeInteger(Number(district))) {
    throw Object.assign(new Error("State and a non-negative integer district are required to view comments"), { status: 400 });
  }
  return { state, district: Number(district) };
}

export async function getPublicBillCommentCounts(billIds, runner = db, location) {
  const { state, district } = commentDistrict(location);
  const ids = [...new Set(billIds)];
  if (!ids.length) return new Map();
  const { rows } = await runner.query(`SELECT bill_comments.bill_id, COUNT(*)::integer AS count
    FROM bill_comments
    WHERE bill_comments.bill_id = ANY($1::integer[]) AND ${publicVisibility}
      AND LOWER(BTRIM(bill_comments.district_state)) = LOWER($2) AND bill_comments.district_number = $3
    GROUP BY bill_comments.bill_id`, [ids, state, district]);
  const counts = new Map(ids.map(id => [id, 0]));
  for (const row of rows) counts.set(row.bill_id, row.count);
  return counts;
}

export function sameCommentDistrict(comment, user) {
  return `LOWER(BTRIM(${comment}.district_state)) = LOWER(BTRIM(${user}.state))
    AND ${comment}.district_number = ${user}.district`;
}

export async function getCommentById(commentId, viewerId, runner = db) {
  const sql = `SELECT c.* FROM bill_comments c JOIN users u ON u.id = $2
    WHERE c.id = $1 AND ${sameCommentDistrict("c", "u")}`;
  const {
    rows: [comment],
  } = await runner.query(sql, [commentId, viewerId]);
  return comment ?? null;
}

export async function listOwnedBillComments(userId, billId, runner = db) {
  const { rows } = await runner.query(`SELECT interactions.*,
    c.id AS comment_id, c.draft_text AS comment_draft_text,
    c.approved_text AS comment_approved_text,
    c.moderation_status AS comment_moderation_status,
    c.moderation_reason AS comment_moderation_reason,
    c.is_public AS comment_is_public, c.updated_at AS comment_updated_at,
    reps.full_name AS recipient_name, reps.chamber AS recipient_chamber
    FROM interactions JOIN bill_comments c ON c.interaction_id = interactions.id
      AND c.user_id = interactions.user_id
    JOIN users u ON u.id = c.user_id AND ${sameCommentDistrict("c", "u")}
    LEFT JOIN reps ON reps.bioguideid = interactions.rep_bioguide_id
    WHERE interactions.user_id = $1 AND interactions.bill_id = $2
    ORDER BY c.created_at DESC, c.id DESC`, [userId, billId]);
  return rows;
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
      district_state,
      district_number,
      draft_text,
      moderation_status,
      updated_at
    )
    SELECT $1, users.id, $3, $4, users.state, users.district, $5, 'draft', now()
    FROM users
    WHERE users.id = $2 AND BTRIM(users.state) <> '' AND users.district >= 0
    ON CONFLICT (interaction_id, LOWER(BTRIM(district_state)), district_number) DO UPDATE SET
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
  { interactionId, userId, generateDrafts, expectedStance },
  runner = db,
) {
  const { rows: [comment] } = await runner.query(`SELECT c.*, c.updated_at::text AS source_version,
    i.stance AS source_stance FROM bill_comments c
    JOIN interactions i ON i.id = c.interaction_id AND i.user_id = c.user_id
    JOIN users u ON u.id = c.user_id AND ${sameCommentDistrict("c", "u")}
    WHERE c.interaction_id = $1 AND c.user_id = $2`, [interactionId, userId]);
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
    WHERE id = $1
      AND updated_at::text = $4
      AND EXISTS (SELECT 1 FROM interactions i JOIN users u ON u.id = i.user_id
        WHERE i.id = bill_comments.interaction_id AND i.stance IS NOT DISTINCT FROM $5::text
          AND ${sameCommentDistrict("bill_comments", "u")})
    RETURNING call_script, message_template
  `;
  const {
    rows: [savedDrafts],
  } = await runner.query(sql, [comment.id, callScript, messageTemplate, comment.source_version, expectedStance]);
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
  { commentId, draftText, status, moderationReason, moderationCategories },
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
    WHERE id = $1
      AND draft_text = $5
    RETURNING *
  `;
  const {
    rows: [comment],
  } = await runner.query(sql, [
    commentId,
    status,
    moderationReason,
    moderationCategories,
    draftText,
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
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND ${sameCommentDistrict("bill_comments", "u")})
    RETURNING *
  `;
  const {
    rows: [comment],
  } = await runner.query(sql, [commentId, userId, isPublic]);
  return comment ?? null;
}

export async function listPublicCommentsByBillId(
  billId,
  { viewerUserId = null, location } = {},
  runner = db,
) {
  const { state, district } = commentDistrict(location);
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
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(users.first_name), ''), NULLIF(TRIM(users.last_name), ''))), ''), 'Constituent') AS author_display_name,
      reps.full_name AS recipient_name,
      reps.chamber AS recipient_chamber,
      bill_comments.rep_bioguide_id,
      interactions.member_vote_id,
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
    LEFT JOIN interactions ON interactions.id = bill_comments.interaction_id
    LEFT JOIN reps ON reps.bioguideid = bill_comments.rep_bioguide_id
    LEFT JOIN useful_counts ON useful_counts.comment_id = bill_comments.id
    LEFT JOIN viewer_votes ON viewer_votes.comment_id = bill_comments.id
    WHERE bill_comments.bill_id = $1
      AND ${publicVisibility}
      AND LOWER(BTRIM(bill_comments.district_state)) = LOWER($3) AND bill_comments.district_number = $4
    ORDER BY
      COALESCE(bill_comments.published_at, bill_comments.updated_at, bill_comments.created_at) DESC,
      bill_comments.id DESC
  `;
  const { rows } = await runner.query(sql, [billId, viewerUserId, state, district]);
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
