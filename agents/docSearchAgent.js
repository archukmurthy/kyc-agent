/**
 * docSearchAgent.js
 * Sub-agent called by the main KYC agent to retrieve compliance documents.
 *
 * Document retrieval logic:
 *   public_fi   → Wolfsberg Questionnaire + Annual Report
 *   fi_only     → Wolfsberg Questionnaire only
 *   public_only → Annual Report only
 *   corporate   → Annual Report (best effort)
 *
 * Usage (called from main KYC agent):
 *   const result = await docSearchAgent({
 *     companyName: "HSBC Holdings plc",
 *     country: "United Kingdom",
 *     ownershipType: "public_fi",
 *     niumEntityType: "fi"
 *   });
 */

const Anthropic = require("@anthropic-ai/sdk");
const https = require("https");
const fs = require("fs");
const path = require("path");

const client = new Anthropic();

// ─── Pricing constants (Sonnet 4.6, per million tokens) ──────────────────────
// claude-sonnet-4-20250514 was retired by Anthropic (API returns 404
// not_found_error). claude-sonnet-4-6 is the drop-in replacement at the
// same per-token rates.
const PRICING = {
  model: "claude-sonnet-4-6",
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
};

// ─── Cost tracker ─────────────────────────────────────────────────────────────

class CostTracker {
  constructor() {
    this.calls = [];
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }

  record(label, usage) {
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const inputCost = (inputTokens / 1_000_000) * PRICING.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * PRICING.outputPerMillion;
    const totalCost = inputCost + outputCost;
    this.calls.push({
      label,
      inputTokens,
      outputTokens,
      inputCostUSD: inputCost,
      outputCostUSD: outputCost,
      totalCostUSD: totalCost,
      model: PRICING.model,
      timestamp: new Date().toISOString(),
    });
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
  }

  summary() {
    const totalInputCost =
      (this.totalInputTokens / 1_000_000) * PRICING.inputPerMillion;
    const totalOutputCost =
      (this.totalOutputTokens / 1_000_000) * PRICING.outputPerMillion;
    return {
      model: PRICING.model,
      calls: this.calls,
      totals: {
        inputTokens: this.totalInputTokens,
        outputTokens: this.totalOutputTokens,
        totalTokens: this.totalInputTokens + this.totalOutputTokens,
        inputCostUSD: totalInputCost,
        outputCostUSD: totalOutputCost,
        totalCostUSD: totalInputCost + totalOutputCost,
      },
    };
  }

  log() {
    const s = this.summary();
    console.log("\n[CostTracker] ─────────────────────────────────");
    console.log(`[CostTracker] Model: ${s.model}`);
    this.calls.forEach((c) => {
      console.log(
        `[CostTracker]   ${c.label.padEnd(35)} ` +
        `in: ${String(c.inputTokens).padStart(5)} tok  ` +
        `out: ${String(c.outputTokens).padStart(4)} tok  ` +
        `cost: $${c.totalCostUSD.toFixed(5)}`
      );
    });
    console.log("[CostTracker] ─────────────────────────────────");
    console.log(
      `[CostTracker] TOTAL  in: ${s.totals.inputTokens} tok | ` +
      `out: ${s.totals.outputTokens} tok | ` +
      `cost: $${s.totals.totalCostUSD.toFixed(5)}`
    );
    console.log("[CostTracker] ─────────────────────────────────\n");
  }
}

// ─── Document type definitions ────────────────────────────────────────────────

const DOC_TYPES = {
  wolfsberg_questionnaire: {
    label: "Wolfsberg Questionnaire",
    searchSources: [
      "company official website compliance page",
      "company AML financial crime page",
      "Wolfsberg Group member directory",
      "FCA register regulatory filings",
      "SEC EDGAR equivalent regulatory database",
    ],
    queries: (company, country) => [
      `"${company}" Wolfsberg questionnaire PDF ${new Date().getFullYear()}`,
      `"${company}" AML questionnaire correspondent banking PDF`,
      `site:wolfsberg-group.com "${company}"`,
      `"${company}" ${country} financial crime compliance questionnaire filetype:pdf`,
    ],
    filenameTemplate: (slug, year) =>
      `${slug}_Wolfsberg_Questionnaire_${year}.pdf`,
    preferredYear: () => new Date().getFullYear(),
  },
  annual_report: {
    label: "Annual Report",
    searchSources: [
      "company investor relations page",
      "stock exchange filings LSE NYSE SGX",
      "SEC EDGAR annual report",
      "FCA Companies House filing",
      "company official website",
    ],
    queries: (company, country) => [
      `"${company}" annual report ${new Date().getFullYear() - 1} PDF`,
      `"${company}" annual report filetype:pdf investor relations`,
      `"${company}" ${country} annual report regulatory filing`,
      `site:sec.gov "${company}" annual report`,
    ],
    filenameTemplate: (slug, year) =>
      `${slug}_Annual_Report_${year}.pdf`,
    preferredYear: () => new Date().getFullYear() - 1,
  },
};

// ─── Resolve which documents to fetch ────────────────────────────────────────

function resolveDocTypes(ownershipType, niumEntityType) {
  const isFI =
    niumEntityType === "fi" ||
    ownershipType === "fi_only" ||
    ownershipType === "public_fi";

  const isPublic =
    ownershipType === "public_only" || ownershipType === "public_fi";

  const isCorporate = ownershipType === "corporate" || (!isFI && !isPublic);

  const docs = [];
  if (isFI) docs.push("wolfsberg_questionnaire");
  if (isPublic || isCorporate) docs.push("annual_report");

  return docs;
}

// ─── Slug helper ──────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.]/g, "");
}

// ─── Download helper ──────────────────────────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode === 200) {
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve({ success: true, path: destPath });
          });
        } else {
          file.close();
          fs.unlink(destPath, () => {});
          resolve({
            success: false,
            statusCode: res.statusCode,
            reason: `HTTP ${res.statusCode}`,
          });
        }
      })
      .on("error", (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        resolve({
          success: false,
          statusCode: null,
          reason: err.message,
        });
      });
  });
}

// ─── AI-powered document search ───────────────────────────────────────────────

async function searchDocumentWithAI(
  docType, companyName, country, slug, outputDir, costTracker
) {
  const def = DOC_TYPES[docType];
  const year = def.preferredYear();
  const filename = def.filenameTemplate(slug, year);
  const queries = def.queries(companyName, country);
  const sources = def.searchSources;

  const systemPrompt = `You are a compliance document retrieval specialist.
Your job is to find and return a direct PDF download URL for the requested
document. You MUST use the web_search tool to search for it.

Return a JSON object (no markdown fences) with this exact shape:
{
  "found": true | false,
  "url": "https://... direct PDF link or null",
  "year": 2025,
  "sourceLabel": "Company compliance page",
  "confidence": "high" | "medium" | "low",
  "notes": "any relevant notes",
  "searchAttempts": ["query1 tried", "query2 tried"]
}

Only return a URL you have actually verified via web search.
Do not guess or hallucinate URLs.`;

  const userPrompt =
    `Find the most recent ${def.label} for: ${companyName} (${country})

Search queries to try:
${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Return the most recent version as a direct PDF link if possible.`;

  try {
    const response = await client.messages.create({
      model: PRICING.model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    costTracker.record(
      `search:${docType} (${companyName})`, response.usage
    );

    const textContent = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed;
    try {
      const clean = textContent.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return {
        type: docType,
        label: def.label,
        filename,
        year,
        status: "not_found",
        sourceUrl: null,
        notes: "AI response parse error",
        searchAttempts: sources,
        cost: costTracker.calls.at(-1),
      };
    }

    let downloadStatus = "url_found";
    let localPath = null;
    let dl = null;

    if (parsed.found && parsed.url) {
      const destPath = path.join(outputDir, filename);
      dl = await downloadFile(parsed.url, destPath);
      if (dl.success) {
        downloadStatus = "downloaded";
        localPath = dl.path;
      } else {
        // Download attempted but failed (404, 403, redirect, network).
        // The URL itself WAS found and verified via search — so this is
        // url_found, not an error. The failure reason goes in notes.
        downloadStatus = "url_found";
      }
    } else {
      downloadStatus = "not_found";
    }

    return {
      type: docType,
      label: def.label,
      filename: parsed.found ? filename : null,
      year: parsed.year || year,
      status: downloadStatus,
      sourceUrl: parsed.url || null,
      sourceLabel: parsed.sourceLabel || null,
      confidence: parsed.confidence || null,
      notes: dl && dl.reason
        ? `URL found. Download failed: ${dl.reason}`
        : parsed.notes || null,
      localPath,
      searchAttempts: parsed.searchAttempts || sources,
      cost: costTracker.calls.at(-1),
    };
  } catch (err) {
    return {
      type: docType,
      label: def.label,
      filename: null,
      year,
      status: "error",
      sourceUrl: null,
      notes: err.message,
      searchAttempts: sources,
      cost: null,
    };
  }
}

// ─── Build summary table ───────────────────────────────────────────────────────

// Human-readable status for the customer-facing summary table.
function formatStatus(status) {
  switch (status) {
    case "downloaded":
      return "✅ Downloaded";
    case "url_found":
      return "🔗 URL found (not downloaded)";
    case "not_found":
      return "❌ Not found";
    case "download_failed":
      return "⚠ Download failed";
    case "error":
      return "⚠ Error";
    default:
      return status || "—";
  }
}

// NOTE: this table is customer-facing (rendered in Step 2 of the KYC flow).
// Token and cost data deliberately stay OUT of it — they live only on the
// per-document cost object (r.cost) and the overall cost summary, which are
// for database storage and internal use.
function buildSummaryTable(companyName, results) {
  const rows = results.map((r) => ({
    "Company Name": companyName,
    "Document Type": r.label,
    "Year": r.year || "—",
    "Source": r.sourceLabel || "—",
    "Source URL": r.sourceUrl || r.url || r.documentUrl || "Not found",
    "Status": formatStatus(r.status),
    "File": r.filename || "—",
    "Notes": r.notes || "",
  }));

  const found = results.filter(
    (r) => r.status === "downloaded" || r.status === "url_found"
  ).length;

  return {
    rows,
    summary: {
      found,
      notFound: results.length - found,
      total: results.length,
    },
  };
}

// ─── Main agent entry point ────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string} params.companyName    - Full legal name
 * @param {string} params.country        - Country of registration
 * @param {string} params.ownershipType  - "public_fi"|"fi_only"|"public_only"|"corporate"
 * @param {string} params.niumEntityType - "fi"|"corporate"|"platform"|"direct"
 * @param {string} [params.outputDir]    - Download directory (default: "./downloads")
 * @returns {Promise<Object>}
 */
async function docSearchAgent(params) {
  const {
    companyName,
    country,
    ownershipType,
    niumEntityType,
    outputDir = "./downloads",
  } = params;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const slug = slugify(companyName);
  const docTypes = resolveDocTypes(ownershipType, niumEntityType);
  const costTracker = new CostTracker();

  console.log(
    `[DocSearchAgent] Starting for: ${companyName} (${country})`
  );
  console.log(
    `[DocSearchAgent] Entity: ${niumEntityType} | ` +
    `Ownership: ${ownershipType}`
  );
  console.log(`[DocSearchAgent] Documents: ${docTypes.join(", ")}`);

  const results = await Promise.all(
    docTypes.map((docType) =>
      searchDocumentWithAI(
        docType, companyName, country, slug, outputDir, costTracker
      )
    )
  );

  const { rows, summary } = buildSummaryTable(companyName, results);
  const costSummary = costTracker.summary();

  costTracker.log();

  console.log(
    `[DocSearchAgent] Complete. Found: ${summary.found}/${summary.total}`
  );
  console.log(
    `[DocSearchAgent] Total cost: ` +
    `$${costSummary.totals.totalCostUSD.toFixed(5)} ` +
    `(${costSummary.totals.totalTokens} tokens)`
  );

  return {
    companyName,
    country,
    ownershipType,
    niumEntityType,
    documents: results,
    summaryTable: rows,
    summary,
    cost: costSummary,
    searchedAt: new Date().toISOString(),
    outputDir,
  };
}

module.exports = {
  docSearchAgent,
  resolveDocTypes,
  slugify,
  CostTracker,
  PRICING,
};
