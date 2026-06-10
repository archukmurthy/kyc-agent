// Local dev only. CRA auto-loads this file when running `npm start` and
// registers the middleware on the webpack-dev-server Express instance.
// Mirrors api/research.js, api/config.js, and api/admin-auth.js so the same
// endpoints work locally as on Vercel in production. This file is NOT
// bundled into the React app — it only runs in the dev server process.
//
// Requires ANTHROPIC_API_KEY, ADMIN_PASSWORD, TENANT_ID in .env.local.

const path = require("path");

// Lazy-require the API handlers and shared modules from their canonical
// locations so dev and production run the exact same code paths.
const configHandler = require(path.join(__dirname, "..", "api", "config.js"));
const adminAuthHandler = require(path.join(__dirname, "..", "api", "admin-auth.js"));
const configVersionsHandler = require(path.join(__dirname, "..", "api", "config-versions.js"));
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
  app.post("/api/research", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        const { prompt, messages, model, tools, max_tokens } = body;
        if (!prompt && !messages) {
          return res.status(400).json({ error: "Missing prompt or messages in request body" });
        }

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
};
