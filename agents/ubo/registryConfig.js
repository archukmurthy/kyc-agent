"use strict";

const REGISTRIES = Object.freeze({
  COMPANIES_HOUSE: { registryCode: "COMPANIES_HOUSE", jurisdiction: "GB", displayName: "Companies House", accessType: "api", baseUrl: "https://api.company-information.service.gov.uk", allowedDomains: ["api.company-information.service.gov.uk"], searchStrategy: "registration_number_first", supportedDocuments: ["company_profile", "ubo_extract"], credentialRequired: true, mfaSupported: false, automationEnabled: true },
  DK_UBO_REGISTRY: { registryCode: "DK_UBO_REGISTRY", jurisdiction: "DK", displayName: "Danish UBO Registry", accessType: "manual_only", allowedDomains: [], searchStrategy: "registration_number_first", supportedDocuments: ["ubo_extract", "company_profile"], credentialRequired: true, mfaSupported: true, automationEnabled: false },
});
function registriesFor(jurisdiction) { return Object.values(REGISTRIES).filter((r) => r.jurisdiction === String(jurisdiction).toUpperCase()); }
module.exports = { REGISTRIES, registriesFor };
