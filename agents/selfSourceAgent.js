/**
 * selfSourceAgent.js
 * Contract version: 1.2
 *
 * Key fix in v1.2:
 *   - Each DRS requirement now fetches a DIFFERENT page from the registry
 *     (overview / filing-history / officers / PSC / regulator register)
 *     via registryUrlBuilder.js. Previously all items hit the same search URL
 *     producing identical screenshots.
 *   - Registration number discovered on the first item (Legal existence) is
 *     carried forward so subsequent items get direct company page URLs instead
 *     of search result pages.
 *   - PR-025 second-pass logic retained.
 */

const Anthropic = require("@anthropic-ai/sdk");
const https     = require("https");
const http      = require("http");
const fs        = require("fs");
const path      = require("path");
const { takeScreenshot: _screenshotHelper } = require("./screenshotHelper");

const { buildRegistryUrl, buildSecondPassUrl: _unused, ...urlHelpers } = (() => {
  try { return require("./registryUrlBuilder"); }
  catch { return require("../agents/registryUrlBuilder"); }
})();

// Second-pass builders (PR-025) — kept inline since they need reg number input
const SECOND_PASS_BUILDERS = {
  "receita.fazenda":  (r) => `https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp?cnpj=${encodeURIComponent(r)}`,
  "cnpjreva":         (r) => `https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp?cnpj=${encodeURIComponent(r)}`,
  "touki.or.jp":      (r) => `https://www1.touki.or.jp/gateway.html?regNum=${encodeURIComponent(r)}`,
  "ahu.go.id":        (r) => `https://ahu.go.id/pencarian/profil-pt?ahu=${encodeURIComponent(r)}`,
  "gsxt.gov.cn":      (r) => `https://www.gsxt.gov.cn/corp-query-homepage-${encodeURIComponent(r)}.html`,
};

function buildSecondPassUrl(baseUrl, regNum) {
  if (!regNum) return null;
  for (const [host, builder] of Object.entries(SECOND_PASS_BUILDERS)) {
    if (baseUrl.includes(host)) return builder(regNum);
  }
  return null;
}

const PORTAL_LOGIN_ONLY = ["e-services.cr.gov.hk"];
function isPortalLoginOnly(url) {
  return PORTAL_LOGIN_ONLY.some(h => url.includes(h));
}

// Captcha / anti-bot wall detection. When a page is gated by reCAPTCHA, hCaptcha
// or Cloudflare Turnstile the document isn't reachable by automation, so we skip
// the screenshot (it would only capture the challenge, not the document) and flag
// the item for manual retrieval. Markers calibrated against saved snapshots —
// Companies House / FCA pages contain none of these, so working flows are unaffected.
const CAPTCHA_MARKERS = /(g-recaptcha|grecaptcha|recaptcha\/api|recaptcha-response|h-?captcha|hcaptcha|data-sitekey|cf-turnstile|challenges\.cloudflare\.com)/i;
function isCaptchaPage(html) {
  return !!html && CAPTCHA_MARKERS.test(html);
}

let playwright = null;
try { playwright = require("playwright"); }
catch { console.warn("[SelfSourceAgent] Playwright not installed — screenshots disabled."); }

// Bound every AI extraction call: a 30s timeout with a single retry stops a
// hung/slow Anthropic request from stalling a checklist item indefinitely.
const client = new Anthropic({ timeout: 30000, maxRetries: 1 });
const AGENT_VERSION = "1.2.0";

// claude-sonnet-4-20250514 reached end-of-life (the API returns errors / empty
// usage, so every extraction silently fell to low-confidence manual review).
// claude-sonnet-4-6 is the drop-in replacement at the same $3/$15 pricing —
// matches agents/docSearchAgent.js.
const PRICING = {
  model:            "claude-sonnet-4-6",
  inputPerMillion:  3.0,
  outputPerMillion: 15.0,
};

// ─── Cost tracker ─────────────────────────────────────────────────────────────
class CostTracker {
  constructor() { this.calls = []; this.totalInputTokens = 0; this.totalOutputTokens = 0; }
  record(label, usage) {
    const i = usage?.input_tokens ?? 0, o = usage?.output_tokens ?? 0;
    const ic = (i / 1e6) * PRICING.inputPerMillion, oc = (o / 1e6) * PRICING.outputPerMillion;
    this.calls.push({ label, inputTokens: i, outputTokens: o, inputCostUSD: ic, outputCostUSD: oc, totalCostUSD: ic + oc, model: PRICING.model, timestamp: new Date().toISOString() });
    this.totalInputTokens += i; this.totalOutputTokens += o;
  }
  summary() {
    const ic = (this.totalInputTokens / 1e6) * PRICING.inputPerMillion;
    const oc = (this.totalOutputTokens / 1e6) * PRICING.outputPerMillion;
    return { model: PRICING.model, calls: this.calls, totals: { inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens, totalTokens: this.totalInputTokens + this.totalOutputTokens, inputCostUSD: ic, outputCostUSD: oc, totalCostUSD: ic + oc } };
  }
  log() {
    const s = this.summary();
    console.log("\n[SelfSourceAgent:Cost] ─────────────────────────────────");
    console.log(`[SelfSourceAgent:Cost] Model: ${s.model}`);
    this.calls.forEach(c => console.log(`[SelfSourceAgent:Cost]   ${c.label.padEnd(45)} in:${String(c.inputTokens).padStart(5)} out:${String(c.outputTokens).padStart(4)} $${c.totalCostUSD.toFixed(5)}`));
    console.log(`[SelfSourceAgent:Cost] TOTAL in:${s.totals.inputTokens} out:${s.totals.outputTokens} $${s.totals.totalCostUSD.toFixed(5)}`);
    console.log("[SelfSourceAgent:Cost] ─────────────────────────────────\n");
  }
}

function slugify(n) { return n.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_.]/g, ""); }

// ─── HTTP fetch ───────────────────────────────────────────────────────────────
function fetchHtml(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KYBResearchAgent/1.2; compliance-research)", "Accept": "text/html,application/xhtml+xml" },
      timeout: timeoutMs,
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location)
        return fetchHtml(res.headers.location, timeoutMs).then(resolve);
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => resolve({ success: true, html: data, statusCode: res.statusCode, finalUrl: url }));
    });
    req.on("error", e => resolve({ success: false, error: e.message, html: "" }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "timeout", html: "" }); });
  });
}

// ─── Screenshot ───────────────────────────────────────────────────────────────
async function takeScreenshot(url, destPath, requirement) {
  return _screenshotHelper(url, destPath, { requirement });
}

// ─── Render + screenshot (Playwright) ─────────────────────────────────────────
// Registries like Companies House and the FCA register are client-rendered, so a
// raw HTTP GET returns a near-empty JS shell (the extractor then sees almost no
// text and reports low confidence). Render the page in Chromium and return the
// post-render HTML. Captures the screenshot in the SAME visit to avoid launching
// a second browser. Returns null when Playwright isn't available so the caller
// can fall back to a plain HTTP fetch.
async function renderPage(url, screenshotPath, timeoutMs = 25000) {
  if (!playwright) return null;
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Let client-side rendering settle; ignore the timeout if the page never
    // reaches a fully idle network (many registries keep long-poll connections).
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    const html = await page.content();
    // A captcha wall is just the challenge, not the document — don't screenshot it.
    const captcha = isCaptchaPage(html);
    let screenshot = { success: false, reason: captcha ? "captcha" : undefined };
    if (screenshotPath && !captcha) {
      try { await page.screenshot({ path: screenshotPath, fullPage: true }); screenshot = { success: true, path: screenshotPath }; }
      catch (e) { screenshot = { success: false, reason: e.message }; }
    }
    return { success: true, html, captcha, statusCode: resp ? resp.status() : null, finalUrl: page.url(), screenshot };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { if (browser) await browser.close(); }
}

// ─── PDF download ─────────────────────────────────────────────────────────────
function downloadBinary(url, destPath, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    const cleanup = () => { try { file.close(); } catch (_) {} fs.unlink(destPath, () => {}); };
    const request = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KYBResearchAgent/1.2)" }, timeout: timeoutMs }, (res) => {
      if (res.statusCode === 200) {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve({ success: true, path: destPath }); });
      } else { cleanup(); resolve({ success: false, reason: `HTTP ${res.statusCode}` }); }
    });
    request.on("error", e => { cleanup(); resolve({ success: false, reason: e.message }); });
    // Without this a server that accepts the connection but never responds would
    // leave the download (and the whole checklist item) hanging forever.
    request.on("timeout", () => { request.destroy(); cleanup(); resolve({ success: false, reason: "timeout" }); });
  });
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim().slice(0, 14000);
}

// ─── AI extraction ────────────────────────────────────────────────────────────
async function extractWithAI(pageText, companyName, requirement, analystStep, costTracker) {
  const systemPrompt = `You are a KYC compliance data extractor. Extract structured fields from registry page text.
Respond ONLY with JSON. No markdown, no preamble.
{
  "companyFound": true|false,
  "registeredName": "...",
  "registrationNumber": "...",
  "status": "Active|Dissolved|...",
  "incorporationDate": "...",
  "registeredAddress": "...",
  "directorsCount": null,
  "keyDetails": "other compliance-relevant facts",
  "matchConfidence": "high|medium|low",
  "notes": "..."
}`;

  const userPrompt = `Company: "${companyName}"
Requirement: "${requirement}"
Analyst check: "${analystStep}"

Page text:
${pageText}

Set companyFound=false if this page does not clearly relate to this company.`;

  try {
    const response = await client.messages.create({
      model: PRICING.model, max_tokens: 800, system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    costTracker.record(`extract:${requirement}`, response.usage);
    const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    return { companyFound: false, notes: `Extraction error: ${e.message}`, matchConfidence: "low" };
  }
}

// ─── Single fetch + extract + screenshot cycle ────────────────────────────────
async function fetchAndExtract(url, slug, reqSlug, passLabel, item, companyName, outputDir, costTracker) {
  const screenshotPath = path.join(outputDir, `${slug}_${reqSlug}_${passLabel}_screenshot.png`);

  // Prefer a rendered page (registries are JS-driven; a raw GET yields an empty
  // shell). Fall back to a plain HTTP fetch when Playwright is unavailable or the
  // render fails — then grab the screenshot the old way.
  let html, statusCode, finalUrl, screenshot, captcha = false;
  const rendered = await renderPage(url, screenshotPath);
  if (rendered && rendered.success) {
    ({ html, statusCode, finalUrl, screenshot, captcha } = rendered);
  } else {
    const httpResult = await fetchHtml(url);
    if (!httpResult.success) return { success: false, error: (rendered && rendered.error) || httpResult.error };
    html = httpResult.html; statusCode = httpResult.statusCode; finalUrl = httpResult.finalUrl;
    captcha = isCaptchaPage(html);
    // Don't screenshot a captcha wall (see renderPage).
    screenshot = captcha ? { success: false, reason: "captcha" } : await takeScreenshot(url, screenshotPath);
  }

  const htmlPath = path.join(outputDir, `${slug}_${reqSlug}_${passLabel}_snapshot.html`);
  fs.writeFileSync(htmlPath, html);

  const pageText  = htmlToText(html);
  const extracted = await extractWithAI(pageText, companyName, item.requirement, item.analystStep, costTracker);

  const pdfMatches = html.match(/href=["']([^"']*\.pdf[^"']*)/gi) || [];
  const pdfUrls    = pdfMatches.map(m => m.replace(/href=["']/i,"").replace(/["']$/,"")).filter(u => u.startsWith("http")).slice(0,3);
  let pdfDownload  = null;
  if (pdfUrls.length > 0) {
    const pdfPath = path.join(outputDir, `${slug}_${reqSlug}_${passLabel}.pdf`);
    const dl = await downloadBinary(pdfUrls[0], pdfPath);
    if (dl.success) pdfDownload = { url: pdfUrls[0], localPath: pdfPath };
  }

  const files = [
    { type: "html_snapshot",  path: htmlPath, pass: passLabel },
    screenshot && screenshot.success ? { type: "screenshot_png", path: screenshotPath, pass: passLabel } : null,
    pdfDownload ? { type: "pdf_download", path: pdfDownload.localPath, sourceUrl: pdfDownload.url, pass: passLabel } : null,
  ].filter(Boolean);

  return { success: true, url, finalUrl, httpStatus: statusCode, captcha, extracted, pdfUrls, files };
}

// ─── Retrieve one checklist item ──────────────────────────────────────────────
async function retrieveChecklistItem(item, companyName, incorporationCountry, outputDir, costTracker, knownRegNumber) {
  const slug      = slugify(companyName);
  const reqSlug   = item.requirement.replace(/[^a-zA-Z0-9]/g, "_");
  const timestamp = new Date().toISOString();

  console.log(`[SelfSourceAgent] → ${item.requirement} (${item.selfSource})`);

  const baseResult = {
    requirement: item.requirement, selfSourceTier: item.selfSource,
    localEquivalent: item.localEquivalent, analystStep: item.analystStep,
    sourceUrl: item.sourceUrl, companyName, incorporationCountry,
    companyRegistrationNumber: knownRegNumber || null,
    retrievedAt: timestamp, agentVersion: AGENT_VERSION,
  };

  // Portal login — flag immediately
  if (isPortalLoginOnly(item.sourceUrl)) {
    console.log(`[SelfSourceAgent]   ⚠ Portal login required — manual retrieval flagged`);
    const meta = { ...baseResult, status: "manual_retrieval_required", manualReviewFlag: true,
      manualReviewReason: "Registry requires authenticated portal login. Analyst must retrieve manually.",
      searchUrl: item.sourceUrl, files: [] };
    const metaPath = path.join(outputDir, `${slug}_${reqSlug}_metadata.json`);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return { ...meta, metadataPath: metaPath, cost: null };
  }

  // ── Build requirement-specific URL (the key fix) ─────────────────────────
  const firstPassUrl = buildRegistryUrl(item.sourceUrl, item.requirement, companyName, knownRegNumber);
  console.log(`[SelfSourceAgent]   URL: ${firstPassUrl}`);

  const pass1 = await fetchAndExtract(firstPassUrl, slug, reqSlug, "pass1", item, companyName, outputDir, costTracker);

  if (!pass1.success) {
    const meta = { ...baseResult, status: "fetch_failed", error: pass1.error, searchUrl: firstPassUrl, files: [] };
    const metaPath = path.join(outputDir, `${slug}_${reqSlug}_metadata.json`);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return { ...meta, metadataPath: metaPath, cost: costTracker.calls.at(-1) ?? null };
  }

  // Extract registration number from first result to pass forward
  const discoveredRegNum = pass1.extracted?.registrationNumber || knownRegNumber;

  // ── PR-025: second pass if low confidence ────────────────────────────────
  let finalPass = pass1, secondPassUrl = null, secondPassRan = false;

  if (pass1.extracted.matchConfidence === "low") {
    secondPassUrl = buildSecondPassUrl(item.sourceUrl, knownRegNumber);
    if (secondPassUrl) {
      console.log(`[SelfSourceAgent]   Low confidence — pass 2: ${secondPassUrl}`);
      await new Promise(r => setTimeout(r, 800));
      const pass2 = await fetchAndExtract(secondPassUrl, slug, reqSlug, "pass2", item, companyName, outputDir, costTracker);
      secondPassRan = true;
      if (pass2.success && pass2.extracted.matchConfidence !== "low") {
        finalPass = pass2;
        console.log(`[SelfSourceAgent]   ✓ Pass 2 confidence: ${pass2.extracted.matchConfidence}`);
      } else {
        finalPass = { ...pass1, files: [...pass1.files, ...(pass2.success ? pass2.files : [])] };
        console.log(`[SelfSourceAgent]   ✗ Pass 2 still low — manual review flagged`);
      }
    }
  }

  const captchaBlocked    = !!finalPass.captcha;
  if (captchaBlocked) console.log(`[SelfSourceAgent]   🔒 Document behind captcha — screenshot skipped, manual retrieval required`);
  const needsManualReview = captchaBlocked || finalPass.extracted.matchConfidence === "low";
  const isVerified        = finalPass.extracted.companyFound && !needsManualReview;

  const meta = {
    ...baseResult,
    status:           isVerified ? "retrieved" : (captchaBlocked ? "manual_retrieval_required" : "retrieved_unverified"),
    manualReviewFlag: needsManualReview,
    captchaBlocked,
    manualReviewReason: captchaBlocked
      ? "Document is behind a captcha — automated retrieval not possible; manual retrieval required."
      : (needsManualReview
          ? (secondPassRan
              ? "Both passes returned low confidence — manual retrieval recommended."
              : (knownRegNumber
                  ? "Low confidence and no second-pass source available for this registry — manual retrieval recommended."
                  : "Low confidence and no registration number available for a second pass — manual retrieval recommended."))
          : null),
    searchUrl:     firstPassUrl,
    secondPassUrl: secondPassRan ? secondPassUrl : null,
    finalUrl:      finalPass.finalUrl,
    httpStatus:    finalPass.httpStatus,
    extracted:     finalPass.extracted,
    discoveredRegNum,    // ← carry forward to next items
    pdfCandidates: finalPass.pdfUrls,
    files:         finalPass.files,
  };

  const metaPath = path.join(outputDir, `${slug}_${reqSlug}_metadata.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`[SelfSourceAgent]   ${needsManualReview ? "⚠" : "✓"} ${meta.status} | conf:${finalPass.extracted.matchConfidence} | files:${meta.files.length}`);

  return { ...meta, metadataPath: metaPath, cost: costTracker.calls.at(-1) ?? null };
}

// ─── Per-item watchdog ────────────────────────────────────────────────────────
// A single registry item can stall indefinitely (a socket that connects but
// never responds, a Playwright launch that hangs, an AI call that never returns).
// This races each item against a hard deadline so a stuck item is SKIPPED and
// the agent finishes and returns, instead of leaving the whole request hanging.
// 60s comfortably covers a normal render + AI extract (and most second passes);
// anything beyond that is treated as stuck and flagged for manual retrieval.
const PER_ITEM_TIMEOUT_MS = 60000;

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// ─── Main entry point ─────────────────────────────────────────────────────────
async function selfSourceAgent(params) {
  const {
    companyName, incorporationCountry,
    drsChecklist              = [],
    companyRegistrationNumber = null,
    outputDir                 = "./self-sourced",
    preferredOnly             = false,
  } = params;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const costTracker = new CostTracker();
  const selfSourceTiers = preferredOnly
    ? ["Preferred self-source"]
    : ["Preferred self-source", "Supplementary self-source"];

  const itemsToRetrieve = drsChecklist.filter(i => selfSourceTiers.includes(i.selfSource) && i.sourceUrl);

  console.log(`\n[SelfSourceAgent] ═══════════════════════════════════════`);
  console.log(`[SelfSourceAgent] Company: ${companyName} (${incorporationCountry})`);
  console.log(`[SelfSourceAgent] RegNum:  ${companyRegistrationNumber || "not provided — will discover from first result"}`);
  console.log(`[SelfSourceAgent] Items:   ${itemsToRetrieve.length} of ${drsChecklist.length} are self-sourceable`);
  console.log(`[SelfSourceAgent] ═══════════════════════════════════════\n`);

  if (itemsToRetrieve.length === 0) {
    return { companyName, incorporationCountry, results: [], skipped: drsChecklist.length,
      summary: { retrieved: 0, unverified: 0, failed: 0, manualRequired: 0, total: 0 },
      cost: costTracker.summary(), searchedAt: new Date().toISOString() };
  }

  const results = [];
  // knownRegNum is updated after each item — Legal existence always runs first
  // so its discovered registration number flows into Constitution, Officers, etc.
  let knownRegNum = companyRegistrationNumber;

  for (const item of itemsToRetrieve) {
    let result;
    try {
      result = await withTimeout(
        retrieveChecklistItem(item, companyName, incorporationCountry, outputDir, costTracker, knownRegNum),
        PER_ITEM_TIMEOUT_MS
      );
    } catch (e) {
      // Underlying retrieval threw — treat like a failure, keep going.
      console.warn(`[SelfSourceAgent]   ✗ ${item.requirement} — error: ${e.message}`);
      result = null;
    }

    // Watchdog fired (or threw): synthesise a "skip" result so the item is
    // flagged for manual retrieval and the loop moves on instead of hanging.
    if (!result || result.__timedOut) {
      if (result && result.__timedOut) {
        console.warn(`[SelfSourceAgent]   ⏱ ${item.requirement} — exceeded ${Math.round(PER_ITEM_TIMEOUT_MS / 1000)}s, skipping`);
      }
      result = {
        requirement: item.requirement, selfSourceTier: item.selfSource,
        localEquivalent: item.localEquivalent, analystStep: item.analystStep,
        sourceUrl: item.sourceUrl, companyName, incorporationCountry,
        companyRegistrationNumber: knownRegNum || null,
        retrievedAt: new Date().toISOString(), agentVersion: AGENT_VERSION,
        status: "manual_retrieval_required", manualReviewFlag: true,
        manualReviewReason: `Automated retrieval exceeded ${Math.round(PER_ITEM_TIMEOUT_MS / 1000)}s and was skipped — manual retrieval required.`,
        extracted: { companyFound: false, matchConfidence: "low", notes: "retrieval timed out" },
        files: [], cost: null,
      };
    }

    // If this item discovered a registration number, carry it forward
    if (result.discoveredRegNum) knownRegNum = result.discoveredRegNum;
    results.push(result);
    await new Promise(r => setTimeout(r, 1200));
  }

  costTracker.log();

  const retrieved      = results.filter(r => r.status === "retrieved").length;
  const unverified     = results.filter(r => r.status === "retrieved_unverified").length;
  const failed         = results.filter(r => r.status === "fetch_failed").length;
  const manualRequired = results.filter(r => r.manualReviewFlag || r.status === "manual_retrieval_required").length;

  console.log(`[SelfSourceAgent] Done. verified:${retrieved} unverified:${unverified} failed:${failed} manual:${manualRequired}`);
  console.log(`[SelfSourceAgent] Cost: $${costTracker.summary().totals.totalCostUSD.toFixed(5)}\n`);

  return {
    companyName, incorporationCountry, companyRegistrationNumber: knownRegNum,
    results, skipped: drsChecklist.length - itemsToRetrieve.length,
    summary: { retrieved, unverified, failed, manualRequired, total: results.length },
    cost: costTracker.summary(), searchedAt: new Date().toISOString(), outputDir,
  };
}

module.exports = { selfSourceAgent, CostTracker, PRICING, AGENT_VERSION };
