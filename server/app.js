import express from "express";
const app = express();
export default app;

import districtsRouter from "./src/api/districts.js";
import repsRouter from "./src/api/reps.js";
import billsRouter from "./src/api/bills.js";
import houseVotesRouter from "./src/api/houseVotes.js";

app.use(express.json());

app.use("/districts", districtsRouter);
app.use("/reps", repsRouter);
app.use("/bills", billsRouter);
app.use("/housevotes", houseVotesRouter);

app.use((err, req, res, next) => {
  switch (err.code) {
    // Invalid type
    case "22P02":
      return res.status(400).send(err.message);
    // Unique constraint violation
    case "23505":
    // Foreign key violation
    case "23503":
      return res.status(400).send(err.detail);
    default:
      next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Sorry! Something went wrong.");
});
