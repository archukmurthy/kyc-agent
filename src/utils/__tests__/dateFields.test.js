import { isDateField, isIsoDate, resolveInputType } from "../dateFields";

describe("isDateField — the fields that must get a date picker", () => {
  it("detects the schema's date fields, none of which declare inputType", () => {
    expect(isDateField({ field: "registeredDate", label: "Date of Incorporation" })).toBe(true);
    expect(isDateField({ field: "incorporation_date", label: "Date of Incorporation" })).toBe(true);
    expect(isDateField({ field: "date_of_birth" })).toBe(true);
    expect(isDateField({ field: "applicantDateOfBirth", label: "Applicant Date of Birth" })).toBe(true);
  });

  it("matches on the label alone when the id says nothing", () => {
    expect(isDateField({ field: "f17", label: "Date of Incorporation" })).toBe(true);
  });

  it("falls back to an ISO value when neither name says date", () => {
    expect(isDateField({ field: "f17" }, "2015-03-12")).toBe(true);
    expect(isDateField({ field: "f17" }, "Suite 4B")).toBe(false);
  });
});

describe("isDateField — what must NOT become a date picker", () => {
  it("ignores words that merely contain 'date'", () => {
    ["update", "lastUpdate", "candidate", "mandate", "validated", "updated_by"].forEach((f) => {
      expect(isDateField({ field: f })).toBe(false);
    });
  });

  it("never overrides an explicit inputType", () => {
    // A select whose label mentions a date stays a select.
    expect(isDateField({ field: "incorporationDate", inputType: "select" })).toBe(false);
    expect(isDateField({ field: "registeredDate", inputType: "textarea" })).toBe(false);
    // And an explicit date is a date whatever it is called.
    expect(isDateField({ field: "whenever", inputType: "date" })).toBe(true);
  });

  it("is safe on empty input", () => {
    expect(isDateField()).toBe(false);
    expect(isDateField({}, "")).toBe(false);
  });
});

describe("resolveInputType", () => {
  it("returns date for detected dates and preserves other declared types", () => {
    expect(resolveInputType({ field: "registeredDate" })).toBe("date");
    expect(resolveInputType({ field: "ownershipType", inputType: "select" })).toBe("select");
    expect(resolveInputType({ field: "tradeName" })).toBe("text");
  });
});

describe("isIsoDate", () => {
  it("accepts only a full ISO calendar date, which is what the input needs", () => {
    expect(isIsoDate("2015-03-12")).toBe(true);
    expect(isIsoDate("August 1965")).toBe(false);
    expect(isIsoDate("2015-03")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});
