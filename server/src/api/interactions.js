import express from "express";
const router = express.Router();
export default router;
import {
  addStance,
  addComment,
  getAllUserInteractions,
  getUserInteractionsByBill,
} from "../db/queries/interactions";
