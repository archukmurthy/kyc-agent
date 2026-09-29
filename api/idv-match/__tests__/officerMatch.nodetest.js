"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { pickBestOfficer } = require("../officerMatch");

const CANDIDATES = [
  { name: "SMITH, John", birthMonthYear: "1985-05", officerId: "o1" },
  { name: "DOE, Jane", birthMonthYear: "1990-01", officerId: "o2" },
];

test("picks the officer the document belongs to", () => {
  const r = pickBestOfficer({ candidates: CANDIDATES, identity: { first_name: "John", last_name: "Smith" } });
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.officer.officerId, "o1");
});

test("tolerates a name variance an equivalence rule explains (still matches)", () => {
  // Transliteration/phonetic variance of the surname — resolved by a rule, so a
  // plausible match, not an LOA.
  const r = pickBestOfficer({ candidates: [{ name: "SMYTHE, Jon" }], identity: { first_name: "John", last_name: "Smythe" } });
  assert.strictEqual(r.matched, true);
});

test("no plausible match -> matched:false (caller routes to LOA)", () => {
  const r = pickBestOfficer({ candidates: CANDIDATES, identity: { first_name: "Xavier", last_name: "Krusczynski" } });
  assert.strictEqual(r.matched, false);
  assert.strictEqual(r.officer, null);
});

test("empty candidate list -> matched:false", () => {
  const r = pickBestOfficer({ candidates: [], identity: { first_name: "John", last_name: "Smith" } });
  assert.strictEqual(r.matched, false);
});

test("skips unparseable candidate names without throwing", () => {
  const r = pickBestOfficer({ candidates: [{ name: "" }, { name: "SMITH, John" }], identity: { first_name: "John", last_name: "Smith" } });
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.officer.name, "SMITH, John");
});
