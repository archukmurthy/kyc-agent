// Vercel serverless function: calls the doc search sub-agent
// (agents/docSearchAgent.js) and returns its results to the React frontend
// (Step 2 — Document Intelligence, Section A).
//
// CommonJS (module.exports) rather than ESM so src/setupProxy.js can
// require() it for local dev, mirroring api/config.js and friends.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const {
    companyName,
    country,
    ownershipType,
    entityCategory,
    tenantId, // reserved for future per-tenant doc search behaviour
  } = req.body || {};

  if (!companyName || !country ||
      !ownershipType || !entityCategory) {
    return res.status(400).json({
      error: "Missing required fields",
    });
  }

  try {
    // Lazy require: the agent instantiates the Anthropic SDK client at module
    // scope (which throws if ANTHROPIC_API_KEY is unset), so only load it
    // when a request actually arrives — not at dev-server startup.
    const { docSearchAgent } = require("../agents/docSearchAgent");

    // Generate case ID for download folder
    const caseId = [
      companyName
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toLowerCase()
        .slice(0, 30),
      Date.now(),
    ].join("_");

    // Vercel's function filesystem is read-only except /tmp; locally use the
    // repo-relative ./downloads folder (gitignored).
    const baseDir = process.env.VERCEL ? "/tmp/downloads" : "./downloads";

    const result = await docSearchAgent({
      companyName,
      country,
      ownershipType,
      entityCategory,
      outputDir: `${baseDir}/${caseId}`,
    });

    // Return the full result.
    // The downloaded files are stored under outputDir for audit purposes.
    // The frontend uses sourceUrl, not the local file path.
    return res.status(200).json({
      success: true,
      caseId,
      documents: result.documents,
      summaryTable: result.summaryTable,
      summary: result.summary,
      cost: result.cost,
      searchedAt: result.searchedAt,
    });

  } catch (err) {
    console.error("[api/doc-search] Error:", err);
    return res.status(500).json({
      error: err.message || "Doc search failed",
    });
  }
};
