import {
  ROW_STATE,
  rowState,
  isLowConfidence,
  docsNeededFrom,
  computeConfirmCounts,
  submitBlockers,
} from "../confirmState";

const verified = { field: "companyNumber", verificationStatus: "verified" };
const probable = { field: "leiNumber", verificationStatus: "probable" };
const indicative = { field: "employees", verificationStatus: "indicative" };

describe("isLowConfidence", () => {
  it("treats probable/indicative as low confidence and verified as not", () => {
    expect(isLowConfidence(probable)).toBe(true);
    expect(isLowConfidence(indicative)).toBe(true);
    expect(isLowConfidence(verified)).toBe(false);
  });

  it("falls back to sourceTier when verificationStatus is absent", () => {
    expect(isLowConfidence({ sourceTier: "tier2" })).toBe(true);
    expect(isLowConfidence({ sourceTier: "tier3" })).toBe(true);
    expect(isLowConfidence({ sourceTier: "tier1" })).toBe(false);
    expect(isLowConfidence({ sourceTier: "document" })).toBe(false);
  });
});

describe("rowState", () => {
  it("is confirmed for a ticked high-confidence row", () => {
    expect(rowState(verified, { checked: true })).toBe(ROW_STATE.CONFIRMED);
  });

  it("needs you for a low-confidence row until it is affirmed", () => {
    expect(rowState(probable, { checked: true, affirmed: false })).toBe(ROW_STATE.NEEDS_YOU);
    expect(rowState(probable, { checked: true, affirmed: true })).toBe(ROW_STATE.CONFIRMED);
  });

  it("needs you for a disputed row with no corrected value yet", () => {
    expect(rowState(verified, { checked: false })).toBe(ROW_STATE.NEEDS_YOU);
    expect(rowState(verified, { checked: false, correction: "   " })).toBe(ROW_STATE.NEEDS_YOU);
  });

  it("is corrected once a value is saved — regardless of confidence or tick", () => {
    expect(rowState(verified, { checked: false, correction: "new" })).toBe(ROW_STATE.CORRECTED);
    expect(rowState(probable, { checked: true, correction: "new" })).toBe(ROW_STATE.CORRECTED);
  });
});

describe("docsNeededFrom", () => {
  const docSnap = {
    emitted: true,
    event: { workflow: "doc_required", docType: "Notice of Change of Address" },
  };

  it("counts a doc_required classification once per document type", () => {
    expect(docsNeededFrom({ addressLine1: docSnap, addressLine2: docSnap })).toEqual([
      { fieldId: "addressLine1", docType: "Notice of Change of Address" },
    ]);
  });

  it("ignores non-doc outcomes and snapshots with no event", () => {
    expect(
      docsNeededFrom({
        tradeName: { emitted: true, event: { workflow: "ops_review", docType: null } },
        website: { emitted: false },
        vat: {},
      })
    ).toEqual([]);
  });
});

describe("computeConfirmCounts", () => {
  const found = [verified, probable, indicative, { field: "tradeName", verificationStatus: "verified" }];

  it("defaults to everything-confirmed except unaffirmed low-confidence rows", () => {
    const counts = computeConfirmCounts({ found, checks: { 0: true, 1: true, 2: true, 3: true } });
    expect(counts).toMatchObject({ needsYou: 2, confirmed: 2, corrected: 0, docsNeeded: 0 });
  });

  it("moves a row out of needsYou when affirmed, and into corrected when saved", () => {
    const counts = computeConfirmCounts({
      found,
      checks: { 0: true, 1: true, 2: true, 3: false },
      affirmed: { leiNumber: true },
      corrections: { corrected_tradeName: "ACME Trading Ltd" },
    });
    // lei affirmed -> confirmed; employees still needs you; tradeName corrected
    expect(counts).toMatchObject({ needsYou: 1, confirmed: 2, corrected: 1 });
  });

  it("counts a disputed row with no value as needsYou", () => {
    const counts = computeConfirmCounts({ found, checks: { 0: false, 1: true, 2: true, 3: true } });
    expect(counts.needsYou).toBe(3); // disputed + two unaffirmed low-confidence
  });

  it("treats a missing checks entry as ticked (rows arrive pre-ticked)", () => {
    expect(computeConfirmCounts({ found: [verified], checks: {} }).confirmed).toBe(1);
  });

  it("reports docsNeeded from the dialogue snapshots", () => {
    const counts = computeConfirmCounts({
      found,
      dialogueState: {
        addressLine1: { emitted: true, event: { workflow: "doc_required", docType: "Notice of Change of Address" } },
      },
    });
    expect(counts.docsNeeded).toBe(1);
    expect(counts.docs[0].docType).toBe("Notice of Change of Address");
  });
});

describe("submitBlockers (the gate's reasons — commit 4 consumes this)", () => {
  it("is empty when nothing needs the customer", () => {
    expect(submitBlockers({ needsYou: 0, docsNeeded: 0 })).toEqual([]);
  });

  it("reports outstanding items and documents", () => {
    expect(submitBlockers({ needsYou: 2, docsNeeded: 1 })).toEqual([
      { kind: "needs_you", count: 2 },
      { kind: "docs_needed", count: 1 },
    ]);
  });
});
