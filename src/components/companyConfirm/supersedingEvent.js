/**
 * supersedingEvent.js — pure builder for the SUPERSEDING change-event emitted
 * when the customer saves an inline-corrected value on Confirm (Option B,
 * commit 3; hardened in 3.1). First code in the app to exercise the store's
 * supersede-by-new-row mechanism (change_events.supersedes, migration 007).
 *
 * It clones the dialogue's initial event so the classification — workflow,
 * docType, intent, registry claim, provenance — is carried VERBATIM, never
 * re-derived. That is deliberate and load-bearing: deriveAmendmentDocuments
 * reads the CURRENT event's workflow/doc_type, so a superseding event that
 * dropped the classification would silently retract a required document. The
 * change still happened; the document still stands. (A genuine reason-flip that
 * should drop the document flows through the separate re-check/revert path.)
 *
 * LINEAGE — chain to the TAIL, not the head. writeEvent rejects superseding an
 * already-superseded row, api/change-events swallows that throw as a 200, and a
 * fire-and-forget client discards it: a second edit pointed at the original
 * event would be silently lost. So each successful write records its own id as
 * `tailEventId`, and the next edit supersedes THAT. `eventId` (the head, set
 * once by ChangeDialogue) is only the fallback for the first correction. The
 * two keys are deliberately separate so the dialogue re-persisting its snapshot
 * can never clobber the tail back to the head.
 *
 * A NULL id is always a clean fallback — it is the one value that cannot throw,
 * and currency then resolves by max id (the same ordering the production revert
 * path already relies on). A stale or guessed id is strictly worse than none.
 * Ids are treated as OPAQUE TOKENS: the Neon HTTP driver may hand back a bigint
 * as a string, so they are only ever passed back verbatim — never compared
 * numerically, never used in arithmetic.
 *
 * Returns null until the initial event exists (snapshot.emitted + .event): a
 * value saved before the dialogue classifies has nothing to supersede.
 */

/**
 * Keep the corrected value serialised the way the original was, so a later diff
 * view never compares a string to an object. Inline edits are scalar by
 * construction (the editor renders text/select/date inputs), so this normalises
 * to a string — matching the string beforeValue a research row carries. An
 * object-shaped original cannot be reconstructed from typed text; that stays a
 * real shape change rather than a silent coercion.
 */
export function serialiseLike(value, reference) {
  if (value === null || value === undefined) return null;
  if (typeof reference === "object" && reference !== null) return String(value);
  return String(value);
}

/**
 * @param {object}  snapshot   the dialogue's persisted state for this field
 * @param {*}       value      the customer's corrected value
 * @param {object} [opts]
 * @param {boolean} [opts.eddFlag]  CD-03 high-risk-country flag for the CORRECTED
 *   value (commit 8). It is OR-ed onto the cloned classification, never cleared:
 *   correcting a country field INTO a high-risk country must raise the flag, and
 *   correcting back out of one must not silently retract an analyst signal on an
 *   append-only trail. Same reasoning as the workflow/docType clone above — a
 *   genuine retraction goes through the re-check/revert path, not through an
 *   edit. Everything else stays verbatim.
 */
export function buildSupersedingEvent(snapshot, value, opts = {}) {
  if (!snapshot || !snapshot.emitted || !snapshot.event) return null;
  const event = {
    ...snapshot.event,
    changeType: "changed",
    afterValue: serialiseLike(value, snapshot.event.beforeValue),
    eddFlag: Boolean(snapshot.event.eddFlag) || opts.eddFlag === true,
  };
  // Prefer the tail (the most recent superseding write). The head is only ever
  // a target for the FIRST correction: once `headConsumed` is set, a write has
  // already superseded it, so falling back to it would throw and be swallowed.
  // When neither is known, omit entirely and take the always-safe null path.
  const target = snapshot.tailEventId != null
    ? snapshot.tailEventId
    : snapshot.headConsumed
    ? null
    : snapshot.eventId;
  delete event.supersedesId;
  if (target != null) event.supersedesId = target;
  return event;
}

export default buildSupersedingEvent;
