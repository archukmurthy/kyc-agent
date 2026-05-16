import React from "react";
import { adminColors } from "../adminDesign";

const STEP_LABELS = [
  "Company",
  "Licences",
  "Entity Types",
  "Schemas",
  "Documents",
  "Sources",
  "Publish",
];

export default function AdminStepIndicator({ currentStep, steps = STEP_LABELS }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "20px 16px 12px",
        background: "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0, flexWrap: "wrap", maxWidth: 920 }}>
        {steps.map((label, i) => {
          const n = i + 1;
          const isCurrent = n === currentStep;
          const isComplete = n < currentStep;
          const isLast = i === steps.length - 1;

          return (
            <React.Fragment key={label}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 76 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    background: isComplete
                      ? adminColors.statusComplete
                      : isCurrent
                      ? adminColors.niumBlue
                      : "#fff",
                    color: isComplete || isCurrent ? "#fff" : adminColors.textMuted,
                    border: isCurrent
                      ? `3px solid rgba(11,61,145,0.22)`
                      : `1.5px solid ${isComplete ? adminColors.statusComplete : adminColors.border}`,
                    transition: "all .15s",
                  }}
                >
                  {isComplete ? "✓" : n}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: isCurrent ? 700 : 500,
                    color: isCurrent ? adminColors.text : adminColors.textMuted,
                    marginTop: 6,
                    textAlign: "center",
                    maxWidth: 76,
                    lineHeight: 1.2,
                  }}
                >
                  {label}
                </div>
              </div>
              {!isLast && (
                <div
                  style={{
                    flex: 1,
                    minWidth: 24,
                    height: 2,
                    background: n < currentStep ? adminColors.statusComplete : adminColors.border,
                    marginTop: 14,
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
