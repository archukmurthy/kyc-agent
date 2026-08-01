const { ownershipCrossing, parsePercentage } = require("../ownershipCrossing");
const { classifyChange } = require("../classifyChange");

const person = (over = {}) => ({
  personScope: true,
  personType: "ubo",
  attribute: "ownership_pct",
  ...over,
});

describe("parsePercentage — a point value, or nothing", () => {
  it("reads the shapes research actually returns", () => {
    expect(parsePercentage("35%")).toBe(35);
    expect(parsePercentage("35")).toBe(35);
    expect(parsePercentage(35)).toBe(35);
    expect(parsePercentage("35.5%")).toBe(35.5);
  });

  it("refuses a band or a qualifier rather than picking a number out of it", () => {
    ["25-50%", "25 – 50%", "25 to 50%", "Over 25%", "More than 25%", "at least 25%", "~25%"]
      .forEach((v) => expect(parsePercentage(v)).toBeNull());
  });

  it("refuses nonsense and out-of-range values", () => {
    [null, undefined, "", "  ", "n/a", "150%", "-5"].forEach((v) =>
      expect(parsePercentage(v)).toBeNull()
    );
  });
});

describe("ownershipCrossing — the 25% UBO threshold", () => {
  it("detects a UBO dropping below the threshold", () => {
    expect(ownershipCrossing("35%", "15%")).toBe("crossed_below");
    expect(ownershipCrossing(25, 24.9)).toBe("crossed_below");
  });

  it("detects someone BECOMING a UBO", () => {
    expect(ownershipCrossing("15%", "35%")).toBe("crossed_above");
    expect(ownershipCrossing(24.9, 25)).toBe("crossed_above");
  });

  it("reports no crossing when both sides sit on the same side", () => {
    expect(ownershipCrossing("40%", "30%")).toBe("none");
    expect(ownershipCrossing("10%", "20%")).toBe("none");
    expect(ownershipCrossing("25%", "25%")).toBe("none");
  });

  it("stays UNKNOWN when either side is a band — never guesses from a range", () => {
    expect(ownershipCrossing("25-50%", "15%")).toBe("unknown");
    expect(ownershipCrossing("35%", "Over 25%")).toBe("unknown");
    expect(ownershipCrossing(null, "15%")).toBe("unknown");
  });
});

/**
 * The behaviour Archana asked for on 2026-08-01: a change that moves someone
 * across the threshold must ASK for the ownership chart, because it changes who
 * the beneficial owners are.
 */
describe("threshold crossings request the ownership chart", () => {
  it("crossing below asks for the chart", () => {
    const r = classifyChange(person({ thresholdCrossing: "crossed_below" }));
    expect(r.workflow).toBe("doc_required");
    expect(r.docType).toBe("Ownership Chart");
    expect(r.matchedRule).toBe("PERSON-OWNERSHIP-CROSSED-BELOW");
  });

  it("crossing above asks for the chart too", () => {
    const r = classifyChange(person({ thresholdCrossing: "crossed_above" }));
    expect(r.workflow).toBe("doc_required");
    expect(r.docType).toBe("Ownership Chart");
    expect(r.matchedRule).toBe("PERSON-OWNERSHIP-CROSSED-ABOVE");
  });

  it("a change that crosses nothing stays silent and asks for nothing", () => {
    const r = classifyChange(person({ thresholdCrossing: "none" }));
    expect(r.workflow).toBe("accept_silent");
    expect(r.docType).toBeNull();
  });

  it("an unparseable band is still recorded UNDECIDED, not guessed", () => {
    const r = classifyChange(person({ thresholdCrossing: "unknown" }));
    expect(r.workflow).toBe("UNDECIDED");
    expect(r.decided).toBe(false);
    expect(r.docType).toBeNull();
  });

  it("end to end: 35% → 15% produces the chart request", () => {
    const r = classifyChange(person({ thresholdCrossing: ownershipCrossing("35%", "15%") }));
    expect(r.docType).toBe("Ownership Chart");
  });
});
