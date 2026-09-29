"use strict";

// No company's name is a default, and no company's name is hard-coded into a
// screen.
//
// This has been "fixed" twice before and came back twice, because both times we
// removed the instances we could find and installed nothing to stop the next
// one. Removing an instance is a day's work; this test is what makes it stay
// removed.
//
// TWO RULES:
//
//   1. No `|| "<brand>"` default anywhere. A request that does not say which
//      workspace it belongs to must be refused, never filed under a company
//      that happens to be in the code. That is not a convenience - the data
//      still goes somewhere, it just goes somewhere wrong, and the customer
//      whose name is in the code is the one it lands on.
//
//   2. No brand name printed on a screen. A customer who has not set their
//      company name must see their own name or nothing, never ours and never
//      another customer's.
//
// WHAT IS DELIBERATELY ALLOWED, and why the list is short and explicit:
//
//   - The vendor integration. Nium is a real third-party company-lookup
//     service we pay for. `lib/niumClient.js` and the adapters that call
//     api.nium.com are named after the supplier they call, the same way a
//     Companies House client is named after Companies House. Renaming those
//     would make the code lie about who it is talking to.
//   - `lib/tenantRegistry.js#PLATFORM_TENANT_IDS`, which names the platform's
//     own workspace so it can be seeded and protected. A named list is not a
//     default: nothing falls back to it.
//   - `lib/auth.js`'s password salt, which is mixed into stored password
//     hashes. Changing it locks every existing admin out, and it is visible to
//     nobody. Tracked as a decision, not an oversight.
//   - Tests and fixtures, which ship to nobody.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

// Directories that ship. Deliberately includes the Evidence Lab: it is not
// deployed today, but it held thirteen copies of the pattern, and "not deployed"
// is a deployment setting rather than a property of the code.
// evidence/, ubo-control-lab/ and integrations/ ship too: the partner's UBO demo
// arrived with `TENANT_ID || "nium"` defaults there, unseen by this scan (UBO-20).
const SEARCH = ["api", "lib", "src", "agents", "ubo-control", "ubo-control-ui", "ubo-control-lab", "evidence", "integrations", "public", "dossierLifecycle"];

const SKIP_DIRS = new Set(["node_modules", "build", "__tests__", "tests", "test-support", "fixtures", "demo", ".kilo", "coverage"]);

// Test harnesses that ship to nobody.
const SKIP_FILES = new Set(["src/setupTests.js"]);

// The supplier's own client and adapters. Named after who they call.
const VENDOR_FILES = new Set([
  "lib/niumClient.js",
  "agents/ubo/niumOwnershipAdapter.js",
  "agents/kycLookupAgent.js",
]);

// Named, not defaulted - see the note at the top of this file.
const ALLOWED_NAMED = new Set([
  "lib/tenantRegistry.js",
  "lib/auth.js",
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|html)$/.test(entry.name) && !/\.test\.|\.nodetest\./.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = SEARCH.flatMap((dir) => walk(path.join(ROOT, dir)));
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

test("the search actually reaches the code", () => {
  // A guard that silently matches nothing is worse than no guard.
  assert.ok(FILES.length > 200, `expected to scan the codebase, found ${FILES.length} files`);
  assert.ok(FILES.some((f) => rel(f) === "api/ubo-discovery.js"));
  assert.ok(FILES.some((f) => rel(f) === "src/admin/components/AdminHeader.jsx"));
});

test("no company name is used as a default or a fallback", () => {
  // `|| "nium"`, `?? "nium"`, `= "nium"` as a parameter default, and the same
  // with any capitalisation.
  const pattern = /(\|\||\?\?|=)\s*["'`]nium["'`]/i;
  const offenders = [];

  for (const file of FILES) {
    const name = rel(file);
    if (VENDOR_FILES.has(name) || ALLOWED_NAMED.has(name) || SKIP_FILES.has(name)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      // A line that only talks about the rule is not the rule being broken.
      if (/^\s*(\/\/|\*|<!--)/.test(line)) continue;
      if (pattern.test(line)) offenders.push(`${name}:${index + 1}  ${line.trim().slice(0, 120)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A workspace that nobody named must be refused, not filed under a company that happens to be in the code:\n" + offenders.join("\n")
  );
});

test("no company name is printed on a screen", () => {
  // Text a person reads. There used to be an exemption here for colour tokens
  // named after the company - they were invisible, but they were also a rename
  // away from gone, so they went instead of earning an exception.
  const offenders = [];

  for (const file of FILES) {
    const name = rel(file);
    if (VENDOR_FILES.has(name) || ALLOWED_NAMED.has(name) || SKIP_FILES.has(name)) continue;
    if (!/\.(jsx|html)$/.test(name) && !name.startsWith("src/")) continue;

    const source = fs.readFileSync(file, "utf8");
    for (const [index, raw] of source.split("\n").entries()) {
      // Identifiers for the vendor journey and its form fields, not sentences.
      const line = raw.replace(/niumRegNumber|niumSearch|nium_api|NIUM_[A-Z_]+/g, "");
      if (/^\s*(\/\/|\*|<!--)/.test(line)) continue;
      // A path to the vendor's own route files or endpoints is a URL, not a
      // sentence: require(path.join(..., "api", "nium", "constants.js")),
      // app.get("/api/nium/public-details"). Nobody reads these.
      if (/\b(require|path\.join|app\.(get|post|put|all|use))\b/.test(line) && /\bapi\b/.test(line)) continue;
      // Inside quotes or inside JSX text - either way, something a person sees.
      if (/["'`>][^"'`<]*\bnium\b/i.test(line)) {
        offenders.push(`${name}:${index + 1}  ${line.trim().slice(0, 120)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A customer must never see another company's name in their own interface:\n" + offenders.join("\n")
  );
});
