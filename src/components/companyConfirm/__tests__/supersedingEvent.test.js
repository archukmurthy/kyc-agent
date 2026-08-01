import { buildSupersedingEvent, serialiseLike } from "../supersedingEvent";

const baseEvent = {
  submissionId: "sub-1",
  fieldId: "registered_address_line1",
  fieldClass: "address",
  changeType: "changed",
  beforeValue: "123 Sample Street",
  afterValue: null,
  supersedesId: null,
  workflow: "doc_required",
  docType: "Notice of Change of Address",
  customerIntent: null,
  customerRegistryClaim: "not_reflected",
  jurisdiction: "GB",
};

describe("buildSupersedingEvent", () => {
  it("carries the initial classification verbatim and sets afterValue + supersedesId", () => {
    const ev = buildSupersedingEvent({ emitted: true, event: baseEvent, eventId: 42 }, "1 New Street");
    expect(ev.afterValue).toBe("1 New Street");
    expect(ev.supersedesId).toBe(42);
    expect(ev.beforeValue).toBe("123 Sample Street");
    expect(ev.changeType).toBe("changed");
    expect(ev.fieldId).toBe("registered_address_line1");
  });

  it("preserves workflow + docType so a re-edit never drops a required document", () => {
    const ev = buildSupersedingEvent({ emitted: true, event: baseEvent, eventId: 42 }, "1 New Street");
    expect(ev.workflow).toBe("doc_required");
    expect(ev.docType).toBe("Notice of Change of Address");
    expect(ev.customerRegistryClaim).toBe("not_reflected");
  });

  // Commit 8 — the corrected value gets its own high-risk-country check, and the
  // flag only ever goes up.
  describe("CD-03 EDD flag on the corrected value", () => {
    it("raises the flag when the correction moves INTO a high-risk country", () => {
      const ev = buildSupersedingEvent({ emitted: true, event: baseEvent }, "Ruritania", { eddFlag: true });
      expect(ev.eddFlag).toBe(true);
    });

    it("leaves it false when neither the original nor the correction is high risk", () => {
      const ev = buildSupersedingEvent({ emitted: true, event: baseEvent }, "United Kingdom", { eddFlag: false });
      expect(ev.eddFlag).toBe(false);
    });

    it("never RETRACTS a flag already set on the original — append-only trail", () => {
      const flagged = { ...baseEvent, eddFlag: true };
      const ev = buildSupersedingEvent({ emitted: true, event: flagged }, "United Kingdom", { eddFlag: false });
      expect(ev.eddFlag).toBe(true);
    });

    it("defaults to the original's flag when no opts are passed", () => {
      expect(buildSupersedingEvent({ emitted: true, event: baseEvent }, "x").eddFlag).toBe(false);
      expect(
        buildSupersedingEvent({ emitted: true, event: { ...baseEvent, eddFlag: true } }, "x").eddFlag
      ).toBe(true);
    });
  });

  it("returns null until the initial event has been emitted", () => {
    expect(buildSupersedingEvent(null, "x")).toBeNull();
    expect(buildSupersedingEvent({ emitted: false, event: baseEvent }, "x")).toBeNull();
    expect(buildSupersedingEvent({ emitted: true, event: null }, "x")).toBeNull();
  });

  it("does not mutate the stored initial event (append-only discipline)", () => {
    const snap = { emitted: true, event: { ...baseEvent }, eventId: 7 };
    buildSupersedingEvent(snap, "y");
    expect(snap.event.afterValue).toBeNull();
    expect(snap.event.supersedesId).toBeNull();
  });

  describe("lineage — chain to the tail, never back to a consumed head", () => {
    it("targets the head for the first correction", () => {
      const ev = buildSupersedingEvent({ emitted: true, event: baseEvent, eventId: "1" }, "a");
      expect(ev.supersedesId).toBe("1");
    });

    it("targets the tail once one exists, not the head", () => {
      const ev = buildSupersedingEvent(
        { emitted: true, event: baseEvent, eventId: "1", headConsumed: true, tailEventId: "2" },
        "b"
      );
      expect(ev.supersedesId).toBe("2");
    });

    it("produces a clean E1<-E2<-E3 chain across three sequential edits", () => {
      // Mirrors the real save loop: build, then record the returned id as the tail.
      let snap = { emitted: true, event: baseEvent, eventId: "1" };
      const targets = [];
      ["a", "b", "c"].forEach((value, i) => {
        const ev = buildSupersedingEvent(snap, value);
        targets.push(ev.supersedesId);
        snap = { ...snap, headConsumed: true, tailEventId: String(i + 2) };
      });
      expect(targets).toEqual(["1", "2", "3"]);
    });

    it("falls back to null — never the consumed head — when the tail id is unknown", () => {
      // The write happened but its id never came back (no DB / bad response).
      // Re-targeting the head would throw "already superseded" and be swallowed.
      const ev = buildSupersedingEvent(
        { emitted: true, event: baseEvent, eventId: "1", headConsumed: true, tailEventId: null },
        "c"
      );
      expect("supersedesId" in ev).toBe(false);
      expect(ev.afterValue).toBe("c");
    });

    it("omits supersedesId entirely when no id was ever retrieved", () => {
      const ev = buildSupersedingEvent({ emitted: true, event: baseEvent, eventId: null }, "x");
      expect("supersedesId" in ev).toBe(false);
    });

    it("treats the id as an opaque token — a string id passes through unchanged", () => {
      const ev = buildSupersedingEvent(
        { emitted: true, event: baseEvent, headConsumed: true, tailEventId: "9007199254740993" },
        "x"
      );
      expect(ev.supersedesId).toBe("9007199254740993");
    });
  });

  describe("shape discipline", () => {
    it("serialises the corrected value the same way the original was", () => {
      const ev = buildSupersedingEvent({ emitted: true, event: baseEvent, eventId: 1 }, "1 New Street");
      expect(typeof ev.afterValue).toBe(typeof ev.beforeValue);
    });

    it("keeps a null-ish saved value as null rather than the string 'null'", () => {
      expect(serialiseLike(null, "x")).toBeNull();
      expect(serialiseLike(undefined, "x")).toBeNull();
    });
  });
});
