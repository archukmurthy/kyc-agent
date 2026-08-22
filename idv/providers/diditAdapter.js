"use strict";

const { createHash } = require("crypto");
const { ProviderAdapter } = require("../contracts/providerAdapter");
const { PROVIDERS, OBSERVATION_TYPES } = require("../domain/constants");
const { ConfigurationError } = require("../domain/errors");
const {
  createIdentityAttribute,
  createVerificationObservation,
  createProviderDecision,
  createExternalEvidenceReference,
  assertNoRawEvidence,
  iso,
} = require("../domain/canonical");
const { verifyDiditWebhook } = require("../security/webhookSignatures");
const { mapProviderStatus, mapObservationStatus, presentEntries } = require("./normalization");
const { ProviderHttpClient } = require("./httpClient");
const { CostPolicy } = require("../services/costPolicy");

const PROVIDER = PROVIDERS.DIDIT;
const ADAPTER_VERSION = "didit-v3.1";

function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null); }
function array(value) { return Array.isArray(value) ? value : value ? [value] : []; }

class DiditAdapter extends ProviderAdapter {
  constructor({ config = {}, httpClient = new ProviderHttpClient(), costPolicy = new CostPolicy(), now = () => new Date() } = {}) {
    super();
    this.config = {
      baseUrl: "https://verification.didit.me",
      environment: "sandbox",
      ...config,
    };
    this.http = httpClient;
    this.costPolicy = costPolicy;
    this.now = now;
    this.provider = PROVIDER;
    this.adapterVersion = ADAPTER_VERSION;
  }

  requireConfig(...keys) {
    for (const key of keys) if (!this.config[key]) throw new ConfigurationError(`Didit configuration is missing ${key}`);
  }

  async createVerificationSession(input) {
    this.requireConfig("apiKey", "workflowId");
    const body = {
      workflow_id: input.workflow || this.config.workflowId,
      vendor_data: input.internalIdvSessionId,
      callback: input.callbackUrl || this.config.callbackUrl,
      callback_method: "both",
      metadata: { internal_idv_session_id: input.internalIdvSessionId },
    };
    if (!body.callback) delete body.callback;
    if (this.config.environment === "sandbox" && input.sandboxScenario) body.sandbox_scenario = input.sandboxScenario;
    const requestUrl = `${this.config.baseUrl.replace(/\/$/, "")}/v3/session/`;
    const response = await this.http.request({
      provider: PROVIDER,
      url: requestUrl,
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.config.apiKey },
      body: JSON.stringify(body),
      diagnostic: {
        enabled: this.config.debugHttp === true,
        runtimeMode: this.config.runtimeMode,
        workflowId: body.workflow_id,
        callbackSupplied: Boolean(body.callback),
        environment: this.config.environment,
      },
    });
    const session = response.data || {};
    if (!session.session_id || !session.url) throw new Error("Didit create-session response omitted session_id or url");
    return {
      provider: PROVIDER,
      provider_session_id: session.session_id,
      provider_report_id: null,
      provider_workflow: session.workflow_id || body.workflow_id,
      provider_workflow_version: session.workflow_version || null,
      provider_adapter_version: ADAPTER_VERSION,
      original_provider_status: session.status,
      canonical_status: mapProviderStatus(session.status),
      created_at: session.created_at || this.now().toISOString(),
      hosted_verification_url: session.url,
    };
  }

  getHostedVerificationUrl(providerSession) {
    if (!providerSession?.hosted_verification_url) throw new TypeError("Didit hosted verification URL is unavailable");
    return providerSession.hosted_verification_url;
  }

  async handleWebhook({ rawBody, headers, receivedAt = this.now() }) {
    this.requireConfig("webhookSecret");
    let payload;
    try { payload = JSON.parse(rawBody); } catch (_) { throw new TypeError("Didit webhook body is not valid JSON"); }
    const authentication = verifyDiditWebhook({
      rawBody,
      parsedBody: payload,
      headers,
      secret: this.config.webhookSecret,
      now: receivedAt,
    });
    if (!payload.session_id) throw new TypeError("Didit webhook omitted session_id");
    const eventId = payload.event_id || createHash("sha256").update(rawBody).digest("hex");
    const occurredAt = payload.created_at && Number.isFinite(Number(payload.created_at))
      ? new Date(Number(payload.created_at) * 1000).toISOString()
      : iso(payload.decision?.decision_at || receivedAt);
    return {
      provider: PROVIDER,
      eventId,
      providerSessionId: payload.session_id,
      originalProviderStatus: payload.status,
      canonicalStatus: mapProviderStatus(payload.status),
      occurredAt,
      webhookType: payload.webhook_type || null,
      authenticationMethod: authentication.method,
      result: authentication.decisionPayloadTrusted && payload.decision
        ? this.normalizeResult(payload, receivedAt) : null,
      requiresReconciliation: !authentication.decisionPayloadTrusted,
    };
  }

  async retrieveVerificationResult(providerSessionId) {
    this.requireConfig("apiKey");
    const response = await this.http.request({
      provider: PROVIDER,
      url: `${this.config.baseUrl.replace(/\/$/, "")}/v3/session/${encodeURIComponent(providerSessionId)}/decision/`,
      headers: { "x-api-key": this.config.apiKey },
    });
    return this.normalizeResult({ ...response.data, session_id: providerSessionId }, this.now());
  }

  normalizeResult(payload, receivedAt) {
    const decision = payload.decision || payload;
    const providerSessionId = payload.session_id || decision.session_id;
    const status = payload.status || decision.status;
    const reportReference = firstDefined(decision.decision_id, decision.report_id, decision.id, null);
    const documents = array(decision.id_verifications || decision.id_verification);
    const extractedAt = firstDefined(decision.extracted_at, decision.updated_at, payload.created_at);
    const identityAttributes = [];
    const observations = [];
    const externalReferences = [];
    for (const document of documents) {
      const documentType = firstDefined(document.document_type, document.type);
      const issuingCountry = firstDefined(document.issuing_country, document.issuing_state, document.country);
      const reference = firstDefined(document.node_id, document.request_id, reportReference);
      const fields = presentEntries(document, {
        first_name: "first_name", last_name: "last_name", date_of_birth: "date_of_birth",
        nationality: "nationality", document_number: "document_number", document_type: "document_type",
        issuing_country: "issuing_country", issuing_state: "issuing_country", expiration_date: "expiry_date",
        expiry_date: "expiry_date", address: "address", parsed_address: "parsed_address",
      });
      identityAttributes.push(...fields.map((field, stableOrdinal) => createIdentityAttribute({
        ...field, provider: PROVIDER, providerSessionId, providerReportReference: reference,
        sourceDocumentReference: reference, sourceDocumentType: documentType,
        sourceDocumentCountry: issuingCountry, extractedAt, stableOrdinal,
      })));
      observations.push(createVerificationObservation({
        type: OBSERVATION_TYPES.DOCUMENT_AUTHENTICITY,
        status: mapObservationStatus(document.status), provider: PROVIDER, providerSessionId,
        providerReference: reference, observedAt: document.completed_at || extractedAt,
        originalProviderStatus: document.status,
      }));
      if (document.document_validity != null) observations.push(createVerificationObservation({
        type: OBSERVATION_TYPES.DOCUMENT_VALIDITY,
        status: mapObservationStatus(document.document_validity), provider: PROVIDER, providerSessionId,
        providerReference: reference, observedAt: document.completed_at || extractedAt,
        originalProviderStatus: String(document.document_validity),
      }));
      externalReferences.push(createExternalEvidenceReference({
        provider: PROVIDER, providerSessionId, providerReference: reference,
        evidenceCategory: "IDENTITY_DOCUMENT", documentType, issuingCountry,
        capturedAt: document.created_at || decision.created_at,
        providerIntegrityReference: document.integrity_reference || null,
      }));
    }
    const observationGroups = [
      [decision.liveness_checks || decision.liveness, OBSERVATION_TYPES.LIVENESS],
      [decision.face_matches || decision.face_match, OBSERVATION_TYPES.FACE_MATCH],
      [decision.nfc_verifications || decision.nfc_verification, OBSERVATION_TYPES.NFC_VERIFICATION],
      [decision.database_verifications || decision.database_validation, OBSERVATION_TYPES.DATABASE_VERIFICATION],
    ];
    for (const [items, type] of observationGroups) {
      for (const item of array(items)) observations.push(createVerificationObservation({
        type, status: mapObservationStatus(item), provider: PROVIDER, providerSessionId,
        providerReference: item.node_id || item.request_id || reportReference,
        observedAt: item.completed_at || item.created_at || decision.updated_at,
        method: item.method || null, score: Number(item.score),
        originalProviderStatus: item.status || item.result || String(item),
      }));
    }
    const normalized = {
      provider: PROVIDER,
      provider_session_id: providerSessionId,
      provider_report_id: reportReference,
      identity_attributes: identityAttributes,
      verification_observations: observations,
      provider_decision: createProviderDecision({
        canonicalStatus: mapProviderStatus(status), provider: PROVIDER, providerSessionId,
        providerReportReference: reportReference, originalProviderStatus: status,
        originalProviderReason: firstDefined(decision.reason, decision.decline_reason, null),
        originalProviderReasonCode: firstDefined(decision.reason_code, decision.code, null),
        decidedAt: firstDefined(decision.decision_at, decision.completed_at, decision.updated_at), receivedAt,
      }),
      external_evidence_references: externalReferences,
      timestamps: {
        created_at: iso(decision.created_at),
        verification_started_at: iso(firstDefined(decision.started_at, decision.initiated_at)),
        document_submitted_at: iso(firstDefined(decision.document_submitted_at, decision.submitted_at)),
        extraction_available_at: iso(extractedAt),
        provider_completed_at: iso(firstDefined(decision.completed_at, decision.decision_at)),
        result_received_at: iso(receivedAt, this.now()),
      },
      provider_extensions: {
        original_status: status || null,
        original_reason: firstDefined(decision.reason, decision.decline_reason, null),
        original_reason_code: firstDefined(decision.reason_code, decision.code, null),
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
      nfc: "NOT_CONFIGURED", nfc_support: "SUPPORTED",
      database_verification: "NOT_CONFIGURED", database_verification_support: "UNKNOWN",
      raw_evidence_custody: "PROVIDER",
    };
  }

  getExternalEvidenceReferences(result) { return result?.external_evidence_references || []; }

  getProviderCostInformation(result) {
    const modules = [...new Set((result?.verification_observations || []).map((item) => item.observation_type))];
    return this.costPolicy.estimate({ provider: PROVIDER, workflow: result?.provider_workflow || this.config.workflowId, modules });
  }
}

module.exports = { DiditAdapter, ADAPTER_VERSION };
