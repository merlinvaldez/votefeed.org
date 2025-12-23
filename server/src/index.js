import "dotenv/config";
import app from "../app.js";
import db from "./db/client.js";
await db.connect();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
