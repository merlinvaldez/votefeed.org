import express from "express";

const router = express.Router();

export default router;

import { createUser, getUserByEmailAndPassword } from "../db/queries/users.js";
import requireBody from "../middleware/requireBody.js";
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
