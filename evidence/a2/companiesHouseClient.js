"use strict";

const BASE = "https://api.company-information.service.gov.uk";

class CompaniesHouseHttpError extends Error {
  constructor(message, status) { super(message); this.name = "CompaniesHouseHttpError"; this.status = status; }
}

class CompaniesHouseClient {
  constructor({ apiKey = process.env.COMPANIES_HOUSE_API_KEY, fetchImpl = global.fetch } = {}) {
    if (!apiKey) throw new Error("COMPANIES_HOUSE_API_KEY is not configured");
    if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
    this.fetch = fetchImpl;
    this.auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }

  async get(path) {
    const url = `${BASE}${path}`;
    const response = await this.fetch(url, { headers: { Authorization: this.auth, accept: "application/json" } });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new CompaniesHouseHttpError(`Companies House returned ${response.status}`, response.status);
    let data;
    try { data = JSON.parse(bytes.toString("utf8")); } catch (_) { throw new Error("Companies House returned invalid JSON"); }
    return { url, status: response.status, contentType: response.headers?.get?.("content-type") || "application/json", bytes, data };
  }

  profile(companyNumber) { return this.get(`/company/${encodeURIComponent(companyNumber)}`); }

  async paginated(companyNumber, resource, pageSize = 100) {
    const pages = [];
    let startIndex = 0;
    for (let page = 0; page < 100; page += 1) {
      let result;
      try { result = await this.get(`/company/${encodeURIComponent(companyNumber)}/${resource}?items_per_page=${pageSize}&start_index=${startIndex}`); }
      catch (error) { error.partialPages = pages; throw error; }
      pages.push({ ...result, pageNumber: page + 1, startIndex });
      const items = Array.isArray(result.data.items) ? result.data.items : [];
      const total = Number(result.data.total_results || 0);
      startIndex += items.length;
      if (items.length === 0 || startIndex >= total) return pages;
    }
    throw new Error(`${resource} pagination exceeded safety limit`);
  }

  officers(companyNumber) { return this.paginated(companyNumber, "officers"); }
  psc(companyNumber) { return this.paginated(companyNumber, "persons-with-significant-control"); }
}

module.exports = { BASE, CompaniesHouseClient, CompaniesHouseHttpError };
