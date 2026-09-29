"use strict";

// Retention/deletion structure (Phase E5). The contract requires SEPARATE
// retention clocks per data class — provider media, Vault PII, IDV operations,
// and Evidence provenance cannot share one deletion clock. This module defines
// the structure and computes per-class deletion-due dates. Periods are UNSET
// (null = keep until a period is specified) until compliance sets them — the
// structure is in place so turning on a real period is a config change, not a
// rebuild.

const DATA_CLASSES = Object.freeze({
  PROVIDER_MEDIA: "provider_media",       // encrypted document images we hold
  VAULT_PII: "vault_pii",                 // extracted identity attributes in the Vault
  IDV_OPERATIONS: "idv_operations",       // attempts, decisions, lifecycle, screening
  EVIDENCE_PROVENANCE: "evidence_provenance", // outbox envelopes / provenance
});

// periodDays: null = unset (retain, no scheduled deletion). Set per class when
// the compliance record-retention period is decided (e.g. KYC 5-7 years).
const RETENTION_POLICY = Object.freeze({
  [DATA_CLASSES.PROVIDER_MEDIA]: { periodDays: null },
  [DATA_CLASSES.VAULT_PII]: { periodDays: null },
  [DATA_CLASSES.IDV_OPERATIONS]: { periodDays: null },
  [DATA_CLASSES.EVIDENCE_PROVENANCE]: { periodDays: null },
});

function retentionFor(dataClass) {
  return RETENTION_POLICY[dataClass] || { periodDays: null };
}

// Deletion-due date for a data class given when retention started. Returns null
// when the period is unset (keep). `now`/`fromISO` are passed in (no hidden clock).
function deletionDueAt(dataClass, fromISO) {
  const period = retentionFor(dataClass).periodDays;
  if (period == null || !fromISO) return null;
  const from = new Date(fromISO);
  if (Number.isNaN(from.valueOf())) return null;
  return new Date(from.getTime() + period * 24 * 60 * 60 * 1000).toISOString();
}

// The retention metadata stamp stored alongside a record.
function retentionMetadata(dataClass, fromISO) {
  return {
    data_class: dataClass,
    period_days: retentionFor(dataClass).periodDays,
    retained_from: fromISO || null,
    deletion_due_at: deletionDueAt(dataClass, fromISO),
  };
}

module.exports = { DATA_CLASSES, RETENTION_POLICY, retentionFor, deletionDueAt, retentionMetadata };
