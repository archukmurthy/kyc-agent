"use strict";

// Didit webhook endpoint. All result processing is server-side: verify the
// signature, route the event to exactly the attempt that owns the session, and
// store the document-extracted result. If the signature scheme does not trust
// the decision payload, the SERVER re-pulls the decision (never the browser).
// Deliveries are idempotent (event id) and out-of-order/stale events are ignored.
const { verifyDiditWebhook } = require("../../lib/didit/webhookSignature");
const { getDecision } = require("../../lib/didit/diditClient");
const { persistDecision } = require("./persistDecision");
const attemptStore = require("./attemptStore");
const webhookEvents = require("./webhookEvents");

// Compute an ISO time for the event from its unix-seconds timestamp.
function eventIsoTime(payload, now) {
  const raw = Number(payload.created_at != null ? payload.created_at : payload.timestamp);
  return Number.isFinite(raw) ? new Date(raw * 1000).toISOString() : new Date(now).toISOString();
}

// Core, HTTP-agnostic. Dependencies are injectable for testing.
async function processWebhook({ rawBody, headers, now = Date.now() }, deps = {}) {
  const verify = deps.verify || verifyDiditWebhook;
  const store = deps.attemptStore || attemptStore;
  const events = deps.webhookEvents || webhookEvents;
  const pullDecision = deps.getDecision || getDecision;
  const persist = deps.persistDecision || persistDecision;

  const v = verify({ rawBody, headers, secret: process.env.DIDIT_WEBHOOK_SECRET, now });
  if (!v.valid) return { statusCode: 401, body: { error: "invalid_webhook", reason: v.reason } };

  const { sessionId, status, decisionTrusted, payload } = v;
  if (!sessionId) return { statusCode: 400, body: { error: "no_session_id" } };

  const attempt = await store.getByDiditSession(sessionId);
  if (!attempt) return { statusCode: 404, body: { error: "attempt_not_found" } };

  const isNew = await events.markEventProcessed(payload.event_id || null, attempt.id);
  if (!isNew) return { statusCode: 200, body: { accepted: true, duplicate: true, attemptId: attempt.id } };

  // Ignore an event older than the last one we applied (out-of-order / stale).
  // Checked before we pull or persist anything.
  const eventTime = eventIsoTime(payload, now);
  if (attempt.last_event_at && new Date(eventTime) <= new Date(attempt.last_event_at)) {
    return { statusCode: 200, body: { accepted: true, stale: true, attemptId: attempt.id } };
  }

  // A trusted scheme carries the decision; otherwise the server re-pulls it so we
  // never persist an unverified payload.
  let decision = decisionTrusted && payload.decision ? payload.decision : null;
  if (!decision) decision = await pullDecision(sessionId);

  // Map -> Vault (PII) -> store (non-PII). See persistDecision.
  await persist({ attempt, decision, receivedAt: new Date(now), lastEventAt: eventTime, statusFallback: status }, deps);

  return { statusCode: 200, body: { accepted: true, attemptId: attempt.id } };
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

// Thin HTTP adapter. Reads the RAW body (signature is over raw bytes) and never
// leaks internals on error.
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  try {
    const rawBody = await readRawBody(req);
    const { statusCode, body } = await processWebhook({ rawBody, headers: req.headers || {} });
    return res.status(statusCode).json(body);
  } catch (err) {
    console.error("[idv-match webhook]", err && err.message);
    return res.status(500).json({ error: "webhook_error" });
  }
}

module.exports = handler;
module.exports.processWebhook = processWebhook;
// Vercel: give us the raw body for signature verification.
module.exports.config = { api: { bodyParser: false } };
