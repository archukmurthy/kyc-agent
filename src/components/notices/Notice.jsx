/**
 * Notice.jsx — the ONE three-tier notice system for the Confirm page, defined
 * here once and reused wherever a customer-facing notice appears (the capture
 * dialogue's outcome notices and the Confirm-row source-confidence messages).
 *
 * The visual weight matches what is being asked of the customer:
 *   Tier 1 — calm, nothing required     (ops_review / silent outcomes)
 *   Tier 2 — verify/confirm, non-blocking (company / lower-confidence source)
 *   Tier 3 — must act, usually upload     (doc_required) — the most conspicuous
 *
 * ACCESSIBILITY (non-negotiable): the tiers are distinguishable by COLOUR + ICON
 * + LABEL together, never colour alone. A meaningful share of users don't
 * reliably tell colours apart, and in a compliance flow a customer must never
 * miss a required action because two shades looked alike. The <Notice> component
 * always renders the tier's icon and its worded label alongside the colour, so
 * this guarantee can't be forgotten at a call site.
 *
 * Presentation only — no logic, no state. Tier colours reuse the app's existing
 * token palette (App.js `C`): success (teal), warning (amber), plus a stronger
 * orange for the action-required tier so it reads as distinct from Tier 2.
 */

import React from "react";

export const NOTICE_TIERS = {
  // Tier 1 — calm. The change is recorded; nothing is required from the customer.
  tier1: {
    label: "No action needed",
    icon: "✓",
    box: { background: "#dff2ec", border: "1px solid #9fd8c8" },
    accent: "#1a6b56",
  },
  // Tier 2 — verify/confirm. Noticeable, non-blocking. Distinct amber.
  tier2: {
    label: "Please confirm",
    icon: "❓",
    box: { background: "#fff1d6", border: "1px solid #e8c98a" },
    accent: "#8c5500",
  },
  // Tier 3 — action required (usually a document upload). The most conspicuous:
  // stronger orange, a left accent band, bold — hard to skip.
  tier3: {
    label: "Action required",
    icon: "⚠",
    box: { background: "#ffe9d6", border: "1px solid #fb923c", borderLeft: "4px solid #ea580c" },
    accent: "#9a3412",
  },
};

const baseBox = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  marginTop: 8,
  padding: "9px 12px",
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.5,
};

/**
 * <Notice tier="tier1|tier2|tier3">message</Notice>
 * Renders icon + worded label + message in the tier's colour. `style` merges in
 * for per-site spacing; `testId` overrides the default data-testid.
 */
export function Notice({ tier = "tier1", children, style, testId }) {
  const t = NOTICE_TIERS[tier] || NOTICE_TIERS.tier1;
  return (
    <div
      data-testid={testId || `notice-${tier}`}
      data-notice-tier={tier}
      style={{ ...baseBox, ...t.box, color: t.accent, ...style }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 14, lineHeight: 1.3 }}>
        {t.icon}
      </span>
      <span>
        <strong style={{ fontWeight: 700 }}>{t.label}.</strong>{" "}
        <span style={{ fontWeight: 400 }}>{children}</span>
      </span>
    </div>
  );
}

export default Notice;
