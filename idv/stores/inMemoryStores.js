"use strict";

const { randomUUID } = require("crypto");
const { SecureIdentityStore } = require("../contracts/secureIdentityStore");
const { SecureStoreRequiredError } = require("../domain/errors");
const { assertNoRawEvidence } = require("../domain/canonical");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class InMemorySessionRepository {
  constructor() {
    this.durable = false;
    this.sessions = new Map();
    this.providerIndex = new Map();
  }

  async create(session) {
    assertNoRawEvidence(session);
    if (this.sessions.has(session.internal_idv_session_id)) throw new Error("IDV session already exists");
    const stored = { ...clone(session), record_version: 1 };
    this.sessions.set(stored.internal_idv_session_id, stored);
    this.providerIndex.set(`${stored.provider}:${stored.provider_session_id}`, stored.internal_idv_session_id);
    return clone(stored);
  }

  async get(internalIdvSessionId) {
    return clone(this.sessions.get(internalIdvSessionId) || null);
  }

  async getByProviderSession(provider, providerSessionId) {
    const id = this.providerIndex.get(`${provider}:${providerSessionId}`);
    return id ? this.get(id) : null;
  }

  async save(session, expectedVersion) {
    assertNoRawEvidence(session);
    const current = this.sessions.get(session.internal_idv_session_id);
    if (!current) throw new Error("Cannot save a missing IDV session");
    if (expectedVersion != null && current.record_version !== expectedVersion) {
      const conflict = new Error("Concurrent IDV session update");
      conflict.code = "IDV_CONCURRENT_UPDATE";
      throw conflict;
    }
    const stored = { ...clone(session), record_version: current.record_version + 1 };
    this.sessions.set(stored.internal_idv_session_id, stored);
    return clone(stored);
  }

  async list() {
    return [...this.sessions.values()].map(clone);
  }
}

class InMemoryResultRepository {
  constructor() { this.results = new Map(); this.durable = false; }

  async save(internalIdvSessionId, resultWithoutPii) {
    if (resultWithoutPii.identity_attributes) {
      throw new TypeError("Identity attributes must be persisted through SecureIdentityStore");
    }
    assertNoRawEvidence(resultWithoutPii);
    this.results.set(internalIdvSessionId, clone(resultWithoutPii));
    return clone(resultWithoutPii);
  }

  async get(internalIdvSessionId) {
    return clone(this.results.get(internalIdvSessionId) || null);
  }
}

class InMemoryWebhookReceiptStore {
  constructor() { this.receipts = new Map(); this.durable = false; }

  async begin(provider, eventId, receivedAt = new Date()) {
    const key = `${provider}:${eventId}`;
    const existing = this.receipts.get(key);
    if (existing && existing.state !== "FAILED") return { accepted: false, receipt: clone(existing) };
    const receipt = {
      provider,
      event_id: eventId,
      state: "PROCESSING",
      received_at: new Date(receivedAt).toISOString(),
      attempts: (existing?.attempts || 0) + 1,
    };
    this.receipts.set(key, receipt);
    return { accepted: true, receipt: clone(receipt) };
  }

  async complete(provider, eventId, metadata = {}) {
    const key = `${provider}:${eventId}`;
    const current = this.receipts.get(key);
    if (!current) throw new Error("Webhook receipt was not claimed");
    this.receipts.set(key, { ...current, state: "COMPLETED", completed_at: new Date().toISOString(), ...clone(metadata) });
  }

  async fail(provider, eventId, errorCode) {
    const key = `${provider}:${eventId}`;
    const current = this.receipts.get(key);
    if (!current) return;
    this.receipts.set(key, { ...current, state: "FAILED", error_code: errorCode || "IDV_WEBHOOK_PROCESSING_FAILED" });
  }
}

class InMemoryEventStore {
  constructor() { this.events = []; this.durable = false; }
  async append(event) { this.events.push(clone(event)); return clone(event); }
  async list() { return this.events.map(clone); }
  async listForSession(id) { return this.events.filter((event) => event.internal_idv_session_id === id).map(clone); }
}

class SyntheticOnlySecureIdentityStore extends SecureIdentityStore {
  constructor() {
    super();
    this.productionReady = false;
    this.extractions = new Map();
    this.responses = new Map();
    this.sessionReferences = new Map();
    this.retention = new Map();
  }

  assertSynthetic(context) {
    if (context?.synthetic !== true) throw new SecureStoreRequiredError();
  }

  async persistProviderExtraction(internalIdvSessionId, attributes, context) {
    this.assertSynthetic(context);
    assertNoRawEvidence(attributes);
    const existing = this.extractions.get(internalIdvSessionId) || [];
    const byId = new Map(existing.map((attribute) => [attribute.attribute_id, attribute]));
    for (const attribute of attributes) byId.set(attribute.attribute_id, clone(attribute));
    this.extractions.set(internalIdvSessionId, [...byId.values()]);
  }

  async storeExtractedIdentity({ internalIdvSessionId, attributes, access, retentionMetadata = {} }) {
    this.assertSynthetic(access);
    await this.persistProviderExtraction(internalIdvSessionId, attributes, access);
    const secureIdentityReference = this.sessionReferences.get(internalIdvSessionId) || randomUUID();
    this.sessionReferences.set(internalIdvSessionId, secureIdentityReference);
    this.retention.set(secureIdentityReference, { retention_metadata: clone(retentionMetadata), deletion_status: "ACTIVE", legal_hold: false });
    return { secureIdentityReference, storedAttributeCount: attributes.length };
  }

  async retrieveIdentityForAuthorizedPurpose({ identityReference, access, fields, attributeIds }) {
    this.assertSynthetic(access);
    const sessionId = [...this.sessionReferences.entries()].find(([, reference]) => reference === identityReference)?.[0];
    if (!sessionId) return { secureIdentityReference: identityReference, attributes: [] };
    const allowedFields = new Set(fields || []);
    const allowedIds = attributeIds ? new Set(attributeIds) : null;
    const attributes = (this.extractions.get(sessionId) || []).filter((item) =>
      allowedFields.has(item.attribute_concept) && (!allowedIds || allowedIds.has(item.attribute_id)));
    return { secureIdentityReference: identityReference, attributes: clone(attributes) };
  }

  async getProviderExtractions(internalIdvSessionId, context) {
    this.assertSynthetic(context);
    return clone(this.extractions.get(internalIdvSessionId) || []);
  }

  async appendCustomerResponse(internalIdvSessionId, response, context) {
    this.assertSynthetic(context);
    const existing = this.responses.get(internalIdvSessionId) || [];
    this.responses.set(internalIdvSessionId, [...existing, clone(response)]);
  }

  async recordCustomerConfirmation({ identityReference, response, access }) {
    this.assertSynthetic(access);
    const sessionId = [...this.sessionReferences.entries()].find(([, reference]) => reference === identityReference)?.[0];
    if (!sessionId) throw new TypeError("Synthetic identity record is unavailable");
    await this.appendCustomerResponse(sessionId, response, access);
    return { responseId: response.response_id, action: response.action };
  }

  async recordCustomerCorrection(input) { return this.recordCustomerConfirmation(input); }
  async recordCustomerRejection(input) { return this.recordCustomerConfirmation(input); }

  async getCustomerResponses(internalIdvSessionId, context) {
    this.assertSynthetic(context);
    return clone(this.responses.get(internalIdvSessionId) || []);
  }

  async deleteSubjectIdentityData(internalIdvSessionId, context) {
    this.assertSynthetic(context);
    this.extractions.delete(internalIdvSessionId);
    this.responses.delete(internalIdvSessionId);
  }

  async deleteOrScheduleDeletion({ identityReference, access, deleteAt = new Date() }) {
    this.assertSynthetic(access);
    const sessionId = [...this.sessionReferences.entries()].find(([, reference]) => reference === identityReference)?.[0];
    if (!sessionId) return { deletionStatus: "DELETED", idempotent: true };
    const immediate = new Date(deleteAt) <= new Date();
    if (immediate) {
      await this.deleteSubjectIdentityData(sessionId, access);
      this.retention.set(identityReference, { ...(this.retention.get(identityReference) || {}), deletion_status: "DELETED" });
    } else {
      this.retention.set(identityReference, { ...(this.retention.get(identityReference) || {}), deletion_status: "SCHEDULED", deletion_scheduled_at: new Date(deleteAt).toISOString() });
    }
    return { deletionStatus: immediate ? "DELETED" : "SCHEDULED" };
  }

  async getRetentionMetadata({ identityReference, access }) {
    this.assertSynthetic(access);
    return clone(this.retention.get(identityReference) || null);
  }
}

class InMemoryCostLedgerRepository {
  constructor() { this.entries = []; this.durable = false; }
  async append(entry) { const stored = { cost_entry_id: entry.cost_entry_id || randomUUID(), ...clone(entry) }; this.entries.push(stored); return clone(stored); }
  async list(filter = {}) { return this.entries.filter((entry) => !filter.tenantId || entry.tenant_id === filter.tenantId).map(clone); }
}

class InMemoryPocGroundTruthRepository {
  constructor() { this.labels = new Map(); this.durable = false; }
  async save(label) { const stored = { ground_truth_id: label.ground_truth_id || randomUUID(), ...clone(label) }; this.labels.set(`${stored.tenant_id}:${stored.internal_idv_session_id}`, stored); return clone(stored); }
  async get(id, tenantId) { return clone(this.labels.get(`${tenantId}:${id}`) || null); }
  async list({ tenantId } = {}) { return [...this.labels.values()].filter((item) => !tenantId || item.tenant_id === tenantId).map(clone); }
}

module.exports = {
  InMemorySessionRepository,
  InMemoryResultRepository,
  InMemoryWebhookReceiptStore,
  InMemoryEventStore,
  SyntheticOnlySecureIdentityStore,
  InMemoryCostLedgerRepository,
  InMemoryPocGroundTruthRepository,
};
