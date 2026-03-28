export default async function requireUser(req, res, next) {
  const { userId } = req.auth();
  if (!userId || !req.user) {
    return res.status(401).send("Unauthorized");
  }
  return next();
}
