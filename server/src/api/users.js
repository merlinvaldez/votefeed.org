import express from "express";

const router = express.Router();

export default router;

import { createUser, getUserByEmailAndPassword } from "../db/queries/users.js";
import requireBody from "../middleware/requireBody.js";
import requireUser from "../middleware/requireUser.js";
import { createToken } from "../utils/jwt.js";

router.post(
  "/signup",
  requireBody(["email", "password", "first_name", "last_name", "address"]),
  async (req, res) => {
    const { email, password, first_name, last_name, address } = req.body;
    const user = await createUser(
      email,
      password,
      first_name,
      last_name,
      address
    );
    const token = createToken({ id: user.id });
    res.status(201).send(token);
  }
);

router.post("/login", requireBody(["email", "password"]), async (req, res) => {
  const { email, password } = req.body;
  const user = await getUserByEmailAndPassword(email, password);
  if (!user) return res.status(401).send("Invalid username or password.");
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
    const { votes = [] } = await findMemberVotes(rep.bioguideid);
    res.json({ rep, votes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load feed" });
  }
});
