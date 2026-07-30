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
  isCompanyWideDocType,
  isPerFieldDocType,
  canonicalDocType,
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

describe("scope-aware document dedup (6a) — identity evidence is per person", () => {
  const johnDob = { fieldId: "ubo::sh_john::dob", docType: "Proof of Identity", personName: "John Smith" };
  const johnNat = { fieldId: "ubo::sh_john::nationality", docType: "Proof of Identity", personName: "John Smith" };
  const janeNat = { fieldId: "ubo::sh_jane::nationality", docType: "Proof of Identity", personName: "Jane Doe" };
  const addr1 = { fieldId: "addressLine1", docType: "Notice of Change of Address" };
  const addr2 = { fieldId: "addressLine2", docType: "Notice of Change of Address" };

  it("two people each needing a POI produce TWO entries, not one", () => {
    const docs = canonicalDocs([johnDob, janeNat]);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.stakeholderId)).toEqual(["sh_john", "sh_jane"]);
  });

  it("one person, two attributes both triggering POI, produce ONE entry", () => {
    const docs = canonicalDocs([johnDob, johnNat]);
    expect(docs).toHaveLength(1);
    expect(docs[0].stakeholderId).toBe("sh_john");
  });

  it("a company document triggered by several fields still collapses to one", () => {
    const docs = canonicalDocs([addr1, addr2]);
    expect(docs).toHaveLength(1);
    expect(docs[0].stakeholderId).toBeNull();
  });

  it("keeps company and person documents of different types apart", () => {
    const docs = canonicalDocs([johnDob, janeNat, addr1, addr2]);
    expect(docs).toHaveLength(3);
  });

  it("keys person uploads by (person, docType) and company uploads by docType", () => {
    expect(docKey(johnDob)).toBe("sh_john::Proof of Identity");
    expect(docKey(johnNat)).toBe("sh_john::Proof of Identity"); // same person, same doc
    expect(docKey(janeNat)).toBe("sh_jane::Proof of Identity"); // different person
    // No fieldId in either form: which field lands in the canonical entry
    // depends on list order, which differs between Confirm and Fill Gaps.
    expect(docKey(addr1)).toBe("company::Notice of Change of Address");
    expect(docKey(addr2)).toBe(docKey(addr1));
  });

  /**
   * THE REGRESSION TEST for the P1 defect. On commit 6 the dedupe key was the
   * docType alone, so one uploaded Proof of Identity satisfied every person's
   * POI and the gate opened while the database still owed documents.
   */
  it("UPLOAD ISOLATION: person A's upload never satisfies person B's document", () => {
    const docs = canonicalDocs([johnDob, johnNat, janeNat]);
    expect(docs).toHaveLength(2); // John's POI + Jane's POI

    // Upload ONLY John's.
    const uploads = { [docKey(johnDob)]: { name: "john-poi.pdf", uploadFailed: false } };

    const blockers = submitBlockers({ found: [], docs, uploads });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].kind).toBe(BLOCKER_KIND.MISSING_DOCUMENT);
    expect(blockers[0].stakeholderId).toBe("sh_jane");
    expect(blockers[0].label).toContain("Jane Doe");

    // The counts agree with the gate.
    const counts = computeConfirmCounts({ found: [], docs, uploads });
    expect(counts.docsNeeded).toBe(1);
    expect(counts.docsTotal).toBe(2);

    // Uploading Jane's as well clears it.
    const both = { ...uploads, [docKey(janeNat)]: { name: "jane-poi.pdf", uploadFailed: false } };
    expect(submitBlockers({ found: [], docs, uploads: both })).toEqual([]);
    expect(computeConfirmCounts({ found: [], docs, uploads: both }).docsNeeded).toBe(0);
  });

  it("a failed upload does not satisfy that person either", () => {
    const docs = canonicalDocs([johnDob]);
    const uploads = { [docKey(johnDob)]: { name: "x.pdf", uploadFailed: true } };
    expect(submitBlockers({ found: [], docs, uploads })).toHaveLength(1);
  });

  it("labels a person document with the person and leaves company docs unnamed", () => {
    const docs = canonicalDocs([janeNat, addr1]);
    const blockers = submitBlockers({ found: [], docs, uploads: {} });
    expect(blockers.find((b) => b.stakeholderId === "sh_jane").label).toBe("Proof of Identity — Jane Doe");
    expect(blockers.find((b) => !b.stakeholderId).label).toBe("Notice of Change of Address");
  });
});

/**
 * THE REGRESSION TEST for the company-wide-document defect. Scope used to be
 * read off the fieldId alone, so a document triggered by a person BECAME
 * per-person — removing two UBOs opened two Ownership Chart requests for the
 * one chart that exists, and uploading it once could not close the other.
 * Scope is a property of the DOCUMENT; the trigger only says who asked.
 */
describe("company-wide documents are ONE request however many people trigger them", () => {
  const johnRemoval = { fieldId: "ubo::sh_john::removal", docType: "Ownership Chart", personName: "John Smith" };
  const janeRemoval = { fieldId: "ubo::sh_jane::removal", docType: "Ownership Chart", personName: "Jane Doe" };
  const johnDirList = { fieldId: "director::sh_john::removal", docType: "List of Directors", personName: "John Smith" };
  const janeDirList = { fieldId: "director::sh_jane::removal", docType: "List of Directors", personName: "Jane Doe" };
  const janePoi = { fieldId: "ubo::sh_jane::nationality", docType: "Proof of Identity", personName: "Jane Doe" };

  it("two UBO removals produce ONE ownership chart request", () => {
    const docs = canonicalDocs([johnRemoval, janeRemoval]);
    expect(docs).toHaveLength(1);
    expect(docs[0].docType).toBe("Ownership Chart");
  });

  it("the single chart belongs to nobody — it is not labelled with a person", () => {
    const docs = canonicalDocs([johnRemoval, janeRemoval]);
    expect(docs[0].stakeholderId).toBeNull();
    expect(docs[0].personName).toBeNull();
    const blockers = submitBlockers({ found: [], docs, uploads: {} });
    expect(blockers[0].label).toBe("Ownership Chart"); // not "— John Smith"
  });

  it("uploading it once closes it for everyone", () => {
    const docs = canonicalDocs([johnRemoval, janeRemoval]);
    const uploads = { [docKey(johnRemoval)]: { name: "chart.pdf", uploadFailed: false } };
    expect(submitBlockers({ found: [], docs, uploads })).toEqual([]);
    expect(computeConfirmCounts({ found: [], docs, uploads }).docsNeeded).toBe(0);
  });

  it("the key does not depend on WHICH person triggered it", () => {
    expect(docKey(johnRemoval)).toBe("company::Ownership Chart");
    expect(docKey(janeRemoval)).toBe(docKey(johnRemoval));
    // Order of the source list must not change the satisfaction key either.
    expect(docKey(canonicalDocs([johnRemoval, janeRemoval])[0]))
      .toBe(docKey(canonicalDocs([janeRemoval, johnRemoval])[0]));
  });

  it("the same holds for List of Directors", () => {
    const docs = canonicalDocs([johnDirList, janeDirList]);
    expect(docs).toHaveLength(1);
    const uploads = { [docKey(janeDirList)]: { name: "directors.pdf", uploadFailed: false } };
    expect(submitBlockers({ found: [], docs, uploads })).toEqual([]);
  });

  /** The fix must NOT loosen identity evidence — that was the earlier P1. */
  it("does not make identity evidence company-wide by accident", () => {
    const docs = canonicalDocs([johnRemoval, janeRemoval, janePoi]);
    expect(docs).toHaveLength(2); // one chart + Jane's POI
    // Uploading the chart leaves Jane's POI standing.
    const uploads = { [docKey(johnRemoval)]: { name: "chart.pdf", uploadFailed: false } };
    const blockers = submitBlockers({ found: [], docs, uploads });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].stakeholderId).toBe("sh_jane");
    expect(blockers[0].label).toBe("Proof of Identity — Jane Doe");
  });

  it("an unknown person-triggered docType stays per-person (fail-safe default)", () => {
    const a = { fieldId: "ubo::sh_john::something", docType: "Some New Identity Document" };
    const b = { fieldId: "ubo::sh_jane::something", docType: "Some New Identity Document" };
    expect(canonicalDocs([a, b])).toHaveLength(2);
    expect(docKey(a)).not.toBe(docKey(b));
  });
});

/**
 * Two rule paths, one real filing. A company-level director edit emits
 * 'Updated Director Registry'; a person-level removal emits 'List of
 * Directors'. Doing both asked the customer for the same document twice.
 * Merged in the presentation layer only — the policy table and the audit
 * trail keep the precise rule-level name.
 */
describe("aliased document types collapse to one request", () => {
  const companyDirEdit = { fieldId: "directors", docType: "Updated Director Registry" };
  const personDirRemoval = { fieldId: "director::sh_jane::removal", docType: "List of Directors", personName: "Jane Doe" };
  const companyUboEdit = { fieldId: "ubo_list", docType: "Updated UBO Registry" };
  const personUboRemoval = { fieldId: "ubo::sh_john::removal", docType: "Ownership Chart", personName: "John Smith" };

  it("merges the director pair into one request under the plain-English name", () => {
    const docs = canonicalDocs([companyDirEdit, personDirRemoval]);
    expect(docs).toHaveLength(1);
    expect(docs[0].docType).toBe("List of Directors");
  });

  it("merges the UBO pair into one request", () => {
    const docs = canonicalDocs([companyUboEdit, personUboRemoval]);
    expect(docs).toHaveLength(1);
    expect(docs[0].docType).toBe("Ownership Chart");
  });

  it("an upload against either name satisfies both", () => {
    const docs = canonicalDocs([companyDirEdit, personDirRemoval]);
    expect(docKey(companyDirEdit)).toBe(docKey(personDirRemoval));
    const uploads = { [docKey(companyDirEdit)]: { name: "directors.pdf", uploadFailed: false } };
    expect(submitBlockers({ found: [], docs, uploads })).toEqual([]);
  });

  it("the merge does not drag unrelated types together", () => {
    const docs = canonicalDocs([
      personDirRemoval,
      personUboRemoval,
      { fieldId: "ubo::sh_john::nationality", docType: "Proof of Identity", personName: "John Smith" },
    ]);
    expect(docs.map((d) => d.docType).sort()).toEqual([
      "List of Directors", "Ownership Chart", "Proof of Identity",
    ]);
  });

  it("an aliased name is still recognised as company-wide", () => {
    expect(isCompanyWideDocType("Updated Director Registry")).toBe(true);
    expect(isCompanyWideDocType("Updated UBO Registry")).toBe(true);
    expect(isCompanyWideDocType("Proof of Identity")).toBe(false);
    expect(canonicalDocType("Notice of Change of Address")).toBe("Notice of Change of Address");
  });
});

/**
 * 'Supporting Registration Document' is one placeholder name (policy table open
 * question O3) standing in for BRN / VAT / licence documents. Different filings
 * wearing one name must NOT collapse into a single upload — decided with
 * Archana 2026-07-30: over-collect rather than under-collect.
 */
describe("per-field placeholder documents do not collapse", () => {
  const brn = { fieldId: "companyNumber", docType: "Supporting Registration Document", fieldLabel: "Companies House Number" };
  const vat = { fieldId: "vatNumber", docType: "Supporting Registration Document", fieldLabel: "VAT Number" };

  it("two registration fields produce TWO requests", () => {
    const docs = canonicalDocs([brn, vat]);
    expect(docs).toHaveLength(2);
  });

  it("keys them apart so one upload cannot satisfy the other", () => {
    expect(docKey(brn)).not.toBe(docKey(vat));
    const docs = canonicalDocs([brn, vat]);
    const uploads = { [docKey(brn)]: { name: "brn.pdf", uploadFailed: false } };
    const blockers = submitBlockers({ found: [], docs, uploads });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].label).toBe("Supporting Registration Document — VAT Number");
  });

  it("the same field asking twice is still one request", () => {
    expect(canonicalDocs([brn, { ...brn }])).toHaveLength(1);
  });

  it("is not treated as company-wide", () => {
    expect(isCompanyWideDocType("Supporting Registration Document")).toBe(false);
    expect(isPerFieldDocType("Supporting Registration Document")).toBe(true);
    expect(isPerFieldDocType("Ownership Chart")).toBe(false);
  });

  it("company-wide documents still collapse — the split is scoped to O3 only", () => {
    const a = { fieldId: "addressLine1", docType: "Notice of Change of Address" };
    const b = { fieldId: "addressLine2", docType: "Notice of Change of Address" };
    expect(canonicalDocs([a, b])).toHaveLength(1);
  });
});

describe("an ADDED person's documents are per-person too (commit 7 × 6a)", () => {
  const existingPoi = { fieldId: "ubo::sh_existing::nationality", docType: "Proof of Identity", personName: "John Smith" };
  const addedPoi = { fieldId: "ubo::sh_added::added_poi", docType: "Proof of Identity", personName: "Priya Raman" };
  const addedPoa = { fieldId: "ubo::sh_added::added_poa", docType: "Proof of Address", personName: "Priya Raman" };
  const addedChart = { fieldId: "ubo::sh_added::added", docType: "Ownership Chart", personName: "Priya Raman" };

  it("does not collapse an added person's POI into an existing person's POI", () => {
    const docs = canonicalDocs([existingPoi, addedPoi]);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.stakeholderId).sort()).toEqual(["sh_added", "sh_existing"]);
  });

  it("uploading the existing person's POI leaves the added person's outstanding", () => {
    const docs = canonicalDocs([existingPoi, addedPoi]);
    const uploads = { [docKey(existingPoi)]: { name: "john.pdf", uploadFailed: false } };
    const blockers = submitBlockers({ found: [], docs, uploads });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].stakeholderId).toBe("sh_added");
    expect(blockers[0].label).toContain("Priya Raman");
  });

  it("an added UBO's three documents are three separate requests", () => {
    const docs = canonicalDocs([addedChart, addedPoi, addedPoa]);
    expect(docs.map((d) => d.docType).sort()).toEqual([
      "Ownership Chart", "Proof of Address", "Proof of Identity",
    ]);
    expect(submitBlockers({ found: [], docs, uploads: {} })).toHaveLength(3);
  });

  it("the added person's own POI and POA do not collapse into each other", () => {
    expect(docKey(addedPoi)).not.toBe(docKey(addedPoa));
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
