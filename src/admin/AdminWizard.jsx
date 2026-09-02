import React, { useState } from "react";
import { adminColors, adminStyles } from "./adminDesign";
import AdminStepIndicator from "./components/AdminStepIndicator";
import StepCompany from "./steps/StepCompany";
import StepLicences from "./steps/StepLicences";
import StepEntityTypes from "./steps/StepEntityTypes";
import StepSchemas from "./steps/StepSchemas";
import StepDocuments from "./steps/StepDocuments";
import StepSources from "./steps/StepSources";
import StepPublish from "./steps/StepPublish";

const STEPS = [
  { n: 1, label: "Company",      Component: StepCompany,      title: "Company Setup" },
  { n: 2, label: "Licences",     Component: StepLicences,     title: "Licences" },
  { n: 3, label: "Entity Types", Component: StepEntityTypes,  title: "Entity Types" },
  { n: 4, label: "Schemas",      Component: StepSchemas,      title: "Field Schemas" },
  { n: 5, label: "Documents",    Component: StepDocuments,    title: "Document Collection" },
  { n: 6, label: "Sources",      Component: StepSources,      title: "Source Classification" },
  { n: 7, label: "Publish",      Component: StepPublish,      title: "Review & Publish" },
];

// 7-step wizard shell. Step navigation is unconstrained: the step indicator,
// Back, and Continue all just change `currentStep`; data is never reset, so
// jumping around is a non-destructive review action.
export default function AdminWizard({
  localConfig,
  onConfigChange,
  onExit,
  onPublish,
  startAtStep = 1,
  adminToken,
  tenantId,
  onPublishSuccess,
  resumed = false,
}) {
  const [currentStep, setCurrentStep] = useState(
    Math.min(Math.max(startAtStep, 1), STEPS.length)
  );

  const step = STEPS[currentStep - 1];
  const StepComponent = step.Component;
  const isPublishStep = currentStep === 7;
  const prevStep = STEPS[currentStep - 2];

  function jumpTo(n) {
    const clamped = Math.min(Math.max(n, 1), STEPS.length);
    setCurrentStep(clamped);
  }

  function next() {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    } else if (onPublish) {
      onPublish();
    }
  }

  function back() {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  }

  return (
    <div style={adminStyles.wizardWrapper}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          background: "#fff",
          borderBottom: `1px solid ${adminColors.border}`,
        }}
      >
        <button
          type="button"
          onClick={onExit}
          style={{
            ...adminStyles.btnGhost,
            color: adminColors.textMuted,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ← Exit to Dashboard
        </button>
        <div style={{ fontSize: 14, fontWeight: 800, color: adminColors.text }}>
          Admin Setup
        </div>
        <div style={{ fontSize: 12, color: adminColors.textMuted }}>
          Step {currentStep} of {STEPS.length}
        </div>
      </div>

      <AdminStepIndicator
        currentStep={currentStep}
        steps={STEPS.map((s) => s.label)}
        onClick={jumpTo}
      />

      {resumed && currentStep === startAtStep && (
        <div style={{ textAlign: "center", padding: "6px 16px 0", fontSize: 12, color: adminColors.brandBlue, fontWeight: 600 }}>
          Resuming from where you left off — Step {currentStep} of {STEPS.length}
        </div>
      )}

      <div style={{ flex: 1, padding: "16px 16px 96px" }}>
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto 12px",
            padding: "0 8px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: adminColors.textMuted,
          }}
        >
          Step {currentStep} of {STEPS.length} — {step.title}
        </div>
        {isPublishStep ? (
          <StepPublish
            config={localConfig}
            onChange={onConfigChange}
            adminToken={adminToken}
            tenantId={tenantId}
            onPublishSuccess={onPublishSuccess}
          />
        ) : (
          <StepComponent
            config={localConfig}
            onChange={onConfigChange}
            isStandalone={false}
          />
        )}
      </div>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "#fff",
          borderTop: `1px solid ${adminColors.border}`,
          padding: "14px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            maxWidth: 720,
            alignItems: "center",
          }}
        >
          <div>
            {currentStep > 1 && (
              <button type="button" onClick={back} style={adminStyles.btnSecondary}>
                ← Back{prevStep ? ` to ${prevStep.label}` : ""}
              </button>
            )}
          </div>
          {isPublishStep ? (
            <button
              type="button"
              onClick={() => onPublish && onPublish()}
              style={adminStyles.btnPrimary}
              title="Publish from the bottom bar (same as the in-step Publish button)"
            >
              Publish Configuration
            </button>
          ) : (
            <button type="button" onClick={next} style={adminStyles.btnPrimary}>
              Continue →
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: adminColors.textMuted }}>
          Your progress is saved automatically
        </div>
      </div>
    </div>
  );
}
