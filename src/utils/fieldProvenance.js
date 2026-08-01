/**
 * fieldProvenance.js — the scalar field_provenance rule, extracted pure so the
 * one guarantee that matters can be tested directly.
 *
 * THE RULE: agent_value is the AI/registry ORIGINAL and is never overwritten
 * with the customer's value. customer_value is what the customer supplied;
 * final_value is what wins. For an untouched field agent_value and final_value
 * coincide; for a corrected field they MUST differ and both must be present —
 * that is what makes field_provenance a second durable home for the original,
 * so change_events.before_value is no longer its single point of failure.
 *
 * Consumed by api/submit.js. CommonJS so the serverless function can require it.
 */

function asText(x) {
  if (x === null || x === undefined) return null;
  return typeof x === "object" ? JSON.stringify(x) : String(x);
}

/**
 * @param {object|undefined} meta - the client's fieldMetadata entry for this field
 * @returns {{agentValue: string|null, customerAction: string|null}}
 */
function deriveScalarProvenance(meta) {
  if (!meta) {
    // No trail for this field (e.g. an older client that doesn't transmit
    // fieldMetadata). Record nothing rather than guess — claiming the AI
    // sourced a value it may never have seen is worse than a null.
    return { agentValue: null, customerAction: null };
  }
  // AFFIRMED — the customer explicitly ticked a low-confidence value. Every row
  // arrives ticked, so without this "confirmed an unverified value" and "never
  // looked at it" are the same record. Only fills an action the client did not
  // already state: an edit or an uncheck is the stronger fact and wins.
  const customerAction = meta.customerAction || (meta.affirmed ? "affirmed" : null);
  // A correction carries the pre-correction value explicitly.
  if (meta.agentValue !== null && meta.agentValue !== undefined) {
    return { agentValue: asText(meta.agentValue), customerAction };
  }
  // A customer-entered gap has no agent value at all.
  if (meta.sourceTier === "manual") {
    return { agentValue: null, customerAction };
  }
  // An untouched AI/registry field: the trail entry IS the agent value.
  return { agentValue: asText(meta.value), customerAction };
}

module.exports = { deriveScalarProvenance, asText };
