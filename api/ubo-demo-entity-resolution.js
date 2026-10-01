"use strict";

const { createDemoEntityMatcher } = require("../ubo-control-lab/server/demoEntityMatching.js");
const { applyCors, requireUboCaller } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");
const trials = require("../lib/uboTrials");

function createHandler(matchEntities = createDemoEntityMatcher(), countPaidStep = trials.countPaidStep) {
  return async function uboDemoEntityResolutionHandler(req, res) {
    if (applyCors(req, res)) return undefined;
    // Merged from the UBO demo with no credential and no limit. Calls Anthropic per request, so an anonymous caller can spend our money.
    // Clerk gives these a real caller identity; the limiter is what holds until then.
    if (!(await enforceRateLimit(req, res, "ubo-demo-entity"))) return undefined;
    // Clerk owns who is calling. Inert until CLERK_SECRET_KEY is set, so this
    // route behaves exactly as before until the keys land.
    // No requireTenant here, deliberately. This route never reads the caller's
    // workspace - what scopes it is the rate limiter, which resolves the caller
    // and their workspace itself (lib/rateLimit.js#callerKey). Asking for a
    // tenant we then discard is a claim a reader believes and the code does not
    // keep, and with the login switched off it cannot be enforced anyway.
    // Staff, or a customer comparing names on their own chart. It reads no
    // stored data, so a customer session needs no further scoping here.
    const actor = await requireUboCaller(req, res);
    if (!actor) return undefined;
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ success: false, code: "method_not_allowed" });
    }
    try {
      // One of the caller's trial steps, counted where the AI call starts (UBO-44).
      await countPaidStep(actor);
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
