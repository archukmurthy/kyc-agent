"use strict";

const { browserAvailable } = require("../../evidence/a2/websiteCapture");

module.exports = function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  return res.status(200).json({
    stage: "A2",
    live: {
      companiesHouseApi: !!process.env.COMPANIES_HOUSE_API_KEY,
      database: !!process.env.DATABASE_URL,
      durableArtifactStorage: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.EVIDENCE_ARTIFACT_DIR),
      browser: browserAvailable(),
    },
  });
};
