#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { neon } = require("@neondatabase/serverless");
const { buildRealShapedJourneyFixture } = require("./fixtures/real-shaped-journey");
const { appRequire } = require("./lib/esm-require");

// Pure CJS app modules — the engine, the read DAL, and the amendment-document
// derivation. Safe to load before DATABASE_URL is repointed: none of them
// connect to anything.
const { classifyChange } = require("../src/changeIntelligence/classifyChange");
const { personHasHighRiskCountry } = require("../src/changeIntelligence/highRiskCountries");
const { deriveAmendmentDocuments } = require("../src/changeIntelligence/amendmentDocuments");
const {
  getEventsBySubmission,
  getCurrentFieldState,
} = require("../src/changeIntelligence/events/readEvents");

// The REAL client-side builders, loaded through the ESM shim. Payloads are
// built with these and never hand-written, because the bugs this harness exists
// to catch (source_tier as a string, an unthreaded fieldMetadata) lived in the
// builder->handler->column seam, which a literal payload steps straight over.
const { buildChangeEvent } = appRequire("src/components/changeDialogue/buildChangeEvent.js");
const { deriveSource } = appRequire("src/components/changeDialogue/dialogueContent.js");
const {
  personFieldId,
  resolvePersonType,
  PERSON_ATTRIBUTE,
} = appRequire("src/components/companyConfirm/personType.js");
const { docDedupeKey } = appRequire("src/components/companyConfirm/confirmState.js");

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

/**
 * THE RULE THIS HARNESS IS BUILT AROUND.
 *
 * /api/change-events and /api/submit answer 200 even when Postgres REJECTED the
 * write — capture must never block a customer, so the rejection is reported as
 * `{ success: false, warning }` in the body. Asserting on statusCode alone is
 * therefore worthless, and that blind spot is precisely what hid the
 * `invalid input syntax for type smallint: "tier1"` failure while the UI looked
 * perfect. Every write in this file goes through here.
 */
function assertWritten(res, label) {
  assert.equal(res.statusCode, 200, `${label}: unexpected status ${res.statusCode}`);
  assert.equal(
    res.body?.success,
    true,
    `${label}: handler reported failure — ${res.body?.warning || res.body?.error || "no warning given"}`,
  );
  return res.body;
}

let phaseCount = 0;
function pass(assertionName) {
  phaseCount += 1;
  console.log(`✓ ${assertionName}`);
}

/**
 * ASSERTION 5 — the guard fails LOUDLY without a real, separate test database.
 *
 * A smoke test that silently no-ops is worse than no smoke test: both handlers
 * degrade to a 200 when DATABASE_URL is unset, so an unguarded run would print
 * green while asserting nothing. This re-runs THIS script as a child process
 * with a deliberately unsafe environment and requires a non-zero exit.
 *
 * The child exits inside requireSafeTestDatabase, long before it reaches this
 * function, so there is no recursion; SMOKE_GUARD_CHILD is belt-and-braces so a
 * future reordering of main() cannot turn this into a fork bomb.
 */
function assertGuardRefusesUnsafeRuns() {
  if (process.env.SMOKE_GUARD_CHILD === "1") return;

  const cases = [
    {
      label: "no TEST_DATABASE_URL",
      env: { TEST_DATABASE_URL: "", REAL_DB_SMOKE_CONFIRM: CONFIRMATION },
      expect: /TEST_DATABASE_URL is required/,
    },
    {
      label: "missing acknowledgement",
      env: { TEST_DATABASE_URL: "postgresql://u:p@example.invalid/db", REAL_DB_SMOKE_CONFIRM: "" },
      expect: /REAL_DB_SMOKE_CONFIRM/,
    },
    {
      label: "test URL equals the application database",
      env: {
        TEST_DATABASE_URL: "postgresql://u:p@example.invalid/db?sslmode=require",
        DATABASE_URL: "postgresql://u:p@example.invalid/db",
        REAL_DB_SMOKE_CONFIRM: CONFIRMATION,
      },
      expect: /Refusing to run against the configured application database/,
    },
  ];

  for (const testCase of cases) {
    const result = spawnSync(process.execPath, [__filename], {
      encoding: "utf8",
      env: { ...process.env, ...testCase.env, SMOKE_GUARD_CHILD: "1" },
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    assert.notEqual(
      result.status,
      0,
      `Guard did not fail for "${testCase.label}" — a no-op run would have reported success`,
    );
    assert.match(output, testCase.expect, `Guard failed for the wrong reason on "${testCase.label}"`);
  }
  pass("Assertion 5 — guard refuses to run without a real, separate test database (3 unsafe cases, all non-zero exit)");
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
  // Runs FIRST, before a single row is written: if the safety net is broken
  // there is no point trusting anything that follows. The SMOKE_GUARD_CHILD
  // sentinel is what stops the child re-entering this.
  assertGuardRefusesUnsafeRuns();
  const testUrl = requireSafeTestDatabase();
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testUrl;

  const sql = neon(testUrl);
  const fixture = buildRealShapedJourneyFixture();
  const ids = {};
  const observed = {}; // values worth reporting, not just asserting
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
    assertWritten(eventRes, "fixture change event");
    const eventRow = await queryOne(
      sql,
      "SELECT field_id, workflow, doc_type, after_value FROM change_events WHERE submission_id = $1 AND field_id = $2",
      [fixture.marker, "registeredAddress"],
      "change event",
    );
    assert.equal(eventRow.field_id, "registeredAddress");
    assert.equal(eventRow.workflow, "doc_required");
    assert.equal(eventRow.doc_type, "Notice of Change of Address");
    assert.equal(eventRow.after_value, "20 Example Street, London, EC1A 1AB");
    console.log("✓ Confirm-style change event persisted with its Fill-Gaps document decision");

    // ── ASSERTION 1 — source_tier reaches a SMALLINT column as a NUMBER ──
    //
    // The fixture event above hardcodes `sourceTier: 1`, so on its own it can
    // never catch the real defect: a stakeholder object carries the STRING form
    // ("tier1") and the person path once passed it straight through, which real
    // Postgres rejected outright while the route still answered 200. This runs
    // the string through the SAME deriveSource the app uses and proves the
    // normalisation survives all the way into the column.
    const companySource = deriveSource({ sourceTier: "tier1", source: "Companies House" });
    assert.equal(typeof companySource.sourceTier, "number", "deriveSource must normalise tier1 -> 1");
    const companyEngine = classifyChange({
      fieldClass: "address",
      changeType: "update",
      intent: "genuine_update",
      registryStatus: "not_reflected",
      verifiability: "structured_registry",
      jurisdiction: "GB",
    });
    const companyBefore = { line1: "10 Example Street", postcode: "EC1A 1AA" };
    const companyEvent = buildChangeEvent({
      field: {
        fieldId: "smoke.company.registeredAddress",
        fieldClass: "address",
        value: companyBefore,
        sourceType: companySource.sourceType,
        sourceProvider: companySource.sourceProvider,
        sourceTier: companySource.sourceTier,
        verifiability: "structured_registry",
      },
      jurisdiction: "GB",
      submissionId: fixture.marker,
      storedChangeType: "changed",
      intent: "genuine_update",
      registryStatus: "not_reflected",
      engineResult: companyEngine,
      afterValue: "20 Example Street, London, EC1A 1AB",
    });
    assertWritten(
      await invoke(writeChangeEvent, { method: "POST", body: companyEvent }),
      "builder-built company correction",
    );
    const companyRow = await queryOne(
      sql,
      "SELECT field_id, workflow, source_tier, source_provider, before_value FROM change_events WHERE submission_id = $1 AND field_id = $2",
      [fixture.marker, "smoke.company.registeredAddress"],
      "company correction",
    );
    observed.companySourceTierType = typeof companyRow.source_tier;
    assert.equal(
      typeof companyRow.source_tier,
      "number",
      `source_tier persisted as ${typeof companyRow.source_tier} (${JSON.stringify(companyRow.source_tier)}) — a string here is the bug`,
    );
    assert.equal(companyRow.source_tier, 1);
    assert.equal(companyRow.source_provider, "Companies House");
    assert.equal(companyRow.workflow, companyEngine.workflow);
    // JSONB round-trip: an object in is the same object out, not a string.
    assert.deepEqual(companyRow.before_value, companyBefore);
    pass(
      `Assertion 1 — company correction: source_tier persisted as ${observed.companySourceTierType} (${companyRow.source_tier}), before_value JSONB round-tripped`,
    );

    // ── ASSERTION 2 — person composite fieldId + two-person document keying ──
    //
    // Mirrors App.js#emitPersonChange exactly: resolvePersonType -> personFieldId
    // -> classifyChange(personScope) -> deriveSource -> buildChangeEvent. Two
    // DIFFERENT stakeholders both correct a nationality, so both owe a Proof of
    // Identity — the cross-person under-collection defect was one upload
    // satisfying both, and the DB-observable half of that is whether the two
    // events stay independently addressable.
    const people = [
      {
        id: "sh_smoke_a",
        full_name: "Ana Silva",
        nationality: "Portuguese",
        isUBO: true,
        sourceTier: "tier1",
        source: "Companies House",
      },
      {
        id: "sh_smoke_b",
        full_name: "Bo Chen",
        nationality: "Singaporean",
        isUBO: true,
        sourceTier: "tier1",
        source: "Companies House",
      },
    ];
    const correctedNationality = { sh_smoke_a: "Brazilian", sh_smoke_b: "Malaysian" };

    for (const person of people) {
      const type = resolvePersonType(person, "beneficialOwners");
      const compositeId = personFieldId(type.personType, person.id, PERSON_ATTRIBUTE.NATIONALITY);
      const engineResult = classifyChange({
        personScope: true,
        personType: type.personType,
        attribute: PERSON_ATTRIBUTE.NATIONALITY,
        nameCase: null,
        pepValue: null,
        thresholdCrossing: null,
        highRiskCountry: personHasHighRiskCountry({
          ...person,
          nationality: correctedNationality[person.id],
        }),
      });
      // The line dcd38b3 added: person provenance goes through deriveSource, not
      // straight from the stakeholder's "tier1" string.
      const personSource = deriveSource({ sourceTier: person.sourceTier, source: person.source });
      const personEvent = buildChangeEvent({
        field: {
          fieldId: compositeId,
          fieldClass: type.personType === "director" ? "director" : "ubo",
          value: person.nationality,
          sourceType: personSource.sourceType,
          sourceProvider: personSource.sourceProvider,
          sourceTier: personSource.sourceTier,
          verifiability: "structured_registry",
        },
        jurisdiction: "GB",
        submissionId: fixture.marker,
        storedChangeType: "changed",
        intent: null,
        registryStatus: "unknown",
        engineResult,
        afterValue: correctedNationality[person.id],
      });
      assertWritten(
        await invoke(writeChangeEvent, { method: "POST", body: personEvent }),
        `person event for ${person.id}`,
      );
    }

    const allEvents = await getEventsBySubmission(sql, fixture.marker);
    const personRows = allEvents.filter((row) => String(row.field_id).includes("::"));
    observed.personFieldIds = personRows.map((row) => row.field_id).sort();
    assert.equal(personRows.length, 2, "Expected exactly two person events");
    assert.deepEqual(observed.personFieldIds, [
      "ubo::sh_smoke_a::nationality",
      "ubo::sh_smoke_b::nationality",
    ]);
    for (const row of personRows) {
      assert.equal(row.workflow, "doc_required", `${row.field_id}: wrong workflow`);
      assert.equal(row.doc_type, "Proof of Identity", `${row.field_id}: wrong doc_type`);
      assert.equal(
        typeof row.source_tier,
        "number",
        `${row.field_id}: source_tier persisted as ${typeof row.source_tier} — this is the exact person-path bug`,
      );
    }

    // The DB-observable half of cross-person collection: two people, two
    // documents. "Uploading one satisfies only one" is pure client state and is
    // covered by confirmState's unit tests — deliberately not asserted here.
    const derivedDocs = deriveAmendmentDocuments(allEvents);
    const personDocKeys = derivedDocs
      .filter((doc) => String(doc.fieldId).includes("::"))
      .map(docDedupeKey)
      .sort();
    observed.personDocKeys = personDocKeys;
    assert.deepEqual(personDocKeys, [
      "p:sh_smoke_a:Proof of Identity",
      "p:sh_smoke_b:Proof of Identity",
    ]);
    assert.equal(new Set(personDocKeys).size, 2, "Two people collapsed into one document request");
    pass(
      `Assertion 2 — person events kept distinct: ${observed.personFieldIds.join(" / ")} -> ${personDocKeys.join(" / ")}`,
    );

    // ── ASSERTION 4 — supersede chain resolves with OPAQUE STRING ids ──
    //
    // change_events.id is BIGSERIAL and the Neon HTTP driver returns it as a JS
    // STRING ("282"), not a number. Anything doing a numeric === on it breaks
    // the chain silently, and a stale supersedesId makes writeEvent throw —
    // which the route swallows as a 200, losing the event.
    const chainFieldId = "smoke.chain.tradingName";
    const chainEngine = classifyChange({
      fieldClass: "generic",
      changeType: "update",
      intent: "genuine_update",
      registryStatus: "not_reflected",
      verifiability: "unverified",
      jurisdiction: "GB",
    });
    const chainBase = {
      field: {
        fieldId: chainFieldId,
        fieldClass: "generic",
        value: "Head Value",
        sourceType: companySource.sourceType,
        sourceProvider: companySource.sourceProvider,
        sourceTier: companySource.sourceTier,
        verifiability: "unverified",
      },
      jurisdiction: "GB",
      submissionId: fixture.marker,
      storedChangeType: "changed",
      intent: "genuine_update",
      registryStatus: "not_reflected",
      engineResult: chainEngine,
    };
    const headBody = assertWritten(
      await invoke(writeChangeEvent, {
        method: "POST",
        body: buildChangeEvent({ ...chainBase, afterValue: "First Value" }),
      }),
      "supersede chain head",
    );
    observed.returnedIdType = typeof headBody.id;
    assert.equal(
      observed.returnedIdType,
      "string",
      `Returned id is ${observed.returnedIdType} — the driver's BIGSERIAL contract changed; numeric comparisons downstream are now suspect`,
    );

    const tailBody = assertWritten(
      await invoke(writeChangeEvent, {
        method: "POST",
        body: buildChangeEvent({
          ...chainBase,
          afterValue: "Second Value",
          supersedesId: headBody.id, // passed back verbatim, as an opaque token
        }),
      }),
      "supersede chain tail",
    );

    const current = await getCurrentFieldState(sql, fixture.marker, chainFieldId);
    assert.ok(current, "getCurrentFieldState returned nothing for the chained field");
    assert.equal(String(current.id), String(tailBody.id), "Current state is not the tail of the chain");
    assert.notEqual(String(current.id), String(headBody.id), "Superseded head is still current");
    assert.equal(current.after_value, "Second Value");
    assert.equal(String(current.supersedes), String(headBody.id));
    pass(
      `Assertion 4 — supersede chain resolved with ${observed.returnedIdType} ids: head ${headBody.id} -> tail ${tailBody.id}, current = tail`,
    );

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
      "SELECT field_name, agent_value, customer_value, final_value, customer_action, layer FROM field_provenance WHERE journey_id = $1",
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

    // ── ASSERTION 3 — scalar field_provenance keeps the THREE-WAY distinction ──
    //
    // agent_value is the AI/registry ORIGINAL and must never be overwritten
    // with the customer's value. This is the only durable second home for a
    // corrected value besides change_events.before_value, and it was silently
    // NULL for every scalar until fieldMetadata was threaded through submit's
    // destructure AND its persistJourneyModel call — a two-sided seam where
    // either half alone still yields NULL, and both halves' unit tests passed.
    const scalarOf = (fieldName) => {
      const row = provenanceRows.find((r) => r.field_name === fieldName);
      assert.ok(row, `field_provenance row for ${fieldName} is missing`);
      return row;
    };

    // 1. CORRECTED — the original and the customer's value both survive, distinct.
    const corrected = scalarOf("registeredAddress");
    assert.equal(corrected.agent_value, "10 Example Street, London, EC1A 1AA");
    assert.equal(corrected.customer_value, "20 Example Street, London, EC1A 1AB");
    assert.equal(corrected.final_value, "20 Example Street, London, EC1A 1AB");
    assert.notEqual(
      corrected.agent_value,
      corrected.customer_value,
      "A corrected scalar lost its original — agent_value was overwritten with the customer's value",
    );
    assert.equal(corrected.customer_action, "corrected");

    // 2. UNTOUCHED — agent value and final value coincide.
    const untouched = scalarOf("businessRegistrationNumber");
    assert.equal(untouched.agent_value, "12345678");
    assert.equal(untouched.final_value, "12345678");
    assert.equal(
      untouched.agent_value,
      untouched.final_value,
      "An untouched scalar should have agent_value === final_value",
    );
    assert.equal(untouched.customer_action, "kept");

    // 3. CUSTOMER-ENTERED GAP — no agent value at all. Claiming the AI sourced a
    //    value it never saw is worse than a null.
    const gap = scalarOf("natureOfBusiness");
    assert.equal(gap.agent_value, null, "A customer-entered gap must not claim an agent_value");
    assert.equal(gap.final_value, "Cross-border payment services");
    assert.equal(gap.customer_action, "provided");

    observed.provenance = {
      corrected: `agent=${corrected.agent_value} | customer=${corrected.customer_value} | action=${corrected.customer_action}`,
      untouched: `agent=${untouched.agent_value} == final=${untouched.final_value} | action=${untouched.customer_action}`,
      gap: `agent=${gap.agent_value} | final=${gap.final_value} | action=${gap.customer_action}`,
    };
    pass("Assertion 3 — field_provenance three-way: corrected keeps the original, untouched coincides, gap is NULL");
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

  console.log("\nObserved against the real database:");
  console.log(`  source_tier type      : ${observed.companySourceTierType}`);
  console.log(`  person field_ids      : ${(observed.personFieldIds || []).join(", ")}`);
  console.log(`  person document keys  : ${(observed.personDocKeys || []).join(", ")}`);
  console.log(`  returned event id type: ${observed.returnedIdType}`);
  console.log(`  provenance corrected  : ${observed.provenance?.corrected}`);
  console.log(`  provenance untouched  : ${observed.provenance?.untouched}`);
  console.log(`  provenance gap        : ${observed.provenance?.gap}`);
  console.log(`\nPASS: real-shaped data survived the real database write/read paths (${phaseCount}/5 targeted assertions)`);
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
