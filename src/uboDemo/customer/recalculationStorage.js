// CommonJS on purpose: the server stores with this and the browser reads with it.
//
// Every recalculated comparison row carries the chart analysis it was computed
// from - and one recalculation produces the same analysis for every row. Kept
// as it is, a case held seven identical ~190 KB copies: 1.3 MB of a 1.9 MB
// record, written again into every save's history (end-to-end check,
// 2026-10-04: saves took 10-43 s). Stored, a repeat refers to the first copy;
// read, it is the same object again.

function sameAnalysis(left, right) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/** Recalculations with each repeated chart analysis replaced by a reference to its first copy. */
function shareRepeatedAnalyses(recalculations) {
  if (!recalculations || typeof recalculations !== "object") return recalculations;
  const firsts = [];
  return Object.fromEntries(Object.entries(recalculations).map(([key, record]) => {
    if (!record?.chartAnalysis) return [key, record];
    const first = firsts.find(({ analysis }) => sameAnalysis(analysis, record.chartAnalysis));
    if (!first) { firsts.push({ key, analysis: record.chartAnalysis }); return [key, record]; }
    const { chartAnalysis: _shared, ...rest } = record;
    return [key, { ...rest, chartAnalysisSameAs: first.key }];
  }));
}

/** Recalculations as computed: every reference resolved to its analysis. */
function expandSharedAnalyses(recalculations) {
  if (!recalculations || typeof recalculations !== "object") return recalculations;
  return Object.fromEntries(Object.entries(recalculations).map(([key, record]) => {
    if (!record?.chartAnalysisSameAs) return [key, record];
    const { chartAnalysisSameAs: source, ...rest } = record;
    const analysis = recalculations[source]?.chartAnalysis;
    return [key, analysis ? { ...rest, chartAnalysis: analysis } : rest];
  }));
}

module.exports = { shareRepeatedAnalyses, expandSharedAnalyses };
