"use strict";

// ComplyCube screening webhook. Verifies the signature (SDK EventVerifier over
// the raw body), then re-pulls the full check to get the breakdown and stores
// the interpreted result. Re-pull + overwrite is naturally idempotent, so
// retried deliveries are safe.
const { EventVerifier } = require("@complycube/api");
const complyCubeClient = require("./complyCubeClient");
const store = require("./store");
const { interpretCheck } = require("./interpret");

const COMPLETION_EVENTS = /completed|complete|failed|updated|attention|clear|rejected/i;

function defaultVerify(secret) {
  const verifier = new EventVerifier(secret);
  return (rawBody, signature) => verifier.constructEvent(rawBody, signature);
}

async function processScreeningWebhook({ rawBody, signature, secret }, deps = {}) {
  if (!secret) return { statusCode: 500, body: { error: "no_webhook_secret" } };
  const verify = deps.verifyEvent || defaultVerify(secret);

  let event;
  try {
    event = verify(rawBody, signature);
  } catch (_) {
    return { statusCode: 401, body: { error: "invalid_signature" } };
  }

  const type = (event && event.type) || "";
  const payload = (event && event.payload) || {};
  const checkId = payload.id || payload.checkId;
  if (!checkId) return { statusCode: 400, body: { error: "no_check_id" } };

  const s = deps.store || store;
  const row = await s.getByCheckId(checkId);
  if (!row) return { statusCode: 404, body: { error: "screening_not_found" } };

  if (!COMPLETION_EVENTS.test(type)) {
    return { statusCode: 200, body: { accepted: true, ignored: type } };
  }

  // Re-pull the full check for the breakdown (the webhook payload is a summary).
  const getCheck = deps.getCheck || complyCubeClient.getCheck;
  const check = await getCheck(checkId);
  const interpreted = interpretCheck(check);
  await s.updateScreeningResult(row.id, {
    status: interpreted.status,
    outcome: interpreted.outcome,
    categories: interpreted.categories,
  });

  // Re-resolve the band now the screening result is stored — covers the case where
  // the applicant left our tab and is no longer polling /resolve. resolveAttempt is
  // idempotent (a decision already recorded is returned as-is), so a concurrent poll
  // can't double-record. Best-effort: a re-resolve failure never fails the webhook.
  const reResolve = deps.resolveAttempt || require("../resolve").resolveAttempt;
  if (row.attempt_id) {
    try { await reResolve(row.attempt_id); }
    catch (err) { console.error("[idv-match screening webhook] re-resolve failed:", err && err.message); }
  }

  return { statusCode: 200, body: { accepted: true, screeningId: row.id, hit: interpreted.hit } };
}

function readRawBody(req) {
  if (req.rawBody != null) return Promise.resolve(req.rawBody);
  return new Promise((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => resolve(raw));
  });
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers && (req.headers["complycube-signature"] || req.headers["ComplyCube-Signature"]);
    const { statusCode, body } = await processScreeningWebhook({
      rawBody,
      signature,
      secret: process.env.COMPLYCUBE_WEBHOOK_SECRET,
    });
    return res.status(statusCode).json(body);
  } catch (err) {
    console.error("[idv-match screening webhook]", err && err.message);
    return res.status(500).json({ error: "screening_webhook_error" });
  }
}

module.exports = handler;
module.exports.processScreeningWebhook = processScreeningWebhook;
module.exports.config = { api: { bodyParser: false } };
