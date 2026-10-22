import { readBillDelegation } from "../db/queries/billDelegation.js";

export function billDelegationHandler({ authenticated = false, readDetail = readBillDelegation } = {}) {
  return async (req, res) => {
    const { congress, cardId } = req.query;
    const { billType, billNumber } = req.params;
    if (typeof congress !== "string" || !/^[1-9]\d*$/.test(congress) ||
        !Number.isSafeInteger(Number(congress)) || !/^[1-9]\d*$/.test(billNumber) ||
        !Number.isSafeInteger(Number(billNumber)) ||
        !["hr", "s", "hres", "sres", "hjres", "sjres", "hconres", "sconres"].includes(billType) ||
        (cardId !== undefined && (typeof cardId !== "string" || !cardId.trim() || cardId.length > 2048))) {
      return res.status(400).json({ error: "Invalid bill or action identity" });
    }
    try {
      return res.json(await readDetail(authenticated ? req.user : {
        state: req.query.state, district: req.query.district,
      }, { congress: Number(congress), billType, billNumber: Number(billNumber), cardId }));
    } catch (err) {
      const status = err.code === "INVALID_DELEGATION_LOCATION" ? 400 : err.status ?? 503;
      return res.status(status).json({ error: status < 500 ? err.message : "Bill votes could not be loaded. Please retry." });
    }
  };
}
