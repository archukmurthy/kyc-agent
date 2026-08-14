/**
 * FillGapsPage.jsx — the Fill Gaps step of the onboarding wizard.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. renderGapSection
 * and the page's JSX moved here VERBATIM — the bodies below are the same text
 * that ran in App.js. What changed is only how they get their data: they used to
 * close over App's scope, and now arrive through the prop interface declared on
 * the component.
 *
 * gapSectionOrder did NOT move, despite reading as part of the same cluster: at
 * the time of the extraction the pre-boarding/dossier path called it too (via
 * App.js#getGapSections), so it stayed in App.js and is drilled. Same rule the
 * earlier slices followed — anything with a consumer outside this page stays
 * put. That second consumer has since been deleted as superseded legacy, so
 * this page is now its only caller; the drill is kept rather than churned.
 *
 * THIS ONE AUTHORED ITS OWN BOUNDARY. Confirm, Applicant and slice 1 each had a
 * named render function to relocate; this page was inline JSX in App's return,
 * so there was nothing to lift — the component had to be invented around it.
 * That is precisely why the oracle (FillGapsPage.render.test.jsx, 20 tests)
 * was written first, and why it must stay green UNCHANGED: "I moved a function"
 * is checkable by eye, "I invented a boundary" is not.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS, destructured back into
 * locals of the same name, so the moved bodies stay byte-identical.
 *
 * THIS COMPONENT OWNS NO STATE. Everything is drilled:
 *
 *   - gapRef crosses AS A REF and setFormVersion is not needed here at all —
 *     the write path is updateGap, which App owns and which bumps the version
 *     itself. renderGapSection reads gapRef.current at render time. Do NOT lift
 *     these values into state: that re-renders the form on every keystroke and
 *     loses input focus. See CLAUDE.md.
 *   - dialogueStateRef crosses AS A REF and is read via .current inside the
 *     render, NOT snapshotted into a prop value. Snapshotting it would freeze
 *     the Confirm-dialogue outcomes and stop live document requests reaching
 *     the Amendment Documentation panel.
 *   - fillTestData, validateStakeholders, allGapsFilled and the whole gap
 *     machinery (getCombinedGaps / updateGap / dependsOnSatisfied) stay in
 *     App.js. Their call sites moved; the functions did not.
 *
 * The <StakeholderGapForms/> mount is passed through exactly as slice 1 left
 * it — same eleven props, same order. This component receives them and hands
 * them straight down; it does not re-wire the cluster.
 */

import React from "react";
import { SHOW_TEST_TOOLS } from "../../constants/appConstants";
import { StableInput } from "../inputs/StableInput";
import AmendmentDocuments from "../amendmentDocuments/AmendmentDocuments";
import { docsNeededFrom } from "../companyConfirm/confirmState";
import { humaniseSection } from "../companyConfirm/foundTableHelpers";
import { StakeholderGapForms } from "./StakeholderGapForms";

export function FillGapsPage({
  // ── research + schema ──
  research,
  activeSchema,
  // ── the gap machinery, all App-owned ──
  getCombinedGaps,
  gapSectionOrder,
  dependsOnSatisfied,
  updateGap,
  gapRef,
  allGapsFilled,
  sectionConfig,
  customQuestions,
  fillTestData,
  // ── people: the validator stays in App, the rest is passed through to
  //    StakeholderGapForms untouched ──
  validateStakeholders,
  stakeholderErrors,
  setStakeholderErrors,
  effectivelyListed,
  getStakeholders,
  updateStakeholderField,
  addStakeholder,
  removeStakeholder,
  isStkFieldConfirmed,
  stkCorrectedFields,
  stkHasCorrections,
  // ── amendment documents ──
  dossierId,
  onboardingSubmissionId,
  amendmentUploads,
  setAmendmentUploads,
  dialogueStateRef,
  // ── page chrome + navigation ──
  jurisdictionBadge,
  entityBadge,
  step,
  STEPS,
  scrollAndSetStep,
  error,
  setError,
  Btn,
  cardStyle: card,
}) {

  const renderGapSection = (sectionKey) => {
    // "Additional Documents" (documents) section hidden on the Fill Gaps page
    // for all flows (FI / Corporate, AI-only / document+AI) per request. Kept
    // restorable: remove this guard to bring the section back.
    if (sectionKey === "documents") return null;
    const items = getCombinedGaps()
      .filter(g => g.section === sectionKey)
      .filter(dependsOnSatisfied);
    if (items.length === 0) return null;
    const cfg = sectionConfig[sectionKey] || { title: humaniseSection(sectionKey), icon: "📋", sub: "", twoCol: true };

    return (
      <div style={card} key={sectionKey}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{cfg.icon} {cfg.title}</h3>
        <p style={{ fontSize: 12, color: "#1a3a4a60", margin: "0 0 14px" }}>{cfg.sub}</p>
        <div style={cfg.twoCol ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" } : {}}>
          {items.map(g => <StableInput key={g.field} id={g.field} label={g.label} type={g.inputType} value={gapRef.current[g.field] || ""} onUpdate={updateGap} required={g.required} options={g.options} placeholder={g.placeholder || ("Enter " + g.label.toLowerCase())} />)}
        </div>
        {/* Part 8 — analyst custom questions (from pre-boarding) wired into the
            customer's Fill Gaps for this section, rendered as fillable fields. */}
        {customQuestions.filter(q => q.section === sectionKey).map(q => (
          <div key={q.id} style={{ marginBottom: 4 }}>
            <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "1px 6px", marginBottom: 4, textTransform: "uppercase" }}>Additional</span>
            <StableInput
              id={`custom_${q.id}`}
              label={q.question}
              required={q.required}
              type={q.fieldType === "yesno" ? "select" : q.fieldType}
              options={q.fieldType === "yesno" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : q.fieldType === "select" ? (q.options || []).map(o => ({ value: o, label: o })) : undefined}
              value={gapRef.current[`custom_${q.id}`] || ""}
              onUpdate={updateGap}
              placeholder={q.fieldType === "textarea" ? "Enter your response..." : `Enter ${String(q.question).toLowerCase()}`}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
          <div>
            <AmendmentDocuments
              submissionId={dossierId || onboardingSubmissionId}
              initialUploads={amendmentUploads}
              onUploadsChange={setAmendmentUploads}
              extraDocuments={docsNeededFrom(dialogueStateRef.current)}
            />
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e0a040,#d09030)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📝</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Additional Information Required {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>{getCombinedGaps().filter(g => g.section !== "documents").length} fields need your input</p>
                </div>
                {SHOW_TEST_TOOLS && (
                  <button
                    type="button"
                    onClick={fillTestData}
                    title="Testing only — fills all visible fields with sample data"
                    style={{
                      marginLeft: "auto", flexShrink: 0,
                      padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                      background: "transparent", color: "#4a9e8e",
                      border: "2px dashed #4a9e8e",
                    }}
                  >
                    ✨ Fill with test data
                  </button>
                )}
              </div>
            </div>

            {stakeholderErrors.length > 0 && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
                padding: "14px 16px", marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
                  Please fix the following before continuing:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {stakeholderErrors.map((msg, i) => (
                    <li key={i} style={{ fontSize: 12, color: "#dc2626", marginBottom: 3 }}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 1. Corrections required + 2. Missing gap fields — corrections
                come first inside gapSectionOrder(), then missing fields. */}
            {gapSectionOrder().filter(s => s !== "applicant").map(s => renderGapSection(s))}

            <StakeholderGapForms
              research={research}
              activeSchema={activeSchema}
              effectivelyListed={effectivelyListed}
              getStakeholders={getStakeholders}
              updateStakeholderField={updateStakeholderField}
              addStakeholder={addStakeholder}
              removeStakeholder={removeStakeholder}
              isStkFieldConfirmed={isStkFieldConfirmed}
              stkCorrectedFields={stkCorrectedFields}
              stkHasCorrections={stkHasCorrections}
              cardStyle={card}
            />

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.confirm)}>← Back to Review</Btn>
              <Btn variant="primary" onClick={() => {
                const stkErrors = validateStakeholders();
                if (stkErrors.length > 0) {
                  setStakeholderErrors(stkErrors);
                  setError("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  return;
                }
                if (allGapsFilled()) {
                  setStakeholderErrors([]);
                  scrollAndSetStep(STEPS.documentRequirements);
                  setError("");
                } else {
                  setError("Please fill all required fields.");
                }
              }}>Continue to Documents →</Btn>
            </div>
            {error && step === STEPS.fillGaps && <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}
          </div>
  );
}

export default FillGapsPage;
