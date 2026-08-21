"use strict";

const { createHash } = require("crypto");
const { ProviderAdapter } = require("../contracts/providerAdapter");
const { PROVIDERS, OBSERVATION_TYPES } = require("../domain/constants");
const { ConfigurationError, WebhookAuthenticationError } = require("../domain/errors");
const {
  createIdentityAttribute,
  createVerificationObservation,
  createProviderDecision,
  createExternalEvidenceReference,
  assertNoRawEvidence,
  iso,
} = require("../domain/canonical");
const { hmacHex, safeHexEqual, header, verifyVeriffWebhook } = require("../security/webhookSignatures");
const { mapProviderStatus, mapObservationStatus, presentEntries } = require("./normalization");
const { ProviderHttpClient } = require("./httpClient");
const { CostPolicy } = require("../services/costPolicy");

const PROVIDER = PROVIDERS.VERIFF;
const ADAPTER_VERSION = "veriff-v1.1";

function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null); }

class VeriffAdapter extends ProviderAdapter {
  constructor({ config = {}, httpClient = new ProviderHttpClient(), costPolicy = new CostPolicy(), now = () => new Date() } = {}) {
    super();
    this.config = {
      baseUrl: "https://stationapi.veriff.com",
      environment: "sandbox",
      workflow: "ESSENTIAL",
      verifyApiResponses: true,
      ...config,
    };
    this.http = httpClient;
    this.costPolicy = costPolicy;
    this.now = now;
    this.provider = PROVIDER;
    this.adapterVersion = ADAPTER_VERSION;
  }

  requireConfig(...keys) {
    for (const key of keys) if (!this.config[key]) throw new ConfigurationError(`Veriff configuration is missing ${key}`);
  }

  signedHeaders(value) {
    return {
      "content-type": "application/json",
      "x-auth-client": this.config.apiKey,
      "x-hmac-signature": hmacHex(this.config.sharedSecret, value),
    };
  }

  verifyApiResponse(response) {
    if (!this.config.verifyApiResponses) return;
    const responseClient = header(response.headers, "x-auth-client");
    const responseSignature = header(response.headers, "x-hmac-signature");
    if (responseClient !== this.config.apiKey || !safeHexEqual(responseSignature, hmacHex(this.config.sharedSecret, response.rawBody))) {
      throw new WebhookAuthenticationError("Veriff API response signature is invalid");
    }
  }

  async createVerificationSession(input) {
    this.requireConfig("apiKey", "sharedSecret");
    const verification = {
      vendorData: input.internalIdvSessionId,
      endUserId: input.subjectPersonId || undefined,
      callback: input.callbackUrl || this.config.callbackUrl || undefined,
      serviceCoverage: input.country ? { country: input.country } : undefined,
    };
    for (const key of Object.keys(verification)) if (verification[key] === undefined) delete verification[key];
    const rawBody = JSON.stringify({ verification });
    const response = await this.http.request({
      provider: PROVIDER,
      url: `${this.config.baseUrl.replace(/\/$/, "")}/v1/sessions`,
      method: "POST",
      headers: this.signedHeaders(rawBody),
      body: rawBody,
    });
    this.verifyApiResponse(response);
    const session = response.data?.verification || {};
    if (!session.id || !session.url) throw new Error("Veriff create-session response omitted verification.id or verification.url");
    return {
      provider: PROVIDER,
      provider_session_id: session.id,
      provider_report_id: null,
      provider_workflow: input.workflow || this.config.workflow,
      provider_workflow_version: this.config.workflowVersion || null,
      provider_adapter_version: ADAPTER_VERSION,
      original_provider_status: session.status,
      canonical_status: mapProviderStatus(session.status),
      created_at: session.acceptanceTime || this.now().toISOString(),
      hosted_verification_url: session.url,
    };
  }

  getHostedVerificationUrl(providerSession) {
    if (!providerSession?.hosted_verification_url) throw new TypeError("Veriff hosted verification URL is unavailable");
    return providerSession.hosted_verification_url;
  }

  async handleWebhook({ rawBody, headers, receivedAt = this.now() }) {
    this.requireConfig("apiKey", "sharedSecret");
    verifyVeriffWebhook({ rawBody, headers, apiKey: this.config.apiKey, sharedSecret: this.config.sharedSecret });
    let payload;
    try { payload = JSON.parse(rawBody); } catch (_) { throw new TypeError("Veriff webhook body is not valid JSON"); }
    const verification = payload.verification || {};
    if (!verification.id) throw new TypeError("Veriff webhook omitted verification.id");
    return {
      provider: PROVIDER,
      eventId: createHash("sha256").update(rawBody).digest("hex"),
      providerSessionId: verification.id,
      originalProviderStatus: verification.status,
      canonicalStatus: mapProviderStatus(verification.status),
      occurredAt: iso(firstDefined(verification.decisionTime, verification.submissionTime, receivedAt)),
      webhookType: "DECISION",
      authenticationMethod: "X-HMAC-SIGNATURE",
      result: this.normalizeResult(payload, receivedAt),
      requiresReconciliation: false,
    };
  }

  async retrieveVerificationResult(providerSessionId) {
    this.requireConfig("apiKey", "sharedSecret");
    const response = await this.http.request({
      provider: PROVIDER,
      url: `${this.config.baseUrl.replace(/\/$/, "")}/v1/sessions/${encodeURIComponent(providerSessionId)}/decision`,
      headers: this.signedHeaders(providerSessionId),
    });
    this.verifyApiResponse(response);
    return this.normalizeResult(response.data, this.now());
  }

  normalizeResult(payload, receivedAt) {
    const verification = payload?.verification || {};
    const providerSessionId = verification.id;
    const reportReference = verification.attemptId || null;
    const document = verification.document || {};
    const person = verification.person || {};
    const documentType = document.type || null;
    const issuingCountry = document.country || null;
    const extractedAt = firstDefined(verification.submissionTime, verification.decisionTime);
    const identityAttributes = [];
    const fields = [
      ...presentEntries(person, {
        firstName: "first_name", lastName: "last_name", dateOfBirth: "date_of_birth",
        nationality: "nationality", idNumber: "personal_id_number", addresses: "addresses",
      }),
      ...presentEntries(document, {
        number: "document_number", type: "document_type", country: "issuing_country",
        validUntil: "expiry_date", validFrom: "valid_from", issuedBy: "issuing_authority",
      }),
    ];
    identityAttributes.push(...fields.map((field) => createIdentityAttribute({
      ...field, provider: PROVIDER, providerSessionId, providerReportReference: reportReference,
      sourceDocumentType: documentType, sourceDocumentCountry: issuingCountry, extractedAt,
    })));

    const observations = [];
    const explicit = [
      [firstDefined(verification.documentAuthenticity, verification.documentVerification, verification.additionalVerifiedData?.documentAuthenticity), OBSERVATION_TYPES.DOCUMENT_AUTHENTICITY],
      [firstDefined(verification.documentValidity, verification.additionalVerifiedData?.documentValidity), OBSERVATION_TYPES.DOCUMENT_VALIDITY],
      [firstDefined(verification.liveness, verification.additionalVerifiedData?.liveness), OBSERVATION_TYPES.LIVENESS],
      [firstDefined(verification.faceMatch, verification.additionalVerifiedData?.faceMatch), OBSERVATION_TYPES.FACE_MATCH],
    ];
    for (const [value, type] of explicit) {
      if (value !== undefined && value !== null) observations.push(createVerificationObservation({
        type, status: mapObservationStatus(value), provider: PROVIDER, providerSessionId,
        providerReference: reportReference, observedAt: verification.decisionTime,
        method: typeof value === "object" ? value.method : null,
        score: Number(typeof value === "object" ? value.score : NaN),
        originalProviderStatus: typeof value === "object" ? (value.status || value.result) : String(value),
      }));
    }
    if (document.nfcValidated !== undefined && document.nfcValidated !== null) {
      observations.push(createVerificationObservation({
        type: OBSERVATION_TYPES.NFC_VERIFICATION, status: mapObservationStatus(document.nfcValidated),
        provider: PROVIDER, providerSessionId, providerReference: reportReference,
        observedAt: verification.decisionTime, originalProviderStatus: String(document.nfcValidated),
      }));
    }
    for (const [registry, validation] of Object.entries(verification.registryValidations || {})) {
      observations.push(createVerificationObservation({
        type: OBSERVATION_TYPES.DATABASE_VERIFICATION, status: mapObservationStatus(validation.status),
        provider: PROVIDER, providerSessionId, providerReference: `${reportReference || providerSessionId}:${registry}`,
        observedAt: validation.timestamp || verification.decisionTime, method: registry,
        originalProviderStatus: validation.status,
      }));
    }
    const externalReferences = documentType || document.number ? [createExternalEvidenceReference({
      provider: PROVIDER, providerSessionId, providerReference: reportReference || providerSessionId,
      evidenceCategory: "IDENTITY_DOCUMENT", documentType, issuingCountry,
      capturedAt: verification.submissionTime,
    })] : [];
    const status = verification.status;
    const normalized = {
      provider: PROVIDER,
      provider_session_id: providerSessionId,
      provider_report_id: reportReference,
      identity_attributes: identityAttributes,
      verification_observations: observations,
      provider_decision: createProviderDecision({
        canonicalStatus: mapProviderStatus(status), provider: PROVIDER, providerSessionId,
        providerReportReference: reportReference, originalProviderStatus: status,
        originalProviderReason: verification.reason || null,
        originalProviderReasonCode: firstDefined(verification.reasonCode, verification.code, null),
        decidedAt: verification.decisionTime, receivedAt,
      }),
      external_evidence_references: externalReferences,
      timestamps: {
        created_at: iso(verification.acceptanceTime),
        verification_started_at: iso(verification.acceptanceTime),
        document_submitted_at: iso(verification.submissionTime),
        extraction_available_at: identityAttributes.length ? iso(verification.decisionTime) : null,
        provider_completed_at: iso(verification.decisionTime),
        result_received_at: iso(receivedAt, this.now()),
      },
      provider_extensions: {
        original_status: status || null,
        original_reason: verification.reason || null,
        original_reason_code: firstDefined(verification.reasonCode, verification.code, null),
      },
    };
    normalized.cost = this.getProviderCostInformation(normalized);
    assertNoRawEvidence(normalized);
    return normalized;
  }

  getCapabilities() {
    return {
      provider: PROVIDER, adapter_version: ADAPTER_VERSION, hosted_flow: true,
      document_verification: true, extraction: true, passive_liveness: true, face_match: true,
      nfc: "OPTIONAL_INTEGRATION_CAPABILITY", database_verification: "OPTIONAL_INTEGRATION_CAPABILITY",
      raw_evidence_custody: "PROVIDER",
    };
  }

  getExternalEvidenceReferences(result) { return result?.external_evidence_references || []; }

  getProviderCostInformation(result) {
    const modules = [...new Set((result?.verification_observations || []).map((item) => item.observation_type))];
    return this.costPolicy.estimate({ provider: PROVIDER, workflow: this.config.workflow, modules });
  }
}

module.exports = { VeriffAdapter, ADAPTER_VERSION };
