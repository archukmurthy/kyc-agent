/**
 * /api/company-search
 *
 * Resolve a company NAME → registration number via the UK Companies House
 * public search API (free). Used to look up a registration number when only
 * the company name is known.
 *
 * Method: GET
 * Query:
 *   - q       (required) company name to search
 *   - country (optional) ISO alpha-2; only "GB" is supported (UK only)
 * Returns:
 *   - { results: [{ name, registrationNumber, status, address, type }], query }
 *   - { results: [], noResults: true, message }   when nothing matches / non-GB
 *   - { error }                                    on misconfig / upstream error
 *
 * Auth: HTTP Basic with the Companies House REST API key as the USERNAME and an
 * empty password. Set COMPANIES_HOUSE_API_KEY (free — register an application at
 * https://developer.company-information.service.gov.uk/). No key in the repo.
 *
 * Registered in src/setupProxy.js so it also works under local `npm start`.
 */

const CH_BASE = "https://api.company-information.service.gov.uk";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const q = (req.query.q || "").trim();
  const country = (req.query.country || "GB").toUpperCase();

  if (!q) {
    return res.status(400).json({ error: "Missing required query param: q" });
  }

  // Companies House is the UK registry only. For other jurisdictions there's no
  // free name search here — surface that clearly rather than pretending.
  if (country !== "GB") {
    return res.status(200).json({
      results: [],
      noResults: true,
      message: "Company-number lookup is only available for UK (GB) companies.",
    });
  }

  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Companies House API key not configured. Add COMPANIES_HOUSE_API_KEY to " +
        ".env.local (local) and the Vercel project (prod). Get a free key at " +
        "https://developer.company-information.service.gov.uk/.",
    });
  }

  // Basic auth: base64("<apiKey>:") — key as username, empty password.
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const url = `${CH_BASE}/search/companies?q=${encodeURIComponent(q)}&items_per_page=5`;

  try {
    const r = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, accept: "application/json" },
    });

    if (!r.ok) {
      const body = await r.text();
      console.error("[company-search] Companies House error:", r.status, body);
      if (r.status === 401) {
        return res.status(401).json({
          error: "Companies House rejected the API key (401). Check COMPANIES_HOUSE_API_KEY.",
        });
      }
      return res.status(502).json({ error: `Companies House error ${r.status}` });
    }

    const data = await r.json();
    const results = (data.items || []).map((it) => ({
      name: it.title,
      registrationNumber: it.company_number,
      status: it.company_status || "",
      address: it.address_snippet || "",
      type: it.company_type || "",
    }));

    return res.status(200).json({ results, noResults: results.length === 0, query: q });
  } catch (err) {
    console.error("[company-search] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
