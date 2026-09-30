"use strict";

// The UBO screens against the gates in front of them.
//
// Four routes were broken or about to break and nothing noticed, because every
// test in front of them mocks the network. The screen tests assert what the
// screen does with an answer; the route tests assert what the route does with a
// request. Nobody checked that the request the screen actually sends is one the
// route actually accepts.
//
//   /api/ubo-control-lab   demanded an admin password. The demo sends none, so
//                          live research had been answering 400 since Batch 0
//                          locked it on the reasoning that it had no caller -
//                          true that day; the demo was merged in five days later.
//
//   the other three        call requireStaff, which is inert while
//                          CLERK_SECRET_KEY is unset. No screen sent a token, so
//                          the day the trial turns Clerk on they answer 401.
//
// So this reads the screens' own source for the call they make, and checks it
// against the gate in the route. It is deliberately source-reading rather than
// clever: the thing that failed was a mismatch nobody could see from either
// side alone.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Each UBO route, and the screen file that calls it. */
const CALLS = [
  { route: "api/ubo-control-lab.js", caller: "src/uboDemo/demoResearch.js", url: "/api/ubo-control-lab" },
  { route: "api/ubo-demo-customer-ownership-chart.js", caller: "src/uboDemo/customer/CustomerOwnershipChartPage.jsx", url: "/api/ubo-demo-customer-ownership-chart" },
  { route: "api/ubo-demo-entity-resolution.js", caller: "src/uboDemo/customer/ChartResearchComparison.jsx", url: "/api/ubo-demo-entity-resolution" },
  { route: "api/ubo-poc-case.js", caller: "src/uboDemo/pocCaseClient.js", url: "/api/ubo-poc-case" },
  { route: "api/ubo-invite.js", caller: "src/trials/trialApi.js", url: "/api/ubo-invite" },
  { route: "api/ubo-people.js", caller: "src/people/peopleApi.js", url: "/api/ubo-people" },
];

test("each UBO route still has the caller this test claims", () => {
  // A mapping that has gone stale tests nothing at all.
  for (const { caller, url } of CALLS) {
    assert.ok(read(caller).includes(url), `${caller} no longer calls ${url} - fix this mapping`);
  }
});

test("a screen calling a staff-gated route sends the session token", () => {
  // Inert today because CLERK_SECRET_KEY is unset. The whole point of the trial
  // is to set it, and that is the moment these would have started refusing.
  const missing = [];
  for (const { route, caller } of CALLS) {
    if (!/requireStaff|requireUboCaller/.test(read(route))) continue;
    if (!/clerkAuthHeaders/.test(read(caller))) missing.push(`${caller} -> ${route}`);
  }
  assert.deepEqual(
    missing,
    [],
    "these screens call a route that checks a Clerk session and send no token, so they 401 the day Clerk is switched on:\n" + missing.join("\n")
  );
});

test("no UBO screen is asked for an admin password", () => {
  // requireAdmin needs a tenant in the query string and a shared admin password
  // in the header. No customer-facing screen has either, and none should: these
  // are reached by signed-in trial users.
  const wrongGate = CALLS
    .filter(({ route }) => /requireAdmin/.test(read(route)))
    .map(({ route, caller }) => `${route} (called by ${caller})`);

  assert.deepEqual(
    wrongGate,
    [],
    "a screen cannot supply an admin password - these routes want requireStaff:\n" + wrongGate.join("\n")
  );
});

test("every route a UBO screen calls is rate-limited", () => {
  // All of them either reach a provider or write. The demo's own route reached
  // Anthropic through START_LIVE with no limiter at all, which meant the trial
  // budget and the daily ceiling did not apply to the path prospects use.
  const unlimited = CALLS
    .filter(({ route }) => !/enforceRateLimit/.test(read(route)))
    .map(({ route }) => route);
  assert.deepEqual(unlimited, [], "a UBO screen's route with no limiter:\n" + unlimited.join("\n"));
});

test("the demo's live research passes the same paid allowance as the direct route, once", () => {
  // Two routes onto one provider. Every live lab path reaches the provider
  // through a nested call to /api/ubo-discovery, which charges the paid
  // allowance - per-person limit, trial budget and end date, spend ceiling,
  // the demo's total. That only works if the caller's identity goes with the
  // call; without it the nested route sees nobody. And the lab must not charge
  // the bucket itself as well, or one run counts twice (UBO-15).
  const lab = read("api/ubo-control-lab.js");
  const calls = lab.split("\n").filter((line) => line.includes("invokeLegacyDiscovery("));
  assert.ok(calls.length >= 3, "expected the definition and at least two nested calls");
  assert.deepStrictEqual(calls.filter((line) => !line.includes("callerHeaders")), [], "a nested discovery call without the caller's identity");
  assert.doesNotMatch(lab, /enforceRateLimit\(req, res, "ubo-discovery"\)/, "the lab charges the discovery bucket itself - one run would count twice");
});

test("every owner-only or role-gated UBO action names its roles", () => {
  // The refusal above only fires when a route ASKS for a role. A route that
  // checks the role itself, after calling requireStaff with none, would be
  // waved through on an unconfigured deployment exactly as before.
  const fs2 = require("node:fs");
  const path2 = require("node:path");
  const src = fs2.readFileSync(path2.join(ROOT, "api/ubo-invite.js"), "utf8");
  assert.match(src, /requireStaff\([^)]*\{[^}]*roles:\s*\[/s, "owner actions must be declared to requireStaff, not checked afterwards");

  const people = fs2.readFileSync(path2.join(ROOT, "api/ubo-people.js"), "utf8");
  assert.match(people, /requireStaff\([^)]*\{[^}]*roles:\s*\[/s);
});

test("a route that demands a tenant actually reads one", () => {
  // The sibling of the role rule. `requireTenant: true` cannot be enforced when
  // the login is switched off - requireStaff returns before it is checked - so
  // a route that asks for a tenant and then never reads it is making a promise
  // a reader believes and the code does not keep. Three UBO routes did exactly
  // that until 2026-09-24. The one that genuinely needs a workspace
  // (ubo-discovery) reads it, and handles the switched-off case itself.
  const fs2 = require("node:fs");
  const path2 = require("node:path");

  const apiDir = path2.join(ROOT, "api");
  const offenders = [];
  for (const name of fs2.readdirSync(apiDir)) {
    if (!name.endsWith(".js")) continue;
    const src = fs2.readFileSync(path2.join(apiDir, name), "utf8");
    if (!/requireTenant:\s*true/.test(src)) continue;
    // It must go on to read the tenant off the actor it was given.
    // uboCallerTenant(actor) is that read, in the one place that decides it.
    if (!/actor\.tenantId|\.tenantId\b|uboCallerTenant\(actor\)/.test(src)) offenders.push(name);
  }

  assert.deepEqual(
    offenders,
    [],
    "these demand a workspace and never read it - drop the flag or use it:\n" + offenders.join("\n")
  );
});

test("every UBO screen file that calls a staff-gated route sends the session token", () => {
  // The table above names one caller per route, and a route can have several:
  // the questions screen posted evidence uploads and recalculations to the
  // chart route with no token, and nothing here looked at it. So this reads
  // every file under src/uboDemo instead of a list.
  const staffRoutes = CALLS.filter(({ route }) => /requireStaff|requireUboCaller/.test(read(route))).map(({ url }) => url);
  const dir = path.join(ROOT, "src", "uboDemo");
  const files = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) files.push(full);
    }
  })(dir);
  const missing = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // A call, not a mention: the engines name routes as data without fetching.
    const calls = staffRoutes.filter((url) => new RegExp(`(fetch|fetchImpl)\\(\\s*["\`]${url.replace(/[/-]/g, "\\$&")}`).test(src));
    if (calls.length && !/clerkAuthHeaders/.test(src)) missing.push(`${path.relative(ROOT, file)} -> ${calls.join(", ")}`);
  }
  assert.deepEqual(missing, [], "these screens call a signed-in route without the session token");
});
