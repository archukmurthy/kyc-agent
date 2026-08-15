"use strict";

const { getPlatformStatus } = require("../../evidence/platform");

module.exports = function evidenceStatusHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json(getPlatformStatus());
};
