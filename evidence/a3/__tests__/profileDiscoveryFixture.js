"use strict";

const PROFILE_DISCOVERY_SOURCE = Object.freeze({
  company_name: "TESCO PLC",
  previous_company_names: Object.freeze([{ name: "TESCO STORES (HOLDINGS) LIMITED", effective_from: "1947-11-27", ceased_on: "1983-08-25" }]),
  sic_codes: Object.freeze(["47110"]),
  company_number: "00445790",
  company_status: "active",
  date_of_creation: "1947-11-27",
  jurisdiction: "england-wales",
  type: "plc",
  registered_office_address: Object.freeze({ address_line_1: "Tesco House, Shire Park", address_line_2: "Kestrel Way", locality: "Welwyn Garden City", postal_code: "AL7 1GA", country: "United Kingdom" }),
  etag: "technical-etag-not-a-business-fact",
  links: Object.freeze({ self: "/company/00445790", officers: "/company/00445790/officers" }),
});

class DeterministicProfileDiscoveryProvider {
  constructor() { this.calls = 0; }
  async extract({ decodedText, requestedConcepts = [] }) {
    this.calls += 1; const source = JSON.parse(decodedText); const requested = new Map(requestedConcepts.map((item) => [item.concept, item]));
    const address = [source.registered_office_address.address_line_1, source.registered_office_address.address_line_2, source.registered_office_address.locality, source.registered_office_address.postal_code, source.registered_office_address.country].filter(Boolean).join(", ");
    const facts = [
      { concept: "business_name", value: source.company_name, raw: `"company_name":"${source.company_name}"`, requested: requested.has("business_name"), schemaFieldId: requested.get("business_name")?.schemaFieldId || null, informationNeedId: requested.get("business_name")?.informationNeedId || null },
      { concept: "registered_address", value: address, raw: JSON.stringify(source.registered_office_address), requested: requested.has("registered_address"), schemaFieldId: requested.get("registered_address")?.schemaFieldId || null, informationNeedId: requested.get("registered_address")?.informationNeedId || null },
      { concept: "previous_company_names", value: source.previous_company_names.map((item) => item.name), raw: JSON.stringify(source.previous_company_names), requested: false },
      { concept: "sic_codes", value: source.sic_codes, raw: JSON.stringify(source.sic_codes), requested: false },
      { concept: "registration_number", value: source.company_number, raw: `"company_number":"${source.company_number}"`, requested: false },
      { concept: "company_status", value: source.company_status, raw: `"company_status":"${source.company_status}"`, requested: false },
      { concept: "incorporation_date", value: source.date_of_creation, raw: `"date_of_creation":"${source.date_of_creation}"`, requested: false },
      { concept: "jurisdiction", value: source.jurisdiction, raw: `"jurisdiction":"${source.jurisdiction}"`, requested: false },
      { concept: "company_type", value: source.type, raw: `"type":"${source.type}"`, requested: false },
    ].map((fact) => ({ ...fact, valueFound: true, semanticRole: "business_fact", sampled: false }));
    return { facts, requestedConceptOutcomes: requestedConcepts.map((item) => ({ concept: item.concept, status: facts.some((fact) => fact.requested && fact.concept === item.concept) ? "found" : "not_found" })), completeness: { state: "complete", limitations: [], sourceRecordCount: 1, representedRecordCount: 1 } };
  }
}

module.exports = { DeterministicProfileDiscoveryProvider, PROFILE_DISCOVERY_SOURCE };
