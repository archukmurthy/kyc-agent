import { expandSharedAnalyses, shareRepeatedAnalyses } from "./recalculationStorage";

test("a chart analysis shared by several rows is stored once and read back for every row", () => {
  const analysis = { view: { graph: { nodes: [1, 2, 3] } } };
  const other = { view: { graph: { nodes: [9] } } };
  const recalculations = {
    a: { determination: "DEFINITE_UBO", chartAnalysis: analysis, recalculatedAt: "t1" },
    b: { determination: "INDETERMINATE", chartAnalysis: JSON.parse(JSON.stringify(analysis)), recalculatedAt: "t1" },
    c: { determination: "DEFINITE_NON_UBO", chartAnalysis: other, recalculatedAt: "t2" },
    d: { determination: "INDETERMINATE", error: "failed" },
  };
  const stored = shareRepeatedAnalyses(recalculations);
  expect(stored.a.chartAnalysis).toEqual(analysis);
  expect(stored.b).toEqual({ determination: "INDETERMINATE", recalculatedAt: "t1", chartAnalysisSameAs: "a" });
  expect(stored.c.chartAnalysis).toEqual(other);
  expect(stored.d).toEqual(recalculations.d);
  expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(recalculations).length);
  expect(expandSharedAnalyses(stored)).toEqual(recalculations);
});

test("nothing to share is left as it is", () => {
  expect(shareRepeatedAnalyses(undefined)).toBeUndefined();
  expect(expandSharedAnalyses({ a: { determination: "X" } })).toEqual({ a: { determination: "X" } });
});
