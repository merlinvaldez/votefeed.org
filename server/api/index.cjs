const appPromise = (async () => {
  // create the Express app once per cold start
  const [{ default: app }, { default: db }] = await Promise.all([
    // load ESM modules in parallel
    import("../app.js"), // import the Express app (ESM module)
    import("../src/db/client.js"), // import the DB client (ESM module)
  ]); // wait for both imports to finish
  let connectPromise = null; // track a single DB connect attempt
  async function ensureDbConnected() {
    // connect once and reuse for later requests
    if (connectPromise) return connectPromise; // reuse the in-flight or completed promise
    connectPromise = db.connect().catch((err) => {
      // start DB connection and catch failures
      connectPromise = null; // allow retry on the next request if it fails
      throw err; // surface the DB error to Express error handling
    }); // end connect attempt
    return connectPromise; // return the connection promise
  } // end ensureDbConnected
  app.use(async (req, res, next) => {
    // middleware runs before all routes
    try {
      await ensureDbConnected(); // make sure DB is ready
      next(); // continue to the route handler
    } catch (err) {
      next(err); // pass DB errors to Express error handler
    }
  }); // end middleware
  return app; // return the initialized app
})(); // kick off initialization immediately

module.exports = async (req, res) => {
  // export a CJS handler for Vercel
  const app = await appPromise; // wait for app initialization
  return app(req, res); // delegate request to Express
}; // end handler
