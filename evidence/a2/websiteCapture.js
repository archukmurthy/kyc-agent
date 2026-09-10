"use strict";

const fs = require("node:fs");

function browserAvailable(playwrightImpl) {
  try {
    const playwright = playwrightImpl || require("playwright");
    return fs.existsSync(playwright.chromium.executablePath());
  } catch (_) { return false; }
}

const PATHS = Object.freeze({
  overview_website: "",
  officers_website: "/officers",
  psc_website: "/persons-with-significant-control",
});

async function nextPageUrl(page) {
  for (const selector of ['a[rel="next"]', ".govuk-pagination__next a"]) {
    const link = page.locator(selector).first();
    if (await link.count()) return link.getAttribute("href");
  }
  const labelled = page.getByRole("link", { name: /next page/i }).first();
  return await labelled.count() ? labelled.getAttribute("href") : null;
}

async function captureCompaniesHouseWebsite(companyNumber, area = "overview_website", { playwrightImpl } = {}) {
  if (!Object.hasOwn(PATHS, area)) throw new Error(`Unsupported Companies House website area ${area}`);
  const playwright = playwrightImpl || require("playwright");
  const url = `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}${PATHS[area]}`;
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pages = [];
    const visited = new Set();
    let nextUrl = url;
    let failureReason = null;
    while (nextUrl) {
      if (visited.has(nextUrl)) { failureReason = `Website pagination repeated ${nextUrl}`; break; }
      visited.add(nextUrl);
      let response;
      try {
        response = await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
        const capturedUrl = page.url() || nextUrl;
        const html = Buffer.from(await page.content(), "utf8");
        if (/(g-recaptcha|hcaptcha|cf-turnstile|challenges\.cloudflare\.com)/i.test(html.toString("utf8"))) throw new Error("CAPTCHA prevented website capture");
        let screenshot = null;
        let screenshotError = null;
        try { screenshot = Buffer.from(await page.screenshot({ fullPage: true, type: "png" })); }
        catch (error) { screenshotError = error.message; }
        pages.push({ pageNumber: pages.length + 1, url: capturedUrl, status: response?.status?.() || null, capturedAt: new Date().toISOString(), html, screenshot, screenshotError });
        const href = await nextPageUrl(page);
        nextUrl = href ? new URL(href, capturedUrl).toString() : null;
      } catch (error) { failureReason = error.message; break; }
    }
    if (!pages.length && failureReason) throw new Error(failureReason);
    return { area, url, pages, paginationComplete: !failureReason, failureReason };
  } finally { if (browser) await browser.close(); }
}

async function captureCompanyOverview(companyNumber, options) {
  return captureCompaniesHouseWebsite(companyNumber, "overview_website", options);
}

module.exports = { captureCompaniesHouseWebsite, captureCompanyOverview, browserAvailable, PATHS };
