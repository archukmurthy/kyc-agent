import { adoptRegistryName, registryLegalName } from "./registryName";

const registry = (legalName, registrationNumber, extra = {}) => ({
  type: "ENTITY_ATTRIBUTE", attribute: "REGISTRY_CONTEXT", value: { legalName, registrationNumber, ...extra },
});
const research = (...facts) => ({ candidateSources: [{ candidateFacts: facts }] });
const typed = { legalName: "Vodaphone LTD", registrationNumber: "01471587", countryCode: "GB" };

test("the registry's name for the case's own number is the company's name", () => {
  const result = research(
    registry("Vodafonethree Holdings Limited", "14903490", { companyType: "ltd" }),
    registry("Vodafone Limited", "01471587"),
    registry("VODAFONE LIMITED", "01471587", { companyType: "ltd" }),
  );
  expect(registryLegalName(result, typed)).toBe("VODAFONE LIMITED");
});

test("no record for the number, or no number, gives no name", () => {
  expect(registryLegalName(research(registry("Other Limited", "00000001")), typed)).toBeNull();
  expect(registryLegalName(research(registry("VODAFONE LIMITED", "01471587")), { legalName: "Vodafone" })).toBeNull();
  expect(registryLegalName(null, typed)).toBeNull();
});

test("a misspelt case takes the registry's name and keeps what was typed", () => {
  const demoCase = { demoCaseId: "case-1", company: typed };
  const adopted = adoptRegistryName({ demoCase, draft: { legalName: "Vodaphone LTD" }, researchResult: research(registry("VODAFONE LIMITED", "01471587", { companyType: "ltd" })) });
  expect(adopted.demoCase.company).toEqual(expect.objectContaining({ legalName: "VODAFONE LIMITED", enteredLegalName: "Vodaphone LTD", registrationNumber: "01471587" }));
  expect(adopted.demoCase.demoCaseId).toBe("case-1");
  expect(adopted.draft.legalName).toBe("VODAFONE LIMITED");
});

test("a name that already matches, in any case or spacing, changes nothing", () => {
  const demoCase = { demoCaseId: "case-1", company: { ...typed, legalName: "Vodafone  Limited" } };
  expect(adoptRegistryName({ demoCase, draft: {}, researchResult: research(registry("VODAFONE LIMITED", "01471587")) })).toBeNull();
});
