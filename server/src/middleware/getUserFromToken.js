import { getUserByClerkId } from "../db/queries/users.js";

export default async function getUserFromToken(req, res, next) {
  const clerkUserId = req.auth?.userId;
  if (!clerkUserId) {
    req.user = null;
    return next();
  }
  try {
    const user = await getUserByClerkId(clerkUserId);
    req.user = user ?? null;
    return next();
  } catch (err) {
    return next(err);
  }
}
