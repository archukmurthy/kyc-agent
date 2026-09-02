// Read-only benchmark endpoint.
//
// Runs the existing KYC onboarding research pipeline ONCE per company and
// returns a structured, scoreable result (coverage, source tiers, public-
// company classification, document requirements, and per-request token totals).
//
// It is read-only with respect to our own data — it never writes config or
// state. It DOES make outbound Anthropic calls (web research), so it costs
// tokens; those are captured per call and totalled in the response.
//
// Reuses the SAME logic the live customer flow runs: src/pipeline.js
// (single source of truth, also imported by src/App.js) and the root
// documentRequirements.js engine. Tenant + config resolution mirror api/config.js
// so the benchmark scores exactly the tenant the customer flow would serve.
//
// POST /api/benchmark?tenant=<id>
//   body: { companies: [ { companyName, countryCode, country?, entityType,
//                          ownershipType?, sector?, incorporationCountry? } ] }
// GET  /api/benchmark?tenant=<id>&companyName=...&countryCode=GB&entityType=Corporate&ownershipType=private_limited
//   (single-company convenience form for quick testing)

const storage = require("../lib/storage");
const { buildDefaultConfig, buildBlankConfig } = require("../lib/seedConfig");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { runResearchPipeline } = require("../src/pipeline");
const { getRequirements } = require("../documentRequirements.js");
const { persistBenchmarkEntity } = require("../lib/persist");

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 16000;
const MAX_COMPANIES = 25; // batch cap — keeps a single request bounded

// Maps this app's ownership-type IDs to the DRS engine's normaliseEntityType()
// vocabulary. Kept in sync with OWNERSHIP_ID_TO_DRS in src/App.js.
const OWNERSHIP_ID_TO_DRS = {
  public_listed: "Public Listed Company",
  public_unlisted: "Private Limited",
  private_limited: "Private Limited",
  llp: "LLP",
  general_partnership: "Partnership",
  sole_trader: "Sole Trader",
  trust: "Trust",
  government: "State Owned",
  central_bank: "State Owned",
  charity: "Private Limited",
  foundation: "Private Limited",
  cooperative: "Private Limited",
  branch: "Private Limited",
  spv: "Private Limited",
  holding_company: "Private Limited",
  joint_venture: "Private Limited",
  correspondent_bank: "Public Listed Company",
  payment_institution: "Private Limited",
  investment_fund: "Private Limited",
  insurance_company: "Private Limited",
  other: "Private Limited",
};

// Common country-code → name lookup for prompt copy + DRS incorporation country.
// Falls back to a caller-supplied `country` / `incorporationCountry`, then the
// raw code, so an unlisted code still works.
const COUNTRY_NAMES = {
  GB: "United Kingdom", SG: "Singapore", US: "United States", AU: "Australia",
  CA: "Canada", IE: "Ireland", NL: "Netherlands", DE: "Germany", FR: "France",
  ES: "Spain", IT: "Italy", CH: "Switzerland", SE: "Sweden", NO: "Norway",
  DK: "Denmark", PL: "Poland", HK: "Hong Kong", JP: "Japan", IN: "India",
  MY: "Malaysia", ID: "Indonesia", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
  KR: "South Korea", CN: "China", TW: "Taiwan", AE: "United Arab Emirates",
  SA: "Saudi Arabia", ZA: "South Africa", NG: "Nigeria", KE: "Kenya", EG: "Egypt",
  BR: "Brazil", MX: "Mexico", AR: "Argentina", CL: "Chile", CO: "Colombia",
  TR: "Turkey", IL: "Israel", NZ: "New Zealand", PK: "Pakistan", BD: "Bangladesh",
  LK: "Sri Lanka", AM: "Armenia",
};

// ── Tenant config (mirrors api/config.js readConfig/seedTenant) ──────────────
function configKey(tenant) {
  return `config:${tenant}`;
}

async function seedTenant(tenant) {
  const seeded = tenant === "demo" ? buildDefaultConfig(tenant) : buildBlankConfig(tenant);
  seeded._tenantId = tenant;
  await storage.set(configKey(tenant), seeded);
  return seeded;
}

async function readConfig(tenant) {
  let stored = await storage.get(configKey(tenant));
  if (!stored) return seedTenant(tenant);
  if (tenant === "demo") {
    const hasLicences = Array.isArray(stored.licences) && stored.licences.length > 0;
    if (!hasLicences) {
      const fresh = buildDefaultConfig(tenant);
      fresh._tenantId = tenant;
      await storage.set(configKey(tenant), fresh);
      return fresh;
    }
  }
  return stored;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// ── Server-side Anthropic caller (mirrors api/research.js, returns usage) ────
async function callAnthropic({ prompt, tools }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Server API key not configured (ANTHROPIC_API_KEY)");
  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  };
  if (Array.isArray(tools) && tools.length > 0) requestBody.tools = tools;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
  });
  const data = await response.json();
  if (!response.ok) {
    const err = new Error(
      (data && data.error && data.error.message) || "Claude API error",
    );
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data; // includes .content and .usage
}

// ── Per-company runner ───────────────────────────────────────────────────────
async function benchmarkCompany(input, tenantConfig) {
  const companyName = input.companyName || input.name;
  const countryCode = input.countryCode || input.country_code;
  const entityType = input.entityType;
  const ownershipType = input.ownershipType || "private_limited";
  const sector = input.sector || null;

  if (!companyName || !countryCode || !entityType) {
    return {
      input,
      ok: false,
      error: "Each company needs companyName, countryCode, and entityType.",
    };
  }

  const countryName = input.country || COUNTRY_NAMES[countryCode] || countryCode;

  // Research pipeline (research -> coverage -> gap recovery -> classification).
  const pipelineResult = await runResearchPipeline({
    companyName,
    country: countryName,
    countryCode,
    entityType,
    ownershipType,
    tenantConfig,
    fetchResearch: callAnthropic,
  });

  // Deterministic document requirements (best-effort — never fails the row).
  let documentRequirements = null;
  let documentError = null;
  try {
    const entityDef = (tenantConfig.entityTypes || []).find((e) => e.id === entityType);
    const entityLabel = (entityDef && entityDef.label) || entityType;
    const incorporationCountry =
      input.incorporationCountry || countryName;
    const checklist = getRequirements({
      incorporationCountry,
      entityType: entityLabel,
      ownershipType: OWNERSHIP_ID_TO_DRS[ownershipType] || ownershipType,
      sector: sector || undefined,
    });
    documentRequirements = {
      total: checklist.length,
      mandatoryCount: checklist.filter((d) => d.mandatory).length,
      checklist,
    };
  } catch (e) {
    documentError = e.message;
  }

  return {
    input: { companyName, countryCode, country: countryName, entityType, ownershipType, sector },
    ok: true,
    schema: pipelineResult.schema,
    coverageBefore: pipelineResult.coverageBefore,
    coverage: pipelineResult.coverage,
    ranGapRecovery: pipelineResult.ranGapRecovery,
    isPubliclyListed: pipelineResult.isPubliclyListed,
    listingEvidence: pipelineResult.listingEvidence,
    found: pipelineResult.found,
    documentRequirements,
    documentError,
    usage: pipelineResult.usage,
    totalTokens: pipelineResult.totalTokens,
    calls: pipelineResult.calls,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tenant-Id");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const tenant = getTenantIdFromRequest(req);

  try {
    const tenantConfig = await readConfig(tenant);

    // Build the company list from POST body or GET query.
    let companies;
    if (req.method === "POST") {
      const body = await readBody(req);
      companies = Array.isArray(body.companies)
        ? body.companies
        : (body.companyName || body.name)
          ? [body]
          : null;
    } else {
      const q = req.query || {};
      companies = q.companyName ? [q] : null;
    }

    if (!companies || companies.length === 0) {
      return res.status(400).json({
        error:
          "Provide a company to benchmark. POST { companies: [...] } or GET ?companyName=...&countryCode=GB&entityType=Corporate",
      });
    }

    let truncated = false;
    if (companies.length > MAX_COMPANIES) {
      companies = companies.slice(0, MAX_COMPANIES);
      truncated = true;
    }

    // runId ties every entity in this batch to one benchmark_runs row. Absent
    // (e.g. plain GET / no harness) → persistence is skipped entirely.
    const runId = (companies[0] && companies[0].runId) || null;

    // Sequential — research calls are slow and rate-limited; one failure
    // per company is isolated and reported, the batch continues.
    const results = [];
    for (const company of companies) {
      let result;
      try {
        result = await benchmarkCompany(company, tenantConfig);
      } catch (e) {
        result = { input: company, ok: false, error: e.message, details: e.details || null };
      }
      results.push(result);

      // Persist to Neon (best-effort). A DB error must NEVER break the
      // benchmark response — log and carry on.
      if (runId && result.ok) {
        try {
          await persistBenchmarkEntity(result, {
            runId,
            entityName: result.input.companyName,
            segment: company.segment || null,
            ownershipType: result.input.ownershipType,
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("benchmark persistence failed:", e.message);
        }
      }
    }

    const totals = results.reduce(
      (acc, r) => {
        if (r.usage) {
          acc.input_tokens += r.usage.input_tokens || 0;
          acc.output_tokens += r.usage.output_tokens || 0;
        }
        if (typeof r.totalTokens === "number") acc.totalTokens += r.totalTokens;
        if (r.ok) acc.succeeded += 1; else acc.failed += 1;
        return acc;
      },
      { input_tokens: 0, output_tokens: 0, totalTokens: 0, succeeded: 0, failed: 0 },
    );

    return res.status(200).json({
      tenant,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      companyCount: results.length,
      truncated,
      totals,
      results,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("benchmark endpoint error", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
};
