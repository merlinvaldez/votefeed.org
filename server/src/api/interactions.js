import express from "express";
const router = express.Router();
export default router;
import {
  addStance,
  updateStance,
  removeStanceAndComment,
  deleteComment,
  updateComment,
  getAllUserInteractions,
  getUserInteractionsByBill,
  getInteractionById,
} from "../db/queries/interactions.js";
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
  requireBody(["user_comment"]),
  async (req, res) => {
    const { interactionId } = req.params;
    const owned = await getOwnedInteractionsOrSendError(
      req,
      res,
      interactionId,
    );
    if (!owned) return;
    const { user_comment } = req.body;
    const addedComment = await updateComment(interactionId, user_comment);
    res.status(201).send(addedComment);
  },
);

router.delete("/:interactionId/comment", requireUser, async (req, res) => {
  const { interactionId } = req.params;
  const owned = await getOwnedInteractionsOrSendError(req, res, interactionId);
  if (!owned) return;
  const deleted = await deleteComment(interactionId);
  res.status(201).send(deleted);
});
