"use strict";

// PII Vault wrapper for the IDV-match feature.
//
// Extracted identity PII (name, DOB, document number, ...) must live ONLY in
// the secure Vault as encrypted values behind an opaque reference; our own
// tables persist that reference, never plaintext. This is the single seam the
// rest of api/idv-match/ uses to store/read identity PII — callers never touch
// the idv/ module's store or canonical builders directly.
//
// Dev/test uses the module's in-memory synthetic Vault (no infra: no KMS, no
// OIDC, no separate DB). Production hardening — real KMS-backed ManagedKey
// provider, OIDC-authenticated SecurityContext, separate encrypted DB — is
// BACKLOG IDV-2; it slots in behind this same wrapper without changing callers.

const {
  createIdvModule,
  createCustomerResponse,
  PURPOSES,
} = require("../../idv");

let cachedStore = null;

// The synthetic store is process-wide and in-memory; build it once. We pass an
// explicit minimal env (not process.env) so a stray IDV_* var can't flip this
// to a durable/production store — the synthetic Vault is the ONLY thing this
// dev wrapper is allowed to bind to.
function vaultStore() {
  if (cachedStore) return cachedStore;
  const idv = createIdvModule({ env: { IDV_RUNTIME_MODE: "test", IDV_SYNTHETIC_ONLY: "1" } });
  cachedStore = idv.secureIdentityStore;
  return cachedStore;
}

// Access context for a Vault operation. The dev synthetic store only checks
// `synthetic: true`; we also carry tenant/subject/purpose/fields so the prod
// store (which authorizes on exactly these) drops in unchanged. correlationId
// is required by the prod binder, so always supply one.
function vaultAccess({ tenantId, subjectId, purpose, fields, correlationId }) {
  return {
    synthetic: true,
    tenantId: tenantId || null,
    subjectId: subjectId || null,
    purpose,
    fields: fields || [],
    correlationId: correlationId || subjectId || tenantId || "idv-match",
  };
}

// Persist extracted identity PII. `attributes` are already-canonical identity
// attributes (each with attribute_concept + attribute_value) produced by the
// provider-neutral mapping layer — the sole producer of canonical PII. The
// store runs assertNoRawEvidence on them. `sessionId` (our attempt id) keys the
// Vault entry: re-storing the same attempt updates it and returns the same
// opaque reference (idempotent under duplicate webhooks). Returns the opaque
// secureIdentityReference to persist in our tables.
async function storeExtractedIdentity({
  tenantId,
  subjectId,
  sessionId,
  attributes,
  retentionMetadata = {},
}) {
  if (!sessionId) throw new TypeError("storeExtractedIdentity requires a sessionId");
  if (!Array.isArray(attributes) || attributes.length === 0) {
    throw new TypeError("storeExtractedIdentity requires at least one attribute");
  }
  for (const attribute of attributes) {
    if (!attribute || !attribute.attribute_concept || attribute.attribute_value == null) {
      throw new TypeError("each attribute must be canonical (attribute_concept + attribute_value)");
    }
  }
  const { secureIdentityReference } = await vaultStore().storeExtractedIdentity({
    internalIdvSessionId: sessionId,
    attributes,
    access: vaultAccess({ tenantId, subjectId, purpose: PURPOSES.PROVIDER_INGESTION }),
    retentionMetadata,
  });
  return secureIdentityReference;
}

// Read identity PII back under an explicit field allowlist (data minimization —
// only the concepts named in `fields` are decrypted and returned). Returns a
// plain { concept: value } map for display/matching. An empty allowlist is a
// caller error, not a silent empty read.
async function retrieveForAuthorizedPurpose({
  reference,
  fields,
  subjectId,
  tenantId,
  purpose = PURPOSES.KYC_DECISIONING,
}) {
  if (!reference) throw new TypeError("retrieveForAuthorizedPurpose requires a reference");
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError("retrieveForAuthorizedPurpose requires a non-empty fields allowlist");
  }
  const { attributes } = await vaultStore().retrieveIdentityForAuthorizedPurpose({
    identityReference: reference,
    access: vaultAccess({ tenantId, subjectId, purpose, fields }),
    fields,
  });
  const values = {};
  for (const attribute of attributes) values[attribute.attribute_concept] = attribute.attribute_value;
  return values;
}

// Record a customer confirmation/correction/rejection of an extracted value.
// The response is append-only and carries previousValue, so the original
// extraction is always preserved (correction never overwrites in place).
async function recordCorrection({
  reference,
  sessionId,
  concept,
  attributeId,
  previousValue,
  submittedValue,
  action = "CORRECTED",
  subjectId,
  tenantId,
}) {
  if (!reference) throw new TypeError("recordCorrection requires a reference");
  const response = createCustomerResponse({
    internalIdvSessionId: sessionId,
    attributeId,
    attributeConcept: concept,
    action,
    previousValue,
    submittedValue,
  });
  return vaultStore().recordCustomerCorrection({
    identityReference: reference,
    response,
    access: vaultAccess({ tenantId, subjectId, purpose: PURPOSES.CUSTOMER_CONFIRMATION }),
  });
}

module.exports = {
  storeExtractedIdentity,
  retrieveForAuthorizedPurpose,
  recordCorrection,
  // Exposed for tests that need to reset the process-wide synthetic Vault.
  _resetVaultForTests() { cachedStore = null; },
};
