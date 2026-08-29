"use strict";

const { PolicyPackValidationError } = require("../errors");
const { assertDataOnly, deepFreeze } = require("../internal/validation");
const { parseConditionExpression } = require("./conditionLanguage");

const POLICY_TRUTH_VALUE = Object.freeze({
  TRUE: "TRUE",
  FALSE: "FALSE",
  UNKNOWN: "UNKNOWN",
});

const MISSING = Symbol("MISSING_POLICY_OPERAND");

class PolicyConfigurationError extends PolicyPackValidationError {
  constructor(message, { cause } = {}) {
    super(message, { code: "POLICY_CONFIGURATION_ERROR", cause });
  }
}

function decodeSingleQuoted(source) {
  let result = "";
  for (let index = 1; index < source.length - 1; index += 1) {
    const character = source[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    index += 1;
    const escaped = source[index];
    if (escaped === "u") {
      result += String.fromCharCode(Number.parseInt(source.slice(index + 1, index + 5), 16));
      index += 4;
      continue;
    }
    const escapes = { "'": "'", '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    result += escapes[escaped];
  }
  return result;
}

function literalValue(source) {
  if (source === "true") return true;
  if (source === "false") return false;
  if (source === "null") return null;
  if (source.startsWith("'")) return decodeSingleQuoted(source);
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw new PolicyConfigurationError(`Invalid policy literal ${source}`, { cause });
  }
}

function resolveIdentifier(identifier, context) {
  const segments = identifier.split(".");
  let current = context;
  for (const segment of segments) {
    if (current === null || typeof current !== "object"
      || !Object.prototype.hasOwnProperty.call(current, segment)) return MISSING;
    current = current[segment];
  }
  return current;
}

function isNullLiteral(node) {
  return node.type === "LITERAL" && node.value === "null";
}

function evaluateOperand(node, context) {
  if (node.type === "IDENTIFIER") return resolveIdentifier(node.value, context);
  if (node.type === "LITERAL") return literalValue(node.value);
  if (node.type === "ALWAYS") return true;
  throw new PolicyConfigurationError("Logical/comparison expressions cannot be used as scalar operands");
}

function booleanTruth(value) {
  if (value === MISSING || value === null) return POLICY_TRUTH_VALUE.UNKNOWN;
  if (value === true) return POLICY_TRUTH_VALUE.TRUE;
  if (value === false) return POLICY_TRUTH_VALUE.FALSE;
  throw new PolicyConfigurationError("A bare policy condition operand must resolve to boolean, null, or missing");
}

function compareValues(node, context) {
  const left = evaluateOperand(node.left, context);
  const right = evaluateOperand(node.right, context);
  const explicitNull = isNullLiteral(node.left) || isNullLiteral(node.right);

  if (explicitNull && ["==", "!="].includes(node.operator)) {
    const leftNullish = left === MISSING || left === null;
    const rightNullish = right === MISSING || right === null;
    const equal = leftNullish && rightNullish;
    return (node.operator === "==" ? equal : !equal)
      ? POLICY_TRUTH_VALUE.TRUE
      : POLICY_TRUTH_VALUE.FALSE;
  }
  if (left === MISSING || right === MISSING || left === null || right === null) {
    return POLICY_TRUTH_VALUE.UNKNOWN;
  }

  let result;
  if (node.operator === "==") result = typeof left === typeof right && left === right;
  else if (node.operator === "!=") result = typeof left !== typeof right || left !== right;
  else if (typeof left !== typeof right || !["number", "string"].includes(typeof left)) {
    return POLICY_TRUTH_VALUE.UNKNOWN;
  } else if (node.operator === ">") result = left > right;
  else if (node.operator === ">=") result = left >= right;
  else if (node.operator === "<") result = left < right;
  else if (node.operator === "<=") result = left <= right;
  else throw new PolicyConfigurationError(`Unsupported comparison operator ${node.operator}`);
  return result ? POLICY_TRUTH_VALUE.TRUE : POLICY_TRUTH_VALUE.FALSE;
}

function logicalAnd(left, right) {
  if (left === POLICY_TRUTH_VALUE.FALSE || right === POLICY_TRUTH_VALUE.FALSE) return POLICY_TRUTH_VALUE.FALSE;
  if (left === POLICY_TRUTH_VALUE.TRUE && right === POLICY_TRUTH_VALUE.TRUE) return POLICY_TRUTH_VALUE.TRUE;
  return POLICY_TRUTH_VALUE.UNKNOWN;
}

function logicalOr(left, right) {
  if (left === POLICY_TRUTH_VALUE.TRUE || right === POLICY_TRUTH_VALUE.TRUE) return POLICY_TRUTH_VALUE.TRUE;
  if (left === POLICY_TRUTH_VALUE.FALSE && right === POLICY_TRUTH_VALUE.FALSE) return POLICY_TRUTH_VALUE.FALSE;
  return POLICY_TRUTH_VALUE.UNKNOWN;
}

function evaluateNode(node, context) {
  if (node.type === "LOGICAL") {
    const left = evaluateNode(node.left, context);
    const right = evaluateNode(node.right, context);
    if (node.operator === "&&") return logicalAnd(left, right);
    if (node.operator === "||") return logicalOr(left, right);
    throw new PolicyConfigurationError(`Unsupported logical operator ${node.operator}`);
  }
  if (node.type === "COMPARISON") return compareValues(node, context);
  return booleanTruth(evaluateOperand(node, context));
}

function evaluateConditionExpression(source, input = {}) {
  assertDataOnly(input, "policyConditionContext");
  const context = {
    case: input.case || {},
    facts: input.facts || {},
    answers: input.answers || {},
    params: input.params || {},
  };
  try {
    return evaluateNode(parseConditionExpression(source), context);
  } catch (error) {
    if (error instanceof PolicyConfigurationError) throw error;
    throw new PolicyConfigurationError(`Cannot evaluate policy condition: ${error.message}`, { cause: error });
  }
}

module.exports = {
  POLICY_TRUTH_VALUE,
  PolicyConfigurationError,
  evaluateConditionExpression,
  logicalAnd,
  logicalOr,
};
