/**
 * writeEvent.js — the ONLY write path into change_events.
 *
 * Appends one immutable event. It NEVER updates and NEVER deletes. Correcting a
 * prior event or reverting to the AI value are both expressed as a NEW row whose
 * `supersedesId` points at the row it replaces — the old row stays untouched, so
 * the audit trail can never shrink.
 *
 * `db` is the injected query surface (the neon HTTP client, or any object with
 * `.query(text, params) -> rows[]`). Each SQL string carries a leading
 * `-- @qid:<name>` marker; the driver ignores SQL comments, and test doubles use
 * the marker to route without parsing SQL.
 *
 * Enum guards are imported read-only from the engine's enums.js: an out-of-enum
 * value throws, which is the guard against a drifting caller.
 */

import {
  FIELD_CLASS,
  WORKFLOW,
  VERIFIABILITY,
  INTENT,
  REGISTRY_STATUS,
} from '../enums';
import { COLUMNS, WRITABLE_COLUMNS, JSONB_COLUMNS, CHANGE_TYPE_VALUES } from './schema';

// NOT NULL columns that carry a DB DEFAULT. Because writeEvent always lists
// every writable column in the INSERT, an omitted value would send an explicit
// NULL — which BYPASSES the column DEFAULT and violates NOT NULL. So we apply
// the same defaults here in JS when the caller omits them.
const NOT_NULL_DEFAULTS = {
  [COLUMNS.eddFlag]: false,
  [COLUMNS.escalation]: false,
  [COLUMNS.decided]: true,
};

// column -> the camelCase key callers pass on the event object
const COLUMN_TO_KEY = Object.fromEntries(
  Object.entries(COLUMNS).map(([key, col]) => [col, key]),
);

function assertEnum(label, value, allowed, { nullable }) {
  if (value === undefined || value === null) {
    if (nullable || allowed.includes(null)) return;
    throw new Error(`writeEvent: ${label} is required`);
  }
  if (!allowed.includes(value)) {
    throw new Error(
      `writeEvent: ${label} "${value}" is not in the allowed enum [${allowed
        .filter((v) => v !== null)
        .join(', ')}]`,
    );
  }
}

function requirePresent(event, label, key) {
  const v = event[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`writeEvent: ${label} is required`);
  }
}

export async function writeEvent(db, event = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('writeEvent: db with a .query(text, params) method is required');
  }

  // 1. The server assigns id + created_at. A caller-supplied id is a category
  //    error (it implies an overwrite, which append-only forbids).
  if ('id' in event) {
    throw new Error('writeEvent: id is server-assigned and must not be supplied');
  }

  // 2. Required NOT NULL context.
  requirePresent(event, 'submissionId', 'submissionId');
  requirePresent(event, 'fieldId', 'fieldId');

  // 3. Closed-vocabulary guards (the drift fence).
  assertEnum('fieldClass', event.fieldClass, FIELD_CLASS, { nullable: false });
  assertEnum('changeType', event.changeType, CHANGE_TYPE_VALUES, { nullable: false });
  assertEnum('workflow', event.workflow, WORKFLOW, { nullable: false });
  assertEnum('verifiability', event.verifiability, VERIFIABILITY, { nullable: true });
  assertEnum('customerIntent', event.customerIntent, INTENT, { nullable: true });
  assertEnum('customerRegistryClaim', event.customerRegistryClaim, REGISTRY_STATUS, {
    nullable: true,
  });

  // 4. Supersede validation: the target must exist AND still be current.
  //    A concurrent edit (target already superseded) throws — last-write-wins is
  //    the caller's call to make, not silently resolved here. (Open question O2.)
  const supersedesId = event.supersedesId ?? null;
  if (supersedesId !== null) {
    const existing = await db.query(
      `-- @qid:get_by_id\nSELECT ${COLUMNS.id} FROM change_events WHERE ${COLUMNS.id} = $1`,
      [supersedesId],
    );
    if (!existing || existing.length === 0) {
      throw new Error(`writeEvent: supersedesId ${supersedesId} does not exist`);
    }
    const alreadySuperseded = await db.query(
      `-- @qid:is_superseded\nSELECT ${COLUMNS.id} FROM change_events WHERE ${COLUMNS.supersedes} = $1 LIMIT 1`,
      [supersedesId],
    );
    if (alreadySuperseded && alreadySuperseded.length > 0) {
      throw new Error(
        `writeEvent: supersedesId ${supersedesId} is already superseded (concurrent edit; resolve last-write-wins in the caller)`,
      );
    }
  }

  // 5. Build the INSERT from WRITABLE_COLUMNS so column strings live only in
  //    schema.js. supersedes is appended explicitly (validated above).
  const insertCols = [...WRITABLE_COLUMNS, COLUMNS.supersedes];
  const params = [];
  const placeholders = insertCols.map((col, i) => {
    let value;
    if (col === COLUMNS.supersedes) {
      value = supersedesId;
    } else {
      const key = COLUMN_TO_KEY[col];
      value = event[key];
      if (value === undefined || value === null) {
        value = col in NOT_NULL_DEFAULTS ? NOT_NULL_DEFAULTS[col] : null;
      }
      if (JSONB_COLUMNS.includes(col) && value !== null) {
        value = JSON.stringify(value);
      }
    }
    params.push(value);
    const cast = JSONB_COLUMNS.includes(col) ? '::jsonb' : '';
    return `$${i + 1}${cast}`;
  });

  const rows = await db.query(
    `-- @qid:insert_event\nINSERT INTO change_events (${insertCols.join(', ')}) VALUES (${placeholders.join(
      ', ',
    )}) RETURNING *`,
    params,
  );

  return rows[0];
}
