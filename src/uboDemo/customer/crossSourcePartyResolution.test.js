import {
  buildAiPartyMatchCandidates,
  buildPartyStructuralContexts,
  normalizedLegalName,
  partyFingerprint,
  partyPairKey,
  resolveCrossSourceParty,
} from "./crossSourcePartyResolution";

const party = (name, extra = {}) => ({ name, entityType: "LEGAL_ENTITY", jurisdiction: "GB", ...extra });
const relationship = (subject, object) => ({ type: "RELATIONSHIP", relationship: "ECONOMIC_OWNERSHIP", subject, object });

test("legal-name normalization covers suffix, punctuation, case and joined-word variants", () => {
  expect(normalizedLegalName("Vodafone Holdings Limited").compactBase).toBe(normalizedLegalName("vodafone holdings ltd.").compactBase);
  expect(normalizedLegalName("Vodafonethree Holdings Limited").compactBase).toBe(normalizedLegalName("Vodafone Three Holdings Ltd").compactBase);
  expect(normalizedLegalName("Vodafone International Operations Limited").compactBase).toBe(normalizedLegalName("Vodafone International Operations Ltd").compactBase);
});

test("trusted identifiers win while conflicting identifiers fail closed", () => {
  const identifier = (value) => [{ namespace: "COMPANIES_HOUSE", value }];
  const same = resolveCrossSourceParty({ sourcePartyA: party("Name A", { externalIdentifiers: identifier("00123456") }), sourcePartyB: party("Name B", { externalIdentifiers: identifier("00123456") }) });
  const different = resolveCrossSourceParty({ sourcePartyA: party("Same Name", { externalIdentifiers: identifier("00123456") }), sourcePartyB: party("Same Name", { externalIdentifiers: identifier("00999999") }) });
  expect(same).toEqual(expect.objectContaining({ identityResolutionMethod: "TRUSTED_IDENTIFIER", autoLinked: true, confidence: 1 }));
  expect(different).toEqual(expect.objectContaining({ classification: "DIFFERENT_ENTITY", autoLinked: false }));
});

test("structural context can resolve a unique compatible alias without overwriting source names", () => {
  const researchOwner = party("Example International Holdings Limited");
  const chartOwner = party("Example Intl Holdings Ltd");
  const targetA = party("Target Company Limited");
  const targetB = party("Target Company Ltd");
  const research = [relationship(researchOwner, targetA)];
  const chart = [relationship(chartOwner, targetB)];
  const researchContexts = buildPartyStructuralContexts(research);
  const chartContexts = buildPartyStructuralContexts(chart);
  const resolved = resolveCrossSourceParty({
    sourcePartyA: researchOwner,
    sourcePartyB: chartOwner,
    structuralContextA: researchContexts.get(partyFingerprint(researchOwner)),
    structuralContextB: chartContexts.get(partyFingerprint(chartOwner)),
  });
  expect(resolved.identityResolutionMethod).toBe("STRUCTURAL_CONTEXT");
  expect(resolved.autoLinked).toBe(true);
  expect(researchOwner.name).toBe("Example International Holdings Limited");
  expect(chartOwner.name).toBe("Example Intl Holdings Ltd");
});

test("bounded AI outcomes auto-link only high-confidence supported matches", () => {
  const left = party("Example Global Holdings Limited");
  const right = party("Example Global Holdco Ltd");
  const candidateId = partyPairKey(left, right);
  const high = resolveCrossSourceParty({ sourcePartyA: left, sourcePartyB: right, aiResolutions: [{ candidateId, classification: "LIKELY_SAME_ENTITY", confidence: 0.94, reasons: ["same registry context"] }] });
  const medium = resolveCrossSourceParty({ sourcePartyA: left, sourcePartyB: right, aiResolutions: [{ candidateId, classification: "LIKELY_SAME_ENTITY", confidence: 0.72, reasons: ["name resembles"] }] });
  expect(high).toEqual(expect.objectContaining({ identityResolutionMethod: "AI_ASSISTED", autoLinked: true, confidence: 0.94 }));
  expect(medium).toEqual(expect.objectContaining({ identityResolutionMethod: "AI_ASSISTED", autoLinked: false, confidence: 0.72 }));
});

test("AI candidate generation excludes deterministic matches and incompatible legal forms", () => {
  const targetResearch = party("Target Company Limited");
  const targetChart = party("Target Company Ltd");
  const research = [relationship(party("Example International Holdings Limited"), targetResearch)];
  const chart = [relationship(party("Example Global Holdings Ltd"), targetChart)];
  const candidates = buildAiPartyMatchCandidates(research, chart);
  expect(candidates.some(({ sourcePartyA, sourcePartyB }) => sourcePartyA.name === "Target Company Limited" && sourcePartyB.name === "Target Company Ltd")).toBe(false);
  expect(candidates.length).toBeLessThanOrEqual(20);
});
