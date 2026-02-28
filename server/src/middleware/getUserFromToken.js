import { getUserById } from "../db/queries/users.js";
import { verifyToken } from "../utils/jwt.js";
import { getUserByClerkId } from "../db/queries/users.js";

export default async function getUserFromToken(req, res, next) {
  const clerkUserId = req.auth?.userId;
  if (!clerkUserId) return next();
  try {
    const user = await getUserByClerkId(clerkUserId);
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).send("Failed to load user.");
  }
}
