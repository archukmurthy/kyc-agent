import React from "react";
import { adminStyles, adminColors } from "../adminDesign";

// Reusable card wrapper for wizard steps and standalone forms. Pass a title /
// subtitle for the header band, or omit both for a bare card. Children render
// inside with default padding.
export default function WizardCard({ title, subtitle, children, footer, style }) {
  return (
    <div style={{ ...adminStyles.wizardCard, ...(style || {}) }}>
      {(title || subtitle) && (
        <div style={{ marginBottom: 24 }}>
          {title && (
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: adminColors.text }}>
              {title}
            </h2>
          )}
          {subtitle && (
            <p style={{ fontSize: 14, color: adminColors.textMuted, margin: "6px 0 0" }}>
              {subtitle}
            </p>
          )}
        </div>
      )}
      {children}
      {footer && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${adminColors.border}` }}>
          {footer}
        </div>
      )}
    </div>
  );
}
