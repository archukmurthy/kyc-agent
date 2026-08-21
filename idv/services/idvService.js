"use strict";

const { randomUUID } = require("crypto");
const { assertProviderAdapter } = require("../contracts/providerAdapter");
const {
  CANONICAL_STATUSES,
  TERMINAL_STATUSES,
  OBSERVATION_TYPES,
  OBSERVATION_STATUSES,
  CUSTOMER_RESPONSE_ACTIONS,
  LIFECYCLE_EVENTS,
  CAPABILITY_STATES,
} = require("../domain/constants");
const { createCanonicalSession, createCustomerResponse, assertNoRawEvidence } = require("../domain/canonical");
const { reconcileSessionStatus } = require("../domain/stateMachine");
const { SessionNotFoundError, IdentityAuthenticationError, IdentityAuthorizationError } = require("../domain/errors");
const { createLifecycleEvent, providerScorecard } = require("./metrics");
const { PURPOSES } = require("../security/securityContext");

const OBSERVATION_EVENT = Object.freeze({
  [OBSERVATION_TYPES.DOCUMENT_AUTHENTICITY]: LIFECYCLE_EVENTS.DOCUMENT_VERIFICATION_COMPLETED,
  [OBSERVATION_TYPES.DOCUMENT_VALIDITY]: LIFECYCLE_EVENTS.DOCUMENT_VERIFICATION_COMPLETED,
  [OBSERVATION_TYPES.LIVENESS]: LIFECYCLE_EVENTS.LIVENESS_COMPLETED,
  [OBSERVATION_TYPES.FACE_MATCH]: LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED,
  [OBSERVATION_TYPES.DATABASE_VERIFICATION]: LIFECYCLE_EVENTS.DATABASE_VERIFICATION_COMPLETED,
});

function capabilityState(observations, type, configured) {
  if ((observations || []).some((item) => item.observation_type === type)) return CAPABILITY_STATES.EXECUTED;
  return configured || CAPABILITY_STATES.UNKNOWN;
}

function syntheticAccess(session, purpose, fields, correlationId) {
  return {
    synthetic: true,
    tenantId: session.tenant_id,
    actorId: "SYNTHETIC_TEST_ACTOR",
    subjectId: session.subject_person_id || `synthetic:${session.internal_idv_session_id}`,
    purpose,
    fields,
    correlationId,
  };
}

class IdvService {
  constructor({
    adapters,
    router,
    sessionRepository,
    resultRepository,
    webhookReceiptStore,
    eventStore,
    costLedgerRepository,
    groundTruthRepository,
    secureIdentityStore,
    identityAccessFactory,
    now = () => new Date(),
  }) {
    this.adapters = Object.fromEntries(Object.entries(adapters || {}).map(([provider, adapter]) => [provider, assertProviderAdapter(adapter)]));
    this.router = router;
    this.sessions = sessionRepository;
    this.results = resultRepository;
    this.webhooks = webhookReceiptStore;
    this.events = eventStore;
    this.costs = costLedgerRepository || null;
    this.groundTruth = groundTruthRepository || null;
    this.identityStore = secureIdentityStore;
    this.identityAccessFactory = identityAccessFactory;
    this.now = now;
  }

  adapter(provider) {
    const adapter = this.adapters[provider];
    if (!adapter) throw new TypeError(`No IDV adapter configured for provider ${provider}`);
    return adapter;
  }

  async accessFor(session, purpose, fields, correlationId, securityContext) {
    if (session.synthetic_test_data) return syntheticAccess(session, purpose, fields, correlationId);
    if (typeof this.identityAccessFactory !== "function") throw new IdentityAuthenticationError("Production identity access factory is unavailable");
    return this.identityAccessFactory({ session, purpose, fields, correlationId, securityContext });
  }

  async emit(type, session, { occurredAt, dimensions, metadata } = {}) {
    return this.events.append(createLifecycleEvent({ type, session, occurredAt, dimensions, metadata }));
  }

  async startVerification(input) {
    if (!input.tenantId || !input.customerContextId) throw new TypeError("tenantId and customerContextId are required");
    if (!input.syntheticTestData && !input.subjectPersonId) throw new IdentityAuthorizationError("Non-synthetic IDV requires an authorized subjectPersonId");
    const provider = input.provider || this.router.select(input);
    const adapter = this.adapter(provider);
    const internalIdvSessionId = input.internalIdvSessionId || randomUUID();
    const providerSession = await adapter.createVerificationSession({ ...input, internalIdvSessionId });
    const session = createCanonicalSession({
      internalIdvSessionId,
      tenantId: input.tenantId,
      customerContextId: input.customerContextId,
      subjectPersonId: input.subjectPersonId || `synthetic:${internalIdvSessionId}`,
      provider,
      providerSessionId: providerSession.provider_session_id,
      providerReportId: providerSession.provider_report_id,
      providerWorkflow: providerSession.provider_workflow,
      providerWorkflowVersion: providerSession.provider_workflow_version,
      providerAdapterVersion: providerSession.provider_adapter_version,
      canonicalStatus: providerSession.canonical_status || CANONICAL_STATUSES.READY,
      originalProviderStatus: providerSession.original_provider_status,
      createdAt: providerSession.created_at,
      syntheticTestData: input.syntheticTestData,
      dimensions: {
        tenant_id: input.tenantId,
        country: input.country || null,
        document_issuing_country: input.documentIssuingCountry || null,
        document_type: input.documentType || null,
        device_platform: input.devicePlatform || null,
        liveness_method: input.livenessMethod || null,
        database_verification_state: input.databaseVerificationState || (input.databaseVerificationEnabled === true ? CAPABILITY_STATES.SUPPORTED : CAPABILITY_STATES.NOT_REQUESTED),
        nfc_state: input.nfcState || (input.nfcEnabled === true ? CAPABILITY_STATES.SUPPORTED : CAPABILITY_STATES.NOT_REQUESTED),
        test_case_id: input.testCaseId || null,
        poc_cohort_id: input.pocCohortId || null,
      },
    });
    const stored = await this.sessions.create(session);
    await this.emit(LIFECYCLE_EVENTS.IDV_SESSION_CREATED, stored);
    return { session: stored, hosted_verification_url: adapter.getHostedVerificationUrl(providerSession), capabilities: adapter.getCapabilities() };
  }

  async markHostedFlowOpened(internalIdvSessionId, dimensions = {}) {
    const session = await this.requireSession(internalIdvSessionId);
    if (TERMINAL_STATUSES.has(session.canonical_status)) return session;
    const openedAt = this.now().toISOString();
    const updated = await this.sessions.save({
      ...session,
      canonical_status: CANONICAL_STATUSES.STARTED,
      verification_started_at: session.verification_started_at || openedAt,
      timestamp_provenance: { ...session.timestamp_provenance, verification_started_at: "PLATFORM_REDIRECT_PROXY" },
      dimensions: { ...session.dimensions, ...dimensions },
    }, session.record_version);
    const estimated = this.adapter(session.provider).getProviderCostInformation({ verification_observations: [] });
    await this.emit(LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, updated, {
      occurredAt: openedAt,
      metadata: { timestamp_source: "PLATFORM_REDIRECT_PROXY", cost: estimated },
    });
    if (this.costs && estimated.estimated_cost != null) {
      await this.costs.append({
        tenant_id: session.tenant_id,
        internal_idv_session_id: session.internal_idv_session_id,
        provider: session.provider,
        workflow: session.provider_workflow,
        module: null,
        billing_trigger: estimated.billing_trigger,
        amount: estimated.estimated_cost,
        currency: estimated.currency,
        cost_basis: "ESTIMATED",
        pricing_source: estimated.cost_source,
        pricing_version: estimated.cost_version,
        incurred_at: openedAt,
      });
    }
    return updated;
  }

  async recordCustomerReturn(internalIdvSessionId) {
    const session = await this.requireSession(internalIdvSessionId);
    const returnedAt = this.now().toISOString();
    const updated = await this.sessions.save({ ...session, customer_returned_at: returnedAt }, session.record_version);
    await this.emit(LIFECYCLE_EVENTS.CUSTOMER_RETURNED, updated, { occurredAt: returnedAt, metadata: { authoritative_decision: false } });
    return updated;
  }

  async recordCustomerReturnByProviderSession(provider, providerSessionId) {
    const session = await this.sessions.getByProviderSession(provider, providerSessionId);
    if (!session) throw new SessionNotFoundError(`${provider}:${providerSessionId}`);
    return this.recordCustomerReturn(session.internal_idv_session_id);
  }

  async processWebhook(provider, input) {
    const adapter = this.adapter(provider);
    const receivedAt = new Date(input.receivedAt || this.now()).toISOString();
    const providerEvent = await adapter.handleWebhook({ ...input, receivedAt });
    const claim = await this.webhooks.begin(provider, providerEvent.eventId, receivedAt);
    if (!claim.accepted) return { duplicate: true, receipt: claim.receipt };
    try {
      const session = await this.sessions.getByProviderSession(provider, providerEvent.providerSessionId);
      if (!session) throw new SessionNotFoundError(`${provider}:${providerEvent.providerSessionId}`);
      const result = providerEvent.requiresReconciliation
        ? await adapter.retrieveVerificationResult(providerEvent.providerSessionId)
        : providerEvent.result;
      const incomingStatus = result?.provider_decision?.canonical_status || providerEvent.canonicalStatus;
      const reconciliation = reconcileSessionStatus(session, incomingStatus, providerEvent.occurredAt);
      const timestamps = result?.timestamps || {};
      const canonicalCompletedAt = TERMINAL_STATUSES.has(incomingStatus) ? receivedAt : session.canonical_result_completed_at;
      const next = {
        ...reconciliation.session,
        original_provider_status: providerEvent.originalProviderStatus || session.original_provider_status,
        provider_report_id: result?.provider_report_id || session.provider_report_id,
        verification_started_at: session.verification_started_at || timestamps.verification_started_at,
        document_submitted_at: session.document_submitted_at || timestamps.document_submitted_at,
        extraction_available_at: session.extraction_available_at || timestamps.extraction_available_at,
        provider_completed_at: session.provider_completed_at || timestamps.provider_completed_at,
        provider_decision_at: session.provider_decision_at || result?.provider_decision?.decided_at || null,
        provider_result_received_at: session.provider_result_received_at || receivedAt,
        result_received_at: session.result_received_at || receivedAt,
        completed_at: reconciliation.session.completed_at || canonicalCompletedAt,
        canonical_result_completed_at: session.canonical_result_completed_at || canonicalCompletedAt,
        timestamp_provenance: {
          ...session.timestamp_provenance,
          provider_decision_at: result?.provider_decision?.decided_at ? "PROVIDER_EXACT" : "UNAVAILABLE",
          provider_result_received_at: "PLATFORM_OBSERVED",
          canonical_result_completed_at: TERMINAL_STATUSES.has(incomingStatus) ? "PLATFORM_OBSERVED" : "UNAVAILABLE",
        },
      };
      if (result) {
        result.cost = adapter.getProviderCostInformation({ ...result, provider_workflow: session.provider_workflow });
        assertNoRawEvidence(result);
        if (result.identity_attributes?.length) {
          const fields = result.identity_attributes.map((item) => item.attribute_concept);
          const access = await this.accessFor(session, PURPOSES.PROVIDER_INGESTION, fields, providerEvent.eventId, input.securityContext);
          const storedIdentity = await this.identityStore.storeExtractedIdentity({
            internalIdvSessionId: session.internal_idv_session_id,
            attributes: result.identity_attributes,
            access,
            retentionMetadata: { policy_id: input.retentionPolicyId || null, provider: session.provider },
          });
          next.secure_identity_reference = storedIdentity.secureIdentityReference;
        }
        const { identity_attributes: _pii, ...resultWithoutPii } = result;
        await this.results.save(session.internal_idv_session_id, resultWithoutPii, session.tenant_id);
      }
      const stored = await this.sessions.save(next, session.record_version);
      await this.emitResultEvents(session, stored, result, providerEvent, receivedAt);
      await this.webhooks.complete(provider, providerEvent.eventId, {
        tenant_id: session.tenant_id,
        internal_idv_session_id: session.internal_idv_session_id,
        reconciliation: reconciliation.reason,
      });
      return { duplicate: false, session: stored, reconciliation: reconciliation.reason };
    } catch (error) {
      await this.webhooks.fail(provider, providerEvent.eventId, error.code);
      throw error;
    }
  }

  async emitResultEvents(previous, session, result, providerEvent, receivedAt) {
    if (!result) return;
    const timestamps = result.timestamps || {};
    const existing = await this.events.listForSession(session.internal_idv_session_id, session.tenant_id);
    const already = new Set(existing.map((event) => event.event_type));
    if (!previous.document_submitted_at && timestamps.document_submitted_at) {
      await this.emit(LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED, session, { occurredAt: timestamps.document_submitted_at, metadata: { timestamp_source: "PROVIDER_EXACT" } });
    }
    if (!previous.extraction_available_at && result.identity_attributes?.length) {
      await this.emit(LIFECYCLE_EVENTS.EXTRACTION_AVAILABLE, session, {
        occurredAt: timestamps.extraction_available_at || receivedAt,
        metadata: { attribute_count: result.identity_attributes.length, timestamp_source: timestamps.extraction_available_at ? "PROVIDER_EXACT" : "PLATFORM_OBSERVED" },
      });
    }
    const emittedTypes = new Set();
    for (const observation of result.verification_observations || []) {
      const eventType = OBSERVATION_EVENT[observation.observation_type];
      if (!eventType || emittedTypes.has(eventType)) continue;
      emittedTypes.add(eventType);
      const metadata = {
        passed: observation.status === OBSERVATION_STATUSES.PASSED,
        observation_status: observation.status,
        timestamp_source: observation.observed_at ? "PROVIDER_EXACT" : "PLATFORM_OBSERVED",
      };
      if (Number.isInteger(observation.attempt) && observation.attempt > 0) metadata.attempt = observation.attempt;
      await this.emit(eventType, session, {
        occurredAt: observation.observed_at || receivedAt,
        dimensions: {
          document_issuing_country: session.dimensions.document_issuing_country,
          document_type: session.dimensions.document_type,
          liveness_method: observation.observation_type === OBSERVATION_TYPES.LIVENESS ? observation.method : session.dimensions.liveness_method,
          database_verification_state: capabilityState(result.verification_observations, OBSERVATION_TYPES.DATABASE_VERIFICATION, session.dimensions.database_verification_state),
          nfc_state: capabilityState(result.verification_observations, OBSERVATION_TYPES.NFC_VERIFICATION, session.dimensions.nfc_state),
        },
        metadata,
      });
    }
    await this.emit(LIFECYCLE_EVENTS.PROVIDER_DECISION_RECEIVED, session, {
      occurredAt: result.provider_decision?.decided_at || providerEvent.occurredAt,
      metadata: {
        canonical_status: result.provider_decision?.canonical_status,
        original_provider_status: result.provider_decision?.original_provider_status,
        timestamp_source: result.provider_decision?.decided_at ? "PROVIDER_EXACT" : "PROXY",
        cost: result.cost,
      },
    });
    await this.emit(LIFECYCLE_EVENTS.PROVIDER_RESULT_RECEIVED, session, {
      occurredAt: receivedAt,
      metadata: { provider_decided_at: result.provider_decision?.decided_at || null, timestamp_source: "PLATFORM_OBSERVED" },
    });
    if (session.canonical_status === CANONICAL_STATUSES.REQUIRES_RETRY) {
      await this.emit(LIFECYCLE_EVENTS.RESUBMISSION_REQUESTED, session, { occurredAt: providerEvent.occurredAt, metadata: { retry_stage: providerEvent.retryStage || "UNAVAILABLE" } });
    } else if (TERMINAL_STATUSES.has(session.canonical_status) && !already.has(LIFECYCLE_EVENTS.IDV_TERMINAL)) {
      const priorRetries = existing.filter((event) => event.event_type === LIFECYCLE_EVENTS.RESUBMISSION_REQUESTED).length;
      const terminalMetadata = { canonical_status: session.canonical_status, observed_retry_count: priorRetries, cost: result.cost };
      if (session.canonical_status === CANONICAL_STATUSES.ABANDONED) {
        await this.emit(LIFECYCLE_EVENTS.IDV_ABANDONED, session, { occurredAt: session.canonical_result_completed_at || receivedAt });
      }
      await this.emit(LIFECYCLE_EVENTS.IDV_TERMINAL, session, { occurredAt: session.canonical_result_completed_at || receivedAt, metadata: terminalMetadata });
      await this.emit(LIFECYCLE_EVENTS.IDV_COMPLETED, session, { occurredAt: session.canonical_result_completed_at || receivedAt, metadata: terminalMetadata });
    }
  }

  async recordAttributesPresented(internalIdvSessionId, attributeIds, options = {}) {
    const session = await this.requireSession(internalIdvSessionId);
    if (!session.secure_identity_reference) throw new TypeError("Secure identity reference is unavailable");
    const fields = options.fields || [];
    if (!fields.length) throw new IdentityAuthorizationError("Presented identity fields must be explicit");
    const access = await this.accessFor(session, PURPOSES.CUSTOMER_CONFIRMATION, fields, options.correlationId || randomUUID(), options.securityContext);
    const retrieved = await this.identityStore.retrieveIdentityForAuthorizedPurpose({
      identityReference: session.secure_identity_reference, access, fields, attributeIds,
    });
    for (const attribute of retrieved.attributes) {
      await this.emit(LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_PRESENTED, session, {
        metadata: { attribute_id: attribute.attribute_id, attribute_concept: attribute.attribute_concept },
      });
    }
    return retrieved.attributes.map((attribute) => ({
      attribute_id: attribute.attribute_id,
      attribute_concept: attribute.attribute_concept,
      attribute_value: attribute.attribute_value,
    }));
  }

  async recordCustomerResponse(input) {
    const session = await this.requireSession(input.internalIdvSessionId);
    if (!session.secure_identity_reference) throw new TypeError("Secure identity reference is unavailable");
    if (!input.attributeConcept) throw new TypeError("attributeConcept is required");
    if (input.action === CUSTOMER_RESPONSE_ACTIONS.CORRECTED && (input.submittedValue === undefined || input.submittedValue === null || input.submittedValue === "")) {
      throw new TypeError("A corrected identity value is required");
    }
    const fields = [input.attributeConcept];
    const correlationId = input.correlationId || randomUUID();
    const access = await this.accessFor(session, PURPOSES.CUSTOMER_CONFIRMATION, fields, correlationId, input.securityContext);
    const retrieved = await this.identityStore.retrieveIdentityForAuthorizedPurpose({
      identityReference: session.secure_identity_reference,
      access,
      fields,
      attributeIds: [input.attributeId],
    });
    const attribute = retrieved.attributes[0];
    if (!attribute || attribute.attribute_concept !== input.attributeConcept) throw new TypeError("Provider extraction attribute was not found");
    const response = createCustomerResponse({
      internalIdvSessionId: input.internalIdvSessionId,
      attributeId: attribute.attribute_id,
      attributeConcept: attribute.attribute_concept,
      action: input.action,
      previousValue: attribute.attribute_value,
      submittedValue: input.action === CUSTOMER_RESPONSE_ACTIONS.CORRECTED ? input.submittedValue : attribute.attribute_value,
      occurredAt: input.occurredAt,
    });
    if (input.action === CUSTOMER_RESPONSE_ACTIONS.CORRECTED) {
      await this.identityStore.recordCustomerCorrection({ identityReference: session.secure_identity_reference, response, access });
    } else if (input.action === CUSTOMER_RESPONSE_ACTIONS.CONFIRMED) {
      await this.identityStore.recordCustomerConfirmation({ identityReference: session.secure_identity_reference, response, access });
    } else {
      await this.identityStore.recordCustomerRejection({ identityReference: session.secure_identity_reference, response, access });
    }
    const eventType = input.action === CUSTOMER_RESPONSE_ACTIONS.CORRECTED
      ? LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CORRECTED
      : input.action === CUSTOMER_RESPONSE_ACTIONS.REJECTED
        ? LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_REJECTED
        : LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CONFIRMED;
    await this.emit(eventType, session, {
      occurredAt: response.occurred_at,
      metadata: { attribute_id: attribute.attribute_id, attribute_concept: attribute.attribute_concept },
    });
    return response;
  }

  async recordPocGroundTruth(input) {
    if (!this.groundTruth) throw new TypeError("POC ground-truth repository is unavailable");
    const session = await this.requireSession(input.internalIdvSessionId);
    if (!/^TEST-[A-Z0-9-]{3,80}$/.test(input.testCaseId || "")) throw new TypeError("A non-PII TEST-* testCaseId is required");
    const context = input.securityContext;
    if (!session.synthetic_test_data && (!context || !context.scopes?.includes("idv:poc:label") || context.tenantId !== session.tenant_id)) {
      throw new IdentityAuthorizationError("POC ground-truth labeling is not authorized");
    }
    return this.groundTruth.save({
      tenant_id: session.tenant_id,
      internal_idv_session_id: session.internal_idv_session_id,
      test_case_id: input.testCaseId,
      genuine_user_label: input.genuineUserLabel,
      label_source: input.labelSource || "CONTROLLED_TESTER_ATTESTATION",
      valid_technical_opportunity: input.validTechnicalOpportunity,
      comparison_flags: input.comparisonFlags || {},
      recorded_by_actor_id: context?.actorId || "SYNTHETIC_TEST_ACTOR",
      recorded_at: this.now().toISOString(),
    });
  }

  async recordActualConfirmedCost(input) {
    if (!this.costs) throw new TypeError("Cost ledger repository is unavailable");
    const context = input.securityContext;
    if (!context || !context.scopes?.includes("idv:cost:write")) throw new IdentityAuthorizationError("Confirmed cost ingestion is not authorized");
    const session = await this.requireSession(input.internalIdvSessionId, context.tenantId);
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(input.currency || "")) throw new TypeError("Confirmed cost amount/currency is invalid");
    return this.costs.append({
      tenant_id: session.tenant_id,
      internal_idv_session_id: session.internal_idv_session_id,
      provider: session.provider,
      workflow: session.provider_workflow,
      module: input.module || null,
      billing_trigger: input.billingTrigger || null,
      amount,
      currency: input.currency,
      cost_basis: "ACTUAL_CONFIRMED",
      pricing_source: input.pricingSource || null,
      pricing_version: input.pricingVersion || null,
      incurred_at: input.incurredAt || null,
      confirmed_at: this.now().toISOString(),
    });
  }

  async requireSession(id, tenantId) {
    const session = await this.sessions.get(id, tenantId);
    if (!session) throw new SessionNotFoundError(id);
    return session;
  }

  async getSession(id, tenantId) {
    const session = await this.requireSession(id, tenantId);
    return { session, result: await this.results.get(id, session.tenant_id) };
  }

  async getMetrics(filter = {}) {
    const [events, labels, costs] = await Promise.all([
      this.events.list(filter),
      this.groundTruth ? this.groundTruth.list(filter) : [],
      this.costs && filter.tenantId ? this.costs.list(filter) : [],
    ]);
    return providerScorecard(events, { labels, costs, filter });
  }
}

module.exports = { IdvService, capabilityState };
