import {
  resolvePersonType,
  personFieldId,
  parsePersonFieldId,
  listDocumentFor,
  PERSON_TYPE,
  ATTRIBUTE_BY_FIELD_KEY,
} from "../personType";

describe("resolvePersonType — the real interface wins", () => {
  it("reads explicit flags and reports them as non-stub", () => {
    expect(resolvePersonType({ isDirector: true, isUBO: false }, "anything")).toMatchObject({
      isDirector: true, isUBO: false, personType: PERSON_TYPE.DIRECTOR, source: "flags", isStub: false,
    });
    expect(resolvePersonType({ isDirector: false, isUBO: true }, "anything")).toMatchObject({
      isUBO: true, personType: PERSON_TYPE.UBO, source: "flags", isStub: false,
    });
  });

  it("types a dual-role person as UBO — CD-03 gives them UBO treatment", () => {
    const r = resolvePersonType({ isDirector: true, isUBO: true }, "directors");
    expect(r.personType).toBe(PERSON_TYPE.UBO);
    expect(r.isDirector).toBe(true);
  });

  it("flags win even when the containing field says otherwise", () => {
    const r = resolvePersonType({ isDirector: true, isUBO: false }, "ubo_ownership_analysis");
    expect(r.personType).toBe(PERSON_TYPE.DIRECTOR);
    expect(r.source).toBe("flags");
  });
});

describe("resolvePersonType — the STUB tiers", () => {
  it("infers UBO from a ubo-like field and marks it a stub", () => {
    const r = resolvePersonType({}, "ubo_ownership_analysis");
    expect(r).toMatchObject({ isUBO: true, personType: PERSON_TYPE.UBO, source: "field-inferred", isStub: true });
  });

  it("infers director from a director-like field and marks it a stub", () => {
    const r = resolvePersonType({}, "key_directors_with_nationality");
    expect(r).toMatchObject({ isDirector: true, isUBO: false, personType: PERSON_TYPE.DIRECTOR, source: "field-inferred", isStub: true });
  });

  it("defaults to UBO when there is nothing to go on — over-collect is the safe failure", () => {
    const r = resolvePersonType({}, "");
    expect(r).toMatchObject({ isUBO: true, personType: PERSON_TYPE.UBO, source: "stub-default", isStub: true });
  });

  it("never returns pseudo_ubo — that case is not derivable and stays UNDECIDED", () => {
    const samples = [{}, { isUBO: true }, { isDirector: true }];
    const fields = ["", "directors", "ubo", "shareholders"];
    samples.forEach((p) => fields.forEach((f) => {
      expect(resolvePersonType(p, f).personType).not.toBe(PERSON_TYPE.PSEUDO_UBO);
    }));
  });
});

describe("composite fieldId (Investigation C)", () => {
  it("builds <personType>::<stakeholderId>::<attribute>", () => {
    expect(personFieldId("ubo", "sh_abc_1", "nationality")).toBe("ubo::sh_abc_1::nationality");
  });

  it("round-trips", () => {
    const id = personFieldId("director", "sh_x_2", "dob");
    expect(parsePersonFieldId(id)).toEqual({ personType: "director", stakeholderId: "sh_x_2", attribute: "dob" });
  });

  it("returns null for a company-level fieldId, so callers can tell them apart", () => {
    expect(parsePersonFieldId("addressLine1")).toBeNull();
    expect(parsePersonFieldId("")).toBeNull();
  });

  it("addresses each person-attribute independently — the basis of per-attribute supersede", () => {
    const a = personFieldId("ubo", "sh_1", "dob");
    const b = personFieldId("ubo", "sh_1", "nationality");
    const c = personFieldId("ubo", "sh_2", "dob");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("listDocumentFor — the shared list-document rule", () => {
  it("director → list of directors, UBO → ownership chart", () => {
    expect(listDocumentFor(PERSON_TYPE.DIRECTOR)).toBe("List of Directors");
    expect(listDocumentFor(PERSON_TYPE.UBO)).toBe("Ownership Chart");
  });
});

describe("card field keys map onto CD-03 attributes", () => {
  it("covers the attributes the person card can edit", () => {
    expect(ATTRIBUTE_BY_FIELD_KEY.full_name).toBe("name");
    expect(ATTRIBUTE_BY_FIELD_KEY.date_of_birth).toBe("dob");
    expect(ATTRIBUTE_BY_FIELD_KEY.nationality).toBe("nationality");
    expect(ATTRIBUTE_BY_FIELD_KEY.residential_country).toBe("residential_address");
    expect(ATTRIBUTE_BY_FIELD_KEY.is_pep).toBe("pep");
    expect(ATTRIBUTE_BY_FIELD_KEY.share_percentage).toBe("ownership_pct");
    expect(ATTRIBUTE_BY_FIELD_KEY.role).toBe("role");
  });
});
