# Validation Agent

LOA v1 provides an isolated reusable document-validation module. It is not wired into onboarding, the UBO agent, the Evidence agent, the Research agent, DRS, APIs, or the database.

## Flow

```text
Upload -> Extraction -> Validators -> Findings -> Guidance -> Structured Result
```

The DRS remains the source of truth for whether a document is required. This module only validates evidence that has been provided.

## Folder Responsibilities

- `contracts/` defines shared request, context, finding, and result shapes.
- `engine/` coordinates rule pack loading, extraction, validators, guidance, and aggregation.
- `validators/` contains plug-in validators. New document checks should be added here without changing the engine.
- `rulepacks/` stores jurisdiction-specific rule packs. Each jurisdiction can support multiple document types over time.
- `extraction/` owns extraction orchestration so providers can be swapped later.
- `guidance/` translates findings into customer-facing guidance.
- `replay/` is reserved for historical replay.
- `tests/` covers rule-pack selection, LOA validators, aggregation, and evidence propagation.

## Extension Points

To add a new validator, create a class that extends `BaseValidator`, implement `validate`, add its rule to the applicable rule pack, and register it in `engine/validatorPipeline.js`. Placeholder validators are not part of the default pipeline.

To add a new jurisdiction or document type, add a rule pack under `rulepacks/{JURISDICTION}/` and expose it through `rulepacks/rulePackLoader.js`.

To replace extraction, update `extraction/extractionOrchestrator.js` to call the chosen provider while preserving the extracted document shape consumed by validators.

## Validation States

Only these aggregate and finding states are supported in Phase 1:

- `PASS`
- `REVIEW`
- `FAIL`

There is no scoring engine and no confidence percentage.

## Standalone Lab

`public/validation-lab.html` hosts the Phase 1 lab. It loads the UI from `validation-lab/` and calls the UI-agnostic engine in `agents/validation/`.

The lab supports:

- document upload
- market selection
- validation run
- structured JSON output
- human-readable findings

`npm run build` stages the standalone engine and lab assets into `build/` so the lab is available at `/validation-lab.html` in the production artifact.
