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
  // A statement the client gave up on is still running on the database, so
  // its connection is thrown away rather than handed to the next query, which
  // would wait behind it (review, 2026-10-09).
  const timedOut = (error) => /timeout/i.test(String(error && error.message));
  return {
    async query(text, params) {
      const client = await pool.connect();
      let broken = null;
      try {
        return await client.query(text, params);
      } catch (error) {
        if (timedOut(error)) broken = error;
        throw error;
      } finally { client.release(broken || undefined); }
    },
    async transaction(work) {
      const client = await pool.connect();
      let broken = null;
      try {
        // The database stops the work too: the pooler ignores a limit set
        // when connecting, but takes one set for the transaction - sent with
        // BEGIN, so it costs no extra round trip.
        await client.query(`BEGIN; SET LOCAL statement_timeout = ${Math.max(1, Math.floor(queryMs))}`);
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        // A connection that died mid-transaction cannot roll back; the error
        // that matters is the original one, and the connection is not reused.
        try { await client.query("ROLLBACK"); } catch (rollbackError) { broken = rollbackError; }
        if (timedOut(error)) broken = broken || error;
        throw error;
      } finally { client.release(broken || undefined); }
    },
    close: () => pool.end(),
  };
}

module.exports = { createPostgresDb, DEFAULT_TIMEOUTS };
