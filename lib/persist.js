// Benchmark write-path: persist one benchmarked entity (and its parent run /
// client / session) into Neon Postgres.
//
// Adapted to the ACTUAL shape api/benchmark.js returns (input/schema/usage/
// totalTokens) rather than the entity/classification/cost shape the original
// plan assumed — those nested objects don't exist. The full result is stored
// verbatim in onboarding_sessions.raw_result (JSONB) so any metric can be
// recomputed later without re-calling the model.
//
// All four rows are written in ONE atomic statement (a writable-CTE chain).
// A single SQL statement runs in its own implicit transaction, so it's
// all-or-nothing without needing the WebSocket Pool (and its `ws` dep). Uses
// the pooled DATABASE_URL via the HTTP driver.

const { neon } = require("@neondatabase/serverless");

// claude-sonnet-4-5 list price (USD per million tokens). Token-based estimate;
// excludes any per-request web_search surcharge. Adjust here if pricing moves.
const PRICE_PER_MTOK_INPUT = 3.0;
const PRICE_PER_MTOK_OUTPUT = 15.0;

function estimateCostUsd(inputTokens, outputTokens) {
  const usd =
    (Number(inputTokens || 0) / 1e6) * PRICE_PER_MTOK_INPUT +
    (Number(outputTokens || 0) / 1e6) * PRICE_PER_MTOK_OUTPUT;
  return Math.round(usd * 1e6) / 1e6; // NUMERIC(10,6)
}

// Atomic write of benchmark_runs + clients + onboarding_sessions +
// benchmark_entities. Returns { client_id, session_id, benchmark_run_id }.
// Throws on any failure — the caller decides how to handle it.
async function persistBenchmarkEntity(result, { runId, entityName, segment, ownershipType }) {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  if (!runId) throw new Error("persistBenchmarkEntity: runId is required");

  const sql = neon(conn);

  const input = result.input || {};
  const schema = result.schema || {};
  const usage = result.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;

  const legalName = input.companyName;
  const countryCode = input.countryCode;
  const entityType = input.entityType;
  const schemaKey = entityType && schema.licenceId ? `${entityType}:${schema.licenceId}` : null;
  const totalTokens = inputTokens + outputTokens;
  const costUsd = estimateCostUsd(inputTokens, outputTokens);
  const jurisdiction = schema.region || schema.licenceId || null;

  // $1 runId, $2 legalName, $3 countryCode, $4 entityType, $5 ownershipType,
  // $6 schemaKey, $7 totalTokens, $8 costUsd, $9 rawResult(jsonb),
  // $10 entityName, $11 segment, $12 jurisdiction
  const rows = await sql.query(
    `
    WITH
    run_ins AS (
      INSERT INTO benchmark_runs (id, tenant_id, entity_count, executed_at)
      VALUES ($1, 'demo', 0, NOW())
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    ),
    client_ins AS (
      INSERT INTO clients (tenant_id, legal_name, country_code, entity_type, ownership_type)
      VALUES ('demo', $2, $3, $4, $5)
      ON CONFLICT (tenant_id, legal_name, country_code) DO NOTHING
      RETURNING id
    ),
    client_row AS (
      SELECT id FROM client_ins
      UNION ALL
      SELECT id FROM clients WHERE tenant_id = 'demo' AND legal_name = $2 AND country_code = $3
      LIMIT 1
    ),
    session_ins AS (
      INSERT INTO onboarding_sessions
        (client_id, tenant_id, schema_key, config_version, status, source,
         total_tokens, cost_usd, completed_at, raw_result)
      SELECT cr.id, 'demo', $6, NULL, 'completed', 'benchmark', $7, $8, NOW(), $9::jsonb
      FROM client_row cr
      RETURNING id
    ),
    entity_ins AS (
      INSERT INTO benchmark_entities
        (benchmark_run_id, session_id, entity_name, segment, jurisdiction, ownership_type)
      SELECT $1, si.id, $10, $11, $12, $5
      FROM session_ins si
      RETURNING id
    )
    SELECT
      (SELECT id FROM client_row)  AS client_id,
      (SELECT id FROM session_ins) AS session_id
    `,
    [
      runId,
      legalName,
      countryCode,
      entityType,
      ownershipType,
      schemaKey,
      totalTokens,
      costUsd,
      JSON.stringify(result),
      entityName,
      segment ?? null,
      jurisdiction,
    ],
  );

  const row = rows[0] || {};
  return { client_id: row.client_id, session_id: row.session_id, benchmark_run_id: runId };
}

module.exports = { persistBenchmarkEntity, estimateCostUsd };
