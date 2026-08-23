"use strict";

const { randomUUID } = require("crypto");
const { IdentityAuthorizationError } = require("../domain/errors");

async function readRawBody(req, maximumBytes = 1024 * 1024) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maximumBytes) { const error = new Error("Request body is too large"); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function createProviderWebhookHandler({ idvService, provider, serviceSecurityContextProvider }) {
  if (!idvService || !provider || typeof serviceSecurityContextProvider !== "function") throw new TypeError("Webhook handler dependencies are required");
  return async function providerWebhookHandler(req, res) {
    try {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const rawBody = await readRawBody(req);
      // Workload context must originate from a verified OIDC service identity;
      // provider webhook HMAC authenticates the delivery, not tenant authority.
      const securityContext = await serviceSecurityContextProvider({ provider, correlationId: randomUUID() });
      const result = await idvService.processWebhook(provider, {
        rawBody,
        headers: req.headers,
        receivedAt: new Date(),
        securityContext,
      });
      return send(res, 200, { accepted: true, duplicate: result.duplicate === true });
    } catch (error) {
      const status = error.code === "IDV_WEBHOOK_AUTHENTICATION_FAILED" ? 401 : (error.statusCode || 500);
      return send(res, status, { error: error.code || "IDV_WEBHOOK_FAILED" });
    }
  };
}

function createInternalIdvHandler({ idvService, authenticator, resolveAuthorizedSubject }) {
  if (!idvService || !authenticator || typeof resolveAuthorizedSubject !== "function") throw new TypeError("Internal IDV handler dependencies are required");
  return async function internalIdvHandler(req, res) {
    try {
      const securityContext = await authenticator.authenticate(req.headers.authorization);
      const raw = req.method === "POST" ? await readRawBody(req) : "{}";
      const body = JSON.parse(raw || "{}");
      if (req.method === "POST" && req.url === "/internal/idv/sessions") {
        const subject = await resolveAuthorizedSubject({ securityContext, kycResourceId: body.kycResourceId, operation: "START_IDV" });
        if (!subject || subject.tenantId !== securityContext.tenantId || !subject.subjectId) throw new IdentityAuthorizationError();
        const started = await idvService.startVerification({
          tenantId: securityContext.tenantId,
          customerContextId: body.kycResourceId,
          subjectPersonId: subject.subjectId,
          country: subject.country,
          provider: body.provider,
          documentType: body.documentType,
          documentIssuingCountry: body.documentIssuingCountry,
        });
        return send(res, 201, {
          internalIdvSessionId: started.session.internal_idv_session_id,
          hostedVerificationUrl: started.hosted_verification_url,
          provider: started.session.provider,
        });
      }
      return send(res, 404, { error: "not_found" });
    } catch (error) {
      const status = error.code === "IDV_AUTHENTICATION_REQUIRED" ? 401 : error.code === "IDV_IDENTITY_ACCESS_DENIED" ? 403 : 400;
      return send(res, status, { error: error.code || "IDV_REQUEST_FAILED" });
    }
  };
}

module.exports = { createProviderWebhookHandler, createInternalIdvHandler, readRawBody };
