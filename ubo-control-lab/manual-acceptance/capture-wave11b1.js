"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP = process.env.W11B1_LAB_URL || "http://localhost:3000/ubo-control-lab/";
const API = process.env.W11B1_API_URL || null;
const OUTPUT = __dirname;
let delayNextApplicantSubmission = false;

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT, `wave11b1-${name}.png`), fullPage: true });
}

async function installApiBridge(page) {
  if (!API) return;
  await page.route("**/api/ubo-control-lab", async (route) => {
    const request = route.request();
    const payload = request.method() === "POST" ? JSON.parse(request.postData() || "{}") : {};
    if (delayNextApplicantSubmission && payload.operation === "SUBMIT_APPLICANT_ACTION_AND_ADVANCE") {
      delayNextApplicantSubmission = false;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const response = await fetch(API, {
      method: request.method(),
      headers: { "content-type": "application/json" },
      body: request.method() === "POST" ? request.postData() : undefined,
    });
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
}

async function boot(page) {
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /SUCCESSOR REVIEW/ }).click();
  await page.getByRole("button", { name: "Run successor review" }).click();
  await page.getByRole("tab", { name: "Applicant journey v2" }).click();
}

async function choose(page, fixtureId) {
  const currentSession = page.getByRole("button", { name: "Start new case" });
  if (await currentSession.count()) {
    page.once("dialog", (dialog) => dialog.accept());
    await currentSession.click();
  }
  const host = page.locator(".applicant-journey-host");
  await host.locator("select").selectOption(fixtureId);
  await host.getByRole("button", { name: "Start applicant journey" }).click();
  await host.getByRole("heading", { name: new RegExp(`^${fixtureId}`) }).waitFor();
}

async function openAction(page, label) {
  await page.locator(".uaj-action:not([disabled])").filter({ hasText: label }).first().click();
}

async function fillOwnership(page, ownerName) {
  await openAction(page, "ownership");
  await page.getByLabel("Legal name").fill(ownerName);
  await page.getByLabel("Exact ownership percentage").fill("12.5");
}

async function submitConfirmation(page) {
  await openAction(page, "Confirm");
  delayNextApplicantSubmission = true;
  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await page.getByText("Saving your response and refreshing the ownership review…", { exact: true }).first().waitFor();
  await screenshot(page, "03-automatic-processing");
  await page.getByText("Confirmation recorded", { exact: true }).waitFor();
}

async function makeStoredFixtureLookLikeExplicitLiveDemo(page) {
  await page.evaluate(async () => {
    const cache = window.UboLabApplicantSessions.createApplicantSessionCache(window.localStorage);
    const { record } = await cache.restoreLast();
    const live = {
      ...record.session,
      sessionId: `${record.session.sessionId}:manual-live-save-evidence`,
      sourceMode: "LIVE",
      liveSaveOptIn: false,
    };
    await cache.remove(record.sessionId);
    await cache.save(live, { liveOptIn: true });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Applicant journey v2" }).click();
  await page.getByText("LIVE LAB CASE — NOT SAVED", { exact: true }).waitFor();
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await installApiBridge(page);
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.removeItem("ubo-control-lab.applicant-sessions.v2"));
  await boot(page);

  await choose(page, "AJV2-01");
  await screenshot(page, "01-ajv2-01-initial");
  await openAction(page, "Confirm");
  await screenshot(page, "02-single-confirmation-action");
  await page.getByRole("button", { name: "Cancel" }).click();
  await submitConfirmation(page);
  await screenshot(page, "04-snapshot-b-zero-tasks");
  await screenshot(page, "05-recorded-customer-history");
  await screenshot(page, "06-internal-review-required");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Applicant journey v2" }).click();
  await page.getByText("Restored your local Lab demo session", { exact: true }).waitFor();
  await screenshot(page, "07-refresh-restored-snapshot-b");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset this demo" }).click();
  await page.getByText(/1 immutable snapshot/).waitFor();
  await screenshot(page, "08-explicit-reset-to-snapshot-a");

  await choose(page, "AJV2-04");
  await fillOwnership(page, "North Star Holdings B.V.");
  await page.getByRole("button", { name: "Submit and review" }).click();
  await page.getByText("Our review team needs to verify it.", { exact: true }).waitFor();
  await screenshot(page, "09-structured-ownership-pending-review");
  await page.getByRole("tab", { name: "Decision history" }).click();
  await page.getByText("DEMO FIXTURE — PRECONFIGURED REVIEW DECISIONS", { exact: true }).waitFor();
  await screenshot(page, "10-fixture-review-helper");
  await page.getByRole("button", { name: "Complete fixture review and refresh journey" }).click();
  await page.getByRole("tab", { name: "Applicant journey v2" }).click();
  await page.getByText(/2 immutable snapshot/).waitFor();
  await screenshot(page, "11-snapshot-b-after-fixture-review");

  await choose(page, "AJV2-05");
  await openAction(page, "evidence");
  await page.getByRole("button", { name: "Continue securely" }).click();
  await page.getByText("EVIDENCE HANDOFF READY — EXECUTION NOT CONNECTED", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Applicant journey v2" }).click();
  await screenshot(page, "12-evidence-handoff-restored");

  await choose(page, "AJV2-06");
  await openAction(page, "Ask someone else");
  await page.getByLabel("Who should help?").fill("Group company secretary");
  await page.getByLabel("Their role").fill("Company secretary");
  await page.getByLabel("What should they provide?").fill("Current direct ownership details");
  await page.getByRole("button", { name: "Create request" }).click();
  await page.getByText("Host execution is pending. No invitation was sent and the work is not complete.", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Applicant journey v2" }).click();
  await screenshot(page, "13-delegation-restored");

  await makeStoredFixtureLookLikeExplicitLiveDemo(page);
  await screenshot(page, "14-live-not-saved-by-default");
  await page.getByRole("button", { name: "Save this Lab session locally for demo/testing" }).click();
  await page.getByText("Saved only in this browser — Lab testing, not production case storage", { exact: true }).waitFor();
  await screenshot(page, "15-live-explicit-local-save");

  await choose(page, "AJV2-11");
  await fillOwnership(page, "Stale Draft Holdings Ltd");
  await screenshot(page, "16-stale-draft-protection");

  await page.setViewportSize({ width: 390, height: 844 });
  await choose(page, "AJV2-15");
  await screenshot(page, "17-mobile-390");
  const keyboardAction = page.locator(".uaj-action:not([disabled])").first();
  await keyboardAction.focus();
  await page.keyboard.press("Enter");
  await page.locator("form").first().waitFor();
  await page.getByLabel("Legal name").focus();
  await screenshot(page, "18-keyboard-flow");

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
