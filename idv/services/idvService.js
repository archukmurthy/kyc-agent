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
} = require("../domain/constants");
const {
  createCanonicalSession,
  createCustomerResponse,
  assertNoRawEvidence,
  iso,
} = require("../domain/canonical");
const { reconcileSessionStatus } = require("../domain/stateMachine");
const { SessionNotFoundError } = require("../domain/errors");
const { createLifecycleEvent, providerScorecard } = require("./metrics");

const OBSERVATION_EVENT = Object.freeze({
  [OBSERVATION_TYPES.DOCUMENT_AUTHENTICITY]: LIFECYCLE_EVENTS.DOCUMENT_VERIFICATION_COMPLETED,
  [OBSERVATION_TYPES.DOCUMENT_VALIDITY]: LIFECYCLE_EVENTS.DOCUMENT_VERIFICATION_COMPLETED,
  [OBSERVATION_TYPES.LIVENESS]: LIFECYCLE_EVENTS.LIVENESS_COMPLETED,
  [OBSERVATION_TYPES.FACE_MATCH]: LIFECYCLE_EVENTS.FACE_MATCH_COMPLETED,
  [OBSERVATION_TYPES.DATABASE_VERIFICATION]: LIFECYCLE_EVENTS.DATABASE_VERIFICATION_COMPLETED,
});

class IdvService {
  constructor({
    adapters,
    router,
    sessionRepository,
    resultRepository,
    webhookReceiptStore,
    eventStore,
    secureIdentityStore,
    now = () => new Date(),
  }) {
    this.adapters = Object.fromEntries(Object.entries(adapters || {}).map(([provider, adapter]) => [provider, assertProviderAdapter(adapter)]));
    this.router = router;
    this.sessions = sessionRepository;
    this.results = resultRepository;
    this.webhooks = webhookReceiptStore;
    this.events = eventStore;
    this.identityStore = secureIdentityStore;
    this.now = now;
  }

  adapter(provider) {
    const adapter = this.adapters[provider];
    if (!adapter) throw new TypeError(`No IDV adapter configured for provider ${provider}`);
    return adapter;
  }

  async emit(type, session, { occurredAt, dimensions, metadata } = {}) {
    return this.events.append(createLifecycleEvent({ type, session, occurredAt, dimensions, metadata }));
  }

  async startVerification(input) {
    if (!input.tenantId || !input.customerContextId) throw new TypeError("tenantId and customerContextId are required");
    const provider = input.provider || this.router.select(input);
    const adapter = this.adapter(provider);
    const internalIdvSessionId = input.internalIdvSessionId || randomUUID();
    const providerSession = await adapter.createVerificationSession({ ...input, internalIdvSessionId });
    const session = createCanonicalSession({
      internalIdvSessionId,
      tenantId: input.tenantId,
      customerContextId: input.customerContextId,
      subjectPersonId: input.subjectPersonId,
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
        country: input.country || null,
        document_issuing_country: input.documentIssuingCountry || null,
        document_type: input.documentType || null,
        device_platform: input.devicePlatform || null,
        liveness_method: input.livenessMethod || null,
        database_verification_enabled: input.databaseVerificationEnabled === true,
        nfc_enabled: input.nfcEnabled === true,
        test_case_id: input.testCaseId || null,
      },
    });
    const stored = await this.sessions.create(session);
    await this.emit(LIFECYCLE_EVENTS.IDV_SESSION_CREATED, stored);
    return {
      session: stored,
      hosted_verification_url: adapter.getHostedVerificationUrl(providerSession),
      capabilities: adapter.getCapabilities(),
    };
  }

  async markHostedFlowOpened(internalIdvSessionId, dimensions = {}) {
    const session = await this.requireSession(internalIdvSessionId);
    if (TERMINAL_STATUSES.has(session.canonical_status)) return session;
    const openedAt = this.now().toISOString();
    const updated = await this.sessions.save({
      ...session,
      canonical_status: CANONICAL_STATUSES.STARTED,
      verification_started_at: session.verification_started_at || openedAt,
      dimensions: { ...session.dimensions, ...dimensions },
    }, session.record_version);
    const estimated = this.adapter(session.provider).getProviderCostInformation({ verification_observations: [] });
    await this.emit(LIFECYCLE_EVENTS.HOSTED_FLOW_OPENED, updated, {
      occurredAt: openedAt,
      metadata: { estimated_cost: estimated.estimated_cost },
    });
    return updated;
  }

  async recordCustomerReturn(internalIdvSessionId) {
    const session = await this.requireSession(internalIdvSessionId);
    const returnedAt = this.now().toISOString();
    const updated = await this.sessions.save({ ...session, customer_returned_at: returnedAt }, session.record_version);
    await this.emit(LIFECYCLE_EVENTS.CUSTOMER_RETURNED, updated, {
      occurredAt: returnedAt,
      metadata: { authoritative_decision: false },
    });
    return updated;
  }

  async recordCustomerReturnByProviderSession(provider, providerSessionId) {
    const session = await this.sessions.getByProviderSession(provider, providerSessionId);
    if (!session) throw new SessionNotFoundError(`${provider}:${providerSessionId}`);
    return this.recordCustomerReturn(session.internal_idv_session_id);
  }

  async processWebhook(provider, input) {
    const adapter = this.adapter(provider);
    const providerEvent = await adapter.handleWebhook(input);
    const claim = await this.webhooks.begin(provider, providerEvent.eventId, input.receivedAt || this.now());
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
      const next = {
        ...reconciliation.session,
        original_provider_status: providerEvent.originalProviderStatus || session.original_provider_status,
        provider_report_id: result?.provider_report_id || session.provider_report_id,
        verification_started_at: session.verification_started_at || timestamps.verification_started_at,
        document_submitted_at: session.document_submitted_at || timestamps.document_submitted_at,
        extraction_available_at: session.extraction_available_at || timestamps.extraction_available_at,
        provider_completed_at: session.provider_completed_at || timestamps.provider_completed_at,
        result_received_at: timestamps.result_received_at || this.now().toISOString(),
        completed_at: reconciliation.session.completed_at || (TERMINAL_STATUSES.has(incomingStatus) ? (timestamps.provider_completed_at || providerEvent.occurredAt) : null),
      };
      if (result) {
        assertNoRawEvidence(result);
        if (result.identity_attributes?.length) {
          await this.identityStore.persistProviderExtraction(
            session.internal_idv_session_id,
            result.identity_attributes,
            { synthetic: session.synthetic_test_data },
          );
        }
        const { identity_attributes: _pii, ...resultWithoutPii } = result;
        await this.results.save(session.internal_idv_session_id, resultWithoutPii);
      }
      const stored = await this.sessions.save(next, session.record_version);
      await this.emitResultEvents(session, stored, result, providerEvent);
      await this.webhooks.complete(provider, providerEvent.eventId, {
        internal_idv_session_id: session.internal_idv_session_id,
        reconciliation: reconciliation.reason,
      });
      return { duplicate: false, session: stored, reconciliation: reconciliation.reason };
    } catch (error) {
      await this.webhooks.fail(provider, providerEvent.eventId, error.code);
      throw error;
    }
  }

  async emitResultEvents(previous, session, result, providerEvent) {
    if (!result) return;
    const timestamps = result.timestamps || {};
    if (!previous.document_submitted_at && timestamps.document_submitted_at) {
      await this.emit(LIFECYCLE_EVENTS.DOCUMENT_SUBMITTED, session, { occurredAt: timestamps.document_submitted_at });
    }
    if (!previous.extraction_available_at && result.identity_attributes?.length) {
      await this.emit(LIFECYCLE_EVENTS.EXTRACTION_AVAILABLE, session, {
        occurredAt: timestamps.extraction_available_at || providerEvent.occurredAt,
        metadata: { attribute_count: result.identity_attributes.length },
      });
    }
    const emittedTypes = new Set();
    for (const observation of result.verification_observations || []) {
      const eventType = OBSERVATION_EVENT[observation.observation_type];
      if (!eventType || emittedTypes.has(eventType)) continue;
      emittedTypes.add(eventType);
      await this.emit(eventType, session, {
        occurredAt: observation.observed_at || providerEvent.occurredAt,
        dimensions: {
          document_issuing_country: session.dimensions.document_issuing_country,
          document_type: session.dimensions.document_type,
          liveness_method: observation.observation_type === OBSERVATION_TYPES.LIVENESS ? observation.method : session.dimensions.liveness_method,
        },
        metadata: {
          passed: observation.status === OBSERVATION_STATUSES.PASSED,
          observation_status: observation.status,
          attempt: 1,
        },
      });
    }
    await this.emit(LIFECYCLE_EVENTS.PROVIDER_DECISION_RECEIVED, session, {
      occurredAt: result.provider_decision?.decided_at || providerEvent.occurredAt,
      metadata: {
        canonical_status: result.provider_decision?.canonical_status,
        original_provider_status: result.provider_decision?.original_provider_status,
        cost: result.cost,
      },
    });
    if (session.canonical_status === CANONICAL_STATUSES.REQUIRES_RETRY) {
      await this.emit(LIFECYCLE_EVENTS.DOCUMENT_RETRY_REQUESTED, session, { occurredAt: providerEvent.occurredAt });
    } else if (session.canonical_status === CANONICAL_STATUSES.ABANDONED) {
      await this.emit(LIFECYCLE_EVENTS.IDV_ABANDONED, session, { occurredAt: session.completed_at || providerEvent.occurredAt });
    } else if (TERMINAL_STATUSES.has(session.canonical_status)) {
      const priorEvents = await this.events.listForSession(session.internal_idv_session_id);
      const attempts = 1 + priorEvents.filter((event) => event.event_type === LIFECYCLE_EVENTS.DOCUMENT_RETRY_REQUESTED).length;
      await this.emit(LIFECYCLE_EVENTS.IDV_COMPLETED, session, {
        occurredAt: session.completed_at || providerEvent.occurredAt,
        metadata: { canonical_status: session.canonical_status, attempt_count: attempts, cost: result.cost },
      });
    }
  }

  async recordAttributesPresented(internalIdvSessionId, attributeIds) {
    const session = await this.requireSession(internalIdvSessionId);
    const attributes = await this.identityStore.getProviderExtractions(internalIdvSessionId, { synthetic: session.synthetic_test_data });
    const wanted = new Set(attributeIds);
    for (const attribute of attributes.filter((item) => wanted.has(item.attribute_id))) {
      await this.emit(LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_PRESENTED, session, {
        metadata: { attribute_concept: attribute.attribute_concept },
      });
    }
  }

  async recordCustomerResponse(input) {
    const session = await this.requireSession(input.internalIdvSessionId);
    const context = { synthetic: session.synthetic_test_data };
    const attributes = await this.identityStore.getProviderExtractions(input.internalIdvSessionId, context);
    const attribute = attributes.find((item) => item.attribute_id === input.attributeId);
    if (!attribute) throw new TypeError("Provider extraction attribute was not found");
    const response = createCustomerResponse({
      internalIdvSessionId: input.internalIdvSessionId,
      attributeId: attribute.attribute_id,
      attributeConcept: attribute.attribute_concept,
      action: input.action,
      previousValue: attribute.attribute_value,
      submittedValue: input.action === CUSTOMER_RESPONSE_ACTIONS.CORRECTED ? input.submittedValue : attribute.attribute_value,
      occurredAt: input.occurredAt,
    });
    await this.identityStore.appendCustomerResponse(input.internalIdvSessionId, response, context);
    const eventType = input.action === CUSTOMER_RESPONSE_ACTIONS.CORRECTED
      ? LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CORRECTED
      : LIFECYCLE_EVENTS.IDENTITY_ATTRIBUTE_CONFIRMED;
    await this.emit(eventType, session, {
      occurredAt: response.occurred_at,
      metadata: { attribute_concept: attribute.attribute_concept },
    });
    return response;
  }

  async requireSession(id) {
    const session = await this.sessions.get(id);
    if (!session) throw new SessionNotFoundError(id);
    return session;
  }

  async getSession(id) {
    const session = await this.requireSession(id);
    return { session, result: await this.results.get(id) };
  }

  async getMetrics() {
    return providerScorecard(await this.events.list());
  }
}

module.exports = { IdvService };
