/**
 * schema.js — single source of truth for the change_events table shape, as seen
 * by the DAL. Column names live here as constants so neither writeEvent nor
 * readEvents hard-codes a string twice; the canonical DDL is the mirror copy in
 * db/migrations/007_change_events.sql (keep the two in sync).
 *
 * The closed-vocabulary enums (FIELD_CLASS, WORKFLOW, VERIFIABILITY, INTENT,
 * REGISTRY_STATUS) are NOT redefined here — they are imported from the engine's
 * enums.js, read-only, so this slice cannot drift from the engine contract. The
 * only vocab owned locally is CHANGE_TYPE_VALUES, which is deriveChangeType's
 * output (add|remove|changed) — distinct from the engine's post-split
 * CHANGE_TYPE (add|remove|correct|update), which the engine consumes but this
 * table does not store.
 *
 * Packaged CJS-in-src (module.exports), mirroring the engine + pipeline.js, so a
 * CommonJS api/ route can require() the DAL. The React side imports it via the
 * same ESM→CJS interop already used for the engine (classifyChange).
 */

const TABLE = 'change_events';

// Every column, in DDL order. Used to build queries without re-typing strings.
const COLUMNS = {
  id: 'id',
  submissionId: 'submission_id',
  dossierId: 'dossier_id',
  fieldId: 'field_id',
  fieldClass: 'field_class',

  changeType: 'change_type',
  beforeValue: 'before_value',
  afterValue: 'after_value',

  sourceType: 'source_type',
  sourceProvider: 'source_provider',
  sourceTier: 'source_tier',
  verifiability: 'verifiability',

  customerIntent: 'customer_intent',
  customerRegistryClaim: 'customer_registry_claim',
  registryRecheckResult: 'registry_recheck_result',

  workflow: 'workflow',
  docType: 'doc_type',
  eddFlag: 'edd_flag',
  escalation: 'escalation',
  escalationReason: 'escalation_reason',
  decided: 'decided',
  matchedRule: 'matched_rule',

  jurisdiction: 'jurisdiction',

  supersedes: 'supersedes',
  createdAt: 'created_at',
};

// Columns a caller may supply on write. `id`, `supersedes`, and `created_at`
// are excluded: id + created_at are server-assigned, and supersedes is set via
// the dedicated `supersedesId` argument so the supersede path is validated.
const WRITABLE_COLUMNS = [
  COLUMNS.submissionId,
  COLUMNS.dossierId,
  COLUMNS.fieldId,
  COLUMNS.fieldClass,
  COLUMNS.changeType,
  COLUMNS.beforeValue,
  COLUMNS.afterValue,
  COLUMNS.sourceType,
  COLUMNS.sourceProvider,
  COLUMNS.sourceTier,
  COLUMNS.verifiability,
  COLUMNS.customerIntent,
  COLUMNS.customerRegistryClaim,
  COLUMNS.registryRecheckResult,
  COLUMNS.workflow,
  COLUMNS.docType,
  COLUMNS.eddFlag,
  COLUMNS.escalation,
  COLUMNS.escalationReason,
  COLUMNS.decided,
  COLUMNS.matchedRule,
  COLUMNS.jurisdiction,
];

// JSONB columns — serialised with JSON.stringify on write so a JS value (object,
// array, scalar) round-trips faithfully through the driver.
const JSONB_COLUMNS = [COLUMNS.beforeValue, COLUMNS.afterValue];

// change_type vocab = deriveChangeType output. Owned here (not an engine enum).
const CHANGE_TYPE_VALUES = ['add', 'remove', 'changed'];

module.exports = {
  TABLE,
  COLUMNS,
  WRITABLE_COLUMNS,
  JSONB_COLUMNS,
  CHANGE_TYPE_VALUES,
};
