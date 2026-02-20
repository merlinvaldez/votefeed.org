import express from "express";
const router = express.Router();
export default router;
import { findRepByDistrict } from "../db/queries/reps.js";
import { findMemberVotes } from "../db/queries/houseVotes.js";
import {
  createUser,
  getUserByEmailAndPassword,
  updateUserDistrict,
} from "../db/queries/users.js";
import requireBody from "../middleware/requireBody.js";
import requireUser from "../middleware/requireUser.js";
import { createToken } from "../utils/jwt.js";

router.post(
  "/signup",
  requireBody(["email", "password", "first_name", "last_name", "address"]),
  async (req, res, next) => {
    try {
      const { email, password, first_name, last_name, address } = req.body;
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const zipPattern = /\b\d{5}\b/;
      if (!emailPattern.test(String(email).trim())) {
        return res.status(400).send("Enter a valid email.");
      }
      if (!zipPattern.test(String(address).trim())) {
        return res.status(400).send("Enter a 5 digit ZIP code.");
      }
      const user = await createUser(
        email,
        password,
        first_name,
        last_name,
        address,
      );
      const token = createToken({ id: user.id });
      return res.status(201).send(token);
    } catch (err) {
      const message = String(err?.message || "Somenthing went wrong.");
      const isAddressError =
        message.includes("No district found") || "District lookup fialed";
      if (isAddressError) {
        return res.status(400)
          .send(`We couldn’t match that address to a voting district.
Please enter a U.S. address recognized by the 2020 Census. If it still doesn’t work, try removing the apartment/unit number or entering a nearby address.`);
      }
      return next(err);
    }
  },
);

router.post("/login", requireBody(["email", "password"]), async (req, res) => {
  const { email, password } = req.body;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(String(email).trim())) {
    return res.status(400).send("Enter a valid email.");
  }
  const user = await getUserByEmailAndPassword(email, password);
  if (!user) return res.status(401).send("Invalid email or password.");
  const token = createToken({ id: user.id });
  res.send(token);
});

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
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const offset =
      Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const votes = await findMemberVotes(rep.bioguideid, { limit, offset });
    res.json({ rep, votes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

router.put(
  "/me/updateDistrict",
  requireUser,
  requireBody(["address"]),
  async (req, res) => {
    const { address } = req.body;

    const updated = await updateUserDistrict(req.user.id, req.body.address);
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json(updated);
  },
);
