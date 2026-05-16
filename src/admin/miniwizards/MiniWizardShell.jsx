import React from "react";
import AdminStepIndicator from "../components/AdminStepIndicator";
import { adminColors, adminStyles } from "../adminDesign";

// Compact wizard chrome used by the three dashboard mini-wizards. Renders the
// step labels, the active step's content, and a bottom nav that calls back
// into the parent for prev/next/done.
export default function MiniWizardShell({
  title,
  steps,
  currentStep,
  onPrev,
  onNext,
  onCancel,
  nextLabel,
  nextDisabled,
  children,
}) {
  const isLast = currentStep === steps.length;

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${adminColors.border}`,
        borderRadius: 14,
        boxShadow: "0 1px 4px rgba(0,0,0,.04)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${adminColors.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <button type="button" onClick={onCancel} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted, fontSize: 13 }}>
          ← Exit
        </button>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 12, color: adminColors.textMuted }}>
          Step {currentStep} of {steps.length}
        </div>
      </div>

      <AdminStepIndicator currentStep={currentStep} steps={steps} />

      <div style={{ padding: "10px 16px 18px" }}>{children}</div>

      <div
        style={{
          padding: "12px 18px",
          borderTop: `1px solid ${adminColors.border}`,
          background: adminColors.wizardBg,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          {currentStep > 1 && (
            <button type="button" onClick={onPrev} style={adminStyles.btnSecondary}>
              ← Back
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          style={{ ...adminStyles.btnPrimary, opacity: nextDisabled ? 0.5 : 1, cursor: nextDisabled ? "not-allowed" : "pointer" }}
        >
          {nextLabel || (isLast ? "Done" : "Continue →")}
        </button>
      </div>
    </div>
  );
}
