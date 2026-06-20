# Patch: redefine metric #4 Evidence Coverage as credible-source share (Path A)

The old #4 (`withEvidence / found.length`) structurally pins at ~100% because a
field only enters `found` if the agent populated AND cited it. Path A makes #4
answer a different, non-redundant question from #1 (coverage):

  #1 onboarding coverage  = how MUCH of the researchable form was filled
  #4 evidence coverage    = of what was filled, how much rests on a CREDIBLE
                            (tier-1 authoritative or tier-2 company-owned) source

## 1. Compute the credible count (in metricsFor, near line 177)

FIND:
```js
  const tier1 = found.filter(f => f.sourceTier === 'tier1' || f.sourceTier === 'document').length;
  // evidence = populated field carries a source citation (sourceUrl is often null;
  // the citation lives in the `source` text, so we test that).
  const withEvidence = found.filter(f => f.source && String(f.source).trim()).length;
```

REPLACE WITH:
```js
  const tier1 = found.filter(f => f.sourceTier === 'tier1' || f.sourceTier === 'document').length;
  // #4 Evidence coverage (Path A): of the fields the agent FILLED, how many rest
  // on a CREDIBLE source — tier-1 (authoritative registry / document) or tier-2
  // (company-owned). tier-3 (aggregators, inferred) does NOT count as evidenced.
  // This is distinct from #1 coverage (how much was filled) and from tier1Share
  // (tier-1 only). The old presence-of-any-source check is retained as a floor.
  const credible = found.filter(f =>
    f.sourceTier === 'tier1' || f.sourceTier === 'document' || f.sourceTier === 'tier2'
  ).length;
  const withEvidence = found.filter(f => f.source && String(f.source).trim()).length; // floor only
```

## 2. Redefine the metric (line ~198)

FIND:
```js
    evidenceCoverage: found.length ? withEvidence / found.length : null,     // #4
```

REPLACE WITH:
```js
    evidenceCoverage: found.length ? credible / found.length : null,         // #4 (tier1+tier2 / found)
    evidenceFloor:    found.length ? withEvidence / found.length : null,     // any-citation floor (sanity)
```

## 3. Aggregate (line ~226, next to the other evidence line)

FIND:
```js
    evidenceCoverage: { mean: mean(v('evidenceCoverage')) },
```

REPLACE WITH:
```js
    evidenceCoverage: { mean: mean(v('evidenceCoverage')) },   // credible-source share
    evidenceFloor:    { mean: mean(v('evidenceFloor')) },      // any-citation floor
```

## 4. Console label (line ~318) — make the meaning explicit

FIND:
```js
console.log(`  4. Evidence coverage ........ ${fp(overall.evidenceCoverage.mean)}`);
```

REPLACE WITH:
```js
console.log(`  4. Evidence coverage ........ ${fp(overall.evidenceCoverage.mean)}  (filled fields backed by a tier-1/tier-2 source)`);
```

## Notes
- `tier1Share` (line 208) is left untouched — it remains the tier-1-ONLY view.
  You now have a clean ladder: evidenceFloor (any source) >= evidenceCoverage
  (tier1+2) >= tier1Share (tier1 only).
- Runs over stored pilot output unchanged — no re-run needed, since sourceTier
  is already present on every `found` field.
