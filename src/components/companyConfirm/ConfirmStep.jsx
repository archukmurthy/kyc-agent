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
                  <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>{research.companyName || companyName} {jurisdictionBadge}{entityBadge}</h2>
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
            </div>

            {/* Re-skin: ONE action banner (replaces the old green intro strip
                here and the amber unchecked-count strip that sat above the
                footer). Pure presentation over existing data — a row "needs
                input" when it is tier2/tier3 (low confidence) OR unchecked, so
                a disputed low-confidence row is never double-counted. */}
            {(() => {
              const needsInput = (research.found || []).filter(
                (it, i) => !checks[i] || it.sourceTier === "tier2" || it.sourceTier === "tier3"
              ).length;
              const uncheckedCount = (research.found || []).filter((_, i) => !checks[i]).length;
              const allQuiet = needsInput === 0;
              return (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  background: "#fff", borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  borderLeft: `4px solid ${allQuiet ? "#4a9e8e" : C.warning}`,
                  padding: "14px 18px", marginBottom: 16,
                  boxShadow: "0 2px 10px rgba(26,58,74,0.04)",
                }}>
                  <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>{allQuiet ? "✅" : "👋"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                      {allQuiet
                        ? "Everything is confirmed from official sources — just review and continue."
                        : `${needsInput} item${needsInput === 1 ? "" : "s"} need${needsInput === 1 ? "s" : ""} your input`}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 3, lineHeight: 1.5 }}>
                      {allQuiet
                        ? "Every pre-filled field below came from your documents or official registries. Click any source to see when it was fetched."
                        : "Everything else is confirmed — you don't need to touch it. Amber rows came from company or unverified sources; give each a quick check. Click any source to see when it was fetched."}
                      {uncheckedCount > 0 && (
                        <> You've marked {uncheckedCount} field{uncheckedCount === 1 ? "" : "s"} as wrong — you'll provide the correct value{uncheckedCount === 1 ? "" : "s"} on the next page.</>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

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

            {/* Part 9 — coverage summary tiles. Same computeCoverage data;
                re-skin: four separate tile cards (always rendered — a zero
                tile is de-emphasised rather than hidden), plain integers. */}
            {coverage && (() => {
              const tiles = [
                { label: "Verified", value: coverage.verifiedFields, color: C.success, bg: C.successBg },
                { label: "To Confirm", value: coverage.probableFields, color: C.warning, bg: C.warningBg },
                { label: "Low Confidence", value: coverage.indicativeFields, color: "#C2410C", bg: "#FFF7ED" },
                { label: "To Complete", value: coverage.missingFieldCount, color: C.textMuted, bg: C.surfaceAlt },
              ];
              return (
                <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                  {tiles.map((t) => {
                    const v = Number(t.value) || 0;
                    return (
                      <div key={t.label} style={{
                        flex: 1, padding: "14px 12px", background: t.bg,
                        border: `1px solid ${C.border}`, borderRadius: 10,
                        textAlign: "center", opacity: v === 0 ? 0.45 : 1,
                      }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: t.color, lineHeight: 1 }}>{v}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: t.color, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t.label}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

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

            {/* (The old amber unchecked-count strip lived here — its message
                now lives in the single action banner at the top.) */}

            {/* Re-skin: sticky footer bar. Same two navigation handlers as
                before — no gate in commit 2, both buttons always advance.
                PR: Applicant now sits just before Confirm, so the backward
                action is to return to the Applicant page (not restart). Plain
                step navigation — preserves all field values, checks, applicant
                data and uploaded docs; no wipe, no confirmation. Both journeys. */}
            <div style={{
              position: "sticky", bottom: 0, zIndex: 5,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: "rgba(255,255,255,0.96)", backdropFilter: "blur(4px)",
              borderTop: `1px solid ${C.border}`, borderRadius: "12px 12px 0 0",
              padding: "12px 16px",
            }}>
              <button
                onClick={() => scrollAndSetStep(STEPS.applicant)}
                style={{ padding: "11px 22px", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "transparent", color: C.text, border: `1.5px solid ${C.border}` }}
              >
                ← Back
              </button>
              <button
                onClick={() => { scrollAndSetStep(STEPS.fillGaps); setError(""); }}
                style={{ padding: "12px 28px", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "#4a9e8e", color: "#fff", border: "none", boxShadow: "0 3px 12px rgba(74,158,142,0.35)" }}
              >
                Confirm and Continue →
              </button>
            </div>
          </div>
  );
}

export default ConfirmStep;
