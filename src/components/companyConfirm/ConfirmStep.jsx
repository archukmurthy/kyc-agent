/**
 * ConfirmStep.jsx — the Confirm page of the onboarding wizard, extracted
 * verbatim from the inline block in App.js (Option B port, commit 1: pure
 * extraction, ZERO behaviour change).
 *
 * STRICT boundary: this component is PRESENTATIONAL and CONTROLLED. All state
 * (checks, research, coverage, stakeholder state) stays in App.js and arrives
 * as props, as do the derived render lists (sortedFound et al.) and the two
 * deep render helpers (renderStakeholderConfirmSection /
 * renderUnifiedFoundTable) — those close over App.js state (checks, refs,
 * dialogue persistence) and moving them would change closure semantics.
 * The step gate (`step === STEPS.confirm && …`) also stays in App.js.
 */

import { C } from "../../constants/theme";
import { SHOW_TEST_TOOLS } from "../../constants/appConstants";
import { getResearchStrategy } from "../../utils/ownershipTypes";

export function ConfirmStep({
  research,
  companyName,
  coverage,
  ownershipType,
  journeyType,
  servedFromCache,
  cachedAt,
  checks,
  isPubliclyListedOverride,
  setIsPubliclyListedOverride,
  sortedFound,
  stakeholderFound,
  regularFound,
  docCount,
  tier1Count,
  tier2Count,
  tier3Count,
  jurisdictionBadge,
  entityBadge,
  cardStyle,
  Btn,
  STEPS,
  stepsFor,
  setStep,
  setCompanyName,
  setJourneyOpen,
  setSelectedJourneyCard,
  setJourneyType,
  setError,
  scrollAndSetStep,
  renderStakeholderConfirmSection,
  renderUnifiedFoundTable,
}) {
  const card = cardStyle;
  return (
          <div>
            {/* The "is this the right company?" check now lives on the Applicant
                page as the five-fact FoundationalFactsGate (slice 2), so there is
                no gate here — avoids a double gate. */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✅</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{research.companyName || companyName} {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>
                    {sortedFound.length} fields pre-filled · {docCount} from documents · {tier1Count} from official sources · {tier2Count + tier3Count} need your attention
                  </p>
                  {servedFromCache && cachedAt && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: '#f0fdf4', border: '1px solid #bbf7d0',
                      borderRadius: 20, padding: '3px 10px', fontSize: 11, color: '#166534',
                      marginTop: 8
                    }}>
                      ✓ Served from cache · fetched {new Date(cachedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ background: "#f0f9f6", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#1a6b56", borderLeft: "4px solid #4a9e8e" }}>
                Below: every field we pre-filled, sorted by source — documents first (most reliable), then official registries, then company-owned sources, then unverified web. Uncheck anything wrong — it'll move to the next page for correction. Click any source to reveal when it was fetched.
              </div>
            </div>

            {/* TEST-ONLY utility — treat the company as publicly listed, which
                skips the detailed stakeholder EDD forms on the next page. Sets
                isPubliclyListedOverride (same state + downstream effectivelyListed
                consumer as before — behaviour unchanged). Gated by SHOW_TEST_TOOLS
                so real customers never see it; styled to match the dashed
                "Fill with test data" test control, not a customer selection. */}
            {SHOW_TEST_TOOLS && (
              <div
                onClick={() => setIsPubliclyListedOverride(v => !v)}
                title="Testing only — treat this company as publicly listed to skip the detailed stakeholder forms on the next page"
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", marginBottom: 16,
                  background: "transparent",
                  border: "2px dashed #4a9e8e", borderRadius: 8,
                  cursor: "pointer", userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={isPubliclyListedOverride}
                  onChange={() => setIsPubliclyListedOverride(v => !v)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 15, height: 15, accentColor: "#4a9e8e", cursor: "pointer", flexShrink: 0 }}
                  aria-label="TEST: treat as publicly listed (skips stakeholder forms)"
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#4a9e8e", letterSpacing: "0.3px" }}>
                    🧪 TEST: treat as publicly listed (skips stakeholder forms)
                  </div>
                  <div style={{ fontSize: 11, marginTop: 1, color: "#4a9e8e", opacity: 0.8 }}>
                    {isPubliclyListedOverride
                      ? "On — detailed stakeholder forms will be skipped on the next page"
                      : "Test aid only — not shown to customers"}
                  </div>
                </div>
                {isPubliclyListedOverride && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#4a9e8e", border: "1px dashed #4a9e8e", borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
                    Listed ✓
                  </span>
                )}
              </div>
            )}

            {/* Part 11 — low-data banner. Threshold is calibrated per ownership
                type (private companies expect lower fill rates than listed). */}
            {(() => {
              if (!coverage) return null;
              const strat = getResearchStrategy(ownershipType);
              const showLowDataBanner = coverage.fillRate < strat.lowDataThreshold + 0.10;
              if (!showLowDataBanner) return null;
              const parentResult = (research.found || []).find(
                (r) => r.field === "ubo_parent_company" || r.field === "parent_company" || r.field === "group_structure"
              );
              const isPrivateish = ownershipType === "private_limited" || ownershipType === "branch";
              return (
                <div style={{ padding: 16, background: C.infoBg, border: `1px solid ${C.infoBorder}`, borderRadius: 10, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.info, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>ℹ</span>
                    <span>Limited public information found for {research.companyName || companyName}</span>
                  </div>
                  <p style={{ fontSize: 13, color: C.info, marginBottom: 12, lineHeight: 1.5 }}>
                    {coverage.populatedFields} of {coverage.totalResearchFields} fields were found from public sources.
                    {isPrivateish
                      ? " Private companies have limited publicly available information — this is expected."
                      : " You can improve coverage by uploading documents."}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ownershipType === "branch" && (
                      <div style={{ padding: "10px 14px", background: "#fff", borderRadius: 8, border: `1px solid ${C.infoBorder}`, fontSize: 13, color: C.text }}>
                        <strong>Try searching for the parent company:</strong> If this is a branch, searching for the parent entity may return more complete information.
                        {parentResult && parentResult.value && (
                          <button
                            onClick={() => {
                              setCompanyName(String(parentResult.value));
                              setJourneyOpen(false);
                              setSelectedJourneyCard(null);
                              setError("");
                              setStep(STEPS.input);
                            }}
                            style={{ marginLeft: 8, padding: "4px 12px", background: C.info, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                          >
                            Search parent →
                          </button>
                        )}
                      </div>
                    )}
                    {journeyType === "ai_only" && (
                      <div style={{ padding: "10px 14px", background: "#fff", borderRadius: 8, border: `1px solid ${C.infoBorder}`, fontSize: 13, color: C.text, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span>
                          <strong>Upload documents</strong> to pre-fill more fields — Certificate of Incorporation, Annual Report, or Wolfsberg questionnaire.
                        </span>
                        <button
                          onClick={() => { setJourneyType("ai_documents"); setJourneyOpen(false); setStep(stepsFor("ai_documents").documents); }}
                          style={{ padding: "6px 14px", background: C.niumBlue, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}
                        >
                          📄 Upload docs
                        </button>
                      </div>
                    )}
                    <p style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic", margin: 0 }}>
                      Or continue below — you can complete the remaining fields manually on the next page.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Part 9 — coverage summary bar. */}
            {coverage && (
              <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <div style={{ flex: 1, padding: "12px 16px", background: C.successBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.success, lineHeight: 1 }}>{coverage.verifiedFields}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.success, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Verified</div>
                </div>
                <div style={{ flex: 1, padding: "12px 16px", background: C.warningBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.warning, lineHeight: 1 }}>{coverage.probableFields}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.warning, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Confirm</div>
                </div>
                {coverage.indicativeFields > 0 && (
                  <div style={{ flex: 1, padding: "12px 16px", background: "#FFF7ED", borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#C2410C", lineHeight: 1 }}>{coverage.indicativeFields}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#C2410C", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Low Confidence</div>
                  </div>
                )}
                <div style={{ flex: 1, padding: "12px 16px", background: C.surfaceAlt, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.textMuted, lineHeight: 1 }}>{coverage.missingFieldCount}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Complete</div>
                </div>
              </div>
            )}

            {stakeholderFound.length > 0 && (
              <div style={card}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>People Found</h3>
                <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>
                  Directors and beneficial owners we identified from official sources. Verify each name; you'll provide additional compliance details on the next page.
                </p>
                {stakeholderFound.map(({ item, idx }) => renderStakeholderConfirmSection(item, idx))}
              </div>
            )}

            {regularFound.length > 0 && renderUnifiedFoundTable(regularFound, "Pre-filled Fields", "Documents → Official sources → Unverified web. Tier-2 rows carry an inline warning.")}

            {(research.found || []).filter((_, i) => !checks[i]).length > 0 && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fff8ed", borderRadius: 6, fontSize: 12, color: "#b07d10", borderLeft: "3px solid #e0a040" }}>
                ⚠️ {(research.found || []).filter((_, i) => !checks[i]).length} field(s) unchecked — will appear on next page for correction.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {/* PR: Applicant now sits just before Confirm, so the backward action
                  is to return to the Applicant page (not restart). Plain step
                  navigation — preserves all field values, checks, applicant data
                  and uploaded docs; no wipe, no confirmation. Both journeys. */}
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.applicant)}>← Back</Btn>
              <Btn variant="green" onClick={() => { scrollAndSetStep(STEPS.fillGaps); setError(""); }}>Confirm and Continue →</Btn>
            </div>
          </div>
  );
}

export default ConfirmStep;
