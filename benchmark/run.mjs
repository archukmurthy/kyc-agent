#!/usr/bin/env node
// benchmark/run.mjs
// -----------------------------------------------------------------------------
// Runs every entity through POST /api/benchmark, scores the v1 auto-metrics
// (no ground truth required), prints a concise console summary, and writes
// out/results.json + out/scorecard.html.
//
//   node benchmark/run.mjs --endpoint http://localhost:3000/api/benchmark
//
// Flags (all optional):
//   --entities <path>   default benchmark/entities.csv
//   --endpoint <url>    default http://localhost:3000/api/benchmark
//   --concurrency <n>   default 3
//   --timeout <ms>      default 180000   (each live call can take 60-90s)
//   --retries <n>       default 1
//   --baseline <min>    human analyst minutes per entity, default 25
//   --nonkeep <path>    optional JSON array of non-keep field ids (over-collection)
//   --out <dir>         default benchmark/out
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const ENDPOINT    = arg('endpoint', 'http://localhost:3000/api/benchmark');
const ENTITIES    = arg('entities', 'benchmark/entities.csv');
const CONCURRENCY = Number(arg('concurrency', 3));
const TIMEOUT_MS  = Number(arg('timeout', 180000));
const RETRIES     = Number(arg('retries', 1));
const BASELINE    = Number(arg('baseline', 25));
const NONKEEP     = arg('nonkeep', null);
const OUTDIR      = arg('out', 'benchmark/out');

const nonKeepSet = NONKEEP
  ? new Set(JSON.parse(fs.readFileSync(NONKEEP, 'utf8')).map(String))
  : null;

const SEGMENTS = ['FI', 'public', 'private', 'sole_trader'];

// --- tiny CSV parser (handles quoted fields, skips # comments and blanks) ----
function parseCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = [];
    let cur = '', q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        if (c === '"' && raw[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map(s => s.trim()));
  }
  return rows;
}

function loadEntities(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows.shift().map(h => h.toLowerCase());
  const idx = (k) => header.indexOf(k);
  const out = [];
  for (const r of rows) {
    const name = r[idx('name')];
    if (!name) continue;
    const repeat = Math.max(1, Number(r[idx('repeat')] || 1) || 1);
    out.push({
      name,
      country: r[idx('country')] || '',
      segment: r[idx('segment')] || null,
      entityType: r[idx('entitytype')] || null,
      ownershipType: r[idx('ownershiptype')] || null,
      sector: r[idx('sector')] || null,
      repeat,
    });
  }
  return out;
}

// --- one request (POST { companies:[one] }), timed, returns the result obj ----
async function callOnce(entity) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: [{
          companyName: entity.name,
          countryCode: entity.country,
          entityType: entity.entityType || 'Corporate',
          ...(entity.ownershipType ? { ownershipType: entity.ownershipType } : {}),
          ...(entity.sector ? { sector: entity.sector } : {}),
          ...(entity.segment ? { segment: entity.segment } : {}),
          runId,
        }],
      }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    const result = data?.results?.[0] ?? data;
    return { result, timeMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function call(entity) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const { result, timeMs } = await callOnce(entity);
      if (result && result.ok !== false) return { result, timeMs };
      lastErr = result?.error || result?.documentError || 'unknown error';
    } catch (e) {
      lastErr = String(e && e.message ? e.message : e);
    }
  }
  return { result: { ok: false, error: lastErr, input: { companyName: entity.name } }, timeMs: 0 };
}

// --- concurrency pool -------------------------------------------------------
async function runPool(jobs, worker, n) {
  const out = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= jobs.length) break;
      out[i] = await worker(jobs[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// --- stats helpers ----------------------------------------------------------
const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(v => (v - m) ** 2)));
};

// --- score one endpoint result --------------------------------------------
function metricsFor(res, csvRow, timeMin) {
  if (!res || res.ok === false) return null;
  const cov    = res.coverage || res.coverageBefore || {};
  const covB   = res.coverageBefore || cov;
  const schema = res.schema || {};
  const found  = Array.isArray(res.found) ? res.found : [];
  const dr     = res.documentRequirements || {};
  const usage  = res.usage || {};

  const populated = cov.populatedFields ?? found.length;
  const tier1 = found.filter(f => f.sourceTier === 'tier1' || f.sourceTier === 'document').length;
  // evidence = populated field carries a source citation (sourceUrl is often null;
  // the citation lives in the `source` text, so we test that).
  const withEvidence = found.filter(f => f.source && String(f.source).trim()).length;
  const segment = csvRow?.segment
    || (schema.flow === 'fi' ? 'FI' : res.isPubliclyListed ? 'public' : 'private');
  const overcoll = nonKeepSet ? found.filter(f => nonKeepSet.has(String(f.field))).length : null;
  const inTok = usage.input_tokens || 0, outTok = usage.output_tokens || 0;

  return {
    segment,
    jurisdiction: (res.schema && (res.schema.region || res.schema.licenceId)) || 'unknown',
    onboardingCoverage: cov.fillRate ?? null,                 // #1
    questionsAvoided: populated,                              // #2
    questionsRemaining: cov.missingFieldCount ?? null,
    researchReductionPct: BASELINE ? (BASELINE - timeMin) / BASELINE : null, // #3
    evidenceCoverage: found.length ? withEvidence / found.length : null,     // #4
    confHigh: cov.verifiedFields || 0,                        // #5 (verified -> High)
    confMed:  cov.probableFields || 0,                        //    (probable -> Medium)
    confLow:  cov.indicativeFields || 0,                      //    (indicative -> Low)
    confTotal: (cov.verifiedFields || 0) + (cov.probableFields || 0) + (cov.indicativeFields || 0),
    analystMin: BASELINE, platformMin: timeMin,               // #6
    speedup: timeMin > 0 ? BASELINE / timeMin : null,
    analystMinSaved: BASELINE - timeMin,
    completeness: cov.verifiedFillRate ?? null,               // verified coverage
    twoPassLift: res.ranGapRecovery ? ((cov.fillRate || 0) - (covB.fillRate || 0)) : null,
    tier1Share: found.length ? tier1 / found.length : null,
    docMandatory: dr.mandatoryCount ?? null,
    docChecklist: dr.total ?? (Array.isArray(dr.checklist) ? dr.checklist.length : null),
    overcollection: overcoll,
    costUsd: (inTok / 1e6) * 3 + (outTok / 1e6) * 15,         // Sonnet pricing
  };
}

function aggregate(ms) {
  const v = (key) => ms.map(m => m[key]).filter(x => x != null && !Number.isNaN(x));
  const sum = (key) => v(key).reduce((s, x) => s + x, 0);
  const cTot = sum('confTotal');
  return {
    n: ms.length,
    onboardingCoverage: { mean: mean(v('onboardingCoverage')) },
    questionsAvoided:   { mean: mean(v('questionsAvoided')), total: sum('questionsAvoided') },
    questionsRemaining: { mean: mean(v('questionsRemaining')) },
    researchReductionPct: { mean: mean(v('researchReductionPct')) },
    evidenceCoverage:   { mean: mean(v('evidenceCoverage')) },
    confidence: cTot ? { high: sum('confHigh') / cTot, med: sum('confMed') / cTot, low: sum('confLow') / cTot } : { high: null, med: null, low: null },
    platformMin:    { mean: mean(v('platformMin')) },
    speedup:        { mean: mean(v('speedup')) },
    analystMinSaved:{ mean: mean(v('analystMinSaved')) },
    completeness:   { mean: mean(v('completeness')), median: median(v('completeness')) },
    twoPassLift:    { mean: mean(v('twoPassLift')) },
    tier1Share:     { mean: mean(v('tier1Share')) },
    docMandatory:   { mean: mean(v('docMandatory')) },
    docChecklist:   { mean: mean(v('docChecklist')) },
    overcollection: { mean: mean(v('overcollection')) },
    costUsd:        { mean: mean(v('costUsd')), total: sum('costUsd') },
  };
}

// --- main -------------------------------------------------------------------
const entities = loadEntities(ENTITIES);
const runId = crypto.randomUUID(); // ties every entity in this batch to one benchmark_runs row
const jobs = [];
entities.forEach((e, ei) => { for (let k = 0; k < e.repeat; k++) jobs.push({ ...e, _group: ei, _run: k }); });

console.log(`\nRunning ${jobs.length} request(s) across ${entities.length} entit(ies) -> ${ENDPOINT}`);
console.log(`Heads up: live calls take ~60-90s each. At concurrency ${CONCURRENCY} this run may take`
  + ` ~${Math.ceil(jobs.length / CONCURRENCY * 75 / 60)} min and cost roughly $${(jobs.length * 0.5).toFixed(0)} in tokens.\n`);

const t0 = Date.now();
const results = await runPool(jobs, async (job) => {
  const { result, timeMs } = await call(job);
  const okk = result && result.ok !== false;
  process.stdout.write(okk ? '.' : 'x');
  const m = okk ? { ...metricsFor(result, job, timeMs / 60000), name: job.name } : null;
  return { job, result, timeMs, m };
}, CONCURRENCY);
console.log(`\nDone in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min\n`);

const ok = results.filter(x => x.m);
const failed = results.filter(x => !x.m);
const allMetrics = ok.map(x => x.m);

// consistency: groups run more than once
const byGroup = {};
results.forEach(x => { (byGroup[x.job._group] ??= []).push(x); });
const consistency = [];
for (const g of Object.values(byGroup)) {
  const ms = g.map(x => x.m).filter(Boolean);
  if (ms.length < 2) continue;
  consistency.push({
    name: g[0].job.name,
    runs: ms.length,
    coverageStdevPP: Math.round(stdev(ms.map(m => (m.onboardingCoverage || 0) * 100)) * 10) / 10,
    verifiedStdevPP: Math.round(stdev(ms.map(m => (m.completeness || 0) * 100)) * 10) / 10,
  });
}

const overall = aggregate(allMetrics);
const perSeg = {};
for (const s of SEGMENTS) perSeg[s] = aggregate(allMetrics.filter(m => m.segment === s));
const jurisdictions = [...new Set(allMetrics.map(m => m.jurisdiction))];
const perJur = {};
for (const j of jurisdictions) perJur[j] = aggregate(allMetrics.filter(m => m.jurisdiction === j));

// ---- concise console output ----
const f1 = (x) => (x == null ? '   -' : x.toFixed(1));
const fp = (x) => (x == null ? '   -' : pct(x) + '%');
const HDR = 'Group        n  Coverage  Verified  Evidence  Tier1   $/ent  Saved(min)';
const SEP = '----------- --- --------- --------- --------- ------ ------- ----------';
const trow = (label, a) => console.log(
  String(label).padEnd(11), String(a.n).padStart(3),
  fp(a.onboardingCoverage.mean).padStart(9),
  fp(a.completeness.mean).padStart(9),
  fp(a.evidenceCoverage.mean).padStart(9),
  fp(a.tier1Share.mean).padStart(6),
  ('$' + f1(a.costUsd.mean)).padStart(7),
  f1(a.analystMinSaved.mean).padStart(10),
);
console.log('By jurisdiction (the fair comparison — UK and SG schemas differ in size):');
console.log(HDR); console.log(SEP);
for (const j of jurisdictions) if (perJur[j].n) trow(j, perJur[j]);
console.log('\nBy segment:');
console.log(HDR); console.log(SEP);
for (const s of SEGMENTS) if (perSeg[s].n) trow(s, perSeg[s]);
trow('ALL', overall);
console.log(`\nHeadlines:`);
console.log(`  1. Onboarding coverage ...... ${fp(overall.onboardingCoverage.mean)}  (answerable before contacting the customer)`);
console.log(`  2. Customer questions avoided ${f1(overall.questionsAvoided.mean)} per entity (${overall.questionsAvoided.total} total)`);
console.log(`  3. Analyst research reduction ${fp(overall.researchReductionPct.mean)}`);
console.log(`  4. Evidence coverage ........ ${fp(overall.evidenceCoverage.mean)}`);
console.log(`  5. Confidence  High ${fp(overall.confidence.high)} / Med ${fp(overall.confidence.med)} / Low ${fp(overall.confidence.low)}`);
console.log(`  6. Time-to-research ......... analyst ${BASELINE} min vs platform ${f1(overall.platformMin.mean)} min  (${f1(overall.speedup.mean)}x faster)`);
console.log(`     Verified coverage ${fp(overall.completeness.mean)} | Documents ${f1(overall.docChecklist.mean)} (${f1(overall.docMandatory.mean)} mandatory) | Cost $${overall.costUsd.total.toFixed(2)} ($${f1(overall.costUsd.mean)}/entity)`);
if (nonKeepSet) console.log(`     Avg over-collected fields ${f1(overall.overcollection.mean)}`);
if (failed.length) console.log(`     FAILED ${failed.length}: ${failed.map(x => x.result.input?.companyName || x.job.name).join(', ')}`);

// ---- write artifacts ----
fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, 'results.json'),
  JSON.stringify({ overall, perSeg, consistency, raw: results.map(x => x.result) }, null, 2));
fs.writeFileSync(path.join(OUTDIR, 'scorecard.html'), html({ overall, perSeg, perJur, consistency, allMetrics, failed, baseline: BASELINE }));
console.log(`\nWrote ${path.join(OUTDIR, 'results.json')} and ${path.join(OUTDIR, 'scorecard.html')}\n`);
console.log(`Run ID: ${runId}`);

// ---- HTML scorecard ----
function html({ overall, perSeg, perJur, consistency, allMetrics, failed, baseline }) {
  const row = (label, a) => a.n ? `<tr><td>${label}</td><td>${a.n}</td>
    <td>${fp(a.onboardingCoverage.mean)}</td><td>${fp(a.completeness.mean)}</td>
    <td>${fp(a.evidenceCoverage.mean)}</td><td>${fp(a.tier1Share.mean)}</td>
    <td>${fp(a.researchReductionPct.mean)}</td><td>${f1(a.speedup.mean)}x</td>
    <td>$${f1(a.costUsd.mean)}</td><td>${f1(a.platformMin.mean)} min</td>
    <td>${f1(a.analystMinSaved.mean)} min</td></tr>` : '';
  const detail = allMetrics.map(m => `<tr><td>${m.name}</td><td>${m.segment}</td>
    <td>${fp(m.onboardingCoverage)}</td><td>${fp(m.completeness)}</td>
    <td>${fp(m.evidenceCoverage)}</td><td>${m.questionsAvoided}</td>
    <td>${fp(m.researchReductionPct)}</td><td>$${f1(m.costUsd)}</td>
    <td>${f1(m.platformMin)} min</td></tr>`).join('');
  const cons = consistency.length
    ? `<h2>Consistency (repeat runs)</h2><table><tr><th>Entity</th><th>Runs</th>
       <th>Coverage stdev (pp)</th><th>Verified stdev (pp)</th></tr>
       ${consistency.map(c => `<tr><td>${c.name}</td><td>${c.runs}</td>
       <td>${c.coverageStdevPP}</td><td>${c.verifiedStdevPP}</td></tr>`).join('')}</table>`
    : '';
  const cf = overall.confidence;
  return `<!doctype html><meta charset=utf8><title>KYC Agent Benchmark</title>
<style>
 body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:32px;color:#1a1a1a}
 h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin:0 0 24px}
 .cards{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 24px}
 .card{flex:1;min-width:150px;border:1px solid #e5e5e5;border-radius:10px;padding:16px}
 .card .v{font-size:24px;font-weight:600} .card .l{color:#666;font-size:12px;margin-top:4px}
 table{border-collapse:collapse;width:100%;margin:8px 0 28px;font-size:13px}
 th,td{border-bottom:1px solid #eee;padding:8px 10px;text-align:right}
 th:first-child,td:first-child{text-align:left} th{color:#666;font-weight:600}
 h2{font-size:15px;margin:24px 0 6px}
 .bar{display:flex;height:22px;border-radius:6px;overflow:hidden;max-width:420px;font:11px/22px sans-serif;color:#fff;text-align:center}
</style>
<h1>KYC Agent &mdash; Benchmark Scorecard</h1>
<p class=sub>${new Date().toISOString().slice(0,16).replace('T',' ')} &middot; ${overall.n} entities &middot; analyst baseline ${baseline} min</p>
<div class=cards>
 <div class=card><div class=v>${fp(overall.onboardingCoverage.mean)}</div><div class=l>1. Onboarding coverage</div></div>
 <div class=card><div class=v>${f1(overall.questionsAvoided.mean)}</div><div class=l>2. Questions avoided / entity</div></div>
 <div class=card><div class=v>${fp(overall.researchReductionPct.mean)}</div><div class=l>3. Analyst research reduction</div></div>
 <div class=card><div class=v>${fp(overall.evidenceCoverage.mean)}</div><div class=l>4. Evidence coverage</div></div>
 <div class=card><div class=v>${f1(overall.speedup.mean)}x</div><div class=l>6. Faster than analyst</div></div>
</div>
<h2>5. Confidence distribution</h2>
<div class=bar>
 <span style="width:${(cf.high||0)*100}%;background:#16a34a">${fp(cf.high)}</span>
 <span style="width:${(cf.med||0)*100}%;background:#d97706">${fp(cf.med)}</span>
 <span style="width:${(cf.low||0)*100}%;background:#dc2626">${fp(cf.low)}</span>
</div>
<p class=sub style="margin-top:6px">High (verified) / Medium (probable) / Low (indicative) across populated fields</p>
<h2>By jurisdiction <span style="font-weight:400;color:#888">(fair comparison — UK and SG schemas differ in size)</span></h2>
<table><tr><th>Jurisdiction</th><th>n</th><th>Coverage</th><th>Verified</th><th>Evidence</th><th>Tier1</th>
 <th>Research&nbsp;cut</th><th>Speedup</th><th>$/ent</th><th>Platform</th><th>Saved</th></tr>
 ${Object.keys(perJur).map(j=>row(j,perJur[j])).join('')}
 ${row('<b>All</b>',overall)}</table>
<h2>By segment</h2>
<table><tr><th>Segment</th><th>n</th><th>Coverage</th><th>Verified</th><th>Evidence</th><th>Tier1</th>
 <th>Research&nbsp;cut</th><th>Speedup</th><th>$/ent</th><th>Platform</th><th>Saved</th></tr>
 ${SEGMENTS.map(s=>row(s,perSeg[s])).join('')}
 ${row('<b>All</b>',overall)}</table>
${cons}
<h2>Per entity</h2>
<table><tr><th>Entity</th><th>Segment</th><th>Coverage</th><th>Verified</th><th>Evidence</th>
 <th>Q&nbsp;avoided</th><th>Research&nbsp;cut</th><th>$</th><th>Platform</th></tr>${detail}</table>
${failed.length?`<h2 style=color:#b00>Failed (${failed.length})</h2><p>${failed.map(x=>(x.result.input?.companyName||x.job.name)+': '+x.result.error).join('<br>')}</p>`:''}
`;
}
