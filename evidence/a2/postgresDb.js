"use strict";

const { Pool } = require("@neondatabase/serverless");

function createPostgresDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString });
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

module.exports = { createPostgresDb };
