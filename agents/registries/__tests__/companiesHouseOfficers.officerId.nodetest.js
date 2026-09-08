const { test } = require("node:test");
const assert = require("node:assert");
const { mapOfficerToStakeholder } = require("../companiesHouseOfficers");

test("captures the Companies House officer_id from the appointments link", () => {
  const officer = {
    name: "SMITH, John",
    officer_role: "director",
    date_of_birth: { month: 5, year: 1985 },
    links: { officer: { appointments: "/officers/abc123XYZ/appointments" } },
  };
  const s = mapOfficerToStakeholder(officer, "12345678");
  assert.strictEqual(s.officer_id, "abc123XYZ");
  assert.strictEqual(s.date_of_birth, "1985-05"); // month/year only
  assert.strictEqual(s.full_name, "SMITH, John");
});

test("officer_id is null when the appointments link is absent", () => {
  const s = mapOfficerToStakeholder({ name: "NOID, Person", officer_role: "director" }, "12345678");
  assert.strictEqual(s.officer_id, null);
});
