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
} from "../db/queries/interactions.js";
import requireBody from "../middleware/requireBody.js";

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
  requireBody(["user_id", "bill_id", "stance"]),
  async (req, res) => {
    const { user_id, bill_id, stance } = req.body;
    const addedStance = await addStance(user_id, bill_id, stance);
    res.status(201).send(addedStance);
  }
);

router.put(
  "/:interactionId/stance",
  requireBody(["stance"]),
  async (req, res) => {
    const { interactionId } = req.params;
    const { stance } = req.body;
    const updatedStance = await updateStance(interactionId, stance);
    res.status(201).send(updatedStance);
  }
);

router.delete("/:interactionId", async (req, res) => {
  const { interactionId } = req.params;
  const deleted = await removeStanceAndComment(interactionId);
  res.status(201).send(deleted);
});

router.put(
  "/:interactionId/comment",
  requireBody(["user_comment"]),
  async (req, res) => {
    const { interactionId } = req.params;
    const { user_comment } = req.body;
    const addedComment = await updateComment(interactionId, user_comment);
    res.status(201).send(addedComment);
  }
);

router.delete("/:interactionId/comment", async (req, res) => {
  const { interactionId } = req.params;
  const deleted = await deleteComment(interactionId);
  res.status(201).send(deleted);
});
