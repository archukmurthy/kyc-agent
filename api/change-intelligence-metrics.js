// Read-only metrics endpoint for the Change Intelligence dashboard → Neon `change_events`.
//
//   GET /api/change-intelligence-metrics  → { meta, headline, detail }
//
// Loads every change_event via the DAL and runs the pure computeDashboardMetrics
// aggregator server-side, returning one JSON payload with all headline + detail
// data. PURE READ — no writes, no journey data, nothing outside change_events.
//
// CommonJS (module.exports), mirroring api/amendment-documents.js. Internal/admin
// only (same access pattern as the admin view — the page gates with the admin
// token before fetching this). NOTE: src/setupProxy.js gets an additive route
// registration so this also works under local npm start.
//
// Always returns 200 with a coherent payload: on no DB / DB error it returns the
// empty-state metrics (all zeros) rather than failing, so the dashboard renders
// "no change data yet" instead of a broken chart.

const { neon } = require("@neondatabase/serverless");
const { applyCors, requireAdmin } = require("../lib/routeAuth");
const { PLATFORM_TENANT_IDS } = require("../lib/tenantRegistry");
const { getAllEvents } = require("../src/changeIntelligence/events/readEvents");
const { computeDashboardMetrics } = require("../src/changeIntelligence/dashboardMetrics");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Was open to anyone who knew the URL, and the dashboard gated only in the
  // browser - which stops nobody who calls the endpoint directly.
  const tenant = await requireAdmin(req, res);
  if (!tenant) return undefined;

  // getAllEvents spans every tenant because change_events has no tenant column
  // until Batch 2 of docs/PRODUCTION-READINESS-PLAN.md. Until it does, only the
  // platform operator may read the aggregate: handing one tenant's admin the
  // numbers of another is the same leak with a login in front of it.
  if (!PLATFORM_TENANT_IDS.includes(tenant)) {
    return res.status(403).json({ error: "forbidden" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[change-intelligence-metrics] No DATABASE_URL — empty metrics");
    return res.status(200).json(computeDashboardMetrics([]));
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const events = await getAllEvents(sql);
    return res.status(200).json(computeDashboardMetrics(events));
  } catch (err) {
    console.error("[change-intelligence-metrics] ❌", err.message);
    // Degrade to the empty state rather than break the dashboard.
    return res.status(200).json({ ...computeDashboardMetrics([]), warning: err.message });
  }
};
