import express from "express";
const router = express.Router();
export default router;

import {
  getCommentById,
  listPublicCommentsByBillId,
  setCommentPublicVisibility,
  toggleCommentUsefulVote,
} from "../db/queries/comments.js";
import requireBody from "../middleware/requireBody.js";
import requireUser from "../middleware/requireUser.js";

router.get("/bills/:billId/public", async (req, res, next) => {
  try {
    const billId = Number.parseInt(req.params.billId, 10);
    if (!Number.isInteger(billId)) {
      return res.status(400).json({ error: "Invalid bill id" });
    }

    const comments = await listPublicCommentsByBillId(billId, {
      viewerUserId: req.user?.id ?? null,
    });
    return res.json({ comments });
  } catch (err) {
    return next(err);
  }
});

router.put(
  "/:commentId/public",
  requireUser,
  requireBody(["is_public"]),
  async (req, res, next) => {
    try {
      const commentId = String(req.params.commentId ?? "").trim();
      const { is_public: isPublic } = req.body;

      if (!commentId) {
        return res.status(400).json({ error: "Invalid comment id" });
      }
      if (typeof isPublic !== "boolean") {
        return res.status(400).json({ error: "is_public must be a boolean" });
      }

      const comment = await getCommentById(commentId);
      if (!comment) {
        return res.status(404).send("Comment not found");
      }
      if (comment.user_id !== req.user.id) {
        return res.status(403).send("Forbidden");
      }
      if (
        isPublic &&
        (comment.moderation_status !== "approved" ||
          !comment.approved_text?.trim())
      ) {
        return res
          .status(409)
          .send("Approved comment required before making it public");
      }

      const updatedComment = await setCommentPublicVisibility({
        commentId,
        userId: req.user.id,
        isPublic,
      });

      return res.json(updatedComment);
    } catch (err) {
      return next(err);
    }
  },
);

router.put("/:commentId/useful", requireUser, async (req, res, next) => {
  try {
    const commentId = String(req.params.commentId ?? "").trim();
    if (!commentId) {
      return res.status(400).json({ error: "Invalid comment id" });
    }

    const comment = await getCommentById(commentId);
    if (!comment) {
      return res.status(404).send("Comment not found");
    }
    if (
      comment.moderation_status !== "approved" ||
      !comment.is_public ||
      !comment.approved_text?.trim()
    ) {
      return res.status(409).send("Comment is not available for public reactions");
    }
    if (comment.user_id === req.user.id) {
      return res.status(403).send("Cannot mark your own comment as useful");
    }

    const summary = await toggleCommentUsefulVote({
      commentId,
      userId: req.user.id,
    });

    return res.json({
      comment_id: commentId,
      useful_count: summary.useful_count,
      viewer_has_marked_useful: summary.viewer_has_marked_useful,
    });
  } catch (err) {
    return next(err);
  }
});
