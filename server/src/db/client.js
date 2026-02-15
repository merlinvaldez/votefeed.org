import "dotenv/config"; // load environment variables from .env files
import pg from "pg"; // import pg so we can use Pool for connections

const shouldUseSsl = // decide whether to enable SSL for the DB connection
  process.env.DB_SSL === "true" || process.env.NODE_ENV === "production"; // enable SSL in prod or when DB_SSL is true
const db = new pg.Pool({ // use a pool so idle connections get recycled
  connectionString: process.env.DATABASE_URL, // the Supabase connection string from env
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false, // configure SSL for Supabase
  connectionTimeoutMillis: 5000, // fail fast if a new connection cannot be established
  idleTimeoutMillis: 10000, // close idle connections to avoid stale sockets
  max: 5, // keep a small pool size for serverless usage
}); // end pool configuration
export default db; // export the pool for queries
