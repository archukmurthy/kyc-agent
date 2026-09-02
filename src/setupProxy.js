// Local dev only. CRA auto-loads this file when running `npm start` and
// registers the middleware on the webpack-dev-server Express instance.
// Mirrors api/research.js, api/config.js, and api/admin-auth.js so the same
// endpoints work locally as on Vercel in production. This file is NOT
// bundled into the React app — it only runs in the dev server process.
//
// Requires ANTHROPIC_API_KEY, ADMIN_PASSWORD, TENANT_ID in .env.local.

const path = require("path");
const { pathToFileURL } = require("url");

// Lazy-require the API handlers and shared modules from their canonical
// locations so dev and production run the exact same code paths.
const configHandler = require(path.join(__dirname, "..", "api", "config.js"));
const adminAuthHandler = require(path.join(__dirname, "..", "api", "admin-auth.js"));
const configVersionsHandler = require(path.join(__dirname, "..", "api", "config-versions.js"));
const superAdminAuthHandler = require(path.join(__dirname, "..", "api", "super-admin-auth.js"));
const tenantsHandler = require(path.join(__dirname, "..", "api", "tenants.js"));
const docRequirementsHandler = require(path.join(__dirname, "..", "api", "document-requirements.js"));
const benchmarkHandler = require(path.join(__dirname, "..", "api", "benchmark.js"));
const docSearchHandler = require(path.join(__dirname, "..", "api", "doc-search.js"));
const submitHandler = require(path.join(__dirname, "..", "api", "submit.js"));
const trackEventHandler = require(path.join(__dirname, "..", "api", "track-event.js"));
const saveDossierHandler = require(path.join(__dirname, "..", "api", "save-dossier.js"));
const companySearchHandler = require(path.join(__dirname, "..", "api", "company-search.js"));
const selfSourceHandler = require(path.join(__dirname, "..", "api", "self-source.js"));
const inviteHandler = require(path.join(__dirname, "..", "api", "invite.js"));
const uboDiscoveryHandler = require(path.join(__dirname, "..", "api", "ubo-discovery.js"));
const uboRecalculateHandler = require(path.join(__dirname, "..", "api", "ubo-recalculate.js"));
const getDossierHandler = require(path.join(__dirname, "..", "api", "get-dossier.js"));
const changeEventsHandler = require(path.join(__dirname, "..", "api", "change-events.js"));
const amendmentDocumentsHandler = require(path.join(__dirname, "..", "api", "amendment-documents.js"));
const dossierReseedHandler = require(path.join(__dirname, "..", "api", "dossier-reseed.js"));
const searchAttemptHandler = require(path.join(__dirname, "..", "api", "search-attempt.js"));
const changeIntelligenceMetricsHandler = require(path.join(__dirname, "..", "api", "change-intelligence-metrics.js"));
const generatePolicyHandler = require(path.join(__dirname, "..", "api", "generate-policy.js"));
const officersLayer = require(path.join(__dirname, "..", "lib", "applyOfficersLayer.js"));

function adapt(handler) {
  // Wrap CRA's req/res so it looks enough like a Vercel handler. CRA's
  // bodyParser may have already populated req.body; if not, the handler
  // streams it itself.
  return (req, res) => {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return res;
    };
    return handler(req, res);
  };
}

module.exports = function (app) {
  // UK KYB Policy Simulator. Keep the Anthropic credential and prompt server-side.
  app.post("/api/generate-policy", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(generatePolicyHandler)(req, res);
    });
  });

  app.post("/api/research", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        const { prompt, messages, model, tools, max_tokens,
                companyName, jurisdiction, entityType, forceRefresh,
                registrationNumber } = body;
        if (!prompt && !messages) {
          return res.status(400).json({ error: "Missing prompt or messages in request body" });
        }

        // ─── CACHE LAYER (opt-in) ───
        // Mirrors api/research.js so caching works under `npm start` too. Only
        // the main research call passes `companyName`, so other callers (doc
        // extraction, gap recovery) are untouched. researchCache.js is ESM, so
        // it's loaded via dynamic import() from this CJS dev-server file. Cache
        // failures always fall through to the live API.
        const cacheEnabled = !!companyName;
        let cacheMod = null;
        if (cacheEnabled) {
          try {
            // Node's ESM dynamic import() needs a file:// URL on Windows — a raw
            // "C:\..." path throws "protocol 'c:'" and the cache silently never
            // loads (every research run then hits the paid API). pathToFileURL fixes it.
            cacheMod = await import(pathToFileURL(path.join(__dirname, "..", "lib", "researchCache.js")).href);
          } catch (err) {
            console.error("[research-cache] Failed to load cache module:", err.message);
          }
        }
        if (cacheMod && !forceRefresh) {
          try {
            const cached = await cacheMod.getCachedResearch(companyName, jurisdiction, entityType);
            if (cached) {
              console.log(`[research-cache] HIT for "${companyName}" — serving from DB`);
              return res.status(200).json(cached);
            }
            console.log(`[research-cache] MISS for "${companyName}" — calling Anthropic API`);
          } catch (err) {
            console.error("[research-cache] Cache lookup error, falling through:", err.message);
          }
        } else if (cacheMod && forceRefresh) {
          console.log(`[research-cache] FORCE REFRESH for "${companyName}" — bypassing cache`);
        }

        // ─── LAYER 1 — Companies House Officers API (deterministic) ───
        // Mirrors api/research.js: for UK (GB) companies fetch all active
        // officers before the Anthropic call; the director field is replaced
        // with this data after the call. Failures fall back to AI web search.
        const chOfficers = await officersLayer.fetchOfficersLayer({
          companyName, jurisdiction, registrationNumber,
        });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return res.status(500).json({
            error: "Server API key not configured",
            message: "Add ANTHROPIC_API_KEY=sk-ant-... to .env.local at the repo root and restart `npm start`.",
          });
        }

        const finalMessages = messages || [{ role: "user", content: prompt }];
        const finalModel = model || "claude-sonnet-4-5";
        const finalMaxTokens = max_tokens || 16000;
        const finalTools = Array.isArray(tools)
          ? tools
          : [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];

        const requestBody = {
          model: finalModel,
          max_tokens: finalMaxTokens,
          messages: finalMessages,
        };
        if (finalTools.length > 0) requestBody.tools = finalTools;

        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(requestBody),
        });

        const data = await r.json();

        if (!r.ok) {
          return res.status(r.status).json({ error: "Claude API error", details: data });
        }

        // Runs before the cache save so the cached copy carries them too. No-op
        // when chOfficers is null/empty (non-GB, key absent, or fetch failed).
        officersLayer.injectOfficers(data, chOfficers);

        // ─── SAVE TO CACHE (opt-in; same gate as the lookup above) ───
        if (cacheMod) {
          try {
            await cacheMod.saveResearchToCache(companyName, jurisdiction, entityType, data, finalModel);
          } catch (err) {
            console.error("[research-cache] Failed to save to cache:", err.message);
          }
        }

        res.status(200).json(data);
      } catch (err) {
        res.status(500).json({ error: "Server error", message: err.message });
      }
    });
  });

  app.all("/api/config", adapt(configHandler));
  app.all("/api/config-versions", adapt(configVersionsHandler));
  app.post("/api/admin-auth", adapt(adminAuthHandler));
  app.post("/api/super-admin-auth", adapt(superAdminAuthHandler));
  app.all("/api/tenants", adapt(tenantsHandler));

  // DRS — document requirements service. POST; parse the JSON body the dev
  // server doesn't auto-parse.
  app.post("/api/document-requirements", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(docRequirementsHandler)(req, res);
    });
  });

  // Read-only benchmark endpoint. GET uses req.query; POST needs the JSON body
  // parsed (the dev server doesn't auto-parse it).
  app.get("/api/benchmark", adapt(benchmarkHandler));
  app.post("/api/benchmark", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(benchmarkHandler)(req, res);
    });
  });

  // Doc search agent (Step 2 — Document Intelligence). POST; parse the JSON
  // body the dev server doesn't auto-parse (mirrors the routes above).
  app.post("/api/doc-search", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(docSearchHandler)(req, res);
    });
  });

  // Self-source registry agent (Step 2 — registry retrieval). POST; parse the
  // JSON body the dev server doesn't auto-parse (mirrors the routes above).
  app.post("/api/self-source", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(selfSourceHandler)(req, res);
    });
  });

  // Live customer onboarding submission → Neon Postgres. POST; parse the JSON
  // body the dev server doesn't auto-parse (mirrors the routes above).
  app.post("/api/submit", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(submitHandler)(req, res);
    });
  });

  // Lightweight event tracking → session_timeline. POST; parse the JSON body
  // the dev server doesn't auto-parse (mirrors the routes above).
  app.post("/api/track-event", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(trackEventHandler)(req, res);
    });
  });

  // Pre-boarding dossier save → entity_dossiers. POST; parse the JSON body.
  app.post("/api/save-dossier", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(saveDossierHandler)(req, res);
    });
  });

  // Companies House name → registration-number resolver (UK). GET uses
  // req.query directly.
  app.get("/api/company-search", adapt(companySearchHandler));

  // Fetch a saved dossier by id for the customer invite link. GET uses req.query.
  app.get("/api/get-dossier", adapt(getDossierHandler));

  // Customer onboarding invitation email + token persistence. POST; parse the
  // JSON body the dev server doesn't auto-parse (mirrors the routes above).
  app.post("/api/invite", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(inviteHandler)(req, res);
    });
  });

  // Standalone UBO discovery lab. POST; parse JSON like other serverless routes.
  app.post("/api/ubo-discovery", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(uboDiscoveryHandler)(req, res);
    });
  });

  app.post("/api/ubo-recalculate", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(uboRecalculateHandler)(req, res);
    });
  });

  // Change Intelligence — append-only change_events write. POST; parse the JSON
  // body the dev server doesn't auto-parse (mirrors the routes above).
  app.post("/api/change-events", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(changeEventsHandler)(req, res);
    });
  });

  // Amendment documents derived from change_events for the Fill Gaps section.
  // GET uses req.query directly.
  app.get("/api/amendment-documents", adapt(amendmentDocumentsHandler));

  // Blob upload + retrieval. These were the only /api routes NOT mounted here,
  // so every local upload 404'd, landed as uploadFailed:true, and the submit
  // gate correctly refused to open — which made the whole amendment-document
  // flow untestable locally without stubbing fetch in the page.
  //
  // Dynamic-imported because both handlers are ESM (they `import` @vercel/blob
  // and formidable), unlike the CommonJS handlers required at the top. Same
  // pathToFileURL treatment as researchCache above — a bare import() of a
  // Windows path fails.
  //
  // The multipart stream must reach formidable untouched, so there is no body
  // parsing here.
  const esmHandler = (relPath) => {
    let mod = null;
    return async (req, res) => {
      try {
        if (!mod) {
          mod = await import(pathToFileURL(path.join(__dirname, "..", "api", relPath)).href);
        }
        return adapt(mod.default)(req, res);
      } catch (err) {
        console.error(`[setupProxy] ${relPath} failed to load:`, err.message);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: `Local handler load failed: ${err.message}` }));
      }
    };
  };
  // put() writes to the REAL Vercel Blob store using BLOB_READ_WRITE_TOKEN. To
  // keep dev test files out of production storage, set DEV_FAKE_BLOB=1 in
  // .env.local to short-circuit to a stub. The stub also kicks in when no token
  // is configured, so the Confirm document gate can still be cleared locally
  // without Blob credentials.
  //
  // The stub URL is intentionally an unresolvable example.invalid address: it is
  // stored in amendmentUploads and can reach the dossier via rawResearch, so it
  // must fail loudly rather than look like a real blob.
  //
  // The real handler is resolved ONCE here, not per request, so esmHandler's
  // module memo survives across uploads.
  const uploadDocument = esmHandler("upload-document.js");
  app.post("/api/upload-document", (req, res) => {
    if (process.env.DEV_FAKE_BLOB === "1" || !process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn("[upload-document] DEV STUB — file not stored to Vercel Blob");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ blobUrl: "https://example.invalid/DEV-FAKE", filename: "dev-stub" }));
    }
    return uploadDocument(req, res);
  });
  app.get("/api/get-document", esmHandler("get-document.js"));

  // Self-serve re-research — dossier lifecycle reseed decision (full vs derive).
  // POST; parse the JSON body the dev server doesn't auto-parse.
  app.post("/api/dossier-reseed", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(dossierReseedHandler)(req, res);
    });
  });

  // Server-authoritative search-attempt counter (two-retry cap). GET reads
  // (req.query); POST atomically increments (parse the JSON body).
  app.get("/api/search-attempt", adapt(searchAttemptHandler));
  app.post("/api/search-attempt", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(searchAttemptHandler)(req, res);
    });
  });

  // Read-only Change Intelligence dashboard metrics (aggregations over
  // change_events). GET only.
  app.get("/api/change-intelligence-metrics", adapt(changeIntelligenceMetricsHandler));
};
