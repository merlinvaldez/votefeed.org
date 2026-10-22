export function createCommentSubmissionHandler({
  getOwnedInteraction,
  saveDraft,
  moderateDraft,
  applyModerationResult,
  logError = console.error,
}) {
  return async (req, res) => {
    const { interactionId } = req.params;
    const owned = await getOwnedInteraction(req, res, interactionId);
    if (!owned) return;

    const draftText = req.body?.draft_text;
    if (typeof draftText !== "string" || !draftText.trim()) {
      return res.status(400).send("Comment draft is empty");
    }

    const savedDraft = await saveDraft({
      interactionId,
      userId: req.user.id,
      billId: owned.bill_id,
      repBioguideId: owned.rep_bioguide_id,
      draftText,
    });

    let moderationResult;
    try {
      moderationResult = await moderateDraft(savedDraft.draft_text);
    } catch (err) {
      logError(err);
      return res.status(503).send("Moderation unavailable. Please try again.");
    }

    const moderatedComment = await applyModerationResult({
      interactionId,
      draftText: savedDraft.draft_text,
      status: moderationResult.status,
      moderationReason: moderationResult.moderationReason,
      moderationCategories: moderationResult.moderationCategories,
    });

    if (!moderatedComment) {
      return res.status(409).send("Comment changed during moderation. Please submit again.");
    }

    return res.status(200).send(moderatedComment);
  };
}
