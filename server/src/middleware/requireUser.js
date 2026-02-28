export default async function requireUser(req, res, next) {
  if (!req.auth?.userId) return res.status(401).send("Unauthorized");
  next();
}
