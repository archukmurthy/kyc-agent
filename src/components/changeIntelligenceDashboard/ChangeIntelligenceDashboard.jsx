/**
 * ChangeIntelligenceDashboard.jsx — standalone, READ-ONLY dashboard over
 * change_events. Two reading depths on one page: a headline strip anyone can read
 * in five seconds, and detail beneath for Archana.
 *
 * It only fetches /api/change-intelligence-metrics and renders. ALL aggregation
 * lives server-side in src/changeIntelligence/dashboardMetrics.js — this
 * component computes no metrics. No writes, no journey data, no charting library
 * (bars are plain divs, matching the rest of the app).
 *
 * Honesty about sample size is built in: every headline and chart shows the
 * onboarding/event count it's based on, and an "early data" note appears while
 * the sample is small. Empty data renders "no change data yet", never a broken
 * chart.
 */

import React, { useEffect, useState } from "react";

const C = {
  bg: "#f4f6f9",
  card: "#ffffff",
  border: "#e2e8f0",
  ink: "#1a3a4a",
  muted: "#64748b",
  blue: "#0b3d91",
  bar: "#4a9e8e",
  barAlt: "#0891b2",
  warn: "#9d6500",
  warnBg: "#fff8ed",
  danger: "#b91c1c",
};

const page = { minHeight: "100vh", background: C.bg, padding: "28px 24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: C.ink };
const wrap = { maxWidth: 1100, margin: "0 auto" };
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 15, fontWeight: 700, margin: "0 0 2px" };
const sectionSub = { fontSize: 12, color: C.muted, margin: "0 0 14px" };

function EarlyDataNote({ onboardings, threshold }) {
  return (
    <div style={{ display: "inline-block", background: C.warnBg, border: "1px solid #fcd9a8", color: C.warn, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999 }}>
      Early data — based on {onboardings} onboarding{onboardings === 1 ? "" : "s"}, not yet a stable trend
    </div>
  );
}

function Headline({ label, value, sampleSize, hint, tone }) {
  return (
    <div style={{ flex: "1 1 200px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 18px 14px" }} title={hint || undefined}>
      <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, color: tone === "danger" ? C.danger : C.ink }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>based on {sampleSize} onboarding{sampleSize === 1 ? "" : "s"}</div>
      {hint && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// Horizontal bar list. rows: [{ label, count, sub }]. Width is relative to max.
function BarList({ rows, color = C.bar, emptyText = "No data yet." }) {
  if (!rows || rows.length === 0) return <div style={{ fontSize: 12.5, color: C.muted }}>{emptyText}</div>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 200, fontSize: 12.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>
            {r.label}{r.sub ? <span style={{ color: C.muted }}> · {r.sub}</span> : null}
          </div>
          <div style={{ flex: 1, background: "#eef2f6", borderRadius: 6, height: 18, position: "relative" }}>
            <div style={{ width: `${Math.round((r.count / max) * 100)}%`, minWidth: 2, background: color, height: "100%", borderRadius: 6 }} />
          </div>
          <div style={{ width: 36, textAlign: "right", fontSize: 12.5, fontWeight: 700 }}>{r.count}</div>
        </div>
      ))}
    </div>
  );
}

function fmtDate(s) {
  if (!s) return "";
  try { return new Date(s).toISOString().slice(0, 16).replace("T", " "); } catch (_) { return String(s); }
}

export default function ChangeIntelligenceDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/change-intelligence-metrics")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div style={page}><div style={wrap}><div style={{ color: C.muted, fontSize: 14 }}>Loading change intelligence…</div></div></div>;
  }
  if (error || !data) {
    return <div style={page}><div style={wrap}><div style={{ ...card, color: C.danger }}>Couldn't load metrics{error ? `: ${error}` : ""}.</div></div></div>;
  }

  const { meta, headline, detail } = data;
  const noData = meta.totalEvents === 0;

  return (
    <div style={page}>
      <div style={wrap}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>Change Intelligence</h1>
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            How accurate the AI is, which fields get corrected, and what needed a human — drawn only from recorded changes.
          </p>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.muted }}>{meta.totalEvents} change event{meta.totalEvents === 1 ? "" : "s"} · {meta.onboardings} onboarding{meta.onboardings === 1 ? "" : "s"}</span>
            {meta.earlyData && <EarlyDataNote onboardings={meta.onboardings} threshold={meta.earlyDataThreshold} />}
          </div>
        </div>

        {noData ? (
          <div style={{ ...card, textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>No change data yet</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>
              As customers confirm and correct AI-prefilled fields, this dashboard fills in. Headline accuracy, correction
              hotspots, and escalations will appear here.
            </div>
          </div>
        ) : null}

        {/* ── Headline strip ── */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <Headline label="Corrections captured" value={headline.correctionsCaptured.value} sampleSize={headline.correctionsCaptured.sampleSize}
            hint="Total current (non-superseded) corrections. change_events has no count of accepted fields, so this is a count — not an accuracy rate (see D1)." />
          <Headline label="AI-error corrections" value={headline.aiErrorCorrections.value} sampleSize={headline.aiErrorCorrections.sampleSize}
            hint="Corrections the customer marked as fixing the AI (intent = ai_correction), vs a genuine company change." />
          <Headline label="Back-and-forth pre-empted" value={headline.rfiPreempted.value} sampleSize={headline.rfiPreempted.sampleSize}
            hint={headline.rfiPreempted.definition} />
          <Headline label="Escalations flagged" value={headline.escalationsFlagged.value} sampleSize={headline.escalationsFlagged.sampleSize} tone="danger"
            hint="Standing changes flagged for escalation (escalation = true)." />
        </div>

        {/* ── Detail ── */}
        <div style={card}>
          <h2 style={h2}>AI accuracy by field — where research is weakest</h2>
          <p style={sectionSub}>Current corrections grouped by field, most-corrected first. Based on {meta.currentChanges} standing change{meta.currentChanges === 1 ? "" : "s"}.</p>
          <BarList rows={detail.byField.slice(0, 15).map((f) => ({ label: f.fieldId, sub: f.fieldClass, count: f.count }))} emptyText="No corrections recorded yet." />
        </div>

        <div style={card}>
          <h2 style={h2}>Correction hotspots by field class</h2>
          <p style={sectionSub}>Which kinds of field change most often.</p>
          <BarList rows={detail.byFieldClass.map((f) => ({ label: f.fieldClass || "unknown", count: f.count }))} color={C.barAlt} emptyText="No corrections recorded yet." />
        </div>

        <div style={card}>
          <h2 style={h2}>AI-error vs genuine update</h2>
          <p style={sectionSub}>Is the AI wrong, or did the company genuinely change? The quality-feedback loop.</p>
          <BarList
            rows={[
              { label: "AI error (ai_correction)", count: detail.intentSplit.overall.ai_correction },
              { label: "Genuine update", count: detail.intentSplit.overall.genuine_update },
              { label: "Other / unspecified", count: detail.intentSplit.overall.other },
            ]}
            emptyText="No corrections recorded yet."
          />
          {detail.intentSplit.byFieldClass.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "6px 8px" }}>Field class</th>
                  <th style={{ padding: "6px 8px" }}>AI error</th>
                  <th style={{ padding: "6px 8px" }}>Genuine</th>
                  <th style={{ padding: "6px 8px" }}>Other</th>
                </tr>
              </thead>
              <tbody>
                {detail.intentSplit.byFieldClass.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.fieldClass}</td>
                    <td style={{ padding: "6px 8px" }}>{r.ai_correction}</td>
                    <td style={{ padding: "6px 8px" }}>{r.genuine_update}</td>
                    <td style={{ padding: "6px 8px" }}>{r.other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <h2 style={h2}>Source accuracy — which sources cause corrections</h2>
          <p style={sectionSub}>
            Corrections grouped by the source that supplied the original value.
            {detail.sourceCoverage.sparse && <span style={{ color: C.warn }}> Note: source provenance is sparse ({detail.sourceCoverage.populated}/{detail.sourceCoverage.total} corrections carry a source) — read with caution.</span>}
          </p>
          <BarList rows={detail.bySource.map((s) => ({ label: s.sourceProvider, count: s.count }))} color={C.barAlt} emptyText="No corrections recorded yet." />
        </div>

        <div style={card}>
          <h2 style={h2}>Escalations & failure-fallbacks — what needed a human and why</h2>
          <p style={sectionSub}>Standing escalations, plus re-research failures that dropped the customer to manual entry.</p>
          {detail.escalations.length === 0 && detail.failureFallbacks.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.muted }}>None recorded.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "6px 8px" }}>Type</th>
                  <th style={{ padding: "6px 8px" }}>Field</th>
                  <th style={{ padding: "6px 8px" }}>Reason</th>
                  <th style={{ padding: "6px 8px" }}>When</th>
                </tr>
              </thead>
              <tbody>
                {detail.escalations.map((e, i) => (
                  <tr key={`e${i}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px", color: C.danger, fontWeight: 600 }}>Escalation</td>
                    <td style={{ padding: "6px 8px" }}>{e.fieldId}</td>
                    <td style={{ padding: "6px 8px" }}>{e.reason || "—"}</td>
                    <td style={{ padding: "6px 8px", color: C.muted }}>{fmtDate(e.createdAt)}</td>
                  </tr>
                ))}
                {detail.failureFallbacks.map((f, i) => (
                  <tr key={`f${i}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px", color: C.warn, fontWeight: 600 }}>Re-research failed → manual</td>
                    <td style={{ padding: "6px 8px" }}>{f.fieldId}</td>
                    <td style={{ padding: "6px 8px" }}>{f.reason || "—"}{f.stage ? ` (${f.stage})` : ""}</td>
                    <td style={{ padding: "6px 8px", color: C.muted }}>{fmtDate(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <h2 style={h2}>Undecided monitor</h2>
          <p style={sectionSub}>Changes the engine couldn't classify (UNDECIDED → analyst review). A live view of which pending policy decisions are actually being hit.</p>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{detail.undecided.count}</div>
          <div style={{ fontSize: 11, color: C.muted }}>undecided event{detail.undecided.count === 1 ? "" : "s"} · based on {detail.undecided.sampleSize} onboarding{detail.undecided.sampleSize === 1 ? "" : "s"}</div>
        </div>

        <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 8 }}>
          Read-only · drawn entirely from recorded change events. Journey, funnel, and turnaround metrics arrive when journey
          state is wired (register PR-038 / PR-022 / PR-002).
        </div>
      </div>
    </div>
  );
}
