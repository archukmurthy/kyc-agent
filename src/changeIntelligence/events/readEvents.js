/**
 * readEvents.js — read-only query helpers over change_events.
 *
 * NOTHING here mutates. There is no INSERT/UPDATE/DELETE in this module by
 * design (writeEvent.js is the only write path). If a read file ever imports a
 * mutation, that is a bug — the append-only invariant test asserts this surface.
 *
 * The "current" value of a field is a DERIVATION, not a stored column: it is the
 * latest row for that (submission, field) that NO other row supersedes. A
 * supersede chain therefore leaves all rows in place and simply moves which one
 * the derivation returns.
 *
 * `db` is the injected query surface (`.query(text, params) -> rows[]`). Each
 * query carries a leading `-- @qid:<name>` marker the driver ignores.
 */

const { COLUMNS } = require('./schema');

// Full ordered history for a submission (oldest first).
async function getEventsBySubmission(db, submissionId) {
  return db.query(
    `-- @qid:by_submission\nSELECT * FROM change_events WHERE ${COLUMNS.submissionId} = $1 ORDER BY ${COLUMNS.id} ASC`,
    [submissionId],
  );
}

// One field's full lineage (oldest first) — every event, nothing collapsed.
async function getEventsByField(db, submissionId, fieldId) {
  return db.query(
    `-- @qid:by_field\nSELECT * FROM change_events WHERE ${COLUMNS.submissionId} = $1 AND ${COLUMNS.fieldId} = $2 ORDER BY ${COLUMNS.id} ASC`,
    [submissionId, fieldId],
  );
}

// Derived "current" value: the latest event for the field that is not referenced
// by any other event's `supersedes`. Returns the row, or null if none.
async function getCurrentFieldState(db, submissionId, fieldId) {
  const rows = await db.query(
    `-- @qid:current_field_state\n` +
      `SELECT * FROM change_events e ` +
      `WHERE e.${COLUMNS.submissionId} = $1 AND e.${COLUMNS.fieldId} = $2 ` +
      `AND NOT EXISTS (SELECT 1 FROM change_events s WHERE s.${COLUMNS.supersedes} = e.${COLUMNS.id}) ` +
      `ORDER BY e.${COLUMNS.id} DESC LIMIT 1`,
    [submissionId, fieldId],
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

// Every event the engine could not classify (workflow UNDECIDED). Surfaces
// policy holes at runtime, same visibility the engine's completeness sweep gives
// at build time.
async function getUndecidedEvents(db, submissionId) {
  return db.query(
    `-- @qid:undecided\nSELECT * FROM change_events WHERE ${COLUMNS.submissionId} = $1 AND ${COLUMNS.decided} = false ORDER BY ${COLUMNS.id} ASC`,
    [submissionId],
  );
}

// Thin filtered read for the analyst queue. Data only — no selector, no UI.
async function getEscalations(db, submissionId) {
  return db.query(
    `-- @qid:escalations\nSELECT * FROM change_events WHERE ${COLUMNS.submissionId} = $1 AND ${COLUMNS.escalation} = true ORDER BY ${COLUMNS.id} ASC`,
    [submissionId],
  );
}

// Thin filtered read for the future Fill-Gaps amendment-doc selector: events
// that call for a document (doc_type set). Data only — no selector logic here.
async function getAmendmentDocs(db, submissionId) {
  return db.query(
    `-- @qid:amendment_docs\nSELECT * FROM change_events WHERE ${COLUMNS.submissionId} = $1 AND ${COLUMNS.docType} IS NOT NULL ORDER BY ${COLUMNS.id} ASC`,
    [submissionId],
  );
}

// Whole-table read for the (read-only) Change Intelligence dashboard. Returns
// EVERY event, oldest first, so the pure aggregator can derive current-state per
// (submission, field) itself. Bounded by `limit` (default 50k) so a runaway
// table can't blow the serverless response. Data only — no aggregation here.
async function getAllEvents(db, limit = 50000) {
  return db.query(
    `-- @qid:all_events\nSELECT * FROM change_events ORDER BY ${COLUMNS.id} ASC LIMIT $1`,
    [limit],
  );
}

module.exports = {
  getEventsBySubmission,
  getEventsByField,
  getCurrentFieldState,
  getUndecidedEvents,
  getEscalations,
  getAmendmentDocs,
  getAllEvents,
};
