import { getUserById } from "../db/queries/users.js";
import { verifyToken } from "../utils/jwt.js";

export default async function getUserFromToken(req, res, next) {
  const authorization = req.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return next();

  const token = authorization.split(" ")[1];
  try {
    const { id } = verifyToken(token);
    const user = await getUserById(id);
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    return res.status(401).send("Invalid token.");
  }
}
