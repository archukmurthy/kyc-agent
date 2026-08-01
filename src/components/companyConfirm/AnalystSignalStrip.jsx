/**
 * AnalystSignalStrip.jsx — the build-time "test view" strip (commit 5).
 *
 * NAMED to differ from analystSignals.js by more than case. Module resolution
 * tries `.js` before `.jsx`, and on a case-insensitive filesystem (Windows,
 * macOS) an `AnalystSignals.jsx` component would silently resolve to the
 * `analystSignals.js` helper — rendering a plain function as a component, which
 * returns null and makes the whole strip vanish with no error. Keep the two
 * names distinct.
 *
 * Shows what the change engine actually decided for a row: the registry
 * mismatch, the workflow and matched rule, any document/escalation/EDD flag,
 * and — for field classes with no machinery behind them — an explicit "no
 * automated consequence" placeholder rather than a fabricated signal.
 *
 * SILENCE-LATER IS THE CONTRACT: this component renders NOTHING unless `show`
 * is true. The caller passes SHOW_TEST_TOOLS, so flipping that one flag off for
 * real customers removes every trace of this from the page. It is deliberately
 * a prop rather than an import of the flag, so the guarantee is directly
 * testable rather than dependent on module-load environment.
 *
 * Read-only: it displays; it never writes events, re-classifies, or affects
 * routing or the submit gate.
 */

import React from "react";
import { signalLines } from "./analystSignals";

const SLATE = "#334155";
const SLATE_BORDER = "#94a3b8";
const SLATE_BG = "#f1f5f9";

export function AnalystSignalStrip({ show = false, signal = null, fieldId = null }) {
  if (!show || !signal) return null;
  const lines = signalLines(signal);
  if (!lines.length) return null;

  const isType2 = signal.type === "type2";

  return (
    <div
      data-testid="analyst-signals"
      style={{
        marginTop: 8,
        padding: "8px 10px",
        background: SLATE_BG,
        border: `1px dashed ${SLATE_BORDER}`,
        borderRadius: 8,
        fontSize: 11.5,
        color: SLATE,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
            color: "#fff", background: SLATE, borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap",
          }}
        >
          🔧 test view
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: SLATE, opacity: 0.75 }}>
          {isType2 ? "no engine consequence" : "analyst signal"}
          {fieldId ? ` · ${fieldId}` : ""}
        </span>
        <span style={{ fontSize: 10, color: SLATE, opacity: 0.6 }}>
          not shown to customers
        </span>
      </div>

      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {lines.map((line, i) => (
          <li key={i} style={{ marginBottom: 2 }}>{line}</li>
        ))}
      </ul>

      {/* Raw engine fields, so a tester can see the decision verbatim rather
          than only our phrasing of it. */}
      <div style={{ marginTop: 5, fontSize: 10, opacity: 0.75, wordBreak: "break-word" }}>
        <code>
          class={signal.fieldClass} · workflow={signal.workflow}
          {signal.matchedRule ? ` · rule=${signal.matchedRule}` : ""}
          {signal.docType ? ` · doc=${signal.docType}` : ""}
          {signal.intent ? ` · intent=${signal.intent}` : ""}
          {signal.registryClaim ? ` · registry=${signal.registryClaim}` : ""}
          {signal.verifiability ? ` · verifiability=${signal.verifiability}` : ""}
        </code>
      </div>
    </div>
  );
}

export default AnalystSignalStrip;
