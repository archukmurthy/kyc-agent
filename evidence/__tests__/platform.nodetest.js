"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getPlatformStatus } = require("../platform");
const statusHandler = require("../../api/evidence/status");

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

test("the server boundary exposes only the A0 availability status", () => {
  assert.deepEqual(getPlatformStatus(), {
    platform: "evidence",
    stage: "A0",
    status: "available",
  });
});

test("GET /api/evidence/status returns the boundary status", () => {
  const res = responseRecorder();
  statusHandler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, getPlatformStatus());
});

test("the status route rejects methods outside the A0 contract", () => {
  const res = responseRecorder();
  statusHandler({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
  assert.deepEqual(res.body, { error: "Method not allowed" });
});

test("the Evidence Lab calls the verified status route", () => {
  const labPath = path.join(__dirname, "..", "..", "public", "evidence-lab.html");
  const lab = fs.readFileSync(labPath, "utf8");
  assert.match(lab, /fetch\("\/api\/evidence\/status"\)/);
});
