"use strict";

// One codebase, two products. These tests are about what a prospect can reach
// when the deployment says "ubo".

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const productMode = require("../productMode");

beforeEach(() => { delete process.env.PRODUCT_MODE; });

test("with no mode set, everything is served as before", () => {
  assert.equal(productMode.isUboOnly(), false);
  for (const p of ["/admin", "/super-admin", "/preboarding", "/api/config", "/ubo-demo"]) {
    assert.equal(productMode.isPathAllowed(p), true, p);
  }
});

test("in ubo mode the platform surfaces are not found", () => {
  process.env.PRODUCT_MODE = "ubo";
  for (const p of ["/admin", "/admin/settings", "/super-admin", "/preboarding", "/insights", "/policy-simulator"]) {
    assert.equal(productMode.isPathAllowed(p), false, `${p} must not be reachable in a UBO deployment`);
  }
});

test("in ubo mode the platform's API routes are not found either", () => {
  // The screens being hidden is worth nothing on its own: anyone can post to a
  // route directly.
  process.env.PRODUCT_MODE = "ubo";
  for (const p of ["/api/config", "/api/tenants", "/api/admin-auth", "/api/submit", "/api/save-dossier", "/api/idv-match/session"]) {
    assert.equal(productMode.isPathAllowed(p), false, p);
  }
});

test("in ubo mode the UBO surfaces still work", () => {
  process.env.PRODUCT_MODE = "ubo";
  for (const p of ["/", "/ubo-demo", "/ubo-demo/research", "/ubo-trials", "/api/ubo-discovery", "/api/ubo-invite", "/api/upload-document", "/static/js/main.js", "/favicon.svg"]) {
    assert.equal(productMode.isPathAllowed(p), true, `${p} is part of the product and must work`);
  }
});

test("refuseIfHidden answers with a plain 404 and no explanation", () => {
  // Saying "this exists but is disabled here" tells a stranger what else to
  // look for.
  process.env.PRODUCT_MODE = "ubo";
  const res = {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const handled = productMode.refuseIfHidden({ url: "/api/config?tenant=acme" }, res);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "not_found" });
});

test("the middleware copy of the list cannot drift from this one", () => {
  // middleware.js runs on the Edge runtime and cannot require this module, so
  // the lists are duplicated. This is what stops the duplication rotting.
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "middleware.js"), "utf8");
  const listFrom = (name) => {
    // Plain slicing rather than a regex: this test exists to catch drift, and a
    // clever pattern that silently matches nothing would defeat its own point.
    const marker = `const ${name} = [`;
    const start = source.indexOf(marker);
    assert.ok(start !== -1, `middleware.js must declare ${name}`);
    const end = source.indexOf("]", start);
    return source
      .slice(start + marker.length, end)
      .split(",")
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  };
  assert.deepEqual(listFrom("UBO_PATHS"), [...productMode.UBO_PATHS]);
  assert.deepEqual(listFrom("ALWAYS"), [...productMode.ALWAYS]);
});
