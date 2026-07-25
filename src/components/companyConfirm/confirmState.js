/**
 * confirmState.js — the SINGLE source of truth for Confirm-page item state.
 *
 * ONE predicate, two consumers: the "Needs you" tile (now) and the submit gate
 * (commit 4). Deriving it twice is exactly how a page ends up reading "0 items
 * need your input" next to a button that refuses to advance, so both read
 * rowState() / computeConfirmCounts() from here and nowhere else.
 *
 * Pure — plain data in, plain numbers out. No React, no refs, no fetch.
 *
 * The four states are mutually exclusive and computed from data that already
 * exists on the page:
 *
 *   corrected — the customer saved a replacement value (gapRef
 *               `corrected_<field>`, written by the commit-3 inline editor).
 *   needsYou  — EITHER a disputed row whose corrected value hasn't been
 *               supplied yet, OR a low-confidence row (verificationStatus
 *               probable/indicative) the customer hasn't affirmed yet.
 *   confirmed — everything else: high-confidence rows left ticked, plus
 *               low-confidence rows the customer explicitly ticked.
 *
 * Why affirmation exists: every row arrives pre-ticked (checks defaults to
 * true), so "ticked" alone cannot distinguish "the customer agreed" from "the
 * customer hasn't looked yet". Without that distinction the Needs-you count
 * could never reach zero and the commit-4 gate would be unpassable. Affirming
 * is additive UI state — it never touches `checks`, the dialogue, or capture.
 *
 * SCOPE — vital (research.found) rows only. A stakeholder's per-person fields
 * are still next-page work (they are collected on Fill Gaps until commit 6
 * brings per-person editing onto Confirm), so counting them here would block a
 * gate on work this page cannot do. The person cards carry their own
 * "N needs you" badge meanwhile. When commit 6 lands, people join the count by
 * extending THIS module — not by adding a second counter somewhere else.
 */

export const ROW_STATE = {
  CONFIRMED: "confirmed",
  NEEDS_YOU: "needsYou",
  CORRECTED: "corrected",
};

/** Low confidence = tier2/tier3. Falls back to sourceTier for rows stored
 *  before verificationStatus existed (mirrors renderFoundRow). */
export function isLowConfidence(item = {}) {
  const status =
    item.verificationStatus ||
    (item.sourceTier === "tier2"
      ? "probable"
      : item.sourceTier === "tier3"
      ? "indicative"
      : "verified");
  return status === "probable" || status === "indicative";
}

export function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export function rowState(item, { checked = true, affirmed = false, correction } = {}) {
  if (hasValue(correction)) return ROW_STATE.CORRECTED;
  if (!checked) return ROW_STATE.NEEDS_YOU; // disputed; correction not supplied yet
  if (isLowConfidence(item) && !affirmed) return ROW_STATE.NEEDS_YOU;
  return ROW_STATE.CONFIRMED;
}

/**
 * Documents currently owed, read from the persisted dialogue snapshots (each
 * carries the classification event verbatim). Re-checking a row deletes its
 * snapshot, which is what drops the document — same "latest event wins"
 * semantics as deriveAmendmentDocuments server-side.
 *
 * KNOWN GAP: doc_required events written OUTSIDE the row dialogue (the
 * ownership-type and registration-number change forks in App.js) have no
 * snapshot here and are not counted. Commit 4 reconciles this list against
 * GET /api/amendment-documents, which is authoritative.
 */
export function docsNeededFrom(dialogueState = {}) {
  const seen = new Map();
  Object.entries(dialogueState).forEach(([fieldId, snap]) => {
    const ev = snap && snap.event;
    if (ev && ev.workflow === "doc_required" && ev.docType && !seen.has(ev.docType)) {
      seen.set(ev.docType, { fieldId, docType: ev.docType });
    }
  });
  return Array.from(seen.values());
}

export function computeConfirmCounts({
  found = [],
  checks = {},
  affirmed = {},
  corrections = {},
  dialogueState = {},
} = {}) {
  let needsYou = 0;
  let confirmed = 0;
  let corrected = 0;
  found.forEach((item, idx) => {
    const state = rowState(item, {
      checked: checks[idx] !== false,
      affirmed: !!affirmed[item.field],
      correction: corrections["corrected_" + item.field],
    });
    if (state === ROW_STATE.CORRECTED) corrected += 1;
    else if (state === ROW_STATE.NEEDS_YOU) needsYou += 1;
    else confirmed += 1;
  });
  const docs = docsNeededFrom(dialogueState);
  return { needsYou, confirmed, corrected, docsNeeded: docs.length, docs };
}

/**
 * The gate's reasons, derived from the SAME counts the tiles render (commit 4
 * consumes this; commit 3/2 only display it). Empty array = nothing blocking.
 */
export function submitBlockers(counts = {}) {
  const blockers = [];
  if ((counts.needsYou || 0) > 0) blockers.push({ kind: "needs_you", count: counts.needsYou });
  if ((counts.docsNeeded || 0) > 0) blockers.push({ kind: "docs_needed", count: counts.docsNeeded });
  return blockers;
}

export default computeConfirmCounts;
