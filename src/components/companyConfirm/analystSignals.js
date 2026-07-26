/**
 * analystSignals.js — read-only interpretation of what the change engine
 * ALREADY decided, for the build-time analyst view (commit 5).
 *
 * This module invents nothing. Every value it returns is lifted from the
 * change-event the dialogue built and the engine result it computed; nothing
 * here re-runs classification, writes events, or affects routing. Its whole job
 * is to answer "what did the engine actually do, and does the customer see it?"
 * so that during testing you can watch the decisions fire instead of trusting
 * they happened silently.
 *
 * The two categories come from the backend investigation:
 *
 *   TYPE 1 — a real outcome the engine produced. Often invisible to the
 *            customer by design (analyst-only), but genuinely computed:
 *            a required document, an escalation, an EDD flag, or the plain
 *            fact that the customer's value differs from the registry's.
 *
 *   TYPE 2 — no machinery behind it. classifyFieldClass covers only
 *            director/ubo/address/factualId/pep/structural, so anything else
 *            lands on `generic`; and the verifiability guard routes any
 *            non-registry-sourced field to a silent analyst_review with no
 *            document. There is no outcome to surface, so we say exactly that
 *            rather than fabricate one to match the prototype.
 */

/** The ONLY workflow ChangeDialogue renders as a non-neutral, action-required
 *  notice. Everything else shows the calm "we'll review this" message, i.e. the
 *  customer effectively sees nothing about the decision. */
const CUSTOMER_ACTIONABLE = new Set(["doc_required"]);

/** Workflows that record a decision but drive nothing automatic on their own. */
const NO_CONSEQUENCE = new Set(["ops_review", "analyst_review", "accept_silent", "UNDECIDED"]);

export function isSilentToCustomer(workflow, docType) {
  return !(CUSTOMER_ACTIONABLE.has(workflow) && docType);
}

export function hasAutomatedConsequence(workflow, docType) {
  if (docType) return true;
  return !NO_CONSEQUENCE.has(workflow);
}

const present = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * @param {object} event   the persisted change_event (beforeValue/afterValue/
 *                         workflow/docType/matchedRule/fieldClass/...)
 * @param {object} outcome the engine result the dialogue computed (carries
 *                         `silent`, which the event's column set does not)
 * @param {string} correctedValue the inline-captured value, when the customer
 *                         has saved one but the superseding event's afterValue
 *                         isn't on this snapshot
 * @returns {object|null}  null when there is nothing recorded for this field
 */
export function buildAnalystSignal({ event, outcome, correctedValue } = {}) {
  if (!event) return null;

  const workflow = (outcome && outcome.workflow) || event.workflow || "UNDECIDED";
  const docType = (outcome && outcome.docType) || event.docType || null;
  const matchedRule = (outcome && outcome.matchedRule) || event.matchedRule || null;
  const fieldClass = event.fieldClass || "generic";

  const before = event.beforeValue ?? null;
  const after = present(event.afterValue) ? event.afterValue : (present(correctedValue) ? correctedValue : null);
  // The headline analyst signal: the customer's value differs from the
  // registry's. Only meaningful once a value has actually been captured.
  const registryMismatch = present(after) && String(after) !== String(before ?? "");

  const consequence = hasAutomatedConsequence(workflow, docType);
  const silent = outcome && typeof outcome.silent === "boolean"
    ? outcome.silent
    : isSilentToCustomer(workflow, docType);

  return {
    type: consequence ? "type1" : "type2",
    workflow,
    docType,
    matchedRule,
    fieldClass,
    before,
    after,
    registryMismatch,
    silent,
    eddFlag: !!(outcome ? outcome.eddFlag : event.eddFlag),
    escalation: !!(outcome ? outcome.escalation : event.escalation),
    escalationReason: (outcome && outcome.escalationReason) || event.escalationReason || null,
    decided: outcome && typeof outcome.decided === "boolean" ? outcome.decided : !!event.decided,
    intent: event.customerIntent || null,
    registryClaim: event.customerRegistryClaim || null,
    verifiability: event.verifiability || null,
  };
}

/** The human lines the test view shows, in priority order. Pure, so the wording
 *  is unit-testable and cannot drift from the data it describes. */
export function signalLines(signal) {
  if (!signal) return [];
  const lines = [];

  if (signal.type === "type2") {
    lines.push(
      `No automated consequence for this field class (${signal.fieldClass} → ${signal.workflow}, no document). This is expected — surfaced for testing.`
    );
    // A type-2 outcome is still a recorded decision the customer never sees —
    // say so explicitly, naming the rule that fired (GENERIC,
    // VERIFIABILITY-GUARD, or none at all when the engine didn't decide).
    if (signal.silent) {
      lines.push(
        `Silent outcome: ${signal.workflow} (customer sees nothing)${signal.matchedRule ? ` — rule ${signal.matchedRule}` : ""}.`
      );
    } else if (signal.matchedRule) {
      lines.push(`Rule: ${signal.matchedRule}`);
    }
    if (signal.registryMismatch) {
      lines.push("Customer value differs from registry — recorded, but nothing automated follows for this class.");
    }
    if (!signal.decided) lines.push("Engine did not decide (UNDECIDED) — analyst-bound.");
    return lines;
  }

  if (signal.registryMismatch) {
    lines.push("Customer value differs from registry — flagged for analyst review.");
  }
  if (signal.docType) {
    lines.push(`Document required: ${signal.docType}`);
  }
  if (signal.escalation) {
    lines.push(`Escalation raised${signal.escalationReason ? ` — ${signal.escalationReason}` : ""} (never shown to the customer).`);
  }
  if (signal.eddFlag) lines.push("EDD flag set.");
  if (signal.silent) {
    lines.push(
      `Silent outcome: ${signal.workflow} (customer sees nothing)${signal.matchedRule ? ` — rule ${signal.matchedRule}` : ""}.`
    );
  } else if (signal.matchedRule) {
    lines.push(`Rule: ${signal.matchedRule}`);
  }
  if (!signal.decided) lines.push("Engine did not decide (UNDECIDED) — analyst-bound.");
  return lines;
}

export default buildAnalystSignal;
