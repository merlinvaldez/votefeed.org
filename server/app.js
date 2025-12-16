import express from "express";
const app = express();
export default app;

import districtsRouter from "./src/api/districts.js";
import repRouter from "./src/api/rep.js";

app.use(express.json());

app.use("/districts", districtsRouter);
app.use("/rep", repRouter);

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
