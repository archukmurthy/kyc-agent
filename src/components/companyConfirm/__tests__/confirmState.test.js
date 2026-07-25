import {
  ROW_STATE,
  BLOCKER_KIND,
  rowState,
  rowContext,
  isLowConfidence,
  docsNeededFrom,
  canonicalDocs,
  docKey,
  isSatisfied,
  computeConfirmCounts,
  submitBlockers,
  blockerSummary,
} from "../confirmState";

const verified = { field: "companyNumber", label: "Company Number", verificationStatus: "verified" };
const probable = { field: "leiNumber", label: "LEI Number", verificationStatus: "probable" };
const indicative = { field: "employees", label: "Employees", verificationStatus: "indicative" };
const address = { field: "addressLine1", label: "Registered Address Line 1", verificationStatus: "verified" };

const DOC = { fieldId: "addressLine1", docType: "Notice of Change of Address" };
const uploaded = { name: "proof.pdf", blobUrl: "https://blob/x", uploadFailed: false };
const failedUpload = { name: "proof.pdf", blobUrl: null, uploadFailed: true };

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

describe("canonicalDocs", () => {
  it("unions sources and collapses to one entry per docType", () => {
    const persisted = [DOC];
    const live = [
      { fieldId: "addressLine2", docType: "Notice of Change of Address" }, // same real doc
      { fieldId: "companyNumber", docType: "Supporting Registration Document" },
    ];
    const out = canonicalDocs(persisted, live);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ fieldId: "addressLine1", docType: "Notice of Change of Address" });
    expect(out[1].docType).toBe("Supporting Registration Document");
  });

  it("ignores entries with no docType and tolerates missing sources", () => {
    expect(canonicalDocs(null, [{ fieldId: "x" }], undefined)).toEqual([]);
  });
});

describe("isSatisfied", () => {
  it("counts a stored upload, never a failed one", () => {
    expect(isSatisfied(uploaded)).toBe(true);
    expect(isSatisfied(failedUpload)).toBe(false);
    expect(isSatisfied(undefined)).toBe(false);
  });
});

describe("docsNeededFrom", () => {
  it("reads doc_required classifications out of the dialogue snapshots", () => {
    expect(
      docsNeededFrom({
        addressLine1: { emitted: true, event: { workflow: "doc_required", docType: "Notice of Change of Address" } },
        tradeName: { emitted: true, event: { workflow: "ops_review", docType: null } },
        website: { emitted: false },
      })
    ).toEqual([{ fieldId: "addressLine1", docType: "Notice of Change of Address", fieldClass: null }]);
  });
});

describe("submitBlockers", () => {
  it("opens the gate when nothing needs the customer", () => {
    const blockers = submitBlockers({ found: [verified], checks: { 0: true } });
    expect(blockers).toEqual([]);
  });

  it("(a) blocks an untouched low-confidence row, and never a high-confidence one", () => {
    const blockers = submitBlockers({ found: [verified, probable], checks: { 0: true, 1: true } });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: BLOCKER_KIND.ATTENTION_ROW, fieldId: "leiNumber" });
  });

  it("(a) clears when the customer ticks it", () => {
    const blockers = submitBlockers({
      found: [probable], checks: { 0: true }, affirmed: { leiNumber: true },
    });
    expect(blockers).toEqual([]);
  });

  it("(a) clears when the customer corrects it instead", () => {
    const blockers = submitBlockers({
      found: [probable], checks: { 0: true }, corrections: { corrected_leiNumber: "X1234" },
    });
    expect(blockers).toEqual([]);
  });

  it("(a) blocks a crossed row until its correction is supplied", () => {
    expect(submitBlockers({ found: [address], checks: { 0: false } })).toHaveLength(1);
    expect(
      submitBlockers({ found: [address], checks: { 0: false }, corrections: { corrected_addressLine1: "1 New St" } })
    ).toEqual([]);
  });

  it("(b) a CORRECTED document-triggering field still blocks until the upload lands", () => {
    const base = {
      found: [address],
      checks: { 0: false },
      corrections: { corrected_addressLine1: "1 New St" }, // (a) satisfied
      docs: [DOC],
    };
    // Correcting resolves the row but NOT the document — the compliance rule.
    const blocked = submitBlockers({ ...base, uploads: {} });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ kind: BLOCKER_KIND.MISSING_DOCUMENT, label: DOC.docType });

    // Uploading clears it.
    expect(submitBlockers({ ...base, uploads: { [docKey(DOC)]: uploaded } })).toEqual([]);
  });

  it("(b) treats a failed upload as still missing", () => {
    const blockers = submitBlockers({
      found: [], docs: [DOC], uploads: { [docKey(DOC)]: failedUpload },
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].kind).toBe(BLOCKER_KIND.MISSING_DOCUMENT);
  });

  it("(b) asks for one document once even when two fields trigger it", () => {
    const blockers = submitBlockers({
      found: [],
      docs: [DOC, { fieldId: "addressLine2", docType: "Notice of Change of Address" }],
      uploads: {},
    });
    expect(blockers).toHaveLength(1);
  });

  it("(b) stops blocking when the document drops off the derived list", () => {
    // A revert / reason-flip removes the doc from the derived list entirely.
    expect(submitBlockers({ found: [], docs: [], uploads: {} })).toEqual([]);
  });

  it("(c) blocks an empty required gap and clears when filled", () => {
    const gaps = [{ field: "corrected_vat", label: "VAT number" }];
    expect(submitBlockers({ found: [], requiredGaps: gaps })).toHaveLength(1);
    expect(submitBlockers({ found: [], requiredGaps: gaps })[0].kind).toBe(BLOCKER_KIND.EMPTY_REQUIRED_GAP);
    expect(
      submitBlockers({ found: [], requiredGaps: gaps, corrections: { corrected_vat: "GB1" } })
    ).toEqual([]);
  });

  it("reports all three kinds together", () => {
    const blockers = submitBlockers({
      found: [probable],
      checks: { 0: true },
      docs: [DOC],
      uploads: {},
      requiredGaps: [{ field: "corrected_vat", label: "VAT number" }],
    });
    expect(blockers.map((b) => b.kind).sort()).toEqual(
      [BLOCKER_KIND.ATTENTION_ROW, BLOCKER_KIND.EMPTY_REQUIRED_GAP, BLOCKER_KIND.MISSING_DOCUMENT].sort()
    );
  });
});

describe("rows form — original indices survive a filtered subset", () => {
  // The vital-row table renders a SUBSET of research.found (stakeholder fields
  // render as person cards). `checks` stays keyed by the original index, so the
  // gate must be fed {item, idx} pairs — re-indexing would read the wrong row.
  const found = [probable, { field: "directors", label: "Directors", verificationStatus: "probable" }, indicative];
  const vitalRows = [{ item: found[0], idx: 0 }, { item: found[2], idx: 2 }];

  it("excludes non-gate-eligible rows without shifting the checks lookup", () => {
    // idx 2 (indicative) is crossed; idx 1 (the stakeholder field) is untouched.
    const state = { rows: vitalRows, checks: { 0: true, 1: true, 2: false }, affirmed: { leiNumber: true } };
    const blockers = submitBlockers(state);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ fieldId: "employees", kind: BLOCKER_KIND.ATTENTION_ROW });
    // The stakeholder field never appears, even though it is low-confidence.
    expect(blockers.some((b) => b.fieldId === "directors")).toBe(false);
    expect(computeConfirmCounts(state).needsYou).toBe(1);
  });
});

describe("alignment — the gate, the tile and the amber styling are one set", () => {
  // The row renderer marks a row amber when rowState(...rowContext(...)) is
  // NEEDS_YOU; the tile counts the same; the gate lists the same as kind (a).
  // This asserts they cannot drift apart.
  const found = [verified, probable, indicative, address];
  const state = {
    found,
    checks: { 0: true, 1: true, 2: true, 3: false },
    affirmed: {},
    corrections: {},
  };

  it("kind (a) fieldIds === rows the renderer styles === the Needs You count", () => {
    const rendererMarks = found
      .filter((item, idx) => rowState(item, rowContext(item, idx, state)) === ROW_STATE.NEEDS_YOU)
      .map((i) => i.field);
    const gateMarks = submitBlockers(state)
      .filter((b) => b.kind === BLOCKER_KIND.ATTENTION_ROW)
      .map((b) => b.fieldId);
    const tileCount = computeConfirmCounts(state).needsYou;

    expect(gateMarks).toEqual(rendererMarks);
    expect(tileCount).toBe(rendererMarks.length);
  });

  it("stays aligned after the customer acts", () => {
    const acted = {
      ...state,
      affirmed: { leiNumber: true },
      corrections: { corrected_addressLine1: "1 New St" },
    };
    const rendererMarks = found
      .filter((item, idx) => rowState(item, rowContext(item, idx, acted)) === ROW_STATE.NEEDS_YOU)
      .map((i) => i.field);
    const gateMarks = submitBlockers(acted)
      .filter((b) => b.kind === BLOCKER_KIND.ATTENTION_ROW)
      .map((b) => b.fieldId);
    expect(gateMarks).toEqual(rendererMarks);
    expect(rendererMarks).toEqual(["employees"]);
    expect(computeConfirmCounts(acted).needsYou).toBe(1);
  });
});

describe("computeConfirmCounts", () => {
  const found = [verified, probable, indicative, { field: "tradeName", verificationStatus: "verified" }];

  it("counts the four tiles from the same predicate", () => {
    const counts = computeConfirmCounts({
      found,
      checks: { 0: true, 1: true, 2: true, 3: false },
      affirmed: { leiNumber: true },
      corrections: { corrected_tradeName: "ACME Trading Ltd" },
      docs: [DOC],
      uploads: {},
    });
    expect(counts).toMatchObject({ needsYou: 1, confirmed: 2, corrected: 1, docsNeeded: 1 });
  });

  it("drops docsNeeded to zero once the upload is stored", () => {
    const counts = computeConfirmCounts({ found: [], docs: [DOC], uploads: { [docKey(DOC)]: uploaded } });
    expect(counts.docsNeeded).toBe(0);
    expect(counts.docsTotal).toBe(1);
  });

  it("treats a missing checks entry as ticked (rows arrive pre-ticked)", () => {
    expect(computeConfirmCounts({ found: [verified], checks: {} }).confirmed).toBe(1);
  });
});

describe("blockerSummary — the button always says what's wrong", () => {
  it("is null when nothing blocks", () => {
    expect(blockerSummary([])).toBeNull();
  });

  it("names items alone", () => {
    expect(blockerSummary(submitBlockers({ found: [probable, indicative], checks: {} })))
      .toBe("2 items need your input");
  });

  it("names documents alone", () => {
    expect(blockerSummary(submitBlockers({ found: [], docs: [DOC], uploads: {} })))
      .toBe("1 document needed");
  });

  it("combines both kinds compactly", () => {
    const blockers = submitBlockers({ found: [probable], checks: {}, docs: [DOC], uploads: {} });
    expect(blockerSummary(blockers)).toBe("1 item · 1 document needed");
  });
});
