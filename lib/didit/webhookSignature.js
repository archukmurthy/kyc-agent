"use strict";

// Verifies Didit webhook authenticity (HMAC-SHA256) with replay protection.
// Didit signs each delivery three ways; we accept the first that validates:
//   X-Signature-V2      HMAC over canonical (sorted-key) JSON of the body   -> decision payload trusted
//   X-Signature         HMAC over the exact raw body bytes                  -> decision payload trusted
//   X-Signature-Simple  HMAC over "{timestamp}:{session_id}:{status}:{webhook_type}" -> delivery authentic, decision NOT trusted (server must re-pull)
// An X-Timestamp outside the replay window is rejected. All comparisons are
// constant-time. Secret = DIDIT_WEBHOOK_SECRET.
const crypto = require("node:crypto");

const REPLAY_WINDOW_SECONDS = 300;

function hmacHex(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let bufA;
  let bufB;
  try {
    bufA = Buffer.from(a, "hex");
    bufB = Buffer.from(b, "hex");
  } catch (_) {
    return false;
  }
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Stable, sorted-key, compact JSON — reproduces Didit's V2 canonicalization.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = canonicalize(value[key]);
        return out;
      }, {});
  }
  return value;
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

// Returns { valid, decisionTrusted, method, reason, sessionId, status, webhookType, payload }.
function verifyDiditWebhook({ rawBody, headers, secret, now = Date.now() }) {
  if (!secret) return { valid: false, reason: "no_secret" };

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return { valid: false, reason: "bad_json" };
  }

  const tsHeader = readHeader(headers, "x-timestamp");
  const tsRaw = tsHeader != null ? String(tsHeader) : (payload.timestamp != null ? String(payload.timestamp) : null);
  const ts = Number(tsRaw);
  if (tsRaw == null || !Number.isFinite(ts)) return { valid: false, reason: "no_timestamp" };
  if (Math.abs(Math.floor(now / 1000) - ts) > REPLAY_WINDOW_SECONDS) {
    return { valid: false, reason: "stale" };
  }

  const meta = {
    sessionId: payload.session_id,
    status: payload.status,
    webhookType: payload.webhook_type,
    payload,
  };

  const v2 = readHeader(headers, "x-signature-v2");
  if (v2 && timingSafeEqualHex(v2, hmacHex(secret, JSON.stringify(canonicalize(payload))))) {
    return { valid: true, decisionTrusted: true, method: "v2", ...meta };
  }

  const raw = readHeader(headers, "x-signature");
  if (raw && timingSafeEqualHex(raw, hmacHex(secret, rawBody))) {
    return { valid: true, decisionTrusted: true, method: "raw", ...meta };
  }

  const simple = readHeader(headers, "x-signature-simple");
  if (simple) {
    const envelope = `${tsRaw}:${payload.session_id}:${payload.status}:${payload.webhook_type}`;
    if (timingSafeEqualHex(simple, hmacHex(secret, envelope))) {
      return { valid: true, decisionTrusted: false, method: "simple", ...meta };
    }
  }

  return { valid: false, reason: "invalid_signature", ...meta };
}

module.exports = { verifyDiditWebhook, REPLAY_WINDOW_SECONDS };
