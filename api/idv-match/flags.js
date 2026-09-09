"use strict";

// Public read-only flag endpoint so the browser can learn whether the discrepancy
// bands feature is on (api/document-requirements is protected, so we don't add it
// there). Returns a boolean only — no config, no PII.
const { bandsEnabled } = require("./config");

function getFlags() {
  return { idvDiscrepancyBands: bandsEnabled() };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(getFlags());
}

module.exports = handler;
module.exports.getFlags = getFlags;
