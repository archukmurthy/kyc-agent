# ADR 0009: Versioned condition-language syntax without evaluation

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

Policy applicability and conditional strategies require portable expressions, but accepting JavaScript or evaluating conditions during schema hardening would create an executable-policy and premature-reasoning boundary violation.

## Decision

`ubo-condition-v1` is a small, deterministic syntax contract. It allows `always`; paths under `case`, `facts`, `answers`, and `params`; scalar literals; approved comparisons; `&&`, `||`, and parentheses. It rejects calls, executable constructs, unsupported namespaces/operators, assignments, arithmetic, arrays, and chained comparisons.

The semantic contract is three-valued (`TRUE`, `FALSE`, `UNKNOWN`): missing or null operands produce `UNKNOWN` unless explicitly compared with `null`. G1.2A implements parsing and validation only. Evaluation and policy reasoning are deferred.

## Consequences

Policy artifacts can be validated safely without `eval`, implicit JavaScript coercion, or host dependencies. A future evaluator must implement the pinned semantics and will require its own executable scenario coverage.
