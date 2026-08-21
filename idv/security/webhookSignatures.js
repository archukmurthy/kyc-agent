"use strict";

const { createHmac, timingSafeEqual } = require("crypto");
const { WebhookAuthenticationError } = require("../domain/errors");

function hmacHex(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeHexEqual(actual, expected) {
  if (typeof actual !== "string" || !/^[a-f0-9]+$/i.test(actual)) return false;
  const left = Buffer.from(actual.toLowerCase(), "utf8");
  const right = Buffer.from(expected.toLowerCase(), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function header(headers, name) {
  const wanted = name.toLowerCase();
  if (typeof headers?.get === "function") return headers.get(name);
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1] == null ? null : String(entry[1]);
}

function verifyDiditWebhook({ rawBody, parsedBody, headers, secret, now = new Date(), toleranceSeconds = 300 }) {
  const timestamp = header(headers, "x-timestamp") || String(parsedBody?.timestamp || "");
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Math.floor(now.valueOf() / 1000) - timestampNumber) > toleranceSeconds) {
    throw new WebhookAuthenticationError("Didit webhook timestamp is missing or outside the replay window");
  }
  const signatureV2 = header(headers, "x-signature-v2");
  if (signatureV2 && safeHexEqual(signatureV2, hmacHex(secret, canonicalJson(parsedBody)))) {
    return { method: "X-SIGNATURE-V2", decisionPayloadTrusted: true };
  }
  const signature = header(headers, "x-signature");
  if (signature && safeHexEqual(signature, hmacHex(secret, rawBody))) {
    return { method: "X-SIGNATURE", decisionPayloadTrusted: true };
  }
  const signatureSimple = header(headers, "x-signature-simple");
  const simpleValue = `${timestamp}:${parsedBody?.session_id || ""}:${parsedBody?.status || ""}:${parsedBody?.webhook_type || ""}`;
  if (signatureSimple && safeHexEqual(signatureSimple, hmacHex(secret, simpleValue))) {
    return { method: "X-SIGNATURE-SIMPLE", decisionPayloadTrusted: false };
  }
  throw new WebhookAuthenticationError("Didit webhook signature is invalid");
}

function verifyVeriffWebhook({ rawBody, headers, apiKey, sharedSecret }) {
  if (header(headers, "x-auth-client") !== apiKey) {
    throw new WebhookAuthenticationError("Veriff webhook client identifier is invalid");
  }
  const signature = header(headers, "x-hmac-signature");
  if (!safeHexEqual(signature, hmacHex(sharedSecret, rawBody))) {
    throw new WebhookAuthenticationError("Veriff webhook signature is invalid");
  }
  return { method: "X-HMAC-SIGNATURE", decisionPayloadTrusted: true };
}

module.exports = { hmacHex, safeHexEqual, canonicalJson, header, verifyDiditWebhook, verifyVeriffWebhook };
