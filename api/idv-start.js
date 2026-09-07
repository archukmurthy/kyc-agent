"use strict";
const { createSession } = require("../lib/didit/diditClient");
const store = require("../lib/didit/store");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const ref = req.body && req.body.ref;
  if (!ref) return res.status(400).json({ error: "ref_required" });
  try {
    const session = await createSession({
      vendorData: ref,
      callbackUrl: process.env.DIDIT_CALLBACK_URL,
    });
    store.saveSession(ref, { providerSessionId: session.providerSessionId });
    return res.status(200).json({
      hostedUrl: session.hostedUrl,
      providerSessionId: session.providerSessionId,
    });
  } catch (err) {
    return res.status(502).json({ error: "didit_start_failed", detail: String(err.message || err) });
  }
};
