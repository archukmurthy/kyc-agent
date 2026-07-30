/**
 * confirmState.js — the SINGLE source of truth for Confirm-page item state.
 *
 * ONE predicate, three consumers: the amber row styling, the "Needs You" tile,
 * and the submit gate. Deriving it more than once is exactly how a page ends up
 * reading "0 items need your input" next to a button that refuses to advance,
 * so all three read rowState() / computeConfirmCounts() / submitBlockers() from
 * here and nowhere else. submitBlockers' kind-(a) set is computed by the SAME
 * rowState() call the styling and the tile use — they cannot diverge.
 *
 * Pure — plain data in, plain values out. No React, no refs, no fetch.
 *
 * The three row states are mutually exclusive and computed from data that
 * already exists on the page:
 *
 *   corrected — the customer saved a replacement value (gapRef
 *               `corrected_<field>`, written by the inline editor).
 *   needsYou  — EITHER a disputed row whose corrected value hasn't been
 *               supplied yet, OR a low-confidence row (verificationStatus
 *               probable/indicative) the customer hasn't affirmed yet.
 *   confirmed — everything else: high-confidence rows left ticked, plus
 *               low-confidence rows the customer explicitly ticked.
 *
 * Why affirmation exists: every row arrives pre-ticked (checks defaults to
 * true), so `checks[idx] === true` alone cannot distinguish "the customer
 * agreed" from "the customer hasn't looked yet". The product decision is that
 * untouched low-confidence rows MUST block, so the gate needs the stronger
 * signal — an explicit tick — or it could never open. Affirming is additive UI
 * state; it never touches `checks`, the dialogue, or capture.
 *
 * SCOPE — vital (research.found) rows only. A stakeholder's per-person fields
 * are still next-page work until commit 6 brings per-person editing onto
 * Confirm, so counting them here would block a gate on work this page cannot
 * do. The person cards carry their own badge meanwhile. When commit 6 lands,
 * people join the gate by extending THIS module — not by adding a second
 * predicate somewhere else.
 */

import { parsePersonFieldId } from "./personType";

export const ROW_STATE = {
  CONFIRMED: "confirmed",
  NEEDS_YOU: "needsYou",
  CORRECTED: "corrected",
};

export const BLOCKER_KIND = {
  ATTENTION_ROW: "attention_row",
  MISSING_DOCUMENT: "missing_document",
  EMPTY_REQUIRED_GAP: "empty_required_gap",
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

/** The per-row context every consumer builds the same way. */
export function rowContext(item, idx, { checks = {}, affirmed = {}, corrections = {} } = {}) {
  return {
    checked: checks[idx] !== false,
    affirmed: !!affirmed[item.field],
    correction: corrections["corrected_" + item.field],
  };
}

/**
 * Normalise the row input to [{item, idx}] pairs. `idx` MUST stay the original
 * index into research.found — that is what `checks` is keyed by — so callers
 * that render a filtered subset (the vital-row table excludes stakeholder
 * fields, which render as person cards) pass `rows` with the original indices
 * rather than a re-indexed array. Passing `found` keeps positional indices and
 * is the convenient form for tests.
 */
function toRows({ rows, found }) {
  if (Array.isArray(rows)) return rows.filter((r) => r && r.item);
  return (Array.isArray(found) ? found : []).map((item, idx) => ({ item, idx }));
}

/**
 * Documents whose classification currently requires them, read from the
 * persisted dialogue snapshots. Each snapshot carries its classification event
 * verbatim, so this is the LIVE view — correct in dev with no DB, and correct
 * before the read endpoint has caught up. Re-checking a row deletes its
 * snapshot, which is what drops the document — the same "latest event wins"
 * semantics as deriveAmendmentDocuments server-side.
 */
export function docsNeededFrom(dialogueState = {}) {
  const out = [];
  Object.entries(dialogueState).forEach(([fieldId, snap]) => {
    const ev = snap && snap.event;
    if (ev && ev.workflow === "doc_required" && ev.docType) {
      out.push({ fieldId, docType: ev.docType, fieldClass: ev.fieldClass || null });
    }
  });
  return out;
}

/**
 * COMPANY-WIDE DOCUMENT TYPES — the artefact describes the whole company, so
 * ONE upload covers it however many people's changes asked for it.
 *
 * An ownership chart maps the entire ownership structure and a directors list
 * names every director; removing two UBOs does not create two charts. Contrast
 * identity evidence (Proof of Identity / Proof of Address / Source of Wealth),
 * where John's passport genuinely is not Jane's.
 *
 * Complete as of the current policy table — these are every non-identity
 * docType any rule emits (BASE_RULES + PERSON_RULES). Anything NOT listed and
 * triggered by a person is treated as per-person, which is the fail-safe
 * direction: a new identity-ish document over-collects rather than letting one
 * person's file silently satisfy everybody else's requirement.
 */
export const COMPANY_WIDE_DOC_TYPES = new Set([
  "Ownership Chart",
  "List of Directors",
  "Updated Director Registry",
  "Updated UBO Registry",
  "Notice of Change of Address",
  "Supporting Registration Document",
]);

export const isCompanyWideDocType = (docType) => COMPANY_WIDE_DOC_TYPES.has(docType);

/**
 * DOCUMENT SCOPE — the correction that makes identity evidence safe.
 *
 * Scope is a property of the DOCUMENT, not of the change that triggered it.
 * Deriving it from the fieldId alone was the bug: a person-scoped trigger
 * (`<personType>::<stakeholderId>::<attribute>`) made every document it asked
 * for per-person, so removing two UBOs opened two Ownership Chart requests for
 * one chart — and uploading it once could not close the other.
 *
 * So: company-wide docType → company scope, whoever triggered it. Otherwise a
 * person-scoped trigger means the document belongs to that person.
 */
export function docScope(d = {}) {
  if (isCompanyWideDocType(d.docType)) return { kind: "company" };
  const person = parsePersonFieldId(d.fieldId);
  return person ? { kind: "person", stakeholderId: person.stakeholderId } : { kind: "company" };
}

/**
 * The UPLOAD-SATISFACTION key. This is the safety-critical one: an uploaded
 * file satisfies exactly the entries sharing this key, so a person-scoped
 * document is keyed by (stakeholderId, docType) and can NEVER be satisfied by a
 * file uploaded for somebody else.
 *
 * NEITHER form contains the fieldId, and that is deliberate. The old company
 * form was `<fieldId>::<docType>`, but a company document can be triggered by
 * several different fields (or several different people), and which one lands
 * in the canonical entry depends on list order — which differs between the
 * Confirm page and the Fill Gaps panel. Keying on the docType alone is what
 * makes "upload it once, anywhere" actually true.
 */
export const docKey = (d) => {
  const scope = docScope(d);
  return scope.kind === "person"
    ? `${scope.stakeholderId}::${d.docType}`
    : `company::${d.docType}`;
};

/** The DEDUPE key — what collapses into one visible request. */
export const docDedupeKey = (d) => {
  const scope = docScope(d);
  // Per person for identity evidence; per type for company evidence, so the
  // company behaviour (several fields → one document) is exactly as before.
  return scope.kind === "person" ? `p:${scope.stakeholderId}:${d.docType}` : `c:${d.docType}`;
};

/**
 * Collapse a document list to what the customer is actually asked for, using
 * the scope-aware key: N people each owing a POI produce N entries (one each),
 * while one person whose DOB *and* nationality both trigger POI produces a
 * single POI for that person. First occurrence wins.
 *
 * Sources are unioned first: the persisted list from /api/amendment-documents
 * (authoritative in production) and the live dialogue outcomes (correct in dev
 * without a DB, and immediately after a change before the round-trip lands).
 */
export function canonicalDocs(...sources) {
  const seen = new Set();
  const out = [];
  for (const list of sources) {
    for (const d of Array.isArray(list) ? list : []) {
      if (!d || !d.docType) continue;
      const key = docDedupeKey(d);
      if (seen.has(key)) continue;
      seen.add(key);
      const scope = docScope(d);
      const isPerson = scope.kind === "person";
      out.push({
        fieldId: d.fieldId,
        docType: d.docType,
        fieldClass: d.fieldClass || null,
        // Carried so the panel can say WHOSE document this is. A company-wide
        // document belongs to nobody in particular even when a person's change
        // asked for it, so it must NOT inherit that person's name — labelling
        // the single ownership chart "— John Smith" is what made it look like
        // one of several per-person requests.
        stakeholderId: isPerson ? scope.stakeholderId : null,
        personName: isPerson ? d.personName || null : null,
      });
    }
  }
  return out;
}

/** An upload satisfies a document only if it actually stored. */
export function isSatisfied(upload) {
  return !!upload && !upload.uploadFailed;
}

export function computeConfirmCounts({
  rows,
  found = [],
  checks = {},
  affirmed = {},
  corrections = {},
  docs = [],
  uploads = {},
} = {}) {
  let needsYou = 0;
  let confirmed = 0;
  let corrected = 0;
  toRows({ rows, found }).forEach(({ item, idx }) => {
    const state = rowState(item, rowContext(item, idx, { checks, affirmed, corrections }));
    if (state === ROW_STATE.CORRECTED) corrected += 1;
    else if (state === ROW_STATE.NEEDS_YOU) needsYou += 1;
    else confirmed += 1;
  });
  const outstandingDocs = docs.filter((d) => !isSatisfied(uploads[docKey(d)]));
  return {
    needsYou,
    confirmed,
    corrected,
    docsNeeded: outstandingDocs.length,
    docsTotal: docs.length,
    docs,
    outstandingDocs,
  };
}

/**
 * THE GATE. Returns a structured blocker list; the gate is blocked iff it is
 * non-empty, and the button's message is derived from the same list.
 *
 * (a) attention_row      — rowState === needsYou. IDENTICAL to what the amber
 *                          styling marks and the Needs You tile counts, because
 *                          it is the same rowState() call. An untouched
 *                          high-confidence row is never in this set.
 * (b) missing_document   — a currently-required document with no successful
 *                          upload. INDEPENDENT of (a): correcting a
 *                          document-triggering field resolves (a) but leaves
 *                          (b) blocking until the file lands. That
 *                          independence is the compliance-first behaviour, and
 *                          it falls out of the two conditions being separate
 *                          rather than from any special-casing.
 * (c) empty_required_gap — a required gap with no value. Callers pass the gaps
 *                          that are actionable on THEIR surface; see the note
 *                          at the Confirm call site about why blocking on
 *                          fields the customer cannot see would be a trap.
 */
export function submitBlockers({
  rows,
  found = [],
  checks = {},
  affirmed = {},
  corrections = {},
  docs = [],
  uploads = {},
  requiredGaps = [],
} = {}) {
  const blockers = [];

  toRows({ rows, found }).forEach(({ item, idx }) => {
    const state = rowState(item, rowContext(item, idx, { checks, affirmed, corrections }));
    if (state !== ROW_STATE.NEEDS_YOU) return;
    const disputed = checks[idx] === false;
    blockers.push({
      kind: BLOCKER_KIND.ATTENTION_ROW,
      fieldId: item.field,
      label: item.label || item.field,
      reason: disputed
        ? "You marked this as wrong — enter the correct value."
        : "From a company or unverified source — confirm it or correct it.",
    });
  });

  // Person-scoped documents are counted PER PERSON: uploading John's Proof of
  // Identity clears John's blocker and leaves Jane's standing. The scope-aware
  // docKey is what guarantees that — one person's file can never satisfy
  // another's requirement.
  canonicalDocs(docs).forEach((d) => {
    if (isSatisfied(uploads[docKey(d)])) return;
    blockers.push({
      kind: BLOCKER_KIND.MISSING_DOCUMENT,
      fieldId: d.fieldId,
      stakeholderId: d.stakeholderId || null,
      label: d.personName ? `${d.docType} — ${d.personName}` : d.docType,
      reason: "Your change needs this document before we can continue.",
    });
  });

  (Array.isArray(requiredGaps) ? requiredGaps : []).forEach((g) => {
    if (!g || !g.field) return;
    if (hasValue(corrections[g.field])) return;
    blockers.push({
      kind: BLOCKER_KIND.EMPTY_REQUIRED_GAP,
      fieldId: g.field,
      label: g.label || g.field,
      reason: "This field is required.",
    });
  });

  return blockers;
}

/** The button's message, derived from the same list that blocks it — never a
 *  silent grey-out. Prefers a short combined form when kinds mix. */
export function blockerSummary(blockers = []) {
  const items = blockers.filter((b) => b.kind !== BLOCKER_KIND.MISSING_DOCUMENT).length;
  const documents = blockers.filter((b) => b.kind === BLOCKER_KIND.MISSING_DOCUMENT).length;
  if (!items && !documents) return null;
  const itemPart = items ? `${items} item${items === 1 ? "" : "s"} need${items === 1 ? "s" : ""} your input` : null;
  const docPart = documents ? `${documents} document${documents === 1 ? "" : "s"} needed` : null;
  if (itemPart && docPart) return `${items} item${items === 1 ? "" : "s"} · ${docPart}`;
  return itemPart || docPart;
}

export default computeConfirmCounts;
