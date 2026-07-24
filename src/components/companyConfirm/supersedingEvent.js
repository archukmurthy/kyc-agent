/**
 * supersedingEvent.js — pure builder for the SUPERSEDING change-event emitted
 * when the customer saves an inline-corrected value on Confirm (Option B,
 * commit 3). First code in the app to exercise the store's supersede-by-new-row
 * mechanism (change_events.supersedes, migration 007).
 *
 * It clones the dialogue's initial event so the classification — workflow,
 * docType, intent, registry claim, provenance — is carried VERBATIM, never
 * re-derived (the two events must tell one consistent story), and sets the two
 * things that differ:
 *   - afterValue: the customer's entered value (null on the initial event)
 *   - supersedesId: the initial event's server-assigned id, when the initial
 *     write returned one. Without it (e.g. local dev with no DATABASE_URL) the
 *     event is emitted un-linked and the store's latest-per-field ordering
 *     resolves currency — flagged as an open item with the change_events owner.
 *
 * Returns null until the initial event exists (snapshot.emitted + .event):
 * a value saved before the dialogue classifies has nothing to supersede.
 */
export function buildSupersedingEvent(snapshot, value) {
  if (!snapshot || !snapshot.emitted || !snapshot.event) return null;
  const event = { ...snapshot.event, changeType: "changed", afterValue: value };
  delete event.supersedesId;
  if (snapshot.eventId != null) event.supersedesId = snapshot.eventId;
  return event;
}

export default buildSupersedingEvent;
