import app from "../app.js";
import db from "../src/db/client.js";

let isConnected = false;

if (!isConnected) {
  await db.connect();
  isConnected = true;
}

export default app;
