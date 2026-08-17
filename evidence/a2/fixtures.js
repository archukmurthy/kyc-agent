"use strict";

function response(data, suffix = "") {
  const bytes = Buffer.from(JSON.stringify(data));
  return { url: `https://api.company-information.service.gov.uk${suffix}`, status: 200, contentType: "application/json", bytes, data };
}

function buildCompaniesHouseFixtureClient({ pscFailure = false, officerPageFailure = false } = {}) {
  return {
    async profile(number) { return response({ company_name: "ABC LIMITED", company_number: number, company_status: "active", date_of_creation: "2017-03-12", type: "ltd", registered_office_address: { address_line_1: "25 King Street", locality: "London", postal_code: "SW1A 1AA", country: "United Kingdom" }, sic_codes: ["62020"] }, `/company/${number}`); },
    async officers(number) {
      if (officerPageFailure) { const error = new Error("officers page 2 failed"); error.partialPages = [response({ items: [{ name: "SMITH, Jane", officer_role: "director", appointed_on: "2020-01-01" }], total_results: 2 }, `/company/${number}/officers?page=1`)]; throw error; }
      return [
        { ...response({ items: [{ name: "SMITH, Jane", officer_role: "director", appointed_on: "2020-01-01" }], total_results: 2 }, `/company/${number}/officers?page=1`), pageNumber: 1, startIndex: 0 },
        { ...response({ items: [{ name: "DOE, John", officer_role: "director", appointed_on: "2018-01-01", resigned_on: "2022-01-01" }], total_results: 2 }, `/company/${number}/officers?page=2`), pageNumber: 2, startIndex: 1 },
      ];
    },
    async psc(number) {
      if (pscFailure) throw new Error("PSC temporary upstream error");
      return [
        { ...response({ items: [{ name: "SMITH, Jane", kind: "individual-person-with-significant-control", natures_of_control: ["ownership-of-shares-25-to-50-percent"] }], total_results: 2 }, `/company/${number}/psc?page=1`), pageNumber: 1, startIndex: 0 },
        { ...response({ items: [{ name: "HOLDCO LIMITED", kind: "corporate-entity-person-with-significant-control", ceased_on: "2020-01-01", natures_of_control: ["voting-rights-50-to-75-percent"] }], total_results: 2 }, `/company/${number}/psc?page=2`), pageNumber: 2, startIndex: 1 },
      ];
    },
  };
}

async function fixtureWebsiteCapture(number, area = "overview_website") {
  const suffix = area === "officers_website" ? "/officers" : area === "psc_website" ? "/persons-with-significant-control" : "";
  const pageCount = area === "officers_website" ? 2 : 1;
  return {
    area,
    url: `https://find-and-update.company-information.service.gov.uk/company/${number}${suffix}`,
    paginationComplete: true,
    failureReason: null,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      url: `https://find-and-update.company-information.service.gov.uk/company/${number}${suffix}${index ? `?page=${index + 1}` : ""}`,
      status: 200,
      capturedAt: "2026-08-16T12:00:00.000Z",
      html: Buffer.from(`<html><h1>ABC LIMITED</h1><p>${number}</p><p>${area} page ${index + 1}</p>${area === "psc_website" ? "<p>No registrable person with significant control</p>" : ""}</html>`),
      screenshot: Buffer.from(`fixture-${area}-page-${index + 1}-png-bytes`),
      screenshotError: null,
    })),
  };
}

module.exports = { buildCompaniesHouseFixtureClient, fixtureWebsiteCapture };
