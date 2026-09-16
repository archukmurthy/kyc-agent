"use strict";

const { analyseCustomerOwnershipChart } = require("../ubo-control-lab/server/customerOwnershipChartDemo.js");

function createHandler(analyse = analyseCustomerOwnershipChart) {
  return async function customerOwnershipChartHandler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      const result = await analyse(req.body || {});
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
