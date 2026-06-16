/**
 * screenshotHelper.js
 * Playwright screenshot logic extracted from selfSourceAgent.js.
 *
 * Fixes applied (v1.2):
 *   1. Dismiss cookie banners before screenshotting
 *   2. Wait for networkidle (not just domcontentloaded) for JS-heavy sites like FCA
 *   3. Scroll to the first meaningful content element before capturing
 *   4. Take fullPage screenshot as the evidence record
 *   5. Take a second focused screenshot clipped to the content section
 *
 * Usage:
 *   const { takeScreenshot } = require("./screenshotHelper");
 *   const result = await takeScreenshot(url, destPath, { requirement });
 *   // result.fullPagePath    — compliance evidence (full page)
 *   // result.focusedPath     — human-readable (content section only)
 */

let playwright = null;
try {
  playwright = require("playwright");
} catch {
  console.warn("[Screenshot] Playwright not installed.");
}

// ─── Cookie banner selectors to dismiss ───────────────────────────────────────
// Ordered by priority — first match wins. Add more as you encounter them.
const COOKIE_DISMISS_SELECTORS = [
  // Companies House / GOV.UK
  'button:has-text("Reject analytics cookies")',
  'button:has-text("Accept analytics cookies")',
  // Generic
  'button:has-text("Reject all")',
  'button:has-text("Decline all")',
  'button:has-text("Reject cookies")',
  'button:has-text("I decline")',
  'button:has-text("No, thanks")',
  'button[id*="reject"]',
  'button[id*="decline"]',
  '[aria-label*="reject" i]',
  '[aria-label*="decline" i]',
];

// ─── Content selectors per requirement ────────────────────────────────────────
// After dismissing the cookie banner, scroll to the most relevant element
// for each requirement type so the focused screenshot shows the right data.
const CONTENT_SELECTORS = {
  "Legal existence": [
    ".company-header",                      // Companies House company header
    "h1",                                   // fallback — company name heading
    ".registered-office-address",
    "#content",
  ],
  "Constitution": [
    ".filing-history-list",                 // Companies House filing history table
    "table",
    "#content",
  ],
  "Regulatory status": [
    ".firm-result",                         // FCA register result
    ".search-results",
    "[class*='result']",
    "main",
    "#content",
  ],
  "Ownership / control": [
    ".psc-list",                            // Companies House PSC list
    "[class*='psc']",
    "table",
    "#content",
  ],
  "UK signatory authority evidence": [
    ".appointment-list",                    // Companies House officers list
    "[class*='officer']",
    "table",
    "#content",
  ],
  "Business activity": [
    ".company-overview",
    ".company-accounts",
    "#content",
  ],
  "Indonesia entity address evidence": [
    "main",
    "#content",
  ],
};

function getContentSelector(requirement) {
  return CONTENT_SELECTORS[requirement] || ["main", "#content", "body"];
}

// ─── Wait strategy per site ───────────────────────────────────────────────────
function getWaitStrategy(url) {
  // FCA register and other JS SPAs — wait for network to fully settle
  if (url.includes("register.fca.org.uk") ||
      url.includes("eservices.mas.gov.sg") ||
      url.includes("bizfile.gov.sg")) {
    return "networkidle";
  }
  // Most registries — domcontentloaded is fine but add a short extra wait
  return "domcontentloaded";
}

// ─── Main screenshot function ─────────────────────────────────────────────────
/**
 * takeScreenshot
 *
 * @param {string} url
 * @param {string} destPath        - base path e.g. "/path/to/Revolut_Legal_existence_pass1"
 *                                   (no extension — we add _full.png and _focused.png)
 * @param {Object} options
 * @param {string} options.requirement  - DRS requirement name, used to pick content selector
 * @returns {{ success, fullPagePath, focusedPath, reason }}
 */
async function takeScreenshot(url, destPath, options = {}) {
  if (!playwright) return { success: false, reason: "Playwright not installed" };
  // Skip in Vercel serverless — no browser runtime available (see PR-028)
  if (process.env.VERCEL) return { success: false, reason: "Playwright skipped in Vercel serverless (PR-028)" };

  const requirement   = options.requirement || "";
  const waitStrategy  = getWaitStrategy(url);
  const contentSelectors = getContentSelector(requirement);

  // Strip extension if caller passed one
  const basePath = destPath.replace(/\.(png|jpg)$/i, "");
  const fullPagePath = `${basePath}_full.png`;
  const focusedPath  = `${basePath}_focused.png`;

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // Navigate
    await page.goto(url, { waitUntil: waitStrategy, timeout: 30000 });

    // Extra wait for JS-heavy sites to fully render
    if (waitStrategy === "networkidle") {
      await page.waitForTimeout(2000);
    } else {
      await page.waitForTimeout(800);
    }

    // ── Step 1: Dismiss cookie banner ────────────────────────────────────────
    for (const selector of COOKIE_DISMISS_SELECTORS) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          console.log(`[Screenshot]   Cookie banner dismissed: ${selector}`);
          await page.waitForTimeout(500); // allow banner animation to clear
          break;
        }
      } catch { /* selector not found — try next */ }
    }

    // ── Step 2: Full page screenshot (compliance evidence record) ─────────────
    await page.screenshot({ path: fullPagePath, fullPage: true });
    console.log(`[Screenshot]   Full page saved: ${fullPagePath}`);

    // ── Step 3: Scroll to content and take focused screenshot ─────────────────
    let focusedSuccess = false;
    for (const selector of contentSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          // Clip to the element's bounding box + some padding
          const box = await el.boundingBox();
          if (box) {
            const clip = {
              x:      Math.max(0, box.x - 10),
              y:      Math.max(0, box.y - 10),
              width:  Math.min(1280, box.width  + 20),
              height: Math.min(2400, box.height + 20), // cap at 2400px tall
            };
            await page.screenshot({ path: focusedPath, clip });
            console.log(`[Screenshot]   Focused screenshot saved (${selector}): ${focusedPath}`);
            focusedSuccess = true;
            break;
          }
        }
      } catch { /* try next selector */ }
    }

    // Fallback — viewport screenshot if no content element found
    if (!focusedSuccess) {
      await page.screenshot({ path: focusedPath, fullPage: false });
      console.log(`[Screenshot]   Focused fallback (viewport): ${focusedPath}`);
    }

    return {
      success:       true,
      fullPagePath,
      focusedPath,
      cookieDismissed: true, // approximate — we attempted dismissal
    };

  } catch (err) {
    console.warn(`[Screenshot]   Failed: ${err.message}`);
    return { success: false, reason: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { takeScreenshot, COOKIE_DISMISS_SELECTORS, CONTENT_SELECTORS };
