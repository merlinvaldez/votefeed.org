import express from "express";
const router = express.Router();
export default router;
import { findRepByDistrict } from "../db/queries/reps.js";
import {
  findMemberPolicyAreas,
  findMemberVotes,
} from "../db/queries/houseVotes.js";
import { getAlignmentByUserAndRep } from "../db/queries/interactions.js";
import {
  updateUserDistrict,
  upsertUserByClerkId,
} from "../db/queries/users.js";
import requireBody from "../middleware/requireBody.js";
import requireUser from "../middleware/requireUser.js";

import {
  ADDRESS_NOT_FOUND_CODE,
  ADDRESS_NOT_FOUND_MESSAGE,
} from "../db/queries/districts.js";

router.post("/signup", (_req, res) => {
  return res.status(410).json({
    error: "Legacy /users/signup removed. Use Clerk SignUp at /signup.",
  });
});

router.post("/login", (_req, res) => {
  return res.status(410).json({
    error: "Legacy /users/login removed. Use Clerk SignIn at /login.",
  });
});

router.post(
  "/me/onboarding",
  requireBody(["address", "email", "first_name", "last_name"]),
  async (req, res, next) => {
    try {
      const { userId } = req.auth();
      if (!userId) {
        return res.status(401).send("Unauthorized");
      }
      const { address, email, first_name, last_name } = req.body;
      const user = await upsertUserByClerkId({
        clerk_user_id: userId,
        email,
        first_name,
        last_name,
        address,
      });
      return res.status(201).json(user);
    } catch (err) {
      if (err?.code === ADDRESS_NOT_FOUND_CODE) {
        return res.status(400).send(ADDRESS_NOT_FOUND_MESSAGE);
      }
      if (
        err?.code === "23505" &&
        (err?.constraint === "users_email_key" ||
          String(err?.detail ?? "")
            .toLowerCase()
            .includes("email"))
      ) {
        return res.status(409).json({
          error: "An Account with that email already exists. Please sign in",
        });
      }
      return next(err);
    }
  },
);

router.get("/me", requireUser, (req, res) => {
  const { id, email, first_name, last_name, district, state } = req.user;
  res.json({ id, email, first_name, last_name, district, state });
});

router.get("/me/feed", requireUser, async (req, res) => {
  try {
    const { district, state } = req.user;
    if (!district || !state) {
      return res.status(400).json({ error: "User is missing district/state" });
    }
    const rep = await findRepByDistrict(state, district);
    if (!rep) return res.status(404).json({ error: "No rep for district" });
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const rawOffset = Number.parseInt(req.query.offset, 10);
    const policyArea = String(req.query.policyArea ?? "").trim() || null;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
    const offset =
      Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const [votes, policyAreaSummary] = await Promise.all([
      findMemberVotes(rep.bioguideid, { limit, offset, policyArea }),
      findMemberPolicyAreas(rep.bioguideid),
    ]);
    const alignment = await getAlignmentByUserAndRep(
      req.user.id,
      rep.bioguideid,
    );
    res.json({
      rep,
      votes,
      alignment,
      policyAreas: policyAreaSummary.items,
      totalPolicyCount: policyAreaSummary.totalCount,
      selectedPolicyArea: policyArea,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

router.put(
  "/me/updateDistrict",
  requireUser,
  requireBody(["address"]),
  async (req, res, next) => {
    const { address } = req.body;
    const zipPattern = /\b\d{5}\b/;
    if (!zipPattern.test(String(address).trim())) {
      return res.status(400).send("Enter a 5 digit ZIP code.");
    }
    try {
      const updated = await updateUserDistrict(req.user.id, req.body.address);
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json(updated);
    } catch (err) {
      if (err?.code === ADDRESS_NOT_FOUND_CODE) {
        return res.status(400).send(ADDRESS_NOT_FOUND_MESSAGE);
      }
      return next(err);
    }
  },
);
