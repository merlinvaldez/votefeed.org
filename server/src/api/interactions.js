import express from "express";
const router = express.Router();
export default router;
import {
  addStance,
  updateStance,
  removeStanceAndComment,
  deleteComment,
  getAllUserInteractions,
  getUserInteractionsByBill,
  getInteractionById,
} from "../db/queries/interactions.js";
import {
  applyCommentModerationResult,
  getOrCreateCommentContactDrafts,
  getCommentByInteractionId,
  upsertDraftComment,
} from "../db/queries/comments.js";
import { getBillById } from "../db/queries/bills.js";
import { findRepByBioguideId } from "../db/queries/reps.js";
import { getUserById } from "../db/queries/users.js";
import { moderateCommentDraft } from "../ai/commentModeration.js";
import { generateCommentContactDrafts } from "../utils/contactDraftPipeline.js";
import requireBody from "../middleware/requireBody.js";
import requireUser from "../middleware/requireUser.js";

async function getOwnedInteractionsOrSendError(req, res, interactionId) {
  const interaction = await getInteractionById(interactionId);
  if (!interaction) {
    res.status(404).send("Interaction not found");
    return null;
  }
  if (interaction.user_id !== req.user.id) {
    res.status(403).send("Forbidden");
    return null;
  }
  return interaction;
}

router.get("/users/:userId", async (req, res) => {
  const { userId } = req.params;
  const interactions = await getAllUserInteractions(userId);
  res.status(200).send(interactions);
});

router.get("/users/:userId/bill/:billId", async (req, res) => {
  const { userId, billId } = req.params;
  const interactions = await getUserInteractionsByBill(userId, billId);
  res.status(200).send(interactions);
});

router.post(
  "/addstance",
  requireUser,
  requireBody(["bill_id", "rep_bioguide_id", "stance"]),
  async (req, res) => {
    const { bill_id, rep_bioguide_id, stance } = req.body;
    const user_id = req.user.id;
    const addedStance = await addStance(
      user_id,
      bill_id,
      rep_bioguide_id,
      stance,
    );
    res.status(201).send(addedStance);
  },
);

router.put(
  "/:interactionId/stance",
  requireUser,
  requireBody(["stance"]),
  async (req, res) => {
    const { interactionId } = req.params;
    const owned = await getOwnedInteractionsOrSendError(
      req,
      res,
      interactionId,
    );
    if (!owned) return;
    const { stance } = req.body;
    const updatedStance = await updateStance(interactionId, stance);
    res.status(201).send(updatedStance);
  },
);

router.delete("/:interactionId", requireUser, async (req, res) => {
  const { interactionId } = req.params;
  const owned = await getOwnedInteractionsOrSendError(req, res, interactionId);
  if (!owned) return;
  const deleted = await removeStanceAndComment(interactionId);
  res.status(201).send(deleted);
});

router.put(
  "/:interactionId/comment",
  requireUser,
  requireBody(["draft_text"]),
  async (req, res) => {
    const { interactionId } = req.params;
    const owned = await getOwnedInteractionsOrSendError(
      req,
      res,
      interactionId,
    );
    if (!owned) return;
    const { draft_text } = req.body;
    const savedDraft = await upsertDraftComment({
      interactionId,
      userId: req.user.id,
      billId: owned.bill_id,
      repBioguideId: owned.rep_bioguide_id,
      draftText: draft_text,
    });
    res.status(201).send(savedDraft);
  },
);

router.post("/:interactionId/comment/submit", requireUser, async (req, res) => {
  const { interactionId } = req.params;
  const owned = await getOwnedInteractionsOrSendError(req, res, interactionId);
  if (!owned) return;

  const comment = await getCommentByInteractionId(interactionId);
  if (!comment) {
    return res.status(404).send("Comment draft not found");
  }
  if (!comment.draft_text?.trim()) {
    return res.status(400).send("Comment draft is empty");
  }

  let moderationResult;
  try {
    moderationResult = await moderateCommentDraft(comment.draft_text);
  } catch (err) {
    console.error(err);
    return res.status(503).send("Moderation unavailable. Please try again.");
  }

  const moderatedComment = await applyCommentModerationResult({
    interactionId,
    status: moderationResult.status,
    moderationReason: moderationResult.moderationReason,
    moderationCategories: moderationResult.moderationCategories,
  });

  return res.status(200).send(moderatedComment);
});

router.get("/:interactionId/comment/contact-drafts", requireUser, async (req, res) => {
  const { interactionId } = req.params;
  const owned = await getOwnedInteractionsOrSendError(req, res, interactionId);
  if (!owned) return;

  try {
    const [user, rep, bill] = await Promise.all([
      getUserById(owned.user_id),
      findRepByBioguideId(owned.rep_bioguide_id),
      getBillById(owned.bill_id),
    ]);

    if (!user || !rep || !bill) {
      return res.status(404).send("Contact draft context not found");
    }

    const drafts = await getOrCreateCommentContactDrafts({
      interactionId,
      generateDrafts: async (comment) =>
        generateCommentContactDrafts({
          constituentName: [user.first_name, user.last_name]
            .filter(Boolean)
            .join(" ")
            .trim(),
          userState: user.state,
          userDistrict: user.district,
          billType: bill.bill_type,
          billNumber: bill.number,
          repFullName: rep.full_name,
          stance: owned.stance,
          approvedCommentText: comment.approved_text,
        }),
    });

    if (!drafts) {
      return res.status(409).send("Approved comment required");
    }

    return res.status(200).json({
      callScript: drafts.callScript,
      messageTemplate: drafts.messageTemplate,
      source: drafts.source,
    });
  } catch (err) {
    console.error(err);
    return res.status(503).send("Failed to prepare contact drafts");
  }
});

router.delete("/:interactionId/comment", requireUser, async (req, res) => {
  const { interactionId } = req.params;
  const owned = await getOwnedInteractionsOrSendError(req, res, interactionId);
  if (!owned) return;
  const deleted = await deleteComment(interactionId);
  res.status(201).send(deleted);
});
