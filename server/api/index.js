import app from "../app.js";
import db from "../src/db/client.js";

let connectPromise = null;

async function ensureDbConnected() {
  if (connectPromise) return connectPromise;
  connectPromise = db.connect().catch((err) => {
    connectPromise = null;
    throw err;
  });
  return connectPromise;
}

app.use(async (req, res, next) => {
  try {
    await ensureDbConnected();
    next();
  } catch (err) {
    next(err);
  }
});

export default app;
