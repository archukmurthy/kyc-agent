const assert = require("assert");
const test = require("node:test");
const AuthorityValidator = require("../validators/AuthorityValidator");
const { loadRulePack } = require("../rulepacks/rulePackLoader");

function buildInput({ market = "UK", entityType = "Private Limited", signerTitle = "Director" } = {}) {
  const rulePack = loadRulePack({ market, documentType: "LOA" });
  return {
    extraction: {
      fields: {
        signerTitle: { value: signerTitle, evidenceRefs: ["ev_signer_title"] },
      },
    },
    evidence: [{ evidenceId: "ev_signer_title", field: "signerTitle", value: signerTitle }],
    requirementContext: { entityType },
    ruleContext: {
      rulePackId: rulePack.id,
      rulePackVersion: rulePack.version,
      activeRules: rulePack.rules,
    },
    execution: { executionId: "exec_authority" },
  };
}

test("UK Private Limited accepts its direct-authority signer roles", () => {
  for (const signerTitle of ["Director", "UBO", "Controlling Person"]) {
    assert.strictEqual(new AuthorityValidator().validate(buildInput({ signerTitle })).status, "PASS");
  }
});

test("Singapore Private Limited accepts Director and UBO but rejects Controlling Person", () => {
  assert.strictEqual(
    new AuthorityValidator().validate(buildInput({ market: "SG", signerTitle: "Director" })).status,
    "PASS"
  );
  assert.strictEqual(
    new AuthorityValidator().validate(buildInput({ market: "SG", signerTitle: "UBO" })).status,
    "PASS"
  );
  assert.strictEqual(
    new AuthorityValidator().validate(buildInput({ market: "SG", signerTitle: "Controlling Person" })).status,
    "FAIL"
  );
});

test("entity-specific signer roles are enforced", () => {
  assert.strictEqual(
    new AuthorityValidator().validate(buildInput({ entityType: "Partnership", signerTitle: "Partner" })).status,
    "PASS"
  );
  assert.strictEqual(
    new AuthorityValidator().validate(buildInput({ entityType: "Sole Proprietor", signerTitle: "Sole Owner" })).status,
    "PASS"
  );
  assert.strictEqual(
    new AuthorityValidator().validate(buildInput({ entityType: "Cooperative", signerTitle: "Director" })).status,
    "PASS"
  );
});

test("Secretary and other delegated roles return REVIEW", () => {
  for (const signerTitle of ["Secretary", "Company Secretary", "Attorney", "Legal Representative", "Authorised Signatory"]) {
    const finding = new AuthorityValidator().validate(buildInput({ signerTitle }));
    assert.strictEqual(finding.status, "REVIEW");
    assert.ok(finding.decision.outcomeReason.includes("supporting evidence"));
  }
});

test("unsupported signer roles fail and missing entity type reviews", () => {
  assert.strictEqual(new AuthorityValidator().validate(buildInput({ signerTitle: "Operations Manager" })).status, "FAIL");
  assert.strictEqual(
    new AuthorityValidator().validate(buildInput({ entityType: "", signerTitle: "Director" })).status,
    "REVIEW"
  );
});
