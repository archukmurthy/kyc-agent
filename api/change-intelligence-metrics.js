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
const { getAllEvents } = require("../src/changeIntelligence/events/readEvents");
const { computeDashboardMetrics } = require("../src/changeIntelligence/dashboardMetrics");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
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
