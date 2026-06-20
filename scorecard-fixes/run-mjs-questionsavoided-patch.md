# Patch: data-point-level "questions avoided" in run.mjs

Three edits. Drop `question-weight.mjs` into the `benchmark/` folder next to
`run.mjs`, then apply these.

## 1. Import (top of run.mjs, with the other imports)

```js
import { questionsAvoided as qaWeight } from './question-weight.mjs';
```

## 2. In `metricsFor()` — replace the single questionsAvoided line

FIND (line ~195):
```js
    questionsAvoided: populated,                              // #2
```

REPLACE WITH:
```js
    // #2 — data-point level. verified+probable = avoided; indicative = predrafted.
    // schemaByField is optional (mode b); pass null to compute purely from
    // `found` (mode a, works retroactively over stored output).
    ...(() => {
      const qa = qaWeight(found, SCHEMA_WEIGHTS || null);
      return {
        questionsAvoided:   qa.avoided,      // verified + probable, in data points
        questionsPredrafted: qa.predrafted,  // indicative, in data points
        questionsAvoidedTotal: qa.total,
        questionsAvoidedFields: populated,   // keep old field-level number for continuity
      };
    })(),
```

The old `questionsAvoided: populated` is preserved as `questionsAvoidedFields`
so nothing downstream breaks and you can compare field-level vs data-point.

## 3. Optional schema weights (mode b) — near the top, after BASELINE etc.

If you want per-field overrides for new runs, define them; otherwise leave as
null and it runs in pure mode (a):

```js
// Mode (b): optional per-field weight overrides. null => pure data-driven (a).
const SCHEMA_WEIGHTS = null;
// Example when you want explicit control:
// const SCHEMA_WEIGHTS = {
//   directors:          { weightKeys: ['full_name','role','nationality','date_of_birth','residential_country'] },
//   ubo_parent_company: { weightKeys: ['full_name','role','share_percentage'] },
// };
```

## 4. In `aggregate()` — add the new keys

FIND (line ~225):
```js
    questionsAvoided:   { mean: mean(v('questionsAvoided')), total: sum('questionsAvoided') },
```

REPLACE WITH:
```js
    questionsAvoided:    { mean: mean(v('questionsAvoided')),    total: sum('questionsAvoided') },
    questionsPredrafted: { mean: mean(v('questionsPredrafted')), total: sum('questionsPredrafted') },
    questionsAvoidedTotal: { mean: mean(v('questionsAvoidedTotal')), total: sum('questionsAvoidedTotal') },
    questionsAvoidedFields: { mean: mean(v('questionsAvoidedFields')), total: sum('questionsAvoidedFields') },
```

## 5. Console + HTML (optional but recommended)

Console line ~316, replace with two lines:
```js
console.log(`  2. Questions avoided (data points) ${f1(overall.questionsAvoided.mean)}/entity, ${overall.questionsAvoided.total} total (verified+probable)`);
console.log(`     + predrafted (indicative)        ${f1(overall.questionsPredrafted.mean)}/entity, ${overall.questionsPredrafted.total} total`);
```

The HTML card at ~370 can show `overall.questionsAvoided.mean` with a second
small figure for predrafted, or stack them — your call on layout.
