"use strict";

const legacyDiscoveryHandler = require("./ubo-discovery");
const {
  applyCustomerAction,
  applyReviewerDecisions,
  compareSnapshotEntries,
  fixtureCatalogue,
  startFixture,
  startLive,
} = require("../ubo-control-lab/server/labEngine");

const OPERATIONS = Object.freeze({
  FIXTURE_CATALOGUE: "FIXTURE_CATALOGUE",
  START_FIXTURE: "START_FIXTURE",
  START_LIVE: "START_LIVE",
  APPLY_REVIEWER_DECISIONS: "APPLY_REVIEWER_DECISIONS",
  APPLY_CUSTOMER_ACTION: "APPLY_CUSTOMER_ACTION",
  COMPARE_SNAPSHOTS: "COMPARE_SNAPSHOTS",
});

function invokeLegacyDiscovery(body) {
  return new Promise((resolve, reject) => {
    const request = { method: "POST", body, headers: { accept: "application/json" } };
    let statusCode = 200;
    const response = {
      status(code) { statusCode = code; return this; },
      setHeader() { return this; },
      json(payload) { resolve({ status: statusCode, body: payload }); return this; },
      end(payload) {
        if (!payload) resolve({ status: statusCode, body: null });
        else {
          try { resolve({ status: statusCode, body: JSON.parse(payload) }); }
          catch { resolve({ status: statusCode, body: payload }); }
        }
        return this;
      },
      write() { return true; },
    };
    Promise.resolve(legacyDiscoveryHandler(request, response)).catch(reject);
  });
}

function send(res, status, payload) {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  return res.json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") return send(res, 200, fixtureCatalogue());
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const input = req.body || {};
    switch (input.operation) {
      case OPERATIONS.FIXTURE_CATALOGUE:
        return send(res, 200, fixtureCatalogue());
      case OPERATIONS.START_FIXTURE:
        return send(res, 200, startFixture(input.payload));
      case OPERATIONS.START_LIVE:
        return send(res, 200, await startLive({
          ...input.payload,
          transport: { invoke: ({ body }) => invokeLegacyDiscovery(body) },
        }));
      case OPERATIONS.APPLY_REVIEWER_DECISIONS:
        return send(res, 200, applyReviewerDecisions(input.payload));
      case OPERATIONS.APPLY_CUSTOMER_ACTION:
        return send(res, 200, applyCustomerAction(input.payload));
      case OPERATIONS.COMPARE_SNAPSHOTS:
        return send(res, 200, compareSnapshotEntries(input.payload?.left, input.payload?.right));
      default:
        return send(res, 400, { error: "Unsupported Lab operation" });
    }
  } catch (error) {
    const clientError = error instanceof TypeError || String(error.code || "").startsWith("ACTION_")
      || ["INVALID_CUSTOMER_ACTION", "UNAUTHORIZED_CUSTOMER_ACTION", "STALE_CUSTOMER_ACTION"].includes(error.code);
    return send(res, clientError ? 400 : 500, {
      error: clientError ? "Lab request rejected" : "UBO Control Lab operation failed",
      code: error.code || null,
      message: clientError ? error.message : "The operation could not be completed safely.",
    });
  }
};

module.exports.OPERATIONS = OPERATIONS;
