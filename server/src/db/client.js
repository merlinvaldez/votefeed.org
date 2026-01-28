import "dotenv/config";
import pg from "pg";

const shouldUseSsl =
  process.env.DB_SSL === "true" || process.env.NODE_ENV === "production";
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
});
export default db;
