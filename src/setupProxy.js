// Local dev only. CRA auto-loads this file when running `npm start` and
// registers the middleware on the webpack-dev-server Express instance.
// Mirrors api/research.js, api/config.js, and api/admin-auth.js so the same
// endpoints work locally as on Vercel in production. This file is NOT
// bundled into the React app — it only runs in the dev server process.
//
// Requires ANTHROPIC_API_KEY and ADMIN_PASSWORD in .env.local. There is no
// TENANT_ID: tenant resolution is strict, so every local URL carries its own
// ?tenant= just as it does in production.

const path = require("path");
const { pathToFileURL } = require("url");

// Lazy-require the API handlers and shared modules from their canonical
// locations so dev and production run the exact same code paths.
const configHandler = require(path.join(__dirname, "..", "api", "config.js"));
const adminAuthHandler = require(path.join(__dirname, "..", "api", "admin-auth.js"));
const preboardingAuthHandler = require(path.join(__dirname, "..", "api", "preboarding-auth.js"));
const configVersionsHandler = require(path.join(__dirname, "..", "api", "config-versions.js"));
const configTemplatesHandler = require(path.join(__dirname, "..", "api", "config-templates.js"));
const superAdminAuthHandler = require(path.join(__dirname, "..", "api", "super-admin-auth.js"));
const tenantsHandler = require(path.join(__dirname, "..", "api", "tenants.js"));
const niumConstantsHandler = require(path.join(__dirname, "..", "api", "nium", "constants.js"));
const niumPublicDetailsHandler = require(path.join(__dirname, "..", "api", "nium", "public-details.js"));
const niumExhaustiveDetailsHandler = require(path.join(__dirname, "..", "api", "nium", "exhaustive-details.js"));
const docRequirementsHandler = require(path.join(__dirname, "..", "api", "document-requirements.js"));
const benchmarkHandler = require(path.join(__dirname, "..", "api", "benchmark.js"));
const docSearchHandler = require(path.join(__dirname, "..", "api", "doc-search.js"));
const submitHandler = require(path.join(__dirname, "..", "api", "submit.js"));
const trackEventHandler = require(path.join(__dirname, "..", "api", "track-event.js"));
const saveDossierHandler = require(path.join(__dirname, "..", "api", "save-dossier.js"));
const idvMatchWebhookHandler = require(path.join(__dirname, "..", "api", "idv-match", "webhook.js"));
const idvMatchStatusHandler = require(path.join(__dirname, "..", "api", "idv-match", "status.js"));
const idvScreeningWebhookHandler = require(path.join(__dirname, "..", "api", "idv-match", "screening", "webhook.js"));
const idvMatchFlagsHandler = require(path.join(__dirname, "..", "api", "idv-match", "flags.js"));
const idvMatchResolveHandler = require(path.join(__dirname, "..", "api", "idv-match", "resolve.js"));
const idvMatchExplainHandler = require(path.join(__dirname, "..", "api", "idv-match", "explain.js"));
const idvMatchSessionHandler = require(path.join(__dirname, "..", "api", "idv-match", "session.js"));
const idvMatchConfirmHandler = require(path.join(__dirname, "..", "api", "idv-match", "confirm.js"));
const idvMatchReviewerHandler = require(path.join(__dirname, "..", "api", "idv-match", "reviewer.js"));
const kycLookupHandler = require(path.join(__dirname, "..", "api", "kyc-lookup.js"));
const companySearchHandler = require(path.join(__dirname, "..", "api", "company-search.js"));
const selfSourceHandler = require(path.join(__dirname, "..", "api", "self-source.js"));
const inviteHandler = require(path.join(__dirname, "..", "api", "invite.js"));
const uboDiscoveryHandler = require(path.join(__dirname, "..", "api", "ubo-discovery.js"));
const uboControlLabHandler = require(path.join(__dirname, "..", "api", "ubo-control-lab.js"));
const uboDemoCustomerOwnershipChartHandler = require(path.join(__dirname, "..", "api", "ubo-demo-customer-ownership-chart.js"));
const uboDemoEntityResolutionHandler = require(path.join(__dirname, "..", "api", "ubo-demo-entity-resolution.js"));
const uboRecalculateHandler = require(path.join(__dirname, "..", "api", "ubo-recalculate.js"));
const getDossierHandler = require(path.join(__dirname, "..", "api", "get-dossier.js"));
const changeEventsHandler = require(path.join(__dirname, "..", "api", "change-events.js"));
const amendmentDocumentsHandler = require(path.join(__dirname, "..", "api", "amendment-documents.js"));
const dossierReseedHandler = require(path.join(__dirname, "..", "api", "dossier-reseed.js"));
const searchAttemptHandler = require(path.join(__dirname, "..", "api", "search-attempt.js"));
const researchAttemptHandler = require(path.join(__dirname, "..", "api", "research-attempt.js"));
const revokeDossierTokenHandler = require(path.join(__dirname, "..", "api", "revoke-dossier-token.js"));
const changeIntelligenceMetricsHandler = require(path.join(__dirname, "..", "api", "change-intelligence-metrics.js"));
const generatePolicyHandler = require(path.join(__dirname, "..", "api", "generate-policy.js"));
const researchHandler = require(path.join(__dirname, "..", "api", "research.js"));
const evidenceStatusHandler = require(path.join(__dirname, "..", "api", "evidence", "status.js"));
const evidenceA1FixtureHandler = require(path.join(__dirname, "..", "api", "evidence", "a1-fixture.js"));
const evidenceA2CollectHandler = require(path.join(__dirname, "..", "api", "evidence", "a2-collect.js"));
const evidenceA2ExistingHandler = require(path.join(__dirname, "..", "api", "evidence", "a2-existing.js"));
const evidenceA2ConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "a2-config.js"));
const evidenceA3FixtureHandler = require(path.join(__dirname, "..", "api", "evidence", "a3-fixture.js"));
const evidenceA3ConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "a3-config.js"));
const evidenceA3InterpretHandler = require(path.join(__dirname, "..", "api", "evidence", "a3-interpret.js"));
const evidenceA3HistoryHandler = require(path.join(__dirname, "..", "api", "evidence", "a3-history.js"));
const evidenceA4aFixtureHandler = require(path.join(__dirname, "..", "api", "evidence", "a4a-fixture.js"));
const evidenceA4aConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "a4a-config.js"));
const evidenceA4aEvaluateHandler = require(path.join(__dirname, "..", "api", "evidence", "a4a-evaluate.js"));
const evidenceA4aHistoryHandler = require(path.join(__dirname, "..", "api", "evidence", "a4a-history.js"));
const evidenceA4aOptionsHandler = require(path.join(__dirname, "..", "api", "evidence", "a4a-options.js"));
const evidenceA4bConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "a4b-config.js"));
const evidenceA4bOptionsHandler = require(path.join(__dirname, "..", "api", "evidence", "a4b-options.js"));
const evidenceA4bAssessHandler = require(path.join(__dirname, "..", "api", "evidence", "a4b-assess.js"));
const evidenceA4bHistoryHandler = require(path.join(__dirname, "..", "api", "evidence", "a4b-history.js"));
const evidenceA5aConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "a5a-config.js"));
const evidenceA5aOptionsHandler = require(path.join(__dirname, "..", "api", "evidence", "a5a-options.js"));
const evidenceA5aReconstructHandler = require(path.join(__dirname, "..", "api", "evidence", "a5a-reconstruct.js"));
const evidenceA5bConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "a5b-config.js"));
const evidenceA5bFreezeHandler = require(path.join(__dirname, "..", "api", "evidence", "a5b-freeze.js"));
const evidenceA5bListHandler = require(path.join(__dirname, "..", "api", "evidence", "a5b-list.js"));
const evidenceA5bReopenHandler = require(path.join(__dirname, "..", "api", "evidence", "a5b-reopen.js"));
const evidenceA5bVerifyHandler = require(path.join(__dirname, "..", "api", "evidence", "a5b-verify.js"));
const evidenceR1ConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "r1-config.js"));
const evidenceR1ContextsHandler = require(path.join(__dirname, "..", "api", "evidence", "r1-contexts.js"));
const evidenceR1IngestHandler = require(path.join(__dirname, "..", "api", "evidence", "r1-ingest.js"));
const evidenceR1ReopenHandler = require(path.join(__dirname, "..", "api", "evidence", "r1-reopen.js"));
const evidenceR2ConfigHandler = require(path.join(__dirname, "..", "api", "evidence", "r2-config.js"));
const evidenceR2OptionsHandler = require(path.join(__dirname, "..", "api", "evidence", "r2-options.js"));
const evidenceR2InterpretHandler = require(path.join(__dirname, "..", "api", "evidence", "r2-interpret.js"));
const evidenceR2HistoryHandler = require(path.join(__dirname, "..", "api", "evidence", "r2-history.js"));
const evidenceR2PreflightHandler = require(path.join(__dirname, "..", "api", "evidence", "r2-preflight.js"));
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
  // Local parity with middleware.js: without this, npm start would serve
  // routes the deployed UBO site refuses, and we would develop against a
  // product that does not exist.
  const productMode = require(path.join(__dirname, "..", "lib", "productMode.js"));
  app.use((req, res, next) => {
    if (productMode.refuseIfHidden(req, res)) return undefined;
    return next();
  });

  // CRA serves the staged UBO graph assets from build/ in production, but
  // `npm start` does not run the staging script. Expose the same canonical
  // files in local development so the ownership-graph iframe receives JS/CSS
  // rather than CRA's HTML fallback.
  app.get("/ubo-control-lab/vendor/react.production.min.js", (_req, res) => res.sendFile(path.join(__dirname, "..", "node_modules", "react", "umd", "react.production.min.js")));
  app.get("/ubo-control-lab/vendor/react-dom.production.min.js", (_req, res) => res.sendFile(path.join(__dirname, "..", "node_modules", "react-dom", "umd", "react-dom.production.min.js")));
  app.get("/ubo-control-lab/vendor/OwnershipGraph.js", (_req, res) => res.sendFile(path.join(__dirname, "..", "ubo-control-ui", "OwnershipGraph.js")));
  app.get("/ubo-control-lab/vendor/ownership-graph.css", (_req, res) => res.sendFile(path.join(__dirname, "..", "ubo-control-ui", "ownership-graph.css")));

  app.post("/api/ubo-demo-customer-ownership-chart", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(uboDemoCustomerOwnershipChartHandler)(req, res);
    });
  });

  app.post("/api/ubo-demo-entity-resolution", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(uboDemoEntityResolutionHandler)(req, res);
    });
  });

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

  // Research — the real handler (server-built prompts, rate limit, cache).
  app.post("/api/research", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(researchHandler)(req, res);
    });
  });

  app.all("/api/config", adapt(configHandler));
  app.all("/api/config-versions", adapt(configVersionsHandler));
  app.get("/api/config-templates", adapt(configTemplatesHandler));
  app.post("/api/admin-auth", adapt(adminAuthHandler));
  app.get("/api/preboarding-auth", adapt(preboardingAuthHandler));
  app.post("/api/preboarding-auth", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(preboardingAuthHandler)(req, res);
    });
  });
  app.post("/api/super-admin-auth", adapt(superAdminAuthHandler));
  app.all("/api/tenants", adapt(tenantsHandler));

  // Nium registry lookup. GET uses Express's req.query directly; POST needs
  // the JSON body parsed into req.body, since the dev server (unlike Vercel)
  // doesn't auto-parse it.
  app.get("/api/nium/constants", adapt(niumConstantsHandler));
  app.get("/api/nium/public-details", adapt(niumPublicDetailsHandler));
  app.post("/api/nium/exhaustive-details", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(niumExhaustiveDetailsHandler)(req, res);
    });
  });

  // DRS — document requirements service. POST; parse the JSON body the dev
  // server doesn't auto-parse (mirrors the Nium POST route above).
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

  // Identity Discrepancy Bands (idv-match). The webhook needs the RAW body for
  // HMAC signature verification (do NOT JSON-parse it); status is read-only.
  app.post("/api/idv-match/webhook", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => { req.rawBody = raw; adapt(idvMatchWebhookHandler)(req, res); });
  });
  app.get("/api/idv-match/status", adapt(idvMatchStatusHandler));
  app.post("/api/idv-match/status", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvMatchStatusHandler)(req, res);
    });
  });
  // Read-only feature-flag probe for the browser + the live band-resolution call.
  app.get("/api/idv-match/flags", adapt(idvMatchFlagsHandler));
  app.post("/api/idv-match/resolve", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvMatchResolveHandler)(req, res);
    });
  });
  app.post("/api/idv-match/explain", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvMatchExplainHandler)(req, res);
    });
  });
  app.post("/api/idv-match/session", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvMatchSessionHandler)(req, res);
    });
  });
  app.post("/api/idv-match/confirm", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvMatchConfirmHandler)(req, res);
    });
  });
  app.get("/api/idv-match/reviewer", adapt(idvMatchReviewerHandler));
  app.post("/api/idv-match/reviewer", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvMatchReviewerHandler)(req, res);
    });
  });
  // ComplyCube screening webhook — needs the RAW body for signature verification.
  app.post("/api/idv-match/screening/webhook", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => { req.rawBody = raw; adapt(idvScreeningWebhookHandler)(req, res); });
  });

  // KYC Lookup Agent → Nium eKYB. POST; parse the JSON body the dev server
  // doesn't auto-parse (mirrors the routes above).
  app.post("/api/kyc-lookup", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        req.body = {};
      }
      adapt(kycLookupHandler)(req, res);
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

  // Revoke every outstanding customer link for a dossier (analyst only).
  app.post("/api/revoke-dossier-token", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(revokeDossierTokenHandler)(req, res);
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

  // Standalone, session-only UBO Control Lab. Uses public UBO APIs and keeps
  // the sealed case envelope in the browser-owned session payload.
  app.get("/api/ubo-control-lab", adapt(uboControlLabHandler));
  app.post("/api/ubo-control-lab", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(uboControlLabHandler)(req, res);
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
      console.warn("[upload-document] DEV STUB - file not stored to Vercel Blob");
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

  // Fresh-customer re-search counter (no dossier). POST; parse the JSON body.
  app.post("/api/research-attempt", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(researchAttemptHandler)(req, res);
    });
  });

  // Read-only Change Intelligence dashboard metrics (aggregations over
  // change_events). GET only.
  app.get("/api/change-intelligence-metrics", adapt(changeIntelligenceMetricsHandler));

  // Evidence Platform Stage A0 — isolated server-boundary availability check.
  app.get("/api/evidence/status", adapt(evidenceStatusHandler));

  // Evidence Platform Stage A1 — fixture-only domain and lineage demonstration.
  app.get("/api/evidence/a1-fixture", adapt(evidenceA1FixtureHandler));

  // Evidence Platform Stage A2 — isolated Companies House producer/Lab route.
  app.post("/api/evidence/a2-collect", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(evidenceA2CollectHandler)(req, res);
    });
  });
  app.get("/api/evidence/a2-config", adapt(evidenceA2ConfigHandler));
  app.post("/api/evidence/a2-existing", (req, res) => {
    let raw = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; } adapt(evidenceA2ExistingHandler)(req, res); });
  });

  // Evidence Platform Stage A3 — isolated fixture interpretation demonstration.
  app.get("/api/evidence/a3-fixture", adapt(evidenceA3FixtureHandler));
  app.get("/api/evidence/a3-config", adapt(evidenceA3ConfigHandler));
  app.post("/api/evidence/a3-interpret", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(evidenceA3InterpretHandler)(req, res);
    });
  });
  app.post("/api/evidence/a3-history", (req, res) => {
    let raw = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; } adapt(evidenceA3HistoryHandler)(req, res); });
  });
  // Evidence Platform Stage A4a — isolated Fact-to-Information-Need evaluation.
  app.get("/api/evidence/a4a-fixture", adapt(evidenceA4aFixtureHandler));
  app.get("/api/evidence/a4a-config", adapt(evidenceA4aConfigHandler));
  for (const [route, handler] of [["/api/evidence/a4a-options", evidenceA4aOptionsHandler], ["/api/evidence/a4a-evaluate", evidenceA4aEvaluateHandler], ["/api/evidence/a4a-history", evidenceA4aHistoryHandler]]) {
    app.post(route, (req, res) => {
      let raw = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; } adapt(handler)(req, res); });
    });
  }
  // Evidence Platform Stage A4b — immutable coverage/completeness/conflict assessment.
  app.get("/api/evidence/a4b-config", adapt(evidenceA4bConfigHandler));
  for (const [route, handler] of [["/api/evidence/a4b-options", evidenceA4bOptionsHandler], ["/api/evidence/a4b-assess", evidenceA4bAssessHandler], ["/api/evidence/a4b-history", evidenceA4bHistoryHandler]]) {
    app.post(route, (req, res) => {
      let raw = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; } adapt(handler)(req, res); });
    });
  }
  // Evidence Platform Stage A5a — read-only point-in-time reconstruction.
  app.get("/api/evidence/a5a-config", adapt(evidenceA5aConfigHandler));
  app.get("/api/evidence/a5a-options", adapt(evidenceA5aOptionsHandler));
  app.post("/api/evidence/a5a-reconstruct", (req, res) => {
    let raw = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; } adapt(evidenceA5aReconstructHandler)(req, res); });
  });
  // Evidence Platform Stage A5b — immutable Package freeze, reopen and verification.
  app.get("/api/evidence/a5b-config", adapt(evidenceA5bConfigHandler));
  for (const [route, handler] of [["/api/evidence/a5b-freeze", evidenceA5bFreezeHandler], ["/api/evidence/a5b-list", evidenceA5bListHandler], ["/api/evidence/a5b-reopen", evidenceA5bReopenHandler], ["/api/evidence/a5b-verify", evidenceA5bVerifyHandler]]) {
    app.post(route, (req, res) => {
      let raw = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; } adapt(handler)(req, res); });
    });
  }
  app.get("/api/evidence/r1-config", adapt(evidenceR1ConfigHandler));
  app.get("/api/evidence/r1-contexts", adapt(evidenceR1ContextsHandler));
  for (const [route, handler] of [["/api/evidence/r1-ingest", evidenceR1IngestHandler], ["/api/evidence/r1-reopen", evidenceR1ReopenHandler]]) app.post(route, (req, res) => { let raw=""; req.setEncoding("utf8"); req.on("data", chunk=>{raw+=chunk;}); req.on("end",()=>{try{req.body=raw?JSON.parse(raw):{};}catch(_){req.body={};} adapt(handler)(req,res);}); });
  app.get("/api/evidence/r2-config", adapt(evidenceR2ConfigHandler));
  for (const [route, handler] of [["/api/evidence/r2-options", evidenceR2OptionsHandler], ["/api/evidence/r2-interpret", evidenceR2InterpretHandler], ["/api/evidence/r2-history", evidenceR2HistoryHandler], ["/api/evidence/r2-preflight", evidenceR2PreflightHandler]]) app.post(route, (req, res) => { let raw=""; req.setEncoding("utf8"); req.on("data", chunk=>{raw+=chunk;}); req.on("end",()=>{try{req.body=raw?JSON.parse(raw):{};}catch(_){req.body={};} adapt(handler)(req,res);}); });
};
