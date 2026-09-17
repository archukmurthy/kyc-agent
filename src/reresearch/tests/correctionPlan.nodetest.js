const { test } = require("node:test");
const assert = require("node:assert");
const { planCorrection, FACT_KEYS } = require("../correctionPlan");

const CURRENT = {
  companyName: "Britannia Group Limited",
  registrationNumber: "01234567",
  countryCode: "GB",
  entityType: "Corporate",
  ownershipType: "private_limited",
};

test("the five fact keys", () => {
  assert.deepStrictEqual(FACT_KEYS, ["companyName", "registrationNumber", "countryCode", "entityType", "ownershipType"]);
});

test("no corrections, or corrections equal to the current values, is 'none'", () => {
  assert.strictEqual(planCorrection(CURRENT, {}).action, "none");
  const same = planCorrection(CURRENT, { companyName: "  Britannia Group Limited ", countryCode: "gb" });
  assert.strictEqual(same.action, "none");
  assert.deepStrictEqual(same.changed, []);
});

test("entity type alone re-derives", () => {
  const plan = planCorrection(CURRENT, { entityType: "FI" });
  assert.strictEqual(plan.action, "re_derive");
  assert.deepStrictEqual(plan.changed, ["entityType"]);
  assert.strictEqual(plan.next.entityType, "FI");
  assert.strictEqual(plan.next.companyName, "Britannia Group Limited");
});

test("each other fact alone re-searches", () => {
  for (const [key, value] of [
    ["companyName", "Britannia Holdings Limited"],
    ["registrationNumber", "07654321"],
    ["countryCode", "IE"],
    ["ownershipType", "public_listed"],
  ]) {
    const plan = planCorrection(CURRENT, { [key]: value });
    assert.strictEqual(plan.action, "re_search", key);
    assert.deepStrictEqual(plan.changed, [key]);
  }
});

test("entity type together with anything else re-searches", () => {
  const plan = planCorrection(CURRENT, { entityType: "FI", companyName: "Other Ltd" });
  assert.strictEqual(plan.action, "re_search");
  assert.deepStrictEqual(plan.changed, ["companyName", "entityType"]);
});

test("next carries every fact, corrected ones replaced and normalised", () => {
  const plan = planCorrection(CURRENT, { countryCode: " ie ", registrationNumber: " 999 " });
  assert.deepStrictEqual(plan.next, {
    companyName: "Britannia Group Limited",
    registrationNumber: "999",
    countryCode: "IE",
    entityType: "Corporate",
    ownershipType: "private_limited",
  });
});

test("clearing the registration number is a valid re-search", () => {
  const plan = planCorrection(CURRENT, { registrationNumber: "" });
  assert.strictEqual(plan.action, "re_search");
  assert.strictEqual(plan.next.registrationNumber, "");
});

test("emptying a required fact is invalid", () => {
  const plan = planCorrection(CURRENT, { companyName: "   ", entityType: "FI" });
  assert.strictEqual(plan.action, "invalid");
  assert.deepStrictEqual(plan.invalid, ["companyName"]);
});

test("missing current values are treated as empty strings", () => {
  const plan = planCorrection({}, { companyName: "Acme Ltd", countryCode: "GB", entityType: "Corporate" });
  assert.strictEqual(plan.action, "re_search");
  assert.strictEqual(plan.next.ownershipType, "");
});

test("unknown correction keys are ignored", () => {
  assert.strictEqual(planCorrection(CURRENT, { tenantId: "evil" }).action, "none");
});
