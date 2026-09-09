"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP = process.env.W11B1_LAB_URL || "http://127.0.0.1:3212/ubo-control-lab/";
const API = process.env.W11B1_API_URL || "http://127.0.0.1:3211/api/ubo-control-lab";
const OUTPUT = __dirname;

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT, "wave11b1-" + name + ".png"), fullPage: true });
}

async function boot(page) {
  await page.route("**/api/ubo-control-lab", async (route) => {
    const request = route.request();
    const response = await fetch(API, {
      method: request.method(),
      headers: { "content-type": "application/json" },
      body: request.method() === "POST" ? request.postData() : undefined,
    });
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /SUCCESSOR REVIEW/ }).click();
  await page.getByRole("button", { name: "Run successor review" }).click();
  await page.getByRole("tab", { name: "Applicant journey v2" }).waitFor();
  await page.getByRole("tab", { name: "Applicant journey v2" }).click();
}

async function choose(page, fixtureId) {
  const reset = page.getByRole("button", { name: "Choose another fixture" });
  if (await reset.count()) await reset.click();
  const host = page.locator(".applicant-journey-host");
  await host.locator("select").selectOption(fixtureId);
  await host.getByRole("button", { name: "Start applicant journey" }).click();
  await host.getByRole("heading", { name: new RegExp("^" + fixtureId) }).waitFor();
}

async function openAction(page, label) {
  const action = page.locator(".uaj-action:not([disabled])").filter({ hasText: label }).first();
  await action.click();
}

async function submitConfirmation(page) {
  await openAction(page, "Confirm");
  await page.getByRole("button", { name: "Submit and review" }).click();
  await page.getByText("Information confirmed", { exact: true }).waitFor();
}

async function fillOwnership(page, ownerName) {
  await openAction(page, "ownership");
  await page.getByLabel("Legal name").fill(ownerName);
  await page.getByLabel("Exact ownership percentage").fill("12.5");
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await boot(page);

  await choose(page, "AJV2-01");
  await screenshot(page, "01-data-rich-confirmation");
  await submitConfirmation(page);
  await screenshot(page, "02-confirmation-r08-satisfied");

  await choose(page, "AJV2-02");
  await submitConfirmation(page);
  await screenshot(page, "03-confirmation-r08-open");

  await choose(page, "AJV2-03");
  await openAction(page, "Something changed");
  await page.locator("form[data-action-type='CORRECTION_REQUIRED'] select").first().selectOption({ index: 1 });
  await page.locator("form[data-action-type='CORRECTION_REQUIRED'] input[type='number']").fill("35");
  await page.getByLabel("When did this change?").fill("2026-09-01");
  await screenshot(page, "04-something-changed");

  await choose(page, "AJV2-04");
  await fillOwnership(page, "North Star Holdings B.V.");
  await screenshot(page, "05-structured-foreign-holdco");
  await page.getByRole("button", { name: "Submit and review" }).click();
  await page.getByText(/candidate identity\/claim target/).waitFor();
  await screenshot(page, "06-pending-explicit-decision");
  await page.getByRole("button", { name: "Apply explicit Lab decisions" }).click();
  await page.getByRole("button", { name: "Re-evaluate ownership case" }).click();
  await page.getByText(/2 immutable snapshot/).waitFor();
  await screenshot(page, "07-new-snapshot-after-decisions");

  await choose(page, "AJV2-05");
  await openAction(page, "evidence");
  await page.getByRole("button", { name: "Continue securely" }).click();
  await page.getByText(/EVIDENCE HANDOFF READY/).first().waitFor();
  await screenshot(page, "08-external-evidence-handoff");

  await choose(page, "AJV2-06");
  await openAction(page, "Ask someone else");
  await page.getByLabel("Who should help?").fill("Group company secretary");
  await page.getByLabel("Their role").fill("Company secretary");
  await page.getByLabel("What should they provide?").fill("Current direct ownership details");
  await page.getByRole("button", { name: "Create request" }).click();
  await page.getByText("Help request prepared").waitFor();
  await screenshot(page, "09-delegation-handoff");

  await choose(page, "AJV2-08");
  await screenshot(page, "10-customer-complete-internal-review");
  await choose(page, "AJV2-07");
  await screenshot(page, "11-system-resolution");
  await choose(page, "AJV2-09");
  await screenshot(page, "12-specialist-review");
  await choose(page, "AJV2-10");
  await screenshot(page, "13-policy-content-block");

  await choose(page, "AJV2-11");
  await fillOwnership(page, "Stale Draft Holdings Ltd");
  await page.getByRole("button", { name: "Submit and review" }).click();
  await page.getByRole("button", { name: "Apply explicit Lab decisions" }).click();
  await openAction(page, "ownership");
  await page.getByRole("button", { name: "Re-evaluate ownership case" }).click();
  await page.getByText("The review changed").waitFor();
  await screenshot(page, "14-stale-draft-cleared");

  await choose(page, "AJV2-13");
  await screenshot(page, "15-asda-system-profile");
  await choose(page, "AJV2-14");
  await screenshot(page, "16-asda-exhausted-profile");

  await page.setViewportSize({ width: 390, height: 844 });
  await choose(page, "AJV2-15");
  await screenshot(page, "17-mobile-390");
  const keyboardAction = page.locator(".uaj-action:not([disabled])").first();
  await keyboardAction.focus();
  await page.keyboard.press("Enter");
  await page.locator("form").first().waitFor();
  await page.getByLabel("Legal name").focus();
  await screenshot(page, "18-keyboard-accessibility");

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
