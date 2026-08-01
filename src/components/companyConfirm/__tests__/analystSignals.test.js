import {
  buildAnalystSignal,
  signalLines,
  isSilentToCustomer,
  hasAutomatedConsequence,
} from "../analystSignals";

const addressEvent = {
  fieldId: "addressLine1",
  fieldClass: "address",
  beforeValue: "123 Sample Street",
  afterValue: null,
  workflow: "doc_required",
  docType: "Notice of Change of Address",
  matchedRule: "ADDR-NOTREFLECTED",
  customerIntent: null,
  customerRegistryClaim: "not_reflected",
  verifiability: "structured_registry",
  decided: true,
};

const genericEvent = {
  fieldId: "tradeName",
  fieldClass: "generic",
  beforeValue: "ACME Holdings",
  afterValue: null,
  workflow: "ops_review",
  docType: null,
  matchedRule: "GENERIC",
  decided: true,
};

describe("outcome classification helpers", () => {
  it("treats only an actionable document as customer-visible", () => {
    expect(isSilentToCustomer("doc_required", "Notice of Change of Address")).toBe(false);
    expect(isSilentToCustomer("doc_required", null)).toBe(true);
    expect(isSilentToCustomer("ops_review", null)).toBe(true);
    expect(isSilentToCustomer("analyst_review", null)).toBe(true);
  });

  it("knows which workflows actually drive something", () => {
    expect(hasAutomatedConsequence("doc_required", "X")).toBe(true);
    expect(hasAutomatedConsequence("escalation", null)).toBe(true);
    expect(hasAutomatedConsequence("restart", null)).toBe(true);
    expect(hasAutomatedConsequence("ops_review", null)).toBe(false);
    expect(hasAutomatedConsequence("analyst_review", null)).toBe(false);
    expect(hasAutomatedConsequence("UNDECIDED", null)).toBe(false);
  });
});

describe("buildAnalystSignal — reads the recorded decision, invents nothing", () => {
  it("returns null with no event", () => {
    expect(buildAnalystSignal({})).toBeNull();
    expect(buildAnalystSignal({ event: null })).toBeNull();
  });

  it("classifies a document-producing change as type 1", () => {
    const s = buildAnalystSignal({ event: addressEvent });
    expect(s.type).toBe("type1");
    expect(s.workflow).toBe("doc_required");
    expect(s.docType).toBe("Notice of Change of Address");
    expect(s.matchedRule).toBe("ADDR-NOTREFLECTED");
    expect(s.silent).toBe(false);
  });

  it("classifies a generic ops_review as type 2 — no machinery behind it", () => {
    const s = buildAnalystSignal({ event: genericEvent });
    expect(s.type).toBe("type2");
    expect(s.docType).toBeNull();
    expect(s.silent).toBe(true);
  });

  it("detects the registry mismatch from the captured value", () => {
    const s = buildAnalystSignal({ event: addressEvent, correctedValue: "1 New Street" });
    expect(s.registryMismatch).toBe(true);
    expect(s.before).toBe("123 Sample Street");
    expect(s.after).toBe("1 New Street");
  });

  it("reports no mismatch before a value is captured, or when unchanged", () => {
    expect(buildAnalystSignal({ event: addressEvent }).registryMismatch).toBe(false);
    expect(
      buildAnalystSignal({ event: addressEvent, correctedValue: "123 Sample Street" }).registryMismatch
    ).toBe(false);
  });

  it("prefers the event's own afterValue over the local correction", () => {
    const s = buildAnalystSignal({
      event: { ...addressEvent, afterValue: "from event" },
      correctedValue: "from gapRef",
    });
    expect(s.after).toBe("from event");
  });

  it("takes `silent` from the engine outcome, which the event cannot carry", () => {
    const s = buildAnalystSignal({
      event: genericEvent,
      outcome: { workflow: "ops_review", silent: true, matchedRule: "GENERIC", decided: true },
    });
    expect(s.silent).toBe(true);
  });

  it("surfaces escalation and EDD from the engine result", () => {
    const s = buildAnalystSignal({
      event: { ...addressEvent, fieldClass: "pep", workflow: "escalation", docType: null },
      outcome: { workflow: "escalation", escalation: true, escalationReason: "PEP field changed", eddFlag: true, silent: true, matchedRule: "PEP-SHORTCIRCUIT", decided: true },
    });
    expect(s.type).toBe("type1");
    expect(s.escalation).toBe(true);
    expect(s.eddFlag).toBe(true);
  });
});

describe("signalLines — wording is derived, not hardcoded per row", () => {
  it("leads with the registry mismatch for a type-1 change", () => {
    const lines = signalLines(buildAnalystSignal({ event: addressEvent, correctedValue: "1 New Street" }));
    expect(lines[0]).toBe("Customer value differs from registry — flagged for analyst review.");
    expect(lines).toContain("Document required: Notice of Change of Address");
  });

  it("states the silent outcome and its rule (verifiability guard → no document, so type 2)", () => {
    const signal = buildAnalystSignal({
      event: { ...addressEvent, workflow: "analyst_review", docType: null, matchedRule: "VERIFIABILITY-GUARD" },
    });
    // analyst_review drives nothing automatically, so it is a type-2 outcome —
    // but it is still a recorded decision the customer never sees.
    expect(signal.type).toBe("type2");
    const lines = signalLines(signal);
    expect(lines.some((l) => l.includes("Silent outcome: analyst_review (customer sees nothing)"))).toBe(true);
    expect(lines.some((l) => l.includes("VERIFIABILITY-GUARD"))).toBe(true);
  });

  it("names the silent outcome when a doc_required escalates instead", () => {
    const lines = signalLines(
      buildAnalystSignal({
        event: { ...addressEvent, workflow: "edd", docType: null, matchedRule: "UBO-EDD" },
        outcome: { workflow: "edd", eddFlag: true, silent: true, matchedRule: "UBO-EDD", decided: true },
      })
    );
    expect(lines).toContain("EDD flag set.");
    expect(lines.some((l) => l.includes("Silent outcome: edd (customer sees nothing) — rule UBO-EDD"))).toBe(true);
  });

  it("says plainly when there is no automated consequence", () => {
    const lines = signalLines(buildAnalystSignal({ event: genericEvent }));
    expect(lines[0]).toBe(
      "No automated consequence for this field class (generic → ops_review, no document). This is expected — surfaced for testing."
    );
    expect(lines.some((l) => l.includes("Silent outcome: ops_review (customer sees nothing) — rule GENERIC"))).toBe(true);
  });

  it("notes a mismatch on a type-2 field without implying a consequence", () => {
    const lines = signalLines(buildAnalystSignal({ event: genericEvent, correctedValue: "New Trading Name" }));
    expect(lines.some((l) => l.includes("nothing automated follows for this class"))).toBe(true);
    expect(lines.some((l) => l.includes("flagged for analyst review"))).toBe(false);
  });

  it("flags an undecided engine result", () => {
    const lines = signalLines(
      buildAnalystSignal({ event: { ...genericEvent, workflow: "UNDECIDED", matchedRule: null, decided: false } })
    );
    expect(lines.some((l) => l.includes("UNDECIDED"))).toBe(true);
  });

  it("returns nothing for a null signal", () => {
    expect(signalLines(null)).toEqual([]);
  });
});
