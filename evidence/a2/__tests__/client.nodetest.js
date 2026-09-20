"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CompaniesHouseClient } = require("../companiesHouseClient");

function response(data, status = 200) {
  const bytes = Buffer.from(JSON.stringify(data));
  return { ok: status >= 200 && status < 300, status, headers: { get: () => "application/json" }, arrayBuffer: async () => bytes };
}

test("client paginates using returned totals and preserves exact page bytes", async () => {
  const calls = [];
  const client = new CompaniesHouseClient({ apiKey: "test-only", fetchImpl: async (url) => {
    calls.push(url);
    return calls.length === 1 ? response({ items: [{ name: "one" }], total_results: 2 }) : response({ items: [{ name: "two" }], total_results: 2 });
  } });
  const pages = await client.officers("12345678");
  assert.equal(pages.length, 2);
  assert.match(calls[1], /start_index=1/);
  assert.equal(pages[0].bytes.toString(), JSON.stringify({ items: [{ name: "one" }], total_results: 2 }));
});
