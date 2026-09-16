// POST /api/research — every Claude call for the onboarding research flow.
//
// The browser sends structured input (a mode plus company facts). This handler
// resolves the tenant, rate-limits the caller, loads the tenant's stored
// config and builds the prompt, model, tools and token budget itself
// (lib/researchPrompts.js). A client-authored prompt/messages/model/tools/
// max_tokens is refused outright, so the endpoint can no longer be used as a
// general-purpose Anthropic proxy.
//
// Admin preview may send `draftConfig`; it is honoured only with a valid admin
// token in X-Admin-Token and never touches the research cache.
//
// CommonJS so src/setupProxy.js mounts this exact handler for `npm start`.

const { getTenantIdFromRequest } = require("../lib/tenant");
const researchCache = require("../lib/researchCache");
const officersLayer = require("../lib/applyOfficersLayer");
const { enforceRateLimit } = require("../lib/rateLimit");
const { buildAnthropicRequest, ResearchInputError, CLIENT_OWNED_KEYS } = require("../lib/researchPrompts");
const config = require("./config");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

let _deps = {
  fetch: (...args) => fetch(...args),
  cache: researchCache,
  officersLayer,
  enforceRateLimit,
  readConfigForTenant: config.readConfigForTenant,
  authorizeAdmin: config.authorizeAdminForTenant,
};

// Callers always pass an already-lowercase header name (Vercel/Node normalise
// incoming header keys to lowercase).
function header(req, name) {
  const headers = (req && req.headers) || {};
  const value = headers[name];
  return typeof value === "string" ? value : "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id, X-Admin-Token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const tenant = getTenantIdFromRequest(req);
  if (!tenant) return res.status(400).json({ error: "tenant_required" });
  if (CLIENT_OWNED_KEYS.some((key) => body[key] !== undefined)) {
    return res.status(400).json({ error: "client_prompt_not_allowed" });
  }

  if (!(await _deps.enforceRateLimit(req, res, "research"))) return undefined;

  try {
    let tenantConfig = null;
    let usingDraft = false;
    if (body.draftConfig && typeof body.draftConfig === "object" && !Array.isArray(body.draftConfig)) {
      const adminToken = header(req, "x-admin-token");
      if (adminToken && (await _deps.authorizeAdmin(tenant, adminToken))) {
        tenantConfig = body.draftConfig;
        usingDraft = true;
      }
    }
    if (!tenantConfig) tenantConfig = await _deps.readConfigForTenant(tenant);
    if (!tenantConfig) return res.status(404).json({ error: "tenant_not_found" });

    let built;
    try {
      built = buildAnthropicRequest(body, tenantConfig);
    } catch (err) {
      if (err instanceof ResearchInputError) return res.status(400).json({ error: err.code });
      throw err;
    }

    const cacheParts = built.cacheKeyParts && !usingDraft ? { tenant, ...built.cacheKeyParts } : null;
    if (cacheParts && body.forceRefresh !== true) {
      try {
        const cached = await _deps.cache.getCachedResearch(cacheParts);
        if (cached) return res.status(200).json(cached);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[research-cache] lookup failed, falling through:", err.message);
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server API key not configured" });

    // LAYER 1 — Companies House officers (deterministic) for the main research
    // call only; null on non-GB, missing key or failure, and injection is then
    // a no-op.
    const chOfficers = built.officers ? await _deps.officersLayer.fetchOfficersLayer(built.officers) : null;

    const response = await _deps.fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(built.requestBody),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: "Claude API error", details: data });
    }

    if (built.officers) _deps.officersLayer.injectOfficers(data, chOfficers);

    if (cacheParts) {
      try {
        await _deps.cache.saveResearchToCache(cacheParts, data, built.requestBody.model);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[research-cache] save failed:", err.message);
      }
    }

    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api/research] failed:", err);
    return res.status(500).json({ error: "research_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
