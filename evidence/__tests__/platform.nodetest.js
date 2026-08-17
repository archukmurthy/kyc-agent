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
    stage: "A2",
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
  assert.match(lab, /\/api\/evidence\/a2-config/);
  assert.match(lab, /\/api\/evidence\/a2-collect/);
  assert.match(lab, /FIXTURE \/ SIMULATED/);
  assert.match(lab, /LIVE COMPANIES HOUSE COLLECTION/);
  assert.match(lab, /Structured evidence/);
  assert.match(lab, /Human-viewable evidence/);
  assert.match(lab, /OFFICERS — HUMAN-VIEWABLE WEBPAGE/);
  assert.match(lab, /PSC \/ OWNERSHIP — HUMAN-VIEWABLE WEBPAGE/);
});

test("GET /api/evidence/a1-fixture returns the validated A1 demonstration", async () => {
  const res = responseRecorder();
  await fixtureHandler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stage, "A1");
  assert.deepEqual(res.body.acquisitionOutcomes, { successful: 3, failed: 1, inconclusive: 1 });
  assert.equal(res.body.identicalFingerprintSeparateProvenance, true);
});
