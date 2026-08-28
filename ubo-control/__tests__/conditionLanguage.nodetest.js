"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CONDITION_LANGUAGE_VERSION,
  UboContractError,
  validateConditionExpression,
} = require("..");
const { parseConditionExpression } = require("../policy/conditionLanguage");

test("the versioned condition syntax accepts the approved deterministic source forms", () => {
  assert.equal(CONDITION_LANGUAGE_VERSION, "ubo-condition-v1");
  [
    "always",
    "case.entity_profile == 'COMPANY'",
    "case.jurisdiction == 'GB'",
    "facts.ownership_layers >= 2",
    "facts.cross_border_layer == true",
    "facts.ownership_layers >= params.chain_depth_risk_floor_layers",
    "answers.DISCLOSE_VOTING_CONTROL == 'no'",
    "facts.potential_de_facto_control == true || facts.ambiguous_control_clause == true",
    "(case.entity_profile == 'COMPANY' || case.entity_profile == 'LLP') && facts.count != null",
  ].forEach((condition) => assert.equal(validateConditionExpression(condition), true));
});

test("the parser records structure and precedence without evaluating policy truth", () => {
  const syntax = parseConditionExpression("facts.a == true || facts.b == true && facts.c == false");
  assert.equal(syntax.type, "LOGICAL");
  assert.equal(syntax.operator, "||");
  assert.equal(syntax.right.type, "LOGICAL");
  assert.equal(syntax.right.operator, "&&");
  assert.equal(Object.prototype.hasOwnProperty.call(require(".."), "evaluateConditionExpression"), false);
});

test("unsupported identifiers, operators, execution syntax, and malformed expressions fail deterministically", () => {
  [
    "",
    "company.type == 'COMPANY'",
    "facts.value = 1",
    "facts.value + 1 > 2",
    "!facts.enabled",
    "eval('true')",
    "Function('return true')()",
    "facts.a == true == facts.b",
    "facts.a ==",
    "facts.a &&",
    "facts.items[0] == 1",
    "facts.a in facts.b",
  ].forEach((condition) => {
    assert.throws(
      () => validateConditionExpression(condition),
      (error) => error instanceof UboContractError && error.code === "INVALID_POLICY_CONDITION",
    );
  });
});

test("the syntax implementation contains no dynamic JavaScript execution primitive", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "policy", "conditionLanguage.js"), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /\bnew\s+Function\b/);
  assert.doesNotMatch(source, /\bFunction\s*\(/);
});
