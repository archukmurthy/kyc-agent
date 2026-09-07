"use strict";
const { getDecision } = require("../lib/didit/diditClient");
const { mapDecision } = require("../lib/didit/mapDecision");
const store = require("../lib/didit/store");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const ref = req.body && req.body.ref;
  if (!ref) return res.status(400).json({ error: "ref_required" });
  const session = store.getSession(ref);
  if (!session || !session.providerSessionId) {
    return res.status(404).json({ error: "session_not_found" });
  }
  try {
    const decision = await getDecision(session.providerSessionId);
    const mapped = mapDecision(decision);
    store.saveResult(ref, mapped);
    return res.status(200).json(mapped);
  } catch (err) {
    return res.status(502).json({ error: "didit_result_failed", detail: String(err.message || err) });
  }
};
