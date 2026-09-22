import React, { useState } from "react";
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

// Step indicator for AdminWizard / mini-wizards. Every bubble (and its label)
// is clickable when an `onClick` handler is supplied — complete, current and
// future steps alike — so users can freely jump in either direction.
export default function AdminStepIndicator({ currentStep, steps = STEP_LABELS, onClick }) {
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
              <StepBubble
                n={n}
                label={label}
                isCurrent={isCurrent}
                isComplete={isComplete}
                onClick={onClick ? () => onClick(n) : null}
              />
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

function StepBubble({ n, label, isCurrent, isComplete, onClick }) {
  const [hover, setHover] = useState(false);
  const clickable = !!onClick;

  const bubbleBg = isComplete
    ? adminColors.statusComplete
    : isCurrent
    ? adminColors.brandBlue
    : "#fff";

  const hoverBg = isComplete
    ? "#3D9244"
    : isCurrent
    ? "#0E48A8"
    : adminColors.wizardBg;

  return (
    <button
      type={clickable ? "button" : undefined}
      onClick={onClick || undefined}
      onMouseEnter={() => clickable && setHover(true)}
      onMouseLeave={() => clickable && setHover(false)}
      title={clickable ? `Go to ${label}` : undefined}
      disabled={!clickable}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minWidth: 76,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: clickable ? "pointer" : "default",
        fontFamily: "inherit",
      }}
    >
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
          background: hover ? hoverBg : bubbleBg,
          color: isComplete || isCurrent ? "#fff" : adminColors.textMuted,
          border: isCurrent
            ? `3px solid rgba(11,61,145,0.22)`
            : `1.5px solid ${isComplete ? adminColors.statusComplete : adminColors.border}`,
          transition: "all .15s",
          boxShadow: hover ? "0 2px 8px rgba(11,61,145,0.18)" : "none",
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
          textDecoration: hover && clickable ? "underline" : "none",
        }}
      >
        {label}
      </div>
    </button>
  );
}
