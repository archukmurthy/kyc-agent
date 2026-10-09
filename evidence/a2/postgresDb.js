"use strict";

const { Pool } = require("@neondatabase/serverless");

// Without these a dropped connection was waited on until the operating system
// gave up - about fourteen minutes - and an idle connection was reused after
// Neon had paused the database, when it is dead (2026-10-09: a read hung that
// long in the test suite, and a server function would have hung to its limit).
//   connect   how long to wait for a connection at all
//   idle      how long an unused connection is kept; well under Neon's pause
//   query     the longest one statement may take, on our side of the wire
const DEFAULT_TIMEOUTS = Object.freeze({ connectMs: 15000, idleMs: 10000, queryMs: 120000 });

function createPostgresDb(connectionString = process.env.DATABASE_URL, timeouts = {}) {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const { connectMs, idleMs, queryMs } = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const pool = new Pool({ connectionString, connectionTimeoutMillis: connectMs, idleTimeoutMillis: idleMs, query_timeout: queryMs });
  // An idle connection that breaks is reported here; with no listener it
  // would end the whole process.
  pool.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.warn("[postgres] an idle connection was lost:", error && error.message);
  });
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(work) {
      const client = await pool.connect();
      let broken = null;
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        // A connection that died mid-transaction cannot roll back; the error
        // that matters is the original one, and the connection is not reused.
        try { await client.query("ROLLBACK"); } catch (rollbackError) { broken = rollbackError; }
        throw error;
      } finally { client.release(broken || undefined); }
    },
    close: () => pool.end(),
  };
}

module.exports = { createPostgresDb, DEFAULT_TIMEOUTS };
