/**
 * ApplicantPage.jsx — the Applicant step of the onboarding wizard.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. The seven
 * render-cluster functions and the two upload handlers moved here VERBATIM —
 * the bodies below are the same text that ran in App.js. What changed is only
 * how they get their data: they used to close over App's scope, and now arrive
 * through the prop interface declared on the component.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS, destructured back into
 * locals of the same name, so the moved bodies stay byte-identical. That is what
 * makes "zero behaviour change" checkable rather than merely claimed — the
 * oracle is ApplicantPage.render.test.jsx, which must stay green UNCHANGED.
 *
 * THIS COMPONENT OWNS NO STATE. Everything is drilled, following the convention
 * ConfirmStep established:
 *
 *   - The seven Applicant useStates stay in App.js because resetAll and the
 *     submit path (deriveApplicantProvenance) read them. Values AND setters are
 *     drilled. Moving them would rewire resetAll — that is not a pure move.
 *   - The seven fact-dispute functions stay in App.js and are drilled. Their
 *     resolutions write document requirements into the Fill Gaps checklist — a
 *     cross-page write that must remain App-owned.
 *   - gapRef is drilled AS A REF and setFormVersion as a callback. The manual
 *     invalidation pattern (write gapRef.current, then bump setFormVersion) is
 *     deliberate: lifting these values into state re-renders the form on every
 *     keystroke and loses input focus. See CLAUDE.md. Do NOT convert to state.
 */

import React from "react";
import { C } from "../../constants/theme";
import { SHOW_TEST_TOOLS } from "../../constants/appConstants";
import { StableInput } from "../inputs/StableInput";
import { DocumentUploadCard } from "../Step2DynamicForm";
import FoundationalFactsGate from "../companyConfirm/FoundationalFactsGate";
import {
  OWNERSHIP_TYPE_LIBRARY,
  ownershipTypeLabel,
} from "../../utils/ownershipTypes";
import { mapExtractedKey } from "../../utils/extractionMapping";
import { TEST_DATA } from "../../demo/demoData";
import {
  APPLICANT_FALLBACK_FIELDS,
  getApplicantCandidates as deriveApplicantCandidates,
} from "../../workflows/applicantWorkflow";

export function ApplicantPage({
  // ── lookup facts shown by the gate ──
  companyName,
  countryCode,
  countryObj,
  entityType,
  ownershipType,
  regNumber,
  regNumberSource,
  research,
  activeSchema,
  dossierStakeholders,
  landedViaLink,
  // ── fact-dispute state (machine itself stays in App) ──
  factChecks,
  ownershipFork,
  regNumberFork,
  ownershipChangeDeclared,
  regNumberChangeDeclared,
  isFactConfirmed,
  toggleFact,
  cancelFactDispute,
  declareOwnershipChanged,
  resolveOwnershipChange,
  declareRegNumberChanged,
  resolveRegNumberChange,
  // ── the seven Applicant useStates: values AND setters, both drilled ──
  applicantSelectedPerson,
  setApplicantSelectedPerson,
  applicantAgentValues,
  setApplicantAgentValues,
  applicantOverrides,
  setApplicantOverrides,
  applicantNotListed,
  setApplicantNotListed,
  applicantValidationError,
  setApplicantValidationError,
  authorityToActFile,
  setAuthorityToActFile,
  signatoryIdFile,
  setSignatoryIdFile,
  // ── shared gap machinery — gapRef AS A REF, setFormVersion as a callback ──
  gapRef,
  setFormVersion,
  getCombinedGaps,
  updateGap,
  dependsOnSatisfied,
  // ── navigation + styling ──
  STEPS,
  scrollAndSetStep,
  resetAll,
  cardStyle,
  Btn,
}) {
  const card = cardStyle;

  const getApplicantCandidates = () =>
    deriveApplicantCandidates(research, dossierStakeholders);

  // Clear the applicant gap fields a person-selection had pre-filled (used when
  // the customer switches to "I am not listed").
  const clearApplicantPrefill = () => {
    ["applicantFirstName", "applicantLastName", "applicantPosition", "applicantNationality", "applicantDateOfBirth"].forEach((f) => {
      gapRef.current[f] = "";
    });
  };

  // Pre-fill the applicant gap fields from a selected director/UBO and record
  // the agent-sourced values so submit-time provenance can detect overrides.
  const selectApplicantPerson = (person) => {
    if (!person) {
      setApplicantSelectedPerson(null);
      setApplicantAgentValues({});
      setApplicantOverrides([]);
      clearApplicantPrefill();
      setFormVersion((v) => v + 1);
      return;
    }
    setApplicantSelectedPerson(person);
    const av = {};
    if (person.name) {
      const parts = String(person.name).trim().split(/\s+/);
      av.applicantFirstName = parts[0] || "";
      av.applicantLastName = parts.slice(1).join(" ");
    }
    if (person.jobTitle) av.applicantPosition = person.jobTitle;
    if (person.nationality) av.applicantNationality = person.nationality;
    if (person.dob) av.applicantDateOfBirth = person.dob;
    setApplicantAgentValues(av);
    setApplicantOverrides([]);
    Object.entries(av).forEach(([fieldId, value]) => { gapRef.current[fieldId] = value; });
    setFormVersion((v) => v + 1);
  };

  const renderApplicantPersonSelector = () => {
    const candidates = getApplicantCandidates();
    if (candidates.length === 0) {
      // No individual directors/UBOs identified (e.g. registry returned only a
      // corporate parent, or name extraction failed). Show a note rather than
      // silently hiding the selector so the page doesn't look broken.
      return (
        <div style={{
          padding: "12px 16px",
          background: C.surfaceAlt,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          fontSize: 13,
          color: C.textSec,
          marginBottom: 20,
        }}>
          We were not able to identify individual directors or owners for this
          company from our research. Please fill in your details below.
        </div>
      );
    }
    return (
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "#1a3a4a80", display: "block", marginBottom: 6, fontWeight: 600 }}>
          Who is completing this application?
        </label>
        <select
          value={applicantSelectedPerson?.id || (applicantNotListed ? "none" : "")}
          onChange={(e) => {
            const id = e.target.value;
            // "none" is the explicit "I am not listed" declaration → record it so
            // the Authority-to-act gate (PR-044) shows. Any other change clears it.
            if (id === "none") { setApplicantNotListed(true); selectApplicantPerson(null); return; }
            setApplicantNotListed(false);
            if (!id) { selectApplicantPerson(null); return; }
            selectApplicantPerson(candidates.find((c) => c.id === id) || null);
          }}
          style={{ width: "100%", border: "1.5px solid rgba(26,58,74,0.14)", borderRadius: 8, padding: "10px 14px", fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#1a3a4a", cursor: "pointer" }}
        >
          <option value="">Select your name...</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}  —  {c.role}</option>
          ))}
          <option value="none">I am not listed — fill in manually</option>
        </select>
        <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "6px 2px 0" }}>
          Picking your name pre-fills the fields below from the official registry. Edit any field that's wrong.
        </p>
      </div>
    );
  };

  // The applicant gap fields (first/last name, email, mobile, job title, DOB,
  // nationality, PEP) rendered as a standalone block. Same StableInput rendering
  // the Fill Gaps applicant section used — extracted here now that Applicant is
  // its own step.
  const renderApplicantFields = () => {
    const schemaItems = getCombinedGaps()
      .filter((g) => g.section === "applicant")
      .filter(dependsOnSatisfied);
    // Fall back to the hardcoded applicant fields when the schema yields none
    // (activeSchema null / not yet resolved), so the page is never blank.
    const items = schemaItems.length > 0 ? schemaItems : APPLICANT_FALLBACK_FIELDS;
    if (items.length === 0) return null;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
        {items.map((g) => (
          <StableInput
            key={g.field}
            id={g.field}
            label={g.label}
            type={g.inputType}
            value={gapRef.current[g.field] || ""}
            onUpdate={updateGap}
            required={g.required}
            options={g.options}
            placeholder={g.placeholder || ("Enter " + g.label.toLowerCase())}
          />
        ))}
      </div>
    );
  };

  // Testing-only: auto-complete the applicant form with sample data. Mirrors
  // fillTestData (Fill Gaps) — pulls from TEST_DATA, keeps any value already
  // entered, and falls back to sensible values for schema fields not in
  // TEST_DATA. Gated by SHOW_TEST_TOOLS at the button, so prod never sees it.
  const fillApplicantTestData = () => {
    const schemaItems = getCombinedGaps()
      .filter((g) => g.section === "applicant")
      .filter(dependsOnSatisfied);
    const items = schemaItems.length > 0 ? schemaItems : APPLICANT_FALLBACK_FIELDS;
    items.forEach((g) => {
      const current = gapRef.current[g.field];
      if (current && String(current).trim().length > 0) return; // keep existing edits
      let val = TEST_DATA[g.field];
      if (val === undefined) {
        const it = String(g.inputType || "text").toLowerCase();
        if (it === "select" && Array.isArray(g.options) && g.options.length > 0) {
          const first = g.options[0];
          val = first && typeof first === "object" ? (first.value ?? first.label) : first;
        } else if (it === "date") {
          val = "1985-06-15";
        } else if (it === "email") {
          val = "jane.smith@example.com";
        } else {
          val = "Sample value";
        }
      }
      gapRef.current[g.field] = val;
    });
    // PR-044: also satisfy the Authority-to-act hard gate in test mode by
    // attaching a dummy file (harmless when the not-listed card isn't shown).
    if (!authorityToActFile) {
      const fname = "test-authority-to-act.pdf";
      let dummy;
      try { dummy = new File([new Blob(["test authority to act"])], fname, { type: "application/pdf" }); }
      catch { dummy = { name: fname, size: 21 }; }
      setAuthorityToActFile(dummy);
    }
    // PR-072: also satisfy the always-shown Signatory ID hard gate in test mode.
    if (!signatoryIdFile) {
      const fname = "test-signatory-id.pdf";
      let dummy;
      try { dummy = new File([new Blob(["test signatory id"])], fname, { type: "application/pdf" }); }
      catch { dummy = { name: fname, size: 18 }; }
      setSignatoryIdFile(dummy);
    }
    setFormVersion((v) => v + 1);
  };

  // Standalone Applicant page (step between Research and Confirm). Reuses the
  // director/UBO person selector + the applicant gap fields, with its own
  // header, required-field validation, and Continue → Confirm.
  const renderApplicantPage = () => {
    // The five foundational facts used to research the company. Reg-number
    // provenance (G2) is gated on the EXPLICIT `regNumberSource` flag, never on
    // `regNumber` truthiness — so a number restored from a loaded dossier (the
    // ?dossierId / ?ref link journeys, which leave the source null) is treated as
    // system-retrieved and stays verifiable, not locked as "you provided this".
    // A customer-typed number (source === "customer") is pre-confirmed and
    // display-only; otherwise the schema-correct registration-number research
    // field is the system-retrieved value the customer must verify; neither →
    // "Not provided" and non-disputable (nothing to confirm).
    //
    // PR-059 B: resolve the reg field id from the active schema's flow rather
    // than a hardcoded literal. Corporate schemas store it as
    // `businessRegistrationNumber`, fi schemas as `registration_number`; reading
    // the literal `registration_number` matched only the fi case and, for a
    // corporate entity, could surface a stray/contaminated row instead of the
    // real value Confirm shows. mapExtractedKey() is the single source of truth
    // for that mapping (same one the extraction pipeline uses).
    const regFlow =
      activeSchema?.flow === "fi" || entityType === "FI" || entityType === "Platform"
        ? "fi"
        : "corporate";
    const regFieldId = mapExtractedKey(regFlow, "registration_number") || "registration_number";
    const customerReg = regNumberSource === "customer" ? (regNumber || "").trim() : "";
    const systemReg = customerReg
      ? ""
      : ((research?.found || []).find((f) => f.field === regFieldId)?.value || "");
    const regProvenance = customerReg ? "customer" : systemReg ? "system" : "none";
    const regValue = customerReg || systemReg || "";

    const facts = [
      { key: "companyName", label: "Company legal name", value: research?.companyName || companyName || "—", disputable: true },
      {
        key: "registrationNumber",
        label: "Registration / company number",
        // After a genuine change is resolved, reflect the NEW number the customer
        // provided (stored regNumber left unchanged) + note that the change
        // document was added to Fill Gaps.
        value: regNumberChangeDeclared?.to
          ? regNumberChangeDeclared.to
          : (regValue || "Not provided"),
        disputable: regProvenance === "system",
        note: regNumberChangeDeclared?.to
          ? `Changed from "${regNumberChangeDeclared.from}" — additional documents are required and have been added to your Fill Gaps checklist.`
          : regProvenance === "customer"
            ? "✓ You provided this"
            : regProvenance === "system"
            ? "Found by research — please verify"
            : "Not provided on lookup",
      },
      { key: "country", label: "Registration country", value: countryObj?.name || countryCode || "—", disputable: true },
      { key: "entityType", label: "Entity type", value: entityType || "—", disputable: true },
      {
        key: "ownershipType",
        label: "Ownership type",
        // After a genuine ownership change is resolved, reflect the NEW type the
        // customer selected (the stored `ownershipType` is intentionally left
        // unchanged — reshaping the schema/questions off the new type is PR-049),
        // and note that the supporting documents were added to Fill Gaps.
        value: ownershipChangeDeclared?.to
          ? ownershipChangeDeclared.to
          : (ownershipTypeLabel(ownershipType) || ownershipType || "—"),
        disputable: true,
        note: ownershipChangeDeclared?.to
          ? `Changed from "${ownershipChangeDeclared.from}" — additional documents are required and have been added to your Fill Gaps checklist.`
          : undefined,
      },
    ];

    // All five confirmed (a disputed fact, or a pending ownership fork, hides the
    // applicant section below). A four-fact dispute resets; ownership forks.
    const fourDisputed = facts.some((f) => f.key !== "ownershipType" && f.key !== "registrationNumber" && f.disputable && factChecks[f.key] === false);
    const ownershipDisputed = factChecks.ownershipType === false;
    const regNumberDisputed = factChecks.registrationNumber === false;
    const factsConfirmed = !fourDisputed && !ownershipDisputed && !regNumberDisputed && ownershipFork === null && regNumberFork === null;

    // PR-044 — Authority-to-act, shown only when the applicant declares they are
    // NOT a listed director/officer. Content mirrors documentRequirements.js's
    // 'Authority to act' item (which is now removed from the Required Docs
    // checklist so it's asked exactly once, here). The card is the SAME reused
    // DocumentUploadCard from the Required Docs page. Only the regulatory citation
    // is jurisdiction-specific (UK MLR 2017 vs SG MAS PSN01); applies to both.
    // TODO(PR-044): SG Apostille/notarisation overlay is a later addition.
    const isUK = countryCode === "GB" || activeSchema?.region === "UK";
    // Unlisted = the applicant is NOT one of the company's listed directors/
    // officers. Two ways to be unlisted: (a) explicitly choosing "I am not listed"
    // in the dropdown, or (b) research found no director/UBO candidates at all, so
    // the dropdown isn't shown and the page falls straight to manual entry. Both
    // must prove authority to act (PR-044).
    const applicantUnlisted = applicantNotListed || getApplicantCandidates().length === 0;
    const authorityToActItem = {
      requirement: "Authority to act",
      standardDocument: "Board resolution / power of attorney / mandate",
      localEquivalent: "Board resolution / power of attorney / authorised mandate",
      why: "Confirm the relationship and product are authorised and the named signatories may bind the customer.",
      fallback: "Do not activate the relationship until authority and signatory identity are resolved.",
      mandatory: true,
      selfSource: "Client-provided only",
      regulatoryRationale: isUK ? "Money Laundering Regulations 2017" : "MAS Notice PSN01",
      regulatoryUrl: isUK
        ? "https://www.legislation.gov.uk/id/uksi/2017/692"
        : "https://www.mas.gov.sg/regulation/notices/psn01-aml-cft-notice---specified-payment-services",
    };
    // Hard gate: when unlisted, Continue is blocked until the file is uploaded.
    const authorityGateBlocks = applicantUnlisted && !authorityToActFile;

    // PR-072 — Signatory ID card, COPIED verbatim from the Required Docs section
    // (the DocumentUploadCard driven by the DRS "Signatory ID" checklist item)
    // onto the Applicant page. Shown for EVERY applicant (always), unlike
    // authority-to-act. App.js (src/) cannot import root documentRequirements.js
    // (CRA ModuleScopePlugin), so — exactly as authorityToActItem does — the item
    // is reconstructed inline with the SAME content the DRS produces: title +
    // Required pill, the accepted-documents guidance (buildIdLocalEquivalent incl.
    // residency + UK/JMLSG onboarding-country overlay), the "Verify each
    // signatory…" line, and the "Why this is required / can't provide it?"
    // expander. UK vs SG split mirrors the isUK toggle used above (LICENSED_MARKETS
    // GB → UK/JMLSG; everything else → Singapore/MAS default).
    const signatoryIdItem = {
      requirement: "Signatory ID",
      standardDocument: "Government-issued photo ID for each authorised signatory",
      localEquivalent: isUK
        ? "For each authorised signatory. Document types accepted may include: Passport; UK photocard driving licence; National identity card (where accepted). The exact document accepted may vary depending on residency status, onboarding channel, document verifiability, translation/transliteration quality, and local policy. For cross-border onboarding, passport is usually the clearest first ask. Onboarding-country overlay (United Kingdom): UK/JMLSG-style practice: passport is the safest first ask for cross-border onboarding; photocard driving licence works best for UK residents; national ID cards are more case-specific."
        : "For each authorised signatory. Document types accepted may include: NRIC (citizen / PR); FIN card (foreign resident); Passport. The exact document accepted may vary depending on residency status, onboarding channel, document verifiability, translation/transliteration quality, and local policy. Passport is the safer ask for non-residents or where local electronic verification is unavailable. Onboarding-country overlay (Singapore): MAS-style practice: use resident local photo ID where reliable, but ask for passport for non-residents, cross-border cases, or where local ID cannot be independently verified.",
      why: "Verify each signatory before the relationship is activated or the first permitted transaction occurs.",
      fallback: "Do not activate the relationship until authority and signatory identity are resolved.",
      mandatory: true,
      selfSource: "Client-provided only",
      regulatoryRationale: isUK ? "Money Laundering Regulations 2017" : "MAS Notice PSN01",
      regulatoryUrl: isUK
        ? "https://www.legislation.gov.uk/id/uksi/2017/692"
        : "https://www.mas.gov.sg/regulation/notices/psn01-aml-cft-notice---specified-payment-services",
    };
    // Hard gate: Signatory ID is always required — Continue is blocked until the
    // file is uploaded, for every applicant. Combined with the conditional
    // authority-to-act gate below.
    const signatoryGateBlocks = !signatoryIdFile;
    const continueBlocked = signatoryGateBlocks || authorityGateBlocks;

    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 40px" }}>
        <FoundationalFactsGate
          facts={facts}
          isConfirmed={isFactConfirmed}
          onToggle={toggleFact}
          ownershipFork={ownershipFork}
          ownershipChangeFrom={ownershipChangeDeclared?.from || ""}
          onReset={resetAll}
          onOwnershipChanged={declareOwnershipChanged}
          onCancel={cancelFactDispute}
          ownershipTypeOptions={OWNERSHIP_TYPE_LIBRARY.map((o) => ({ value: o.id, label: o.label }))}
          onOwnershipChangeResolved={resolveOwnershipChange}
          regNumberFork={regNumberFork}
          regNumberChangeFrom={regNumberChangeDeclared?.from || ""}
          onRegNumberChanged={() => declareRegNumberChanged(regValue)}
          onRegNumberChangeResolved={resolveRegNumberChange}
        />

        {factsConfirmed && (
          <>
            <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1a3a4a", margin: "0 0 8px 0" }}>
                  Tell us about yourself
                </h2>
                <p style={{ fontSize: 14, color: "#1a3a4a80", margin: 0, lineHeight: 1.6 }}>
                  As the person completing this application, we need a few details about you.
                  We have pre-filled what we already know.
                </p>
              </div>
              {SHOW_TEST_TOOLS && (
                <button
                  type="button"
                  onClick={fillApplicantTestData}
                  title="Testing only — fills the applicant form with sample data"
                  style={{
                    flexShrink: 0,
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

            <div style={card}>
              {renderApplicantPersonSelector()}
              {renderApplicantFields()}
            </div>

            {/* PR-072 — Signatory ID proof, COPIED from Required Docs. Always
                shown (every applicant), directly below the applicant fields and
                ABOVE the conditional Authority-to-act card. Reuses the exact same
                Required Docs DocumentUploadCard. This is a COPY — the Signatory ID
                card ALSO still renders in Required Docs (Step2DynamicForm),
                unchanged. The upload slot here is INDEPENDENT of the Required Docs
                one (see signatoryIdFile comment; one-satisfies-both is a deferred
                future enhancement). */}
            <div style={{ ...card, marginTop: 16 }}>
              <p style={{ fontSize: 13, color: "#1a3a4a", margin: "0 0 12px", lineHeight: 1.6 }}>
                Please upload government-issued photo ID for each authorised
                signatory. This is required before we can continue.
              </p>
              <DocumentUploadCard
                item={signatoryIdItem}
                uploaded={signatoryIdFile}
                onUpload={(_req, file) => handleSignatoryIdUpload(file)}
                onRemove={() => setSignatoryIdFile(null)}
                autoSourcedResult={null}
              />
            </div>

            {/* PR-044 — Authority-to-act proof, directly below the applicant
                fields, shown whenever the applicant is unlisted: either "I am not
                listed" was selected, or no directors/UBOs were found (manual-entry
                fallback). Reuses the Required Docs DocumentUploadCard. */}
            {applicantUnlisted && (
              <div style={{ ...card, marginTop: 16 }}>
                <p style={{ fontSize: 13, color: "#1a3a4a", margin: "0 0 12px", lineHeight: 1.6 }}>
                  Because you are <strong>not one of the company's listed directors or officers</strong>,
                  please upload a document showing you are authorised to act for the company.
                </p>
                <DocumentUploadCard
                  item={authorityToActItem}
                  uploaded={authorityToActFile}
                  onUpload={(_req, file) => handleAuthorityToActUpload(file)}
                  onRemove={() => setAuthorityToActFile(null)}
                  autoSourcedResult={null}
                />
              </div>
            )}

            {/* PR: Continue + Start Over share one row (Start Over left, Continue
                right). Start Over is onboarding-only (!landedViaLink) — hidden on
                the dossier/invite journey; the empty <span/> keeps Continue
                right-aligned there. Start Over reuses resetAll (pre-filled lookup,
                not a blank wipe). Layout only — onClick/gating unchanged. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 24 }}>
              {!landedViaLink ? <Btn variant="secondary" onClick={resetAll}>Start Over</Btn> : <span />}
            <button
              disabled={continueBlocked}
              onClick={() => {
                // Hard gate (PR-072): Signatory ID is always required for every
                // applicant — check it before the conditional authority-to-act gate.
                if (!signatoryIdFile) {
                  setApplicantValidationError(
                    "Please upload the signatory ID document before continuing."
                  );
                  return;
                }
                // Hard gate: unlisted applicants must upload authority-to-act first.
                if (applicantUnlisted && !authorityToActFile) {
                  setApplicantValidationError(
                    "Please upload your authority-to-act document before continuing."
                  );
                  return;
                }
                const required = ["applicantFirstName", "applicantLastName", "applicantEmail"];
                const missing = required.filter((f) => !String(gapRef.current[f] || "").trim());
                if (missing.length > 0) {
                  setApplicantValidationError(
                    "Please fill in " + missing.length + " required field" +
                    (missing.length > 1 ? "s" : "") + " before continuing."
                  );
                  return;
                }
                setApplicantValidationError(null);
                scrollAndSetStep(STEPS.confirm);
              }}
              style={{
                padding: "12px 28px",
                background: continueBlocked ? "#9CA3AF" : (C.niumBlue || "#0B3D91"),
                color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700,
                fontFamily: "inherit", cursor: continueBlocked ? "not-allowed" : "pointer",
              }}
            >
              Continue →
            </button>
            </div>

            {/* PR-072 — Signatory ID gate reason. Shown first (always-required
                slot); the authority-to-act reason follows when that card blocks too. */}
            {signatoryGateBlocks && (
              <div style={{
                marginTop: 12, padding: "10px 14px", background: "#FFFBEB",
                border: "1px solid #FCD34D", borderRadius: 8, fontSize: 13, color: "#92400E",
              }}>
                Upload the signatory ID document above to continue.
              </div>
            )}

            {authorityGateBlocks && (
              <div style={{
                marginTop: 12, padding: "10px 14px", background: "#FFFBEB",
                border: "1px solid #FCD34D", borderRadius: 8, fontSize: 13, color: "#92400E",
              }}>
                Upload your authority-to-act document above to continue.
              </div>
            )}

            {applicantValidationError && (
              <div style={{
                marginTop: 12, padding: "10px 14px", background: "#FEF2F2",
                border: "1px solid #FCA5A5", borderRadius: 8, fontSize: 13, color: "#DC2626",
              }}>
                {applicantValidationError}
              </div>
            )}

          </>
        )}
      </div>
    );
  };


  // PR-034 / PR-044 — Authority-to-act upload. Upload to Vercel Blob on file
  // selection and store the permanent URL rather than holding the raw File (an
  // ephemeral, non-persistable reference) in session state. A failed upload
  // still stores the file metadata with uploadFailed:true so the analyst is
  // alerted, but the customer is never blocked from continuing the journey.
  async function handleAuthorityToActUpload(file) {
    if (!file) return;
    let blobUrl = null;
    let uploadFailed = false;
    let filename = file.name;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/upload-document", { method: "POST", body: fd });
      if (!resp.ok) throw new Error("Upload failed: " + resp.status);
      const data = await resp.json();
      if (!data.blobUrl) throw new Error(data.error || "No blobUrl returned");
      blobUrl = data.blobUrl;
      filename = data.filename || file.name;
    } catch (err) {
      uploadFailed = true;
    }
    // Keep .name/.size so the DocumentUploadCard renders the uploaded state and
    // the gate (truthy = satisfied) still passes even when the upload failed.
    setAuthorityToActFile({ name: filename, size: file.size, filename, blobUrl, uploadFailed });
  }

  // PR-072 — Applicant-page Signatory ID upload. Mirrors
  // handleAuthorityToActUpload exactly (session-hold via /api/upload-document,
  // keep .name/.size so truthy = gate satisfied even on upload failure). This is
  // a SEPARATE slot from the Required Docs Signatory ID upload — they do not
  // cross-satisfy. "One-upload-satisfies-both" is a possible later enhancement.
  async function handleSignatoryIdUpload(file) {
    if (!file) return;
    let blobUrl = null;
    let uploadFailed = false;
    let filename = file.name;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/upload-document", { method: "POST", body: fd });
      if (!resp.ok) throw new Error("Upload failed: " + resp.status);
      const data = await resp.json();
      if (!data.blobUrl) throw new Error(data.error || "No blobUrl returned");
      blobUrl = data.blobUrl;
      filename = data.filename || file.name;
    } catch (err) {
      uploadFailed = true;
    }
    setSignatoryIdFile({ name: filename, size: file.size, filename, blobUrl, uploadFailed });
  }

  return renderApplicantPage();
}

export default ApplicantPage;
