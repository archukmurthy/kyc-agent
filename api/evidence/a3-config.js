"use strict";

module.exports = function evidenceA3ConfigHandler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  return res.status(200).json({ stage: "A3", fixtureAvailable: true, liveInterpretation: { database: !!process.env.DATABASE_URL, artifactStorage: !!(process.env.EVIDENCE_ARTIFACT_DIR || process.env.BLOB_READ_WRITE_TOKEN), provider: "anthropic", providerConfigured: !!(process.env.ANTHROPIC_API_KEY && process.env.EVIDENCE_A3_ANTHROPIC_MODEL), modelConfigured: !!process.env.EVIDENCE_A3_ANTHROPIC_MODEL, supportedMediaTypes: ["application/json", "text/html"], screenshotInterpretation: false } });
};
