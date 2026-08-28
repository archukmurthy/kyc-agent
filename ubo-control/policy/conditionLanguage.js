"use strict";

const { UboContractError } = require("../errors");
const { CONDITION_LANGUAGE_VERSION } = require("../contracts/constants");

const COMPARISON_OPERATORS = new Set(["==", "!=", ">", ">=", "<", "<="]);
const LOGICAL_OPERATORS = new Set(["&&", "||"]);
const ALLOWED_ROOTS = new Set(["case", "facts", "answers", "params"]);

function syntaxError(message, offset) {
  return new UboContractError(`Invalid ${CONDITION_LANGUAGE_VERSION} expression at ${offset}: ${message}`, {
    code: "INVALID_POLICY_CONDITION",
  });
}

function readQuotedString(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === quote) {
      return { token: { type: "LITERAL", value: source.slice(start, index + 1), offset: start }, next: index + 1 };
    }
    if (character === "\n" || character === "\r") {
      throw syntaxError("string literals cannot contain raw line breaks", index);
    }
    if (character === "\\") {
      index += 1;
      if (index >= source.length) throw syntaxError("unterminated escape sequence", index);
      const escaped = source[index];
      if (escaped === "u") {
        const hex = source.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw syntaxError("invalid Unicode escape", index);
        index += 4;
      } else if (!/["'\\/bfnrt]/.test(escaped)) {
        throw syntaxError("unsupported string escape", index);
      }
    }
    index += 1;
  }
  throw syntaxError("unterminated string literal", start);
}

function tokenize(source) {
  if (typeof source !== "string" || source.trim() === "") {
    throw syntaxError("expression must be a non-empty string", 0);
  }

  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    if (/^\s/.test(rest)) {
      index += 1;
      continue;
    }

    if (source[index] === "'" || source[index] === '"') {
      const quoted = readQuotedString(source, index);
      tokens.push(quoted.token);
      index = quoted.next;
      continue;
    }

    const number = rest.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      tokens.push({ type: "LITERAL", value: number[0], offset: index });
      index += number[0].length;
      continue;
    }

    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/);
    if (word) {
      const value = word[0];
      if (["true", "false", "null"].includes(value)) {
        tokens.push({ type: "LITERAL", value, offset: index });
      } else if (value === "always") {
        tokens.push({ type: "ALWAYS", value, offset: index });
      } else {
        const root = value.split(".")[0];
        if (!value.includes(".") || !ALLOWED_ROOTS.has(root)) {
          throw syntaxError(`unsupported identifier ${value}`, index);
        }
        tokens.push({ type: "IDENTIFIER", value, offset: index });
      }
      index += value.length;
      continue;
    }

    const operator = [">=", "<=", "==", "!=", "&&", "||", ">", "<"].find((candidate) => rest.startsWith(candidate));
    if (operator) {
      tokens.push({ type: "OPERATOR", value: operator, offset: index });
      index += operator.length;
      continue;
    }

    if (source[index] === "(" || source[index] === ")") {
      tokens.push({ type: source[index] === "(" ? "LPAREN" : "RPAREN", value: source[index], offset: index });
      index += 1;
      continue;
    }

    throw syntaxError(`unsupported token ${JSON.stringify(source[index])}`, index);
  }

  tokens.push({ type: "EOF", value: "", offset: source.length });
  return tokens;
}

function parseConditionExpression(source) {
  const tokens = tokenize(source);
  let position = 0;

  function current() {
    return tokens[position];
  }

  function consume(type, value) {
    const token = current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw syntaxError(`expected ${value || type}`, token.offset);
    }
    position += 1;
    return token;
  }

  function primary() {
    const token = current();
    if (["IDENTIFIER", "LITERAL", "ALWAYS"].includes(token.type)) {
      position += 1;
      return { type: token.type, value: token.value };
    }
    if (token.type === "LPAREN") {
      consume("LPAREN");
      const expression = logicalOr();
      consume("RPAREN");
      return expression;
    }
    throw syntaxError("expected identifier, literal, always, or parenthesized expression", token.offset);
  }

  function comparison() {
    let expression = primary();
    if (current().type === "OPERATOR" && COMPARISON_OPERATORS.has(current().value)) {
      const operator = consume("OPERATOR").value;
      expression = { type: "COMPARISON", operator, left: expression, right: primary() };
      if (current().type === "OPERATOR" && COMPARISON_OPERATORS.has(current().value)) {
        throw syntaxError("chained comparisons are not supported", current().offset);
      }
    }
    return expression;
  }

  function logicalAnd() {
    let expression = comparison();
    while (current().type === "OPERATOR" && current().value === "&&") {
      consume("OPERATOR", "&&");
      expression = { type: "LOGICAL", operator: "&&", left: expression, right: comparison() };
    }
    return expression;
  }

  function logicalOr() {
    let expression = logicalAnd();
    while (current().type === "OPERATOR" && current().value === "||") {
      consume("OPERATOR", "||");
      expression = { type: "LOGICAL", operator: "||", left: expression, right: logicalAnd() };
    }
    return expression;
  }

  const expression = logicalOr();
  if (current().type !== "EOF") {
    const token = current();
    if (token.type === "OPERATOR" && LOGICAL_OPERATORS.has(token.value)) {
      throw syntaxError("logical operator is missing a right operand", token.offset);
    }
    throw syntaxError(`unexpected token ${token.value}`, token.offset);
  }
  return expression;
}

function validateConditionExpression(source) {
  parseConditionExpression(source);
  return true;
}

module.exports = {
  parseConditionExpression,
  validateConditionExpression,
};
