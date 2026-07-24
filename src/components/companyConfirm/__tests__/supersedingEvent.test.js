import { buildSupersedingEvent } from "../supersedingEvent";

const baseEvent = {
  submissionId: "sub-1",
  fieldId: "registered_address_line1",
  fieldClass: "address",
  changeType: "changed",
  beforeValue: "123 Sample Street",
  afterValue: null,
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
    expect(ev.workflow).toBe("doc_required");
    expect(ev.docType).toBe("Notice of Change of Address");
    expect(ev.changeType).toBe("changed");
    expect(ev.customerRegistryClaim).toBe("not_reflected");
    expect(ev.fieldId).toBe("registered_address_line1");
  });

  it("omits supersedesId when the initial id was never retrieved (fallback ordering)", () => {
    const ev = buildSupersedingEvent({ emitted: true, event: baseEvent, eventId: null }, "x");
    expect("supersedesId" in ev).toBe(false);
    expect(ev.afterValue).toBe("x");
  });

  it("returns null until the initial event has been emitted", () => {
    expect(buildSupersedingEvent(null, "x")).toBeNull();
    expect(buildSupersedingEvent(undefined, "x")).toBeNull();
    expect(buildSupersedingEvent({ emitted: false, event: baseEvent }, "x")).toBeNull();
    expect(buildSupersedingEvent({ emitted: true, event: null }, "x")).toBeNull();
  });

  it("does not mutate the stored initial event (append-only discipline)", () => {
    const snap = { emitted: true, event: { ...baseEvent }, eventId: 7 };
    buildSupersedingEvent(snap, "y");
    expect(snap.event.afterValue).toBeNull();
    expect("supersedesId" in snap.event).toBe(false);
  });
});
