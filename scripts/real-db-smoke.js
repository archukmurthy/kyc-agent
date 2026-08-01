#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { neon } = require("@neondatabase/serverless");
const { buildRealShapedJourneyFixture } = require("./fixtures/real-shaped-journey");

const CONFIRMATION = "I_UNDERSTAND_TEST_DATA_WILL_BE_WRITTEN";

function loadLocalTestEnv() {
  const envPath = path.resolve(process.cwd(), ".env.test.local");
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function normalizeConnectionString(value) {
  return String(value || "").trim().replace(/[?&](?:sslmode|channel_binding)=[^&]*/g, "");
}

function requireSafeTestDatabase() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required. Put a disposable Neon branch/database URL in .env.test.local.",
    );
  }
  if (process.env.REAL_DB_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set REAL_DB_SMOKE_CONFIRM=${CONFIRMATION} to acknowledge that disposable test rows will be written.`,
    );
  }
  if (
    process.env.DATABASE_URL &&
    normalizeConnectionString(testUrl) === normalizeConnectionString(process.env.DATABASE_URL)
  ) {
    throw new Error(
      "TEST_DATABASE_URL resolves to DATABASE_URL. Refusing to run against the configured application database.",
    );
  }
  return testUrl;
}

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(handler, req) {
  const res = mockResponse();
  await handler(req, res);
  return res;
}

async function queryOne(sql, text, params, label) {
  const rows = await sql.query(text, params);
  assert.equal(rows.length, 1, `${label}: expected exactly one row`);
  return rows[0];
}

async function cleanup(sql, ids, fixture) {
  // Recover IDs from the unique tenant marker if a handler wrote rows and then
  // failed before returning its response. This keeps cleanup reliable on the
  // exact partial-failure paths the smoke test is intended to expose.
  const discoveredSessions = await sql.query(
    "SELECT id, client_id FROM onboarding_sessions WHERE tenant_id = $1",
    [fixture.tenantId],
  );
  const sessionIds = new Set(discoveredSessions.map((row) => row.id));
  if (ids.sessionId) sessionIds.add(ids.sessionId);

  const discoveredJourneys = await sql.query(
    "SELECT journey_id FROM journeys WHERE tenant_id = $1",
    [fixture.tenantId],
  );
  const journeyIds = new Set(discoveredJourneys.map((row) => row.journey_id));
  if (ids.journeyId) journeyIds.add(ids.journeyId);

  const discoveredDossiers = await sql.query(
    "SELECT id FROM entity_dossiers WHERE tenant_id = $1",
    [fixture.tenantId],
  );
  const dossierIds = new Set(discoveredDossiers.map((row) => row.id));
  if (ids.dossierId) dossierIds.add(ids.dossierId);

  const clientIds = new Set(discoveredSessions.map((row) => row.client_id));
  if (ids.clientId) clientIds.add(ids.clientId);

  const statements = [];
  for (const journeyId of journeyIds) {
    for (const table of [
      "retention_actions",
      "risk_ratings",
      "screening_results",
      "policy_decisions",
      "search_results",
      "events",
      "api_usage",
      "field_provenance",
      "declaration",
      "completion_choice",
    ]) {
      statements.push([`DELETE FROM ${table} WHERE journey_id = $1`, [journeyId]]);
    }
    statements.push(["UPDATE documents SET journey_id = NULL WHERE journey_id = $1", [journeyId]]);
    statements.push(["DELETE FROM journeys WHERE journey_id = $1", [journeyId]]);
  }
  for (const sessionId of sessionIds) {
    statements.push(["DELETE FROM field_values WHERE session_id = $1", [sessionId]]);
    statements.push(["DELETE FROM session_timeline WHERE session_id = $1", [sessionId]]);
    statements.push(["DELETE FROM documents WHERE session_id = $1", [sessionId]]);
    statements.push(["DELETE FROM onboarding_sessions WHERE id = $1", [sessionId]]);
  }
  statements.push(["DELETE FROM change_events WHERE submission_id = $1", [fixture.marker]]);
  for (const dossierId of dossierIds) {
    statements.push(["DELETE FROM entity_dossiers WHERE id = $1", [dossierId]]);
  }
  for (const clientId of clientIds) {
    statements.push(["DELETE FROM clients WHERE id = $1", [clientId]]);
  }
  statements.push(["DELETE FROM tenants WHERE id = $1", [fixture.tenantId]]);

  const failures = [];
  for (const [text, params] of statements) {
    try {
      await sql.query(text, params);
    } catch (error) {
      // A test database may not have every optional migration. Continue cleaning
      // the tables that do exist, then report the incomplete cleanup as a failure.
      failures.push(`${text}: ${error.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Cleanup was incomplete:\n${failures.join("\n")}`);
  }
}

async function main() {
  loadLocalTestEnv();
  const testUrl = requireSafeTestDatabase();
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testUrl;

  const sql = neon(testUrl);
  const fixture = buildRealShapedJourneyFixture();
  const ids = {};
  let primaryError = null;

  // Require handlers only after DATABASE_URL points at the isolated test DB.
  const saveDossier = require("../api/save-dossier");
  const getDossier = require("../api/get-dossier");
  const writeChangeEvent = require("../api/change-events");
  const submit = require("../api/submit");

  console.log(`Real-DB smoke test: ${fixture.marker}`);
  console.log(`Tenant: ${fixture.tenantId}`);

  try {
    const saveRes = await invoke(saveDossier, {
      method: "POST",
      body: fixture.dossierPayload,
    });
    assert.equal(saveRes.statusCode, 200);
    assert.equal(saveRes.body?.success, true, saveRes.body?.warning || "Dossier save failed");
    assert.ok(saveRes.body.dossierId, "Dossier save did not return an id");
    ids.dossierId = saveRes.body.dossierId;

    const getRes = await invoke(getDossier, {
      method: "GET",
      query: { id: ids.dossierId, tenant: fixture.tenantId },
    });
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body?.success, true, getRes.body?.error || "Dossier load failed");
    const dossier = getRes.body.dossier;
    assert.equal(dossier.company_name, fixture.company.name);
    assert.equal(dossier.ownership_type, "private_limited");
    assert.equal(dossier.raw_research.smokeMarker, fixture.marker);
    assert.equal(dossier.raw_research.found[2].stakeholders[0].full_name, "Maya Thompson");
    assert.equal(dossier.stakeholders.beneficialOwners[0].shareholding, "32%");
    console.log("✓ Dossier save/load round-trip preserved realistic nested research data");

    const eventRes = await invoke(writeChangeEvent, {
      method: "POST",
      body: fixture.changeEvent,
    });
    assert.equal(eventRes.statusCode, 200);
    assert.equal(eventRes.body?.success, true, eventRes.body?.warning || "Change event write failed");
    const eventRow = await queryOne(
      sql,
      "SELECT field_id, workflow, doc_type, after_value FROM change_events WHERE submission_id = $1",
      [fixture.marker],
      "change event",
    );
    assert.equal(eventRow.field_id, "registeredAddress");
    assert.equal(eventRow.workflow, "doc_required");
    assert.equal(eventRow.doc_type, "Notice of Change of Address");
    assert.equal(eventRow.after_value, "20 Example Street, London, EC1A 1AB");
    console.log("✓ Confirm-style change event persisted with its Fill-Gaps document decision");

    const submitRes = await invoke(submit, {
      method: "POST",
      body: fixture.submitPayload,
    });
    assert.equal(submitRes.statusCode, 200);
    assert.equal(submitRes.body?.success, true, submitRes.body?.warning || "Submission failed");
    assert.ok(submitRes.body.sessionId, "Submission did not return a session id");
    assert.ok(submitRes.body.clientId, "Submission did not return a client id");
    assert.ok(submitRes.body.journeyId, "Journey-model persistence did not return a journey id");
    ids.sessionId = submitRes.body.sessionId;
    ids.clientId = submitRes.body.clientId;
    ids.journeyId = submitRes.body.journeyId;

    const session = await queryOne(
      sql,
      "SELECT status, journey_type, ownership_type, raw_result FROM onboarding_sessions WHERE id = $1",
      [ids.sessionId],
      "onboarding session",
    );
    assert.equal(session.status, "submitted");
    assert.equal(session.journey_type, "ai_only");
    assert.equal(session.ownership_type, "private_limited");
    assert.equal(session.raw_result.stakeholders.directors[0].full_name, "Maya Thompson");

    const journey = await queryOne(
      sql,
      "SELECT status, current_step, entity_type, jurisdiction FROM journeys WHERE journey_id = $1",
      [ids.journeyId],
      "journey",
    );
    assert.equal(journey.status, "completed");
    assert.equal(journey.current_step, "declaration");
    assert.equal(journey.entity_type, "Corporate");
    assert.equal(journey.jurisdiction, "GB");

    const provenanceRows = await sql.query(
      "SELECT field_name, agent_value, customer_value, customer_action, layer FROM field_provenance WHERE journey_id = $1",
      [ids.journeyId],
    );
    assert.ok(provenanceRows.length >= 6, "Expected scalar, stakeholder, and applicant provenance rows");
    const applicantName = provenanceRows.find((row) => row.field_name === "applicantFirstName");
    assert.ok(applicantName, "Applicant first-name provenance is missing");
    assert.equal(applicantName.agent_value, "Maya");
    assert.equal(applicantName.customer_value, "Maya");
    assert.equal(applicantName.customer_action, "accepted");
    const director = provenanceRows.find((row) =>
      row.field_name.startsWith("directors.director-"),
    );
    assert.ok(director, "Director provenance is missing");
    assert.equal(director.agent_value, "Maya Thompson");
    assert.equal(director.customer_action, "kept");

    const declaration = await queryOne(
      sql,
      "SELECT consent_given, timezone, user_agent FROM declaration WHERE journey_id = $1",
      [ids.journeyId],
      "declaration",
    );
    assert.equal(declaration.consent_given, true);
    assert.equal(declaration.timezone, "Europe/London");
    assert.equal(declaration.user_agent, "Codex real-DB smoke test");
    console.log("✓ Full submission persisted session, journey, declaration, and provenance");
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await cleanup(sql, ids, fixture);
      console.log("✓ Disposable smoke-test rows cleaned up");
    } catch (cleanupError) {
      if (primaryError) {
        primaryError.message += `\n${cleanupError.message}`;
      } else {
        primaryError = cleanupError;
      }
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (primaryError) throw primaryError;
  console.log("PASS: real-shaped data survived the real database write/read paths");
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
