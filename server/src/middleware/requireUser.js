export default async function requireUser(req, res, next) {
  if (!req.auth?.userId || !req.user) {
    return res.status(401).send("Unauthorized");
  }
  return next();
}
