/* eslint-env node */
"use strict";

/**
 * How long UBO records are kept, and what "delete" is allowed to mean.
 *
 * The product owner's instruction, 2026-09-21: nothing is deleted for seven
 * years, the period is hard-coded with a comment rather than configurable, and
 * making it configurable is a backlog item (UBO-RET-1) rather than a feature.
 *
 * Seven years is the ordinary anti-money-laundering record-keeping period in
 * the UK and most of the markets this product is sold into: a regulator can ask
 * to see how an ownership decision was reached long after the relationship
 * ended. A record deleted early cannot be recreated, and "we deleted it" is not
 * an answer anybody accepts.
 *
 * Hard-coded on purpose. A retention period that can be changed by an
 * environment variable can be shortened by accident, in production, by someone
 * who does not know what it is for. Changing it should be a code change with a
 * reviewer - which is what UBO-RET-1 records, so the decision to make it
 * per-customer is taken deliberately rather than discovered.
 *
 * TWO RULES, and the second is the one people break:
 *
 *   1. Keep for seven years from the day the record was made.
 *   2. Nothing is ever hard-deleted. "Delete" means marked deleted and hidden;
 *      the row stays. A customer asking us to remove their data gets it hidden
 *      and excluded, not destroyed, because the obligation to retain outlives
 *      the request.
 *
 * SCOPE. This covers UBO case records - investigations, evidence, decisions,
 * and the trial records that carry a prospect's work. It does NOT cover who has
 * a login: revoking somebody's access removes their access row and should, the
 * same way a key is taken back without shredding the filing cabinet.
 *
 * CommonJS so api/ handlers, lib/ and scripts can all require it.
 */

// Seven years. See the comment above before changing this: it is hard-coded
// deliberately, and UBO-RET-1 is where making it configurable is tracked.
const RETENTION_YEARS = 7;

/** The date a record made at `from` may first be considered for deletion.
 *
 *  Uses setUTCFullYear rather than adding milliseconds, so leap years and the
 *  29th of February behave the way a person would expect - a record made on
 *  2028-02-29 is kept until 2035-03-01, not until some drifted date arrived at
 *  by counting 2,557 days.
 */
function retainUntil(from = new Date()) {
  const start = from instanceof Date ? new Date(from.getTime()) : new Date(from);
  if (Number.isNaN(start.getTime())) throw new Error("retainUntil needs a valid date");
  const until = new Date(start.getTime());
  until.setUTCFullYear(until.getUTCFullYear() + RETENTION_YEARS);
  return until.toISOString();
}

/** Stamps a record with the date it may first be considered for deletion.
 *
 *  Written onto the record rather than calculated on read, so the period that
 *  applied when the record was made travels with it. If the period ever changes,
 *  old records keep the promise they were made under.
 */
function withRetention(record, from = new Date()) {
  if (!record || typeof record !== "object") throw new Error("withRetention needs a record");
  return { ...record, retainUntil: record.retainUntil || retainUntil(from) };
}

/** Whether a record is still inside its retention period - which is to say,
 *  whether deleting it would breach the rule. */
function isWithinRetention(record, now = new Date()) {
  if (!record || !record.retainUntil) {
    // No stamp means we cannot prove the period has passed, and "cannot prove"
    // must never resolve to "delete it".
    return true;
  }
  return new Date(now).getTime() < Date.parse(record.retainUntil);
}

module.exports = { RETENTION_YEARS, retainUntil, withRetention, isWithinRetention };
