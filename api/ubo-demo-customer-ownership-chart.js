"use strict";

const { analyseCustomerOwnershipChart, reevaluateSavedCustomerOwnershipChart } = require("../ubo-control-lab/server/customerOwnershipChartDemo.js");
const { applyCors } = require("../lib/routeAuth");
const { enforceRateLimit } = require("../lib/rateLimit");

function createHandler(analyse = analyseCustomerOwnershipChart, reevaluate = reevaluateSavedCustomerOwnershipChart) {
  return async function customerOwnershipChartHandler(req, res) {
    if (applyCors(req, res)) return undefined;
    // Merged from the UBO demo with no credential and no limit. Reaches document extraction and Anthropic, so an anonymous caller can spend our money.
    // Clerk gives these a real caller identity; the limiter is what holds until then.
    if (!(await enforceRateLimit(req, res, "ubo-demo-chart"))) return undefined;
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      const body = req.body || {};
      const result = body.operation === "REEVALUATE_SAVED_EXTRACTION"
        ? await reevaluate(body)
        : await analyse(body);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ success: true, result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: "Ownership chart analysis failed",
        code: error.code || "customer_ownership_chart_failed",
        message: error.statusCode && error.statusCode < 500
          ? error.message
          : "We could not analyse this ownership chart. Please try again.",
      });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
