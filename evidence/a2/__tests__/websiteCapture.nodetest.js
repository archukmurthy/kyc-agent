"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { captureCompaniesHouseWebsite } = require("../websiteCapture");

function fakePlaywright(pageData, { screenshotFailureAt = null } = {}) {
  let current;
  const page = {
    async goto(url) { current = url; return { status: () => 200 }; },
    async waitForLoadState() {},
    async content() { return `<html><body>${pageData[current].body}</body></html>`; },
    async screenshot() {
      if (current === screenshotFailureAt) throw new Error("fixture screenshot failed");
      return Buffer.from(`png:${current}`);
    },
    url() { return current; },
    locator() {
      return { first() { return this; }, async count() { return pageData[current].next ? 1 : 0; }, async getAttribute() { return pageData[current].next; } };
    },
    getByRole() { return { first() { return this; }, async count() { return 0; }, async getAttribute() { return null; } }; },
  };
  return { chromium: { async launch() { return { async newPage() { return page; }, async close() {} }; } } };
}

test("Officers capture follows explicit website pagination in order", async () => {
  const base = "https://find-and-update.company-information.service.gov.uk/company/12345678/officers";
  const playwrightImpl = fakePlaywright({
    [base]: { body: "officers page 1", next: "?page=2" },
    [`${base}?page=2`]: { body: "officers page 2", next: "?page=3" },
    [`${base}?page=3`]: { body: "officers page 3", next: null },
  });
  const result = await captureCompaniesHouseWebsite("12345678", "officers_website", { playwrightImpl });
  assert.equal(result.paginationComplete, true);
  assert.deepEqual(result.pages.map((page) => page.pageNumber), [1, 2, 3]);
  assert.deepEqual(result.pages.map((page) => page.url), [base, `${base}?page=2`, `${base}?page=3`]);
  assert.ok(result.pages.every((page) => page.html && page.screenshot));
});

test("PSC capture follows pagination and retains HTML when a screenshot fails", async () => {
  const base = "https://find-and-update.company-information.service.gov.uk/company/12345678/persons-with-significant-control";
  const second = `${base}?page=2`;
  const playwrightImpl = fakePlaywright({
    [base]: { body: "PSC statement page", next: "?page=2" },
    [second]: { body: "PSC exemption page", next: null },
  }, { screenshotFailureAt: second });
  const result = await captureCompaniesHouseWebsite("12345678", "psc_website", { playwrightImpl });
  assert.equal(result.paginationComplete, true);
  assert.equal(result.pages.length, 2);
  assert.ok(result.pages[1].html);
  assert.equal(result.pages[1].screenshot, null);
  assert.equal(result.pages[1].screenshotError, "fixture screenshot failed");
});
