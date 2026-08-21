"use strict";

const { ConfigurationError, IdentityAuthorizationError } = require("../domain/errors");

class PostgresTransactionRunner {
  constructor({ connectionString, pool } = {}) {
    if (!pool && !connectionString) throw new ConfigurationError("IDV PostgreSQL connection string is required");
    if (pool) this.pool = pool;
    else {
      // Loaded lazily so pure domain/test consumers do not need a database.
      const { Pool } = require("@neondatabase/serverless");
      this.pool = new Pool({ connectionString });
    }
  }

  async withTransaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async withTenantTransaction(tenantId, work) {
    if (!tenantId || typeof tenantId !== "string" || tenantId.includes("\0")) {
      throw new IdentityAuthorizationError("A trusted tenant context is required for protected persistence");
    }
    return this.withTransaction(async (client) => {
      // set_config(..., true) is transaction-local and safe with pooled connections.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return work(client);
    });
  }

  async close() { if (typeof this.pool.end === "function") await this.pool.end(); }
}

module.exports = { PostgresTransactionRunner };
