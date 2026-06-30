/**
 * buildChangeEvent.js — pure assembler: dialogue answers + engine output -> one
 * change_event object, shaped for the events DAL writeEvent.
 *
 * It produces the camelCase keys writeEvent consumes (which ARE the keys of the
 * events DAL's COLUMNS map — imported here, not redefined, so this stays locked
 * to the table shape). The output is whitelisted against COLUMNS so a stray key
 * can never reach the write path.
 *
 * Two distinct change-type vocabularies meet here, on purpose:
 *  - storedChangeType ('add'|'remove'|'changed') is deriveChangeType's output and
 *    is what the change_events.change_type COLUMN records. On the Confirm page an
 *    unchecked found field is 'changed' (the final value lands at Fill Gaps).
 *  - the engine is called with the post-split 'correct'|'update' (see
 *    dialogueContent.toEngineChangeType) and never sees 'changed'. That value is
 *    NOT stored — only its decision is, via engineResult.
 *
 * after_value is null in capture mode: the customer's final value does not exist
 * yet on the Confirm page. When Fill Gaps commits, a later slice writes a
 * superseding event carrying the resolved value (open question D3).
 */

import { COLUMNS } from '../../changeIntelligence/events/schema';

export function buildChangeEvent({
  field = {},
  jurisdiction = null,
  submissionId = null,
  dossierId = null,
  storedChangeType = 'changed',
  intent = null,
  registryStatus = 'unknown',
  engineResult = {},
} = {}) {
  const draft = {
    submissionId,
    dossierId,
    fieldId: field.fieldId ?? null,
    fieldClass: field.fieldClass ?? null,

    // the diff — final (after) value is unknown on Confirm; see header.
    changeType: storedChangeType,
    beforeValue: field.value ?? null,
    afterValue: null,

    // provenance of the presented value
    sourceType: field.sourceType ?? null,
    sourceProvider: field.sourceProvider ?? null,
    sourceTier: field.sourceTier ?? null,
    verifiability: field.verifiability ?? null,

    // the customer's CLAIMS (recorded as given, not as fact)
    customerIntent: intent ?? null,
    customerRegistryClaim: registryStatus ?? null,
    registryRecheckResult: null, // filled later by the registry re-check slice

    // engine output, recorded verbatim — this row is the audit of the decision
    workflow: engineResult.workflow ?? 'UNDECIDED',
    docType: engineResult.docType ?? null,
    eddFlag: engineResult.eddFlag ?? false,
    escalation: engineResult.escalation ?? false,
    escalationReason: engineResult.escalationReason ?? null,
    decided: engineResult.decided ?? false,
    matchedRule: engineResult.matchedRule ?? null,

    jurisdiction: jurisdiction ?? null,
  };

  // Whitelist against the table's known columns (plus supersedesId, the dedicated
  // append-only lineage arg). id/created_at are server-assigned and never set.
  const allowed = new Set([...Object.keys(COLUMNS), 'supersedesId']);
  const event = {};
  for (const [key, value] of Object.entries(draft)) {
    if (allowed.has(key)) event[key] = value;
  }
  return event;
}
