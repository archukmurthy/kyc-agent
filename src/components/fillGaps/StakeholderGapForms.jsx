/**
 * StakeholderGapForms.jsx — the per-person stakeholder forms and summaries on
 * the Fill Gaps page.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. Nine render
 * functions, their two style constants, the three repeatable-position helpers
 * and the node-array build moved here VERBATIM — the bodies below are the same
 * text that ran in App.js. What changed is only how they get their data: they
 * used to close over App's scope, and now arrive through the prop interface.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS, destructured back into
 * locals of the same name, so the moved bodies stay byte-identical. The oracle
 * is StakeholderGapForms.render.test.jsx (29 tests), which must stay green
 * UNCHANGED — if it goes red, the move is wrong, not the test.
 *
 * THIS COMPONENT OWNS NO STATE, and it touches no ref. Every mutation routes
 * through the drilled App functions — updateStakeholderField / addStakeholder /
 * removeStakeholder — which call App's setStakeholders, which owns the
 * stakeholdersRef write AND fires setStakeholderVersion.
 *
 * DO NOT wire this component to setFormVersion. The page runs on TWO separate
 * render-invalidation counters by design: setFormVersion for the gap inputs
 * (backed by gapRef) and setStakeholderVersion for the people. Converging them
 * would re-render the gap form on every keystroke and lose input focus — see
 * CLAUDE.md.
 *
 * WHAT THE SHELL HANDS OVER. App used to precompute four values in its own body
 * (stakeholderGapRows -> stakeholderFormNodes / stakeholderSummaryNodes, plus
 * the two has* booleans) and render them behind divider gates. That build moved
 * in here, so the component now produces its own nodes from drilled inputs and
 * renders the same two dividers around them.
 */

import React from "react";
import { COUNTRIES } from "../../constants/appConstants";
import { StableInput } from "../inputs/StableInput";
import { PrePopulatedField } from "../inputs/PrePopulatedField";
import {
  findFieldDef,
  formatDOBForDisplay,
  formatShareholding,
  isRegistryExemptionNotice,
  isStakeholderField,
  isUboLikeField,
  needsStakeholderDetails,
} from "../../pipeline";
import { isCorporateStakeholder } from "../../workflows/applicantWorkflow";
import { stkFieldDisplay } from "../companyConfirm/peopleHelpers";
import { BUSINESS_TYPE_OPTIONS, stakeholderMissingFields } from "./stakeholderHelpers";

export function StakeholderGapForms({
  // ── research + schema, read-only ──
  research,
  activeSchema,
  // ── the single "treat as listed" flag every branch below keys off ──
  effectivelyListed,
  // ── App-owned stakeholder accessors and mutators (they own the ref) ──
  getStakeholders,
  updateStakeholderField,
  addStakeholder,
  removeStakeholder,
  isStkFieldConfirmed,
  // ── Confirm-side correction predicates, still App-owned ──
  stkCorrectedFields,
  stkHasCorrections,
  // ── shared card chrome ──
  cardStyle: card,
}) {

  // Repeatable positions ([{ title, start_date }]) for corporate stakeholders.
  const addStkPosition = (fieldId, sid) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = [...((s && s.positions) || []), { title: "", start_date: "" }];
    updateStakeholderField(fieldId, sid, "positions", positions);
  };
  const updateStkPosition = (fieldId, sid, idx, key, value) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = ((s && s.positions) || []).map((p, i) => (i === idx ? { ...p, [key]: value } : p));
    updateStakeholderField(fieldId, sid, "positions", positions);
  };
  const removeStkPosition = (fieldId, sid, idx) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = ((s && s.positions) || []).filter((_, i) => i !== idx);
    updateStakeholderField(fieldId, sid, "positions", positions);
  };
  // ── Per-person stakeholder forms on Fill Gaps ────────────────────────
  // Each accepted/rejected/customer-added person renders as an accordion
  // card with name, role, nationality, DOB, residential country, ID type
  // & number, and PEP toggle + details. Reads/writes through the
  // stakeholdersRef helpers — explicit re-render on every change so
  // completion badges and the conditional PEP-details textarea stay
  // synced with the underlying data.

  const stakeholderLabelStyle = {
    display: "block", fontSize: 12, fontWeight: 600,
    color: "#1a3a4a", marginBottom: 5,
  };

  const stakeholderLockedStyle = {
    padding: "10px 14px", background: "#f2f1ed", borderRadius: 8,
    border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14,
    color: "#1a3a4a80", display: "flex", alignItems: "center",
    justifyContent: "space-between",
  };

  // Next-page (Fill Gaps) body for a CORPORATE stakeholder — KYB fields plus a
  // repeatable positions list. A found field stays verified while its Confirm
  // green tick is on; unticking opens it for edit (same as the person form).
  const renderStakeholderCardCorporateBody = (fieldId, s) => {
    const aiFound = !s.customer_rejected && !s.customer_added;
    const nameLocked = aiFound && isStkFieldConfirmed(s.id, "full_name");
    const positions = s.positions || [];
    return (
      <>
        {/* Business name */}
        {nameLocked ? (
          <div style={{ marginBottom: 14 }}>
            <label style={stakeholderLabelStyle}>Business Name <span style={{ color: "#d44" }}>*</span></label>
            <div style={stakeholderLockedStyle}>
              <span>{s.full_name}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
            </div>
          </div>
        ) : (
          <StableInput
            id={`stk_${fieldId}_${s.id}_business_name`}
            label="Business Name"
            type="text"
            value={s.full_name || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "full_name", v)}
            required
            placeholder="Registered / legal name"
          />
        )}

        {/* Business type */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_business_type`}
          label="Business Type"
          type="select"
          value={s.business_type || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "business_type", v)}
          required
          options={BUSINESS_TYPE_OPTIONS}
        />

        {/* Business registration number */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_brn`}
          label="Business Registration Number"
          type="text"
          value={s.business_registration_number || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "business_registration_number", v)}
          required
          placeholder="e.g. Companies House / ACRA number"
        />

        {/* Registered country — pre-filled & verified when the AI found it */}
        <PrePopulatedField
          id={`stk_${fieldId}_${s.id}_reg_country`}
          label="Registered Country"
          type="select"
          value={s.registered_country || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "registered_country", v)}
          options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
          sourceLabel={s.source}
          startEditing={!isStkFieldConfirmed(s.id, "registered_country")}
          required
        />

        {/* Shareholding (optional) */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_share`}
          label="Shareholding %"
          type="text"
          value={s.share_percentage != null ? String(s.share_percentage) : ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "share_percentage", v === "" ? null : v)}
          placeholder="e.g. 100"
        />

        {/* Positions — repeatable { title, start_date } */}
        <div style={{ marginBottom: 4 }}>
          <label style={stakeholderLabelStyle}>Position(s)</label>
          {positions.length === 0 && (
            <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 8px", fontStyle: "italic" }}>
              No positions added yet.
            </p>
          )}
          {positions.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <StableInput
                  id={`stk_${fieldId}_${s.id}_pos_${i}_title`}
                  label="Title"
                  type="text"
                  value={p.title || ""}
                  onUpdate={(_, v) => updateStkPosition(fieldId, s.id, i, "title", v)}
                  placeholder="e.g. Parent Company, Corporate Director"
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <StableInput
                  id={`stk_${fieldId}_${s.id}_pos_${i}_start`}
                  label="Start date"
                  type="date"
                  value={p.start_date || ""}
                  onUpdate={(_, v) => updateStkPosition(fieldId, s.id, i, "start_date", v)}
                />
              </div>
              <button
                type="button"
                onClick={() => removeStkPosition(fieldId, s.id, i)}
                title="Remove position"
                aria-label="Remove position"
                style={{
                  background: "none", border: "none", color: "#1a3a4a70",
                  cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px 10px",
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addStkPosition(fieldId, s.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14,
              padding: "8px 14px", background: "transparent", color: "#1a3a4a",
              border: "1.5px dashed #4a9e8e", borderRadius: 8,
              fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            + Add position
          </button>
        </div>
      </>
    );
  };

  const renderStakeholderCard = (fieldId, stakeholder, index) => {
    const ubo = isUboLikeField(fieldId);
    const isRejected = !!stakeholder.customer_rejected;
    const isAdded = !!stakeholder.customer_added;
    const isAIFound = !isRejected && !isAdded;
    const missing = stakeholderMissingFields(stakeholder);
    const isComplete = missing.length === 0;

    // A found field stays locked/verified only while its Confirm-page green tick
    // is still on; unticking it on Confirm opens it for editing here.
    const nameLocked = isAIFound && isStkFieldConfirmed(stakeholder.id, "full_name");
    const roleLocked = isAIFound && stakeholder.role && isStkFieldConfirmed(stakeholder.id, "role");

    return (
      <div
        key={stakeholder.id}
        style={{
          borderRadius: 10,
          border: `1.5px solid ${isComplete ? "#4a9e8e" : isRejected ? "#fecaca" : "rgba(26,58,74,0.14)"}`,
          background: isRejected ? "#fef9f9" : "#fff",
          marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>{isCorporateStakeholder(stakeholder) ? "🏢" : "👤"}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {stakeholder.full_name || `${isCorporateStakeholder(stakeholder) ? "Company" : "Person"} ${index + 1}`}
              </div>
              {(stakeholder.role || stakeholder.share_percentage != null) && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>
                  {stakeholder.role || ""}
                  {stakeholder.role && stakeholder.share_percentage != null ? " · " : ""}
                  {formatShareholding(stakeholder.share_percentage)}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
              background: isComplete ? "#dff2ec" : "#fff8ed",
              color: isComplete ? "#1a6b56" : "#8c5500",
              border: `1px solid ${isComplete ? "#4a9e8e" : "#e0a040"}40`,
            }}>
              {isComplete
                ? "✅ Complete"
                : `⚠ ${missing.length} field${missing.length > 1 ? "s" : ""} needed`}
            </span>
            {isAIFound && stakeholder.source && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#dff2ec", color: "#1a6b56",
              }}>
                ✓ {stakeholder.source}
              </span>
            )}
            {isRejected && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca",
              }}>
                Correction needed
              </span>
            )}
            {(isAdded || isRejected) && (
              <button
                type="button"
                onClick={() => removeStakeholder(fieldId, stakeholder.id)}
                style={{
                  background: "none", border: "none", color: "#1a3a4a70",
                  cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px",
                  fontFamily: "inherit",
                }}
                title="Remove this person"
                aria-label="Remove"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 0 }}>
          {isCorporateStakeholder(stakeholder) ? renderStakeholderCardCorporateBody(fieldId, stakeholder) : (
          <>
          {/* Name */}
          {nameLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Full Legal Name <span style={{ color: "#d44" }}>*</span></label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.full_name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <>
              {isRejected && stakeholder.full_name_original && (
                <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 4px" }}>
                  AI found: "{stakeholder.full_name_original}" — please enter the correct name
                </p>
              )}
              <StableInput
                id={`stk_${fieldId}_${stakeholder.id}_full_name`}
                label={`Full Legal Name`}
                type="text"
                value={stakeholder.full_name || ""}
                onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "full_name", v)}
                required
                placeholder="Full legal name"
              />
            </>
          )}

          {/* Role */}
          {roleLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Role / Position</label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.role}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_role`}
              label="Role / Position"
              type="text"
              value={stakeholder.role || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "role", v)}
              placeholder={ubo ? "e.g. Shareholder, UBO" : "e.g. CEO, Director, CFO"}
            />
          )}

          {/* Nationality — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_nationality`}
            label="Nationality"
            type="text"
            value={stakeholder.nationality || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "nationality", v)}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "nationality")}
            required
            placeholder="e.g. British, American, Singaporean"
          />

          {/* Date of birth — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_dob`}
            label="Date of Birth"
            type="date"
            value={stakeholder.date_of_birth || ""}
            displayValue={formatDOBForDisplay(stakeholder.date_of_birth)}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "date_of_birth", v)}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "date_of_birth")}
            required
            placeholder="YYYY-MM-DD"
          />

          {/* Country of residence — pre-filled & locked (editable) when the AI
              found it on the registry; falls through to a country picker when empty */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_country`}
            label="Country of Residence"
            type="select"
            value={stakeholder.residential_country || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "residential_country", v)}
            options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "residential_country")}
          />

          {/* Identity Document Type and Identity Document Number are intentionally
              hidden at Fill Gaps — these are collected later in the verification
              flow, not from the registry. Uncomment to restore.
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_type`}
            label="Identity Document Type"
            type="select"
            value={stakeholder.id_type || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_type", v)}
            options={[
              { value: "passport", label: "Passport" },
              { value: "national_id", label: "National ID Card" },
              { value: "driving_licence", label: "Driving Licence" },
              { value: "other", label: "Other" },
            ]}
          />
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_number`}
            label="Identity Document Number"
            type="text"
            value={stakeholder.id_number || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_number", v)}
            placeholder="Passport or ID number"
          />
          */}

          {/* PEP three-button toggle */}
          <div style={{ marginBottom: 14 }}>
            <label style={stakeholderLabelStyle}>
              Politically Exposed Person (PEP)? <span style={{ color: "#d44" }}>*</span>
            </label>
            <p style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.4, margin: "0 0 8px" }}>
              A PEP holds or has held a prominent public function, or is closely associated with someone who does.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { val: false, label: "No", c: "#4a9e8e", bg: "#dff2ec" },
                { val: true, label: "Yes", c: "#dc2626", bg: "#fef2f2" },
                { val: null, label: "Not Sure", c: "#1a3a4a", bg: "#e0e8f4" },
              ].map((opt) => {
                const selected = stakeholder.is_pep === opt.val;
                return (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => updateStakeholderField(fieldId, stakeholder.id, "is_pep", opt.val)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 8,
                      border: `1.5px solid ${selected ? opt.c : "rgba(26,58,74,0.14)"}`,
                      background: selected ? opt.bg : "transparent",
                      color: selected ? opt.c : "#1a3a4a80",
                      fontWeight: selected ? 700 : 500, fontSize: 13,
                      fontFamily: "inherit", cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional PEP details */}
          {stakeholder.is_pep === true && (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_pep_details`}
              label="PEP Details"
              type="textarea"
              value={stakeholder.pep_details || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "pep_details", v)}
              required
              placeholder="Please describe the political position, function, or connection"
            />
          )}
          </>
          )}
        </div>
      </div>
    );
  };

  // Read-only green summary shown for a listed company's stakeholders that
  // don't require enhanced due diligence (directors/officers, and UBOs < 25%).
  // `field` is the research row; `isPartial` renders it as a subsection above
  // the >= 25% UBO forms.
  const renderListedCompanyStakeholderSummary = (field, stakeholders, isPartial = false) => {
    const ubo = isUboLikeField(field.field);
    const fieldLabel = ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers";
    const lower = fieldLabel.toLowerCase();
    return (
      <div style={{
        borderRadius: 10,
        border: "1px solid #4a9e8e",
        background: "#f3faf8",
        overflow: "hidden",
        marginBottom: isPartial ? 16 : 0,
      }}>
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid #cfe9e1",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {isPartial ? `Other ${fieldLabel}` : fieldLabel}
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                Publicly listed company — verified from official sources. No additional details required.
              </div>
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 99,
            background: "#4a9e8e", color: "#fff", whiteSpace: "nowrap",
          }}>
            🏛 Listed Company
          </span>
        </div>

        <div style={{ padding: "12px 16px" }}>
          {stakeholders.length === 0 ? (
            <p style={{ fontSize: 13, color: "#1a6b56", fontStyle: "italic", margin: 0 }}>
              No {lower} found in public records.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {stakeholders.map((s) => (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", background: "rgba(255,255,255,0.6)",
                  borderRadius: 8, border: "1px solid #cfe9e1",
                }}>
                  <span style={{ fontSize: 16 }}>👤</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1a3a4a" }}>{s.full_name}</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", marginTop: 2 }}>
                      {[s.role, s.share_percentage != null ? `${formatShareholding(s.share_percentage)} shareholding` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#1a6b56", whiteSpace: "nowrap" }}>
                    ✓ Verified
                  </span>
                </div>
              ))}
            </div>
          )}

          <p style={{ fontSize: 12, color: "#1a6b56", marginTop: 12, marginBottom: 0, lineHeight: 1.5, fontStyle: "italic" }}>
            As a publicly listed company, {lower} information is publicly disclosed through regulatory
            filings. Enhanced due diligence details (nationality, date of birth, PEP status) are not
            required for listed company {lower}.
          </p>
        </div>
      </div>
    );
  };

  // ── Fill Gaps stakeholder rendering, split in two ───────────────────────
  // renderStakeholderForms  → only people who need customer input (rendered
  //   in the "additional details needed" section, near the other gap inputs).
  // renderStakeholderSummary → read-only confirmed info / "no action required"
  //   (rendered in the "verified — for reference" section at the bottom).
  // Both return null when they have nothing to show, so the caller can hide
  // the section divider when a field contributes no content.

  // Split "add a stakeholder" buttons (individual vs company) for the Fill Gaps
  // people sections. The blank record is created in the ref and renders its
  // person/company form immediately below.
  const renderAddStakeholderButtons = (fieldId, ubo) => (
    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
      {[
        { label: `+ Add ${ubo ? "individual owner" : "individual"}`, overrides: {} },
        { label: "+ Add company", overrides: { is_company: true } },
      ].map((b) => (
        <button
          key={b.label}
          type="button"
          onClick={() => addStakeholder(fieldId, b.overrides)}
          style={{
            flex: "1 1 0", minWidth: 150,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "10px 18px", background: "transparent", color: "#1a3a4a",
            border: "1.5px dashed #4a9e8e", borderRadius: 8,
            fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );

  // Light, identify-only replacement card (PR-057 interim). Shown ONLY on Fill
  // Gaps for a listed-company person the customer unticked on Confirm. Collects
  // just enough to identify the replacement — full legal name (required) + role
  // — NOT the full UBO/EDD set (no nationality/DOB/PEP/residence). Writes through
  // the same stakeholdersRef helpers as every other person card.
  const renderLightReplacementCard = (fieldId, s) => {
    const named = !!(s.full_name && s.full_name.trim());
    return (
      <div
        key={s.id}
        style={{
          borderRadius: 10,
          border: `1.5px solid ${named ? "#4a9e8e" : "rgba(26,58,74,0.14)"}`,
          background: "#fff", marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>👤</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {s.full_name || "Replacement director"}
              </div>
              {s.full_name_original && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>
                  Replacing: {s.full_name_original}
                </div>
              )}
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
            background: named ? "#dff2ec" : "#fff8ed",
            color: named ? "#1a6b56" : "#8c5500",
            border: `1px solid ${named ? "#4a9e8e" : "#e0a040"}40`,
          }}>
            {named ? "✅ Identified" : "⚠ Name needed"}
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 12px" }}>
            Identify-only — a listed company's directors are public record, so we only need to know
            who replaces the person you removed.
          </p>
          <div style={{ marginBottom: 14 }}>
            <StableInput
              id={`stk_${fieldId}_${s.id}_full_name`}
              label="Full Legal Name"
              type="text"
              value={s.full_name || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "full_name", v)}
              required
              placeholder="Full legal name"
            />
          </div>
          <StableInput
            id={`stk_${fieldId}_${s.id}_role`}
            label="Role / Position"
            type="text"
            value={s.role || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "role", v)}
            placeholder="e.g. Director"
          />
        </div>
      </div>
    );
  };

  // KEPT, not dead by accident. Unreachable via any current UI path: an
  // unticked attribute blocks the Confirm footer, and resolving it re-ticks the
  // field (see resolvePersonCorrection), so stkHasCorrections can't survive to
  // Fill Gaps. Retained for a possible seeded/resumed-dossier load that arrives
  // mid-correction. Delete-vs-keep decision pending (see register). Do not
  // remove without that call. Applies to BOTH renderCorrectionField below and
  // renderFieldCorrectionCard, its only caller.
  //
  // One editable input for a single corrected field, reusing the exact
  // components the private EDD card uses (StableInput / PrePopulatedField).
  // Pre-filled with the AI value and opened for editing (the field is unticked
  // by definition), so the customer edits the surfaced value in place.
  const renderCorrectionField = (fieldId, s, f) => {
    const onUpdate = (_, v) => updateStakeholderField(fieldId, s.id, f.key, v);
    switch (f.key) {
      case "full_name":
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_full_name`} label="Full Legal Name" type="text"
              value={s.full_name || ""} onUpdate={onUpdate} required placeholder="Full legal name" />
          </div>
        );
      case "role":
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_role`} label="Role / Position" type="text"
              value={s.role || ""} onUpdate={onUpdate} placeholder="e.g. CEO, Director, CFO" />
          </div>
        );
      case "nationality":
        return (
          <PrePopulatedField key={f.key} id={`stk_${fieldId}_${s.id}_nationality`} label="Nationality" type="text"
            value={s.nationality || ""} onUpdate={onUpdate} sourceLabel={s.source} startEditing required
            placeholder="e.g. British, American, Singaporean" />
        );
      case "date_of_birth":
        return (
          <PrePopulatedField key={f.key} id={`stk_${fieldId}_${s.id}_dob`} label="Date of Birth" type="date"
            value={s.date_of_birth || ""} displayValue={formatDOBForDisplay(s.date_of_birth)} onUpdate={onUpdate}
            sourceLabel={s.source} startEditing required placeholder="YYYY-MM-DD" />
        );
      case "residential_country":
        return (
          <PrePopulatedField key={f.key} id={`stk_${fieldId}_${s.id}_country`} label="Country of Residence" type="select"
            value={s.residential_country || ""} onUpdate={onUpdate}
            options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
            sourceLabel={s.source} startEditing />
        );
      case "share_percentage":
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_share`} label="Shareholding" type="text"
              value={s.share_percentage != null ? String(s.share_percentage) : ""} onUpdate={onUpdate}
              placeholder="e.g. 30%" />
          </div>
        );
      default:
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_${f.key}`} label={f.label} type="text"
              value={stkFieldDisplay(s, f.key)} onUpdate={onUpdate} />
          </div>
        );
    }
  };

  // KEPT, not dead by accident — see the note above renderCorrectionField.
  // Unreachable via any current UI path (stkHasCorrections can't survive to
  // Fill Gaps); retained for a possible seeded/resumed-dossier load that
  // arrives mid-correction. Delete-vs-keep decision pending.
  //
  // Field-level correction card for a listed-company person the customer did
  // NOT remove but whose AI-returned value(s) they unticked on Confirm. Renders
  // ONLY the unticked fields as editable — correction, not collection. Mirrors
  // the private per-field edit; the person-level removal path is the separate
  // light replacement card above.
  const renderFieldCorrectionCard = (fieldId, s, ubo) => {
    const corrected = stkCorrectedFields(s, ubo);
    if (corrected.length === 0) return null;
    return (
      <div
        key={s.id}
        style={{
          borderRadius: 10, border: "1.5px solid #e0a040",
          background: "#fff", marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>👤</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {s.full_name || (ubo ? "Beneficial owner" : "Director")}
              </div>
              {s.role && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>{s.role}</div>
              )}
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
            background: "#fff8ed", color: "#8c5500", border: "1px solid #e0a04040",
          }}>
            ✎ {corrected.length} correction{corrected.length > 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 12px" }}>
            You marked {corrected.length === 1 ? "a detail" : "these details"} as incorrect on the previous
            page. Correct {corrected.length === 1 ? "it" : "them"} below — we only collect the
            value{corrected.length > 1 ? "s" : ""} you're fixing.
          </p>
          {corrected.map((f) => renderCorrectionField(fieldId, s, f))}
        </div>
      </div>
    );
  };

  const renderStakeholderForms = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const personLabel = ubo ? "beneficial owner" : "director";
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);

    // Drop registry exemption notices — never real people / EDD forms.
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    const needingDetails = validStakeholders.filter((s) => needsStakeholderDetails(s, fieldId, effectivelyListed));

    // Listed-company replacement path: a person the customer unticked on Confirm
    // gets a LIGHT identify-only card here (not the full EDD set). These people
    // return false from needsStakeholderDetails (which we must not change), so
    // detect them via the customer_rejected flag seeded by initStakeholdersForFillGaps.
    const lightReplacements = effectivelyListed
      ? validStakeholders.filter((s) => s.customer_rejected && !needsStakeholderDetails(s, fieldId, effectivelyListed))
      : [];

    // Listed-company field-level corrections: a person the customer kept but
    // whose AI-returned value(s) they unticked on Confirm. Correction-only —
    // these people return false from needsStakeholderDetails so they'd otherwise
    // sit in the read-only summary with no way to edit. People needing full EDD
    // (>=25% UBOs) already correct fields inside renderStakeholderCard, and
    // private-company people flow through needingDetails — so this list is
    // listed-only, not-rejected, not-EDD. (Private corrections are unchanged.)
    const fieldCorrections = effectivelyListed
      ? validStakeholders.filter(
          (s) =>
            !s.customer_rejected &&
            !needsStakeholderDetails(s, fieldId, effectivelyListed) &&
            stkHasCorrections(s, ubo)
        )
      : [];

    // Private company with no real people found yet: prompt to add one. This is
    // a customer action, so it belongs in the forms section.
    if (!effectivelyListed && validStakeholders.length === 0) {
      return (
        <div key={`stk-forms-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
          <div style={{
            margin: "0 0 14px", padding: "10px 14px", borderRadius: 8,
            background: "#fff8ed", border: "1px solid #e0a040",
            fontSize: 12, color: "#8c5500",
          }}>
            No {personLabel}s were found automatically. Please add at least one {personLabel} below.
          </div>
          {renderAddStakeholderButtons(fieldId, ubo)}
        </div>
      );
    }

    // Nobody needs input → nothing in the forms section (summary handles the
    // read-only reference at the bottom of the page). For a listed company the
    // section still renders if the customer unticked someone (light replacement).
    if (needingDetails.length === 0 && lightReplacements.length === 0 && fieldCorrections.length === 0) return null;

    return (
      <div key={`stk-forms-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
        {!effectivelyListed ? (
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 14px", lineHeight: 1.5 }}>
            Complete the required details for each {personLabel} below. Names and roles marked
            "Verified" came from the research on the previous page; everything else needs your input.
          </p>
        ) : needingDetails.length > 0 ? (
          <div style={{
            padding: "12px 16px", background: "#fff8ed", border: "1px solid #e0a040",
            borderRadius: 8, fontSize: 13, color: "#8c5500",
            marginBottom: 16, display: "flex", gap: 8,
          }}>
            <span>⚠</span>
            <span>
              Although this is a listed company, the following beneficial owner
              {needingDetails.length > 1 ? "s hold" : " holds"} 25% or more of shares and requires
              enhanced due diligence details.
            </span>
          </div>
        ) : null}
        {needingDetails.map((s, i) => renderStakeholderCard(fieldId, s, i))}

        {/* Listed-company light replacement cards — only for unticked people. */}
        {lightReplacements.length > 0 && (
          <>
            <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 14px", lineHeight: 1.5 }}>
              You removed {lightReplacements.length === 1 ? `a ${personLabel}` : `${lightReplacements.length} ${personLabel}s`} on
              the previous page. Please identify {lightReplacements.length === 1 ? "their replacement" : "their replacements"} below —
              just a name and role. A listed company's {personLabel}s are public record, so no further details are needed.
            </p>
            {lightReplacements.map((s) => renderLightReplacementCard(fieldId, s))}
          </>
        )}

        {/* Listed-company field-level corrections — kept people whose surfaced
            value(s) the customer unticked to fix. Correction-only, no EDD. */}
        {fieldCorrections.length > 0 && (
          <>
            <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 14px", lineHeight: 1.5 }}>
              You marked {fieldCorrections.length === 1 ? "a detail" : "some details"} as incorrect on the
              previous page. Please correct {fieldCorrections.length === 1 ? "it" : "them"} below. As a listed
              company, no further details are collected — only the values you're fixing.
            </p>
            {fieldCorrections.map((s) => renderFieldCorrectionCard(fieldId, s, ubo))}
          </>
        )}

        {!effectivelyListed && renderAddStakeholderButtons(fieldId, ubo)}
      </div>
    );
  };

  const renderStakeholderSummary = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    // Read-only "verified" reference: people needing no input. Exclude listed
    // people the customer is actively correcting (a field unticked) — they now
    // render as an editable correction card in the forms section above, so
    // showing them here too would duplicate them with the stale value.
    const confirmedOnly = validStakeholders.filter(
      (s) =>
        !needsStakeholderDetails(s, fieldId, effectivelyListed) &&
        !(effectivelyListed && !s.customer_rejected && stkHasCorrections(s, ubo))
    );

    // Listed company with no real owners (e.g. PSC-exempt — only an exemption
    // notice): clean "No action required" reference card.
    if (validStakeholders.length === 0 && effectivelyListed) {
      return (
        <div key={`stk-summary-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
          <div style={{
            padding: "14px 16px", background: "#f3faf8", border: "1px solid #4a9e8e",
            borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {heading} — No action required
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                This is a publicly listed company. Ownership information is publicly disclosed through
                regulatory filings. No additional details required.
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Nothing read-only to show (e.g. a private company — everyone is in the
    // forms section above, so no duplicate rendering here).
    if (confirmedOnly.length === 0) return null;

    return (
      <div key={`stk-summary-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
        {renderListedCompanyStakeholderSummary(researchItem, confirmedOnly, false)}
      </div>
    );
  };
  // Fill Gaps stakeholder rendering, split into two sections. Forms (input
  // needed) render with the other gap inputs; summaries (read-only) render at
  // the bottom for reference. Render functions return null when empty, so the
  // section dividers below only appear when there's actual content.
  const stakeholderGapRows = (research?.found || []).filter((r) => {
    if (!isStakeholderField(r.field) || !Array.isArray(r.stakeholders)) return false;
    if (r.stakeholders.some((s) => !isRegistryExemptionNotice(s))) return true;
    // Listed company whose only "owners" were exemption notices (filtered out
    // of .stakeholders): still surface the "no action required" summary.
    return effectivelyListed && typeof r.value === "string" && r.value.trim().length > 0;
  });
  const stakeholderFormNodes = stakeholderGapRows.map((r) => renderStakeholderForms(r)).filter(Boolean);
  const stakeholderSummaryNodes = stakeholderGapRows.map((r) => renderStakeholderSummary(r)).filter(Boolean);
  const hasStakeholderForms = stakeholderFormNodes.length > 0;
  const hasStakeholderSummary = stakeholderSummaryNodes.length > 0;

  return (
    <>
            {/* 3. Stakeholder forms — only people who need customer input
                (private directors/UBOs, or listed-company >= 25% UBOs). */}
            {hasStakeholderForms && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>👥</span>
                <span>People — additional details needed</span>
              </div>
            )}
            {stakeholderFormNodes}

            {/* 4. Verified stakeholder summary — read-only reference, last. */}
            {hasStakeholderSummary && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>✅</span>
                <span>Verified information — for reference</span>
              </div>
            )}
            {stakeholderSummaryNodes}
    </>
  );
}

export default StakeholderGapForms;
