/**
 * DossierView.jsx — the analyst dossier, the main pre-boarding screen.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. Four bodies moved
 * together because they are one screen: the view itself plus its three sections
 * (Customer Request, Stakeholders, Documents). They are kept as inner functions
 * with their original signatures so the moved bodies stay byte-identical and the
 * view's call sites are unchanged.
 *
 * renderAskMoreButton is kept as a local shim of the same signature, forwarding to
 * <AskMoreButton/>. That preserves the Customer Request body byte-for-byte rather
 * than editing its call site.
 *
 * THIS COMPONENT OWNS NO STATE. Everything is drilled, including gapRef which
 * crosses AS A REF (the "start a fresh dossier" action clears it directly and
 * bumps formVersion).
 *
 * TWO BEHAVIOURS PRESERVED EXACTLY, both pinned by Preboarding.render.test.jsx:
 *   - saveDossier STAYS in App.js. Its setShowDossierView(true) sits OUTSIDE the
 *     try/catch, so an offline save still opens this view. Nothing here may
 *     reorder that.
 *   - renderDossierDocuments returns null when no documents were sourced. The
 *     pre-boarding path never populates them, so the section is legitimately
 *     absent; that null-return is load-bearing, not a bug.
 */

import React from "react";
import { C } from "../../constants/theme";
import { OWNERSHIP_TYPE_LIBRARY } from "../../utils/ownershipTypes";
import { formatFetchedAt } from "../../utils/files";
import {
  formatDOBForDisplay,
  formatShareholding,
  isRegistryExemptionNotice,
} from "../../pipeline";
import { DossierSection } from "../dossier/DossierSection";
import { AskMoreButton } from "./AskMorePanel";

export function DossierView({
  research,
  researchTimestamp,
  coverage,
  customQuestions,
  excludedGapFields,
  dossierId,
  dossierSaved,
  dossierSaving,
  companyName,
  entityType,
  ownershipType,
  agentType,
  preboardingUnlocked,
  docSearchResults,
  selfSourceResults,
  tenantId,
  setShowDossierView,
  setShowInviteScreen,
  setDossierId,
  setDossierSaved,
  setResearch,
  setActiveSchema,
  setCoverage,
  setCompanyName,
  setCountryCode,
  setEntityType,
  setOwnershipType,
  setCustomQuestions,
  setExcludedGapFields,
  setError,
  setStep,
  setFormVersion,
  askMoreOpenSection,
  setAskMoreOpenSection,
  newQuestion,
  setNewQuestion,
  saveDossier,
  getFieldLabel,
  dossierCompany,
  includedGapFieldObjs,
  allRequestableGapFields,
  isStakeholderField,
  loadDossierAndStartOnboarding,
  trackEvent,
  gapRef,
  cardStyle: card,
}) {
  const renderAskMoreButton = (sectionName) => (
    <AskMoreButton
      sectionName={sectionName}
      askMoreOpenSection={askMoreOpenSection}
      setAskMoreOpenSection={setAskMoreOpenSection}
      newQuestion={newQuestion}
      setNewQuestion={setNewQuestion}
      setCustomQuestions={setCustomQuestions}
    />
  );

  // Interactive Customer Request — each gap field carries an exclude checkbox
  // (strike-through + "✕ Excluded" badge when off), custom questions can be
  // removed, and "Ask for more" adds analyst questions inline. `allFields` is
  // the full candidate list (excluded or not); the live count reflects only
  // active (non-excluded) fields plus custom questions.
  const renderCustomerRequestSection = (allFields, qs) => {
    if (allFields.length === 0 && qs.length === 0) {
      return (
        <div style={{ padding: "16px", background: C.successBg, border: `1px solid ${C.successBorder}`, borderRadius: 10, marginBottom: 16, fontSize: 13, color: C.success, fontWeight: 600 }}>
          ✅ No fields to request — all information was collected automatically.
        </div>
      );
    }
    const activeRequestCount =
      allFields.filter((f) => !excludedGapFields.has(f.field)).length + qs.length;
    return (
      <div style={{ marginBottom: 16, borderRadius: 10, border: "1px solid #DDD6FE", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: "#F3F0FF", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#7C3AED" }}>📋 Customer Request</span>
            <span style={{ fontSize: 12, color: "#7C3AED", opacity: 0.7, marginLeft: 8 }}>
              {activeRequestCount} question{activeRequestCount !== 1 ? "s" : ""} will be sent to the customer
            </span>
          </div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          {allFields.map((field, i) => {
            const isExcluded = excludedGapFields.has(field.field);
            return (
              <div
                key={field.field}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: i < allFields.length - 1 || qs.length > 0 ? "1px solid #EDE9FE" : "none",
                  opacity: isExcluded ? 0.4 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {/* Exclude checkbox */}
                <input
                  type="checkbox"
                  checked={!isExcluded}
                  onChange={() => {
                    setExcludedGapFields((prev) => {
                      const next = new Set(prev);
                      if (next.has(field.field)) next.delete(field.field);
                      else next.add(field.field);
                      return next;
                    });
                  }}
                  style={{ width: 15, height: 15, accentColor: "#7C3AED", cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: isExcluded ? C.textMuted : C.text, flex: 1, textDecoration: isExcluded ? "line-through" : "none" }}>
                  {field.label}
                </span>
                {field.required && !isExcluded && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.error, flexShrink: 0 }}>Required</span>
                )}
                {isExcluded && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 99, padding: "1px 6px", flexShrink: 0 }}>
                    ✕ Excluded
                  </span>
                )}
              </div>
            );
          })}
          {qs.map((q, i) => (
            <div
              key={q.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < qs.length - 1 ? "1px solid #EDE9FE" : "none" }}
            >
              <input type="checkbox" checked readOnly style={{ width: 15, height: 15, accentColor: "#7C3AED", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#4C1D95", flex: 1, fontWeight: 500 }}>{q.question}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "2px 6px", flexShrink: 0 }}>Custom</span>
              {/* Remove button */}
              <button
                onClick={() => setCustomQuestions((prev) => prev.filter((cq) => cq.id !== q.id))}
                style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16, padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                title="Remove question"
              >
                ×
              </button>
            </div>
          ))}
          {/* Ask for more — inline in dossier. Section "customer_request" is the
              bucket for all questions added from the dossier view. */}
          <div style={{ marginTop: 12 }}>
            {renderAskMoreButton("customer_request")}
          </div>
        </div>
      </div>
    );
  };

  const renderDossierStakeholders = (stakeholderResults) => (
    <div style={{ marginBottom: 16, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", background: C.surfaceAlt, fontSize: 14, fontWeight: 700, color: C.text }}>👥 Stakeholders Found</div>
      <div style={{ padding: "12px 16px" }}>
        {stakeholderResults.map((result) => {
          const realStakeholders = (result.stakeholders || []).filter((s) => !isRegistryExemptionNotice(s));
          if (realStakeholders.length === 0) return null;
          const fieldId = result.field;
          const isUBO = String(fieldId).includes("ubo") || String(fieldId).includes("beneficial");
          return (
            <div key={fieldId} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6 }}>
                {isUBO ? "Beneficial Owners" : "Directors / Officers"}
              </div>
              {realStakeholders.map((s) => {
                const positions = (s.positions || []).filter((p) => p && p.title);
                // Detail chips mirroring the Fill Gaps stakeholder card: role,
                // shareholding, nationality, DOB, positions, PEP status. Only
                // render what the registry actually returned.
                const details = s.is_company
                  ? [
                      s.role,
                      s.share_percentage != null ? `${formatShareholding(s.share_percentage)} shareholding` : null,
                      s.business_registration_number ? `Reg: ${s.business_registration_number}` : null,
                      s.registered_country ? `Registered in ${s.registered_country}` : null,
                      ...positions.map((p) => p.start_date ? `${p.title} (since ${p.start_date})` : p.title),
                    ].filter(Boolean)
                  : [
                      s.role,
                      s.share_percentage != null ? `${formatShareholding(s.share_percentage)} shareholding` : null,
                      s.nationality ? `Nationality: ${s.nationality}` : null,
                      formatDOBForDisplay(s.date_of_birth) || s.date_of_birth ? `DOB: ${formatDOBForDisplay(s.date_of_birth) || s.date_of_birth}` : null,
                      s.residential_country ? `Residence: ${s.residential_country}` : null,
                      s.is_pep === true ? "⚑ PEP" : s.is_pep === false ? "PEP: No" : null,
                    ].filter(Boolean);
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ marginTop: 1 }}>{s.is_company ? "🏢" : "👤"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.full_name}</span>
                      {s.sharePercentageWarning && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: "#92400E",
                          background: "#FEF3C7", border: "1px solid #FCD34D",
                          borderRadius: 4, padding: "1px 6px", marginLeft: 6,
                        }}>
                          ⚠ Verify band
                        </span>
                      )}
                      {details.length > 0 && (
                        <div style={{ fontSize: 12, color: C.textSec, marginTop: 3, lineHeight: 1.5 }}>
                          {details.join(" · ")}
                        </div>
                      )}
                      {s.is_pep === true && s.pep_details && (
                        <div style={{ fontSize: 11, color: C.warning, marginTop: 2 }}>{s.pep_details}</div>
                      )}
                    </div>
                    {s.source && <span style={{ fontSize: 11, color: C.success, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>✓ {s.source}</span>}
                  </div>
                );
              })}
            </div>
          );
        }).filter(Boolean)}
      </div>
    </div>
  );

  const renderDossierDocuments = () => {
    const docs = (docSearchResults?.documents || []).filter((d) => d.status === "downloaded" || d.status === "url_found");
    // Registry documents retrieved by the self-source agent (Companies House /
    // ACRA / etc.) — these were previously only shown on the Documents step.
    const registryDocs = (selfSourceResults?.results || []).filter(
      (r) => r.status === "retrieved" || r.status === "retrieved_unverified" || r.manualReviewFlag || r.status === "manual_retrieval_required"
    );
    if (docs.length === 0 && registryDocs.length === 0) return null;
    return (
      <div style={{ marginBottom: 16, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.surfaceAlt, fontSize: 14, fontWeight: 700, color: C.text }}>📄 Documents Sourced</div>
        <div style={{ padding: "12px 16px" }}>
          {docs.map((doc, i) => (
            <div key={doc.type || i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: (i < docs.length - 1 || registryDocs.length > 0) ? `1px solid ${C.border}` : "none" }}>
              <span>{doc.type === "wolfsberg_questionnaire" ? "📋" : "📊"}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{doc.label || doc.type}</span>
                {doc.year && <span style={{ fontSize: 12, color: C.textSec, marginLeft: 8 }}>{doc.year}</span>}
              </div>
              {doc.sourceUrl && (
                <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.brandBlue, fontWeight: 600, textDecoration: "none" }}>View →</a>
              )}
            </div>
          ))}
          {registryDocs.map((item, i) => {
            const url = item.searchUrl || item.sourceUrl;
            const retrieved = item.status === "retrieved" || item.status === "retrieved_unverified";
            const ts = formatFetchedAt(item.retrievedAt);
            const hasSnapshot = Array.isArray(item.files) && item.files.length > 0;
            return (
              <div key={`reg-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: i < registryDocs.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <span style={{ marginTop: 1 }}>🏛️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.localEquivalent || item.requirement}</span>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {item.sourceLabel || item.requirement}
                    {!retrieved && <span style={{ color: C.warning, fontWeight: 600 }}> · ⚠ manual retrieval required</span>}
                    {ts && <span> · 🕒 {ts}</span>}
                    {hasSnapshot && retrieved && <span> · 📸 snapshot captured</span>}
                  </div>
                </div>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.brandBlue, fontWeight: 600, textDecoration: "none", flexShrink: 0 }}>View →</a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

    const found = research?.found || [];
    const verifiedItems = found.filter((r) => r.verificationStatus === "verified");
    const probableItems = found.filter((r) => r.verificationStatus === "probable");
    const indicativeItems = found.filter((r) => r.verificationStatus === "indicative");
    const includedFields = includedGapFieldObjs();
    const allGapFields = allRequestableGapFields();
    const stakeholderResults = found.filter((r) => isStakeholderField(r.field) && r.stakeholders?.length > 0);
    const company = dossierCompany();

    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 20px 60px", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: C.text }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", background: "#F3F0FF", border: "1px solid #DDD6FE", borderRadius: 12, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>🔍</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.8px" }}>Intelligence Dossier</span>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#4C1D95", margin: "0 0 4px 0" }}>{company.name}</h1>
              <div style={{ fontSize: 13, color: "#7C3AED", opacity: 0.8 }}>
                {company.countryName}
                {entityType && ` · ${entityType}`}
                {ownershipType && ` · ${(OWNERSHIP_TYPE_LIBRARY.find((o) => o.id === ownershipType)?.label || ownershipType)}`}
              </div>
              <div style={{ fontSize: 11, color: "#7C3AED", opacity: 0.6, marginTop: 4 }}>
                {dossierId && `ID: ${String(dossierId).slice(0, 8)}…`}
              </div>
            </div>
            {/* Save state — the dossier auto-saves on research complete, so by
                the time the analyst lands here it is normally already saved.
                After adjusting exclusions / questions, "Update" re-saves with
                the current state. */}
            <div style={{ flexShrink: 0 }}>
              {dossierSaving && (
                <span style={{ fontSize: 12, color: "#7C3AED", fontStyle: "italic" }}>
                  Saving dossier…
                </span>
              )}

              {!dossierSaving && dossierSaved && dossierId && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "3px 10px" }}>
                    ✓ Dossier Saved
                  </span>
                  <button
                    onClick={() => {
                      setDossierSaved(false);
                      setDossierId(null);
                      saveDossier();
                    }}
                    disabled={dossierSaving}
                    style={{ fontSize: 11, color: "#7C3AED", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}
                  >
                    Update
                  </button>
                </div>
              )}

              {!dossierSaving && !dossierSaved && (
                <button
                  onClick={() => saveDossier()}
                  style={{ padding: "8px 16px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
                >
                  💾 Save Dossier
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Coverage summary */}
        {coverage && (
          <div style={{ display: "flex", gap: 0, marginBottom: 24, borderRadius: 10, border: "1px solid #DDD6FE", overflow: "hidden" }}>
            {[
              { count: coverage.verifiedFields || 0, label: "Verified", bg: C.successBg, color: C.success, border: C.successBorder },
              { count: coverage.probableFields || 0, label: "Probable", bg: C.warningBg, color: C.warning, border: C.warningBorder },
              { count: coverage.indicativeFields || 0, label: "Indicative", bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA" },
              { count: includedFields.length + customQuestions.length, label: "To Request", bg: "#F3F0FF", color: "#7C3AED", border: "#DDD6FE" },
            ].map((tile, i) => (
              <div key={i} style={{ flex: 1, padding: "14px 12px", background: tile.bg, borderRight: i < 3 ? `1px solid ${tile.border}` : "none", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: tile.color, lineHeight: 1 }}>{tile.count}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: tile.color, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{tile.label}</div>
              </div>
            ))}
          </div>
        )}

        <DossierSection title="✅ Verified" subtitle={`${verifiedItems.length} fields from official sources`} items={verifiedItems} bg={C.successBg} borderColor={C.successBorder} color={C.success} getLabel={getFieldLabel} fallbackTs={researchTimestamp} />
        {probableItems.length > 0 && <DossierSection title="~ Probable" subtitle={`${probableItems.length} fields from company sources`} items={probableItems} bg={C.warningBg} borderColor={C.warningBorder} color={C.warning} getLabel={getFieldLabel} fallbackTs={researchTimestamp} />}
        {indicativeItems.length > 0 && <DossierSection title="⚠ Indicative" subtitle={`${indicativeItems.length} fields from unverified sources`} items={indicativeItems} bg="#FFF7ED" borderColor="#FED7AA" color="#C2410C" getLabel={getFieldLabel} fallbackTs={researchTimestamp} />}

        {renderCustomerRequestSection(allGapFields, customQuestions)}
        {stakeholderResults.length > 0 && renderDossierStakeholders(stakeholderResults)}
        {renderDossierDocuments()}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <button
              onClick={async () => {
                // The dossier is the source of truth: always fetch fresh from the
                // DB and reconstruct full research state (raw_research.found,
                // schema, coverage, stakeholders) rather than relying on in-memory
                // state — whether Preview is clicked immediately or hours later.
                // loadDossierAndStartOnboarding handles agentType/step/navigation.
                if (!dossierId) {
                  // eslint-disable-next-line no-console
                  console.warn("[Preview] No dossierId — cannot load from DB");
                  return;
                }
                await loadDossierAndStartOnboarding(dossierId, tenantId);
                trackEvent("preboarding_to_onboarding", {
                  dossierId,
                  via: "preview_button",
                  companyName: company.name,
                  includedFields: includedFields.length,
                  customQuestions: customQuestions.length,
                });
              }}
              style={{
                padding: '10px 20px',
                background: '#fff',
                color: '#1a3a4a',
                border: '2px dashed #1a3a4a',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: 0.85,
              }}
            >
              🧪 Preview Customer Onboarding
            </button>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              See exactly what your customer will see
            </div>
          </div>
          <button
            onClick={() => setShowInviteScreen(true)}
            style={{
              padding: '10px 20px',
              background: '#1a3a4a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            ✉ Invite Customer to Onboard
          </button>
          <button
            onClick={() => {
              // Start a genuinely fresh dossier. Clearing research is essential:
              // the auto-save effect watches research?.found, so leaving it
              // populated would immediately re-save and bounce back here.
              // (preboardingUnlocked is left intact — no re-prompting the gate.)
              setShowDossierView(false);
              setDossierId(null);
              setDossierSaved(false);
              setResearch(null);
              setActiveSchema(null);
              setCoverage(null);
              setExcludedGapFields(new Set());
              setCustomQuestions([]);
              setAskMoreOpenSection(null);
              gapRef.current = {};
              setFormVersion((v) => v + 1);
              setCompanyName("");
              setEntityType("");
              setOwnershipType("");
              setCountryCode("");
              setError("");
              setStep(0);
              trackEvent("preboarding_new_dossier", { previousDossierId: dossierId });
            }}
            style={{ padding: "14px 24px", background: "transparent", color: "#7C3AED", border: "1.5px solid #7C3AED", borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}
          >
            + New Dossier
          </button>
        </div>
      </div>
    );
}
