"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getPlatformStatus } = require("../platform");
const statusHandler = require("../../api/evidence/status");
const fixtureHandler = require("../../api/evidence/a1-fixture");

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("the server boundary reports the current authorized build stage", () => {
  assert.deepEqual(getPlatformStatus(), {
    platform: "evidence",
    stage: "A3",
    status: "available",
  });
});

test("GET /api/evidence/status returns the boundary status", () => {
  const res = responseRecorder();
  statusHandler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, getPlatformStatus());
});

test("the status route rejects methods outside its GET contract", () => {
  const res = responseRecorder();
  statusHandler({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
  assert.deepEqual(res.body, { error: "Method not allowed" });
});

test("the Evidence Lab exposes the isolated A2 live and fixture route", () => {
  const labPath = path.join(__dirname, "..", "..", "public", "evidence-lab.html");
  const lab = fs.readFileSync(labPath, "utf8");
  const labJs = fs.readFileSync(path.join(__dirname, "..", "..", "public", "evidence-lab.js"), "utf8");
  assert.match(lab, /\/api\/evidence\/a2-config/);
  assert.match(lab, /\/api\/evidence\/a2-collect/);
  assert.match(lab, /FIXTURE \/ SIMULATED/);
  assert.match(lab, /LIVE COMPANIES HOUSE COLLECTION/);
  assert.match(lab, /Structured evidence/);
  assert.match(lab, /Human-viewable evidence/);
  assert.match(lab, /OFFICERS — HUMAN-VIEWABLE WEBPAGE/);
  assert.match(lab, /PSC \/ OWNERSHIP — HUMAN-VIEWABLE WEBPAGE/);
  assert.match(labJs, /\/api\/evidence\/a2-existing/);
  assert.match(lab, /Freshness policy not evaluated by Evidence Lab/);
  assert.match(lab, /FETCH FRESH EVIDENCE/);
  assert.match(labJs, /freshProducerRequestKey/);
  assert.match(lab, /\.activity\.hidden\{display:none\}/);
  assert.match(labJs, /received a non-JSON response/);
  assert.match(labJs, /Diagnostic reference/);
});

test("the Evidence Lab exposes the isolated A3 interpretation scenarios", () => {
  const lab = fs.readFileSync(path.join(__dirname, "..", "..", "public", "evidence-lab.html"), "utf8");
  const labJs = fs.readFileSync(path.join(__dirname, "..", "..", "public", "evidence-lab.js"), "utf8");
  assert.match(lab, /\/api\/evidence\/a3-fixture/);
  assert.match(lab, /\/api\/evidence\/a3-interpret/);
  assert.match(lab, /LIVE PRESERVED ARTIFACT/);
  assert.match(lab, /Requested versus discovered/);
  assert.match(lab, /Direct source fact/);
  assert.match(lab, /Selective independent verification/);
  assert.match(lab, /A3 SYNTHETIC FIXTURE SCENARIOS/);
  assert.match(lab, /does not use or interpret the A2 collection shown above/);
  assert.match(labJs, /\/api\/evidence\/a3-history/);
  assert.match(labJs, /Earlier failed interpretation attempt/);
  assert.match(labJs, /This is not the current interpretation and no facts were persisted/);
  assert.match(lab, /Run fresh interpretation/);
  assert.match(lab, /may make a paid AI request/);
  assert.match(lab, /VIEW PREVIOUS INTERPRETATION/);
  assert.match(labJs, /Provider extraction evaluation/);
  assert.match(labJs, /Already represented by A2/);
  assert.match(labJs, /No duplicate A3 fact was persisted/);
  assert.match(lab, /Select complete Evidence Asset/);
  assert.match(lab, /Selected Artifacts must belong to one Evidence Asset/);
  assert.match(labJs, /artifactIds:ids/);
  assert.match(labJs, /Supporting Artifacts/);
  assert.match(lab, /Clear displayed results/);
  assert.match(lab, /Selecting an Artifact does not load history or call AI/);
  assert.match(labJs, /Result from the fresh interpretation run/);
  assert.doesNotMatch(labJs, /renderArtifactSet\(a\);loadHistory\(a\.id\)/);
});

test("GET /api/evidence/a1-fixture returns the validated A1 demonstration", async () => {
  const res = responseRecorder();
  await fixtureHandler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stage, "A1");
  assert.deepEqual(res.body.acquisitionOutcomes, { successful: 3, failed: 1, inconclusive: 1 });
  assert.equal(res.body.identicalFingerprintSeparateProvenance, true);
});
