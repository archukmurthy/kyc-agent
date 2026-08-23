"use strict";

const { randomUUID } = require("crypto");
const { SecureIdentityStore } = require("../contracts/secureIdentityStore");
const { IdentityAuthorizationError } = require("../domain/errors");
const { assertNoRawEvidence } = require("../domain/canonical");
const { RESTRICTED_IDENTITY_CONCEPTS } = require("../security/securityContext");

const CLASSIFICATION = Object.freeze({
  PROTECTED: "PROTECTED_IDENTITY_PII",
  RESTRICTED: "RESTRICTED_IDENTITY_PII",
});

function classificationFor(concept) {
  return RESTRICTED_IDENTITY_CONCEPTS.has(concept) ? CLASSIFICATION.RESTRICTED : CLASSIFICATION.PROTECTED;
}

function aadFor({ tenantId, subjectId, identityReference, recordKind, itemId, concept }) {
  return {
    tenant_id: tenantId,
    subject_id: subjectId,
    identity_reference: identityReference,
    record_kind: recordKind,
    item_id: itemId,
    attribute_concept: concept || null,
  };
}

function envelopeParams(envelope) {
  return [
    envelope.envelope_version,
    envelope.algorithm,
    envelope.ciphertext,
    envelope.nonce,
    envelope.authentication_tag,
    JSON.stringify(envelope.wrapped_dek),
    envelope.kms_provider,
    envelope.kms_key_id,
    envelope.kms_key_version,
  ];
}

function envelopeFromRow(row) {
  return {
    envelope_version: row.envelope_version,
    algorithm: row.encryption_algorithm,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authentication_tag: row.authentication_tag,
    wrapped_dek: row.wrapped_dek,
    kms_provider: row.kms_provider,
    kms_key_id: row.kms_key_id,
    kms_key_version: row.kms_key_version,
  };
}

class PostgresSecureIdentityStore extends SecureIdentityStore {
  constructor({ transactionRunner, envelopeEncryption, authorizer, now = () => new Date() } = {}) {
    super();
    if (!transactionRunner || !envelopeEncryption || !authorizer) {
      throw new TypeError("transactionRunner, envelopeEncryption, and authorizer are required");
    }
    this.transactions = transactionRunner;
    this.encryption = envelopeEncryption;
    this.managedKeyProvider = envelopeEncryption.keys;
    this.authorizer = authorizer;
    this.now = now;
    this.productionReady = true;
  }

  async appendAudit(client, access, action, fields, outcome, detail = null) {
    await client.query(`
      INSERT INTO idv_identity_access_audit
        (audit_id, tenant_id, subject_id, actor_id, purpose, action, field_categories, outcome, outcome_detail, correlation_id, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
    `, [
      randomUUID(), access.tenantId, access.subjectId, access.actorId, access.purpose,
      action, JSON.stringify([...new Set(fields || [])]), outcome, detail, access.correlationId, this.now().toISOString(),
    ]);
  }

  async authorize(access, action, fields) {
    const scoped = { ...access, fields: [...new Set(fields || access?.fields || [])] };
    try { return await this.authorizer.authorize(scoped); }
    catch (error) {
      if (access?.tenantId && access?.subjectId && access?.actorId && access?.purpose && access?.correlationId) {
        try {
          await this.transactions.withTenantTransaction(access.tenantId, async (client) => {
            await this.appendAudit(client, access, action, scoped.fields, "DENIED", error.code || "AUTHORIZATION_DENIED");
          });
        } catch (_) { /* authorization error remains authoritative */ }
      }
      throw error;
    }
  }

  async ensureIdentityRecord(client, { internalIdvSessionId, access, retentionMetadata = {} }) {
    const existing = await client.query(`
      SELECT identity_reference, subject_id, deletion_status, legal_hold
      FROM idv_secure_identity_records
      WHERE tenant_id=$1 AND internal_idv_session_id=$2
    `, [access.tenantId, internalIdvSessionId]);
    if (existing.rows[0]) {
      if (existing.rows[0].subject_id !== access.subjectId) throw new IdentityAuthorizationError("Session subject does not match access subject");
      if (existing.rows[0].deletion_status === "DELETED") throw new IdentityAuthorizationError("Identity record has been deleted");
      return existing.rows[0].identity_reference;
    }
    const identityReference = randomUUID();
    await client.query(`
      INSERT INTO idv_secure_identity_records
        (identity_reference, tenant_id, subject_id, internal_idv_session_id, classification, retention_metadata, deletion_status, legal_hold, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,'ACTIVE',false,$7,$7)
      ON CONFLICT (tenant_id, internal_idv_session_id) DO NOTHING
    `, [identityReference, access.tenantId, access.subjectId, internalIdvSessionId, CLASSIFICATION.PROTECTED, JSON.stringify(retentionMetadata), this.now().toISOString()]);
    const stored = await client.query(`
      SELECT identity_reference, subject_id FROM idv_secure_identity_records
      WHERE tenant_id=$1 AND internal_idv_session_id=$2
    `, [access.tenantId, internalIdvSessionId]);
    if (!stored.rows[0] || stored.rows[0].subject_id !== access.subjectId) {
      throw new IdentityAuthorizationError("Unable to establish tenant-scoped identity record");
    }
    return stored.rows[0].identity_reference;
  }

  async storeExtractedIdentity({ internalIdvSessionId, attributes, access, retentionMetadata = {} }) {
    if (!internalIdvSessionId || !Array.isArray(attributes)) throw new TypeError("Session and attributes are required");
    assertNoRawEvidence(attributes);
    const fields = attributes.map((item) => item.attribute_concept);
    const authorized = await this.authorize(access, "STORE_EXTRACTION", fields);
    return this.transactions.withTenantTransaction(authorized.tenantId, async (client) => {
      const identityReference = await this.ensureIdentityRecord(client, { internalIdvSessionId, access: authorized, retentionMetadata });
      for (const attribute of attributes) {
        const aad = aadFor({
          tenantId: authorized.tenantId, subjectId: authorized.subjectId, identityReference,
          recordKind: "PROVIDER_EXTRACTION", itemId: attribute.attribute_id, concept: attribute.attribute_concept,
        });
        const envelope = await this.encryption.encryptJson(attribute, aad);
        const params = envelopeParams(envelope);
        await client.query(`
          INSERT INTO idv_encrypted_identity_attributes
            (identity_reference, tenant_id, subject_id, attribute_id, attribute_concept, classification,
             envelope_version, encryption_algorithm, ciphertext, nonce, authentication_tag, wrapped_dek,
             kms_provider, kms_key_id, kms_key_version, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
          ON CONFLICT (tenant_id, identity_reference, attribute_id) DO NOTHING
        `, [
          identityReference, authorized.tenantId, authorized.subjectId, attribute.attribute_id,
          attribute.attribute_concept, classificationFor(attribute.attribute_concept), ...params, this.now().toISOString(),
        ]);
      }
      await this.appendAudit(client, authorized, "STORE_EXTRACTION", fields, "ALLOWED");
      return { secureIdentityReference: identityReference, storedAttributeCount: attributes.length };
    });
  }

  async retrieveIdentityForAuthorizedPurpose({ identityReference, access, fields, attributeIds }) {
    if (!identityReference) throw new TypeError("identityReference is required");
    const requested = [...new Set(fields || [])];
    if (!requested.length) throw new IdentityAuthorizationError("An explicit identity field allowlist is required");
    const authorized = await this.authorize(access, "READ_IDENTITY", requested);
    return this.transactions.withTenantTransaction(authorized.tenantId, async (client) => {
      const record = await client.query(`
        SELECT identity_reference FROM idv_secure_identity_records
        WHERE tenant_id=$1 AND identity_reference=$2 AND subject_id=$3 AND deletion_status='ACTIVE'
      `, [authorized.tenantId, identityReference, authorized.subjectId]);
      if (!record.rows[0]) throw new IdentityAuthorizationError("Identity record is unavailable");
      const result = await client.query(`
        SELECT * FROM idv_encrypted_identity_attributes
        WHERE tenant_id=$1 AND identity_reference=$2 AND subject_id=$3 AND attribute_concept = ANY($4::text[])
          AND ($5::uuid[] IS NULL OR attribute_id = ANY($5::uuid[]))
        ORDER BY created_at, attribute_id
      `, [authorized.tenantId, identityReference, authorized.subjectId, requested, attributeIds?.length ? attributeIds : null]);
      const attributes = [];
      for (const row of result.rows) {
        attributes.push(await this.encryption.decryptJson(envelopeFromRow(row), aadFor({
          tenantId: row.tenant_id, subjectId: row.subject_id, identityReference: row.identity_reference,
          recordKind: "PROVIDER_EXTRACTION", itemId: row.attribute_id, concept: row.attribute_concept,
        })));
      }
      await this.appendAudit(client, authorized, "READ_IDENTITY", requested, "ALLOWED");
      return { secureIdentityReference: identityReference, attributes };
    });
  }

  async appendResponse({ identityReference, response, access, expectedAction }) {
    if (!identityReference || !response?.response_id) throw new TypeError("Identity reference and response are required");
    if (response.action !== expectedAction) throw new TypeError(`Expected ${expectedAction} customer response`);
    assertNoRawEvidence(response);
    const fields = [response.attribute_concept];
    const authorized = await this.authorize(access, `RECORD_${expectedAction}`, fields);
    return this.transactions.withTenantTransaction(authorized.tenantId, async (client) => {
      const record = await client.query(`
        SELECT identity_reference FROM idv_secure_identity_records
        WHERE tenant_id=$1 AND identity_reference=$2 AND subject_id=$3 AND deletion_status='ACTIVE'
      `, [authorized.tenantId, identityReference, authorized.subjectId]);
      if (!record.rows[0]) throw new IdentityAuthorizationError("Identity record is unavailable");
      const aad = aadFor({
        tenantId: authorized.tenantId, subjectId: authorized.subjectId, identityReference,
        recordKind: "CUSTOMER_RESPONSE", itemId: response.response_id, concept: response.attribute_concept,
      });
      const envelope = await this.encryption.encryptJson(response, aad);
      const params = envelopeParams(envelope);
      await client.query(`
        INSERT INTO idv_encrypted_customer_responses
          (identity_reference, tenant_id, subject_id, response_id, attribute_id, attribute_concept, action, classification,
           envelope_version, encryption_algorithm, ciphertext, nonce, authentication_tag, wrapped_dek,
           kms_provider, kms_key_id, kms_key_version, occurred_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19)
        ON CONFLICT (tenant_id, identity_reference, response_id) DO NOTHING
      `, [
        identityReference, authorized.tenantId, authorized.subjectId, response.response_id, response.attribute_id,
        response.attribute_concept, response.action, classificationFor(response.attribute_concept), ...params,
        response.occurred_at, this.now().toISOString(),
      ]);
      await this.appendAudit(client, authorized, `RECORD_${expectedAction}`, fields, "ALLOWED");
      return { responseId: response.response_id, action: response.action };
    });
  }

  async recordCustomerConfirmation(input) { return this.appendResponse({ ...input, expectedAction: "CONFIRMED" }); }
  async recordCustomerCorrection(input) { return this.appendResponse({ ...input, expectedAction: "CORRECTED" }); }
  async recordCustomerRejection(input) { return this.appendResponse({ ...input, expectedAction: "REJECTED" }); }

  async deleteOrScheduleDeletion({ identityReference, access, deleteAt = this.now(), reasonCode = "SUBJECT_REQUEST" }) {
    const authorized = await this.authorize(access, "DELETE_IDENTITY", []);
    return this.transactions.withTenantTransaction(authorized.tenantId, async (client) => {
      const result = await client.query(`
        SELECT deletion_status, legal_hold FROM idv_secure_identity_records
        WHERE tenant_id=$1 AND identity_reference=$2 AND subject_id=$3 FOR UPDATE
      `, [authorized.tenantId, identityReference, authorized.subjectId]);
      const record = result.rows[0];
      if (!record) throw new IdentityAuthorizationError("Identity record is unavailable");
      if (record.legal_hold) throw new IdentityAuthorizationError("Identity record is under legal hold");
      if (record.deletion_status === "DELETED") return { deletionStatus: "DELETED", idempotent: true };
      const scheduledAt = new Date(deleteAt);
      if (Number.isNaN(scheduledAt.valueOf())) throw new TypeError("deleteAt is invalid");
      const immediate = scheduledAt <= this.now();
      if (immediate) {
        await client.query("DELETE FROM idv_encrypted_customer_responses WHERE tenant_id=$1 AND identity_reference=$2", [authorized.tenantId, identityReference]);
        await client.query("DELETE FROM idv_encrypted_identity_attributes WHERE tenant_id=$1 AND identity_reference=$2", [authorized.tenantId, identityReference]);
        await client.query(`
          UPDATE idv_secure_identity_records SET deletion_status='DELETED', deleted_at=$3, deletion_reason_code=$4, updated_at=$3
          WHERE tenant_id=$1 AND identity_reference=$2
        `, [authorized.tenantId, identityReference, this.now().toISOString(), reasonCode]);
      } else {
        await client.query(`
          UPDATE idv_secure_identity_records SET deletion_status='SCHEDULED', deletion_scheduled_at=$3, deletion_reason_code=$4, updated_at=$5
          WHERE tenant_id=$1 AND identity_reference=$2
        `, [authorized.tenantId, identityReference, scheduledAt.toISOString(), reasonCode, this.now().toISOString()]);
      }
      await this.appendAudit(client, authorized, immediate ? "DELETE_IDENTITY" : "SCHEDULE_DELETION", [], "ALLOWED");
      return { deletionStatus: immediate ? "DELETED" : "SCHEDULED", deleteAt: scheduledAt.toISOString() };
    });
  }

  async getRetentionMetadata({ identityReference, access }) {
    const authorized = await this.authorize(access, "READ_RETENTION", []);
    return this.transactions.withTenantTransaction(authorized.tenantId, async (client) => {
      const result = await client.query(`
        SELECT retention_metadata, deletion_status, deletion_scheduled_at, deleted_at, legal_hold
        FROM idv_secure_identity_records
        WHERE tenant_id=$1 AND identity_reference=$2 AND subject_id=$3
      `, [authorized.tenantId, identityReference, authorized.subjectId]);
      if (!result.rows[0]) throw new IdentityAuthorizationError("Identity record is unavailable");
      await this.appendAudit(client, authorized, "READ_RETENTION", [], "ALLOWED");
      return result.rows[0];
    });
  }
}

module.exports = { PostgresSecureIdentityStore, CLASSIFICATION, classificationFor, aadFor };
