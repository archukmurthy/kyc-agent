import { allCandidateFacts } from "./customer/caseResolution";

function normalized(value) { return String(value || "").trim().toUpperCase().replace(/\s+/g, " "); }
function registrationKey(value) { return String(value || "").trim().toUpperCase().replace(/\s+/g, ""); }

/**
 * The company's legal name as the registry records it, for the case's own
 * registration number - or null when the research has no such record.
 *
 * The case starts from what the analyst typed. A misspelling ("Vodaphone LTD"
 * for VODAFONE LIMITED) then made the customer's chart describe a different
 * company: its owners were "not in the chart" and nobody qualified (found in
 * the end-to-end check, 2026-10-04). The registry is the authority on the name.
 */
export function registryLegalName(researchResult, company) {
  const number = registrationKey(company?.registrationNumber);
  if (!number || !researchResult) return null;
  const records = allCandidateFacts(researchResult)
    .map((entry) => entry?.fact || entry)
    .filter((fact) => fact?.type === "ENTITY_ATTRIBUTE" && fact.attribute === "REGISTRY_CONTEXT"
      && registrationKey(fact.value?.registrationNumber) === number && String(fact.value?.legalName || "").trim());
  // The registry's own profile (it carries the company type) before a
  // secondary source quoting it.
  const record = records.find((fact) => fact.value.companyType) || records[0];
  return record ? String(record.value.legalName).trim() : null;
}

/** The case and draft carrying the registry's name, keeping what was typed;
 *  null when the name already matches or the registry has no record. */
export function adoptRegistryName({ demoCase, draft, researchResult }) {
  const official = registryLegalName(researchResult, demoCase?.company);
  if (!official || normalized(official) === normalized(demoCase.company.legalName)) return null;
  const enteredLegalName = demoCase.company.enteredLegalName || demoCase.company.legalName;
  return {
    demoCase: { ...demoCase, company: { ...demoCase.company, legalName: official, enteredLegalName } },
    draft: { ...draft, legalName: official },
  };
}
