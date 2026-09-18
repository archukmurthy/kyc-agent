"use strict";

const { createDemoEntityMatcher } = require("../ubo-control-lab/server/demoEntityMatching.js");

function createHandler(matchEntities = createDemoEntityMatcher()) {
  return async function uboDemoEntityResolutionHandler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ success: false, code: "method_not_allowed" });
    }
    try {
      const result = await matchEntities(req.body || {});
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ success: true, result });
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        success: false,
        code: error.code || "entity_match_failed",
        message: error.statusCode && error.statusCode < 500 ? error.message : "Entity matching is temporarily unavailable.",
      });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
