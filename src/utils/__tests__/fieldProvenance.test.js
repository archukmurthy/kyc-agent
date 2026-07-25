const { deriveScalarProvenance } = require("../fieldProvenance");

describe("deriveScalarProvenance — agent_value is never the customer's value", () => {
  it("keeps the ORIGINAL for a corrected scalar, not the correction", () => {
    const { agentValue, customerAction } = deriveScalarProvenance({
      fieldId: "registered_address_line1",
      value: "45 New Harbour Road",   // the customer's correction
      agentValue: "123 Sample Street", // the registry original
      sourceTier: "manual",
      customerAction: "corrected",
    });
    expect(agentValue).toBe("123 Sample Street");
    expect(agentValue).not.toBe("45 New Harbour Road");
    expect(customerAction).toBe("corrected");
  });

  it("uses the trail value as the agent value for an untouched AI field", () => {
    const { agentValue, customerAction } = deriveScalarProvenance({
      fieldId: "companyNumber",
      value: "09428105",
      source: "Companies House",
      sourceTier: "tier1",
      customerAction: null,
    });
    // agent_value === final_value for an uncorrected field, which is correct.
    expect(agentValue).toBe("09428105");
    expect(customerAction).toBeNull();
  });

  it("records no agent value for a customer-entered gap field", () => {
    const { agentValue, customerAction } = deriveScalarProvenance({
      fieldId: "vatNumber",
      value: "GB123456789",
      sourceTier: "manual",
      customerAction: "entered",
      agentValue: null,
    });
    expect(agentValue).toBeNull();
    expect(customerAction).toBe("entered");
  });

  it("returns nulls rather than guessing when no trail entry exists", () => {
    expect(deriveScalarProvenance(undefined)).toEqual({ agentValue: null, customerAction: null });
    expect(deriveScalarProvenance(null)).toEqual({ agentValue: null, customerAction: null });
  });

  it("stringifies an object-valued original so the column always receives text", () => {
    const { agentValue } = deriveScalarProvenance({
      fieldId: "directors",
      value: [{ full_name: "Marcus Thorne" }],
      sourceTier: "tier1",
    });
    expect(agentValue).toBe('[{"full_name":"Marcus Thorne"}]');
  });
});
