"use strict";

// Idempotency for Didit webhook deliveries (Didit retries up to twice).
// markEventProcessed atomically records an event id and reports whether it is
// new. A duplicate delivery returns false so the caller skips reprocessing.
// Events without an id can't be deduped and are treated as new.
const { neon } = require("@neondatabase/serverless");

function client() {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

async function markEventProcessed(eventId, attemptId) {
  if (!eventId) return true;
  const sql = client();
  const rows = await sql`
    INSERT INTO idv_webhook_events (event_id, attempt_id)
    VALUES (${eventId}, ${attemptId})
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  return rows.length > 0;
}

module.exports = { markEventProcessed };
