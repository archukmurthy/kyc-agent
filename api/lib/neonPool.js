// api/lib/neonPool.js
"use strict";

// Pool (WebSocket) driver for INTERACTIVE transactions — the HTTP `neon()` driver
// cannot BEGIN/COMMIT across statements that chain on RETURNING ids, which the
// 11-table finalize needs. One shared Pool per process (Fluid Compute reuses the
// instance across invocations, so we do NOT end() it per request).
const { Pool, neonConfig } = require("@neondatabase/serverless");
const ws = require("ws");

neonConfig.webSocketConstructor = ws;

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

module.exports = { getPool };
