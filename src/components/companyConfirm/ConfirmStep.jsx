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
import { AmendmentDocCard } from "../amendmentDocuments/AmendmentDocCard";
import { HoverTooltip } from "./HoverTooltip";
import { docKey, isSatisfied } from "./confirmState";

export function ConfirmStep({
  research,
  companyName,
  coverage,
  ownershipType,
  journeyType,
  servedFromCache,
  cachedAt,
  checks,
  confirmCounts,
  confirmDocs,
  amendmentUploads,
  uploadingDocKey,
  onAmendmentUpload,
  onAmendmentRemove,
  blockers,
  blockerMessage,
  isPubliclyListedOverride,
  setIsPubliclyListedOverride,
  sortedFound,
  stakeholderFound,
  regularFound,
  docCount,
  tier1Count,
  tier2Count,
  tier3Count,
  prefill,
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
  renderAddPerson,
}) {
  const card = cardStyle;
  // Every count on this page comes from the ONE shared predicate
  // (confirmState.js) that the commit-4 submit gate will also read — the tiles
  // and the gate can never disagree because there is only one derivation.
  const counts = confirmCounts || { needsYou: 0, confirmed: 0, corrected: 0, docsNeeded: 0, docs: [] };
  const outstanding = counts.needsYou;
  const docs = confirmDocs || [];
  const uploads = amendmentUploads || {};
  // The gate: blocked iff the shared predicate returns anything. The message
  // comes from the SAME list, so the button can never grey out silently.
  const blockerList = blockers || [];
  const isBlocked = blockerList.length > 0;
  // Pre-fill is a RESEARCH metric — how much arrived and from where, counted in
  // data points (a stakeholder row carrying three people is not one field).
  // Falls back to the old row-based numbers only if the prop is absent.
  const prefillStats = prefill || {
    total: sortedFound.length,
    document: docCount,
    tier1: tier1Count,
    unverified: tier2Count + tier3Count,
    other: 0,
  };
  return (
          <div>
            {/* The "is this the right company?" check now lives on the Applicant
                page as the five-fact FoundationalFactsGate (slice 2), so there is
                no gate here — avoids a double gate. */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✅</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* The source breakdown is supporting detail, not headline
                      copy — it now lives in a hover tooltip on the company name
                      so the default view stays uncluttered. Same numbers, same
                      wording, floating (out of flow) so nothing reflows. */}
                  <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>
                    <HoverTooltip
                      testId="prefilled-breakdown-tooltip"
                      width={320}
                      content={
                        <span style={{ display: "block" }}>
                          {prefillStats.total} fields pre-filled · {prefillStats.document} from documents · {prefillStats.tier1} from official sources · {prefillStats.unverified} from company or unverified sources
                          {prefillStats.other > 0 && ` · ${prefillStats.other} from an unrecorded source`}
                        </span>
                      }
                    >
                      <span style={{
                        cursor: "help",
                        textDecoration: "underline dotted",
                        textDecorationColor: "rgba(26,58,74,0.3)",
                        textUnderlineOffset: 4,
                      }}>
                        {research.companyName || companyName}
                      </span>
                    </HoverTooltip>
                    {" "}{jurisdictionBadge}{entityBadge}
                  </h2>
                  {/* Prototype's reassurance line leads. */}
                  <p style={{ fontSize: 13, color: C.textSec, margin: "3px 0 0", lineHeight: 1.5 }}>
                    We verified the high-confidence data for <strong>{research.companyName || companyName}</strong>.{" "}
                    {outstanding > 0 ? "Only a few items need your input." : "Nothing needs your input."}
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
                {/* (The header's "N ITEMS NEED YOUR INPUT" pill was removed —
                    the same count is already the Needs You tile below, and its
                    coaching copy is that tile's hover tooltip.) */}
              </div>
            </div>

            {/* (The single action banner that used to sit here is gone from the
                page flow — its coaching copy is now the Needs You tile's hover
                tooltip. Same text, same shared predicate, just not permanent.) */}

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

            {/* The prototype's four tiles — Needs You / Confirmed / Corrected /
                Docs Needed — replacing the old coverage-bar vocabulary
                (Verified / To Confirm / Low Confidence / To Complete). Every
                value is real state from the shared predicate, no invented
                counters: Needs You and Confirmed are fully live; Corrected
                counts saved inline corrections (commit 3); Docs Needed counts
                doc_required classifications and becomes authoritative in
                commit 4, when it reconciles against /api/amendment-documents.
                Plain integers, zero tiles de-emphasised. */}
            {(() => {
              // The old action banner's copy, verbatim — now surfaced only on
              // hover of the Needs You tile it was always describing.
              const needsInput = outstanding;
              const uncheckedCount = (research.found || []).filter((_, i) => !checks[i]).length;
              const allQuiet = needsInput === 0;
              const needsYouTip = (
                <>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.text }}>
                    {allQuiet ? "✅ " : "👋 "}
                    {allQuiet
                      ? "Everything is confirmed from official sources — just review and continue."
                      : `${needsInput} item${needsInput === 1 ? "" : "s"} need${needsInput === 1 ? "s" : ""} your input`}
                  </span>
                  <span style={{ display: "block", marginTop: 4 }}>
                    {allQuiet
                      ? "Every pre-filled field below came from your documents or official registries. Click any source to see when it was fetched."
                      : "Everything else is confirmed — you don't need to touch it. Amber rows came from company or unverified sources; give each a quick check. Click any source to see when it was fetched."}
                    {uncheckedCount > 0 && (
                      <> You've marked {uncheckedCount} field{uncheckedCount === 1 ? "" : "s"} as wrong — you'll provide the correct value{uncheckedCount === 1 ? "" : "s"} on the next page.</>
                    )}
                  </span>
                </>
              );
              const tiles = [
                { label: "Needs You", value: counts.needsYou, color: C.warning, bg: C.warningBg, tooltip: needsYouTip },
                { label: "Confirmed", value: counts.confirmed, color: C.success, bg: C.successBg },
                { label: "Corrected", value: counts.corrected, color: C.info, bg: C.infoBg },
                { label: "Docs Needed", value: counts.docsNeeded, color: "#C2410C", bg: "#FFF7ED" },
              ];
              return (
                <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                  {tiles.map((t) => {
                    const v = Number(t.value) || 0;
                    const face = (
                      <div style={{
                        padding: "14px 12px", background: t.bg,
                        border: `1px solid ${C.border}`, borderRadius: 10,
                        textAlign: "center", opacity: v === 0 ? 0.45 : 1,
                        cursor: t.tooltip ? "help" : "default",
                      }}>
                        <div style={{ fontSize: 26, fontWeight: 800, color: t.color, lineHeight: 1 }}>{v}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: t.color, marginTop: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>{t.label}</div>
                      </div>
                    );
                    // Every tile is wrapped in an equal `flex: 1` box so adding
                    // the tooltip to one of them can't change tile widths.
                    return t.tooltip ? (
                      <HoverTooltip
                        key={t.label}
                        testId="needs-you-tooltip"
                        content={t.tooltip}
                        align="center"
                        width={340}
                        wrapStyle={{ flex: 1, minWidth: 0, display: "block" }}
                      >
                        {face}
                      </HoverTooltip>
                    ) : (
                      <div key={t.label} style={{ flex: 1, minWidth: 0 }}>{face}</div>
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
                {/* The "add a director or beneficial owner we missed" panel was
                    removed from this page. renderAddPerson is still accepted as
                    a prop and AddPersonPanel is untouched, so re-enabling it is
                    one line — the capability was not deleted, only this
                    placement. */}
              </div>
            )}

            {regularFound.length > 0 && renderUnifiedFoundTable(regularFound, "Pre-filled Fields", "Documents → Official sources → Unverified web. Tier-2 rows carry an inline warning.")}

            {/* (The old amber unchecked-count strip lived here — its message
                now lives in the single action banner at the top.) */}

            {/* Pre-submit reassurance line — what you are about to submit, in a
                sentence, from the same counts the tiles show. Live-updating. */}
            <div style={{
              padding: "12px 16px", marginBottom: 16,
              background: C.surfaceAlt, border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 13, color: C.textSec, lineHeight: 1.6,
            }}>
              You're confirming <strong style={{ color: C.text }}>{counts.confirmed}</strong> field
              {counts.confirmed === 1 ? "" : "s"} as found
              {counts.corrected > 0 && (
                <>, correcting <strong style={{ color: C.info }}>{counts.corrected}</strong></>
              )}
              {docs.length > 0 && (
                <>, providing <strong style={{ color: C.text }}>{docs.length}</strong> supporting document{docs.length === 1 ? "" : "s"}</>
              )}
              {outstanding > 0 ? (
                <>, with <strong style={{ color: C.warning }}>{outstanding}</strong> still to review.</>
              ) : (
                <>.</>
              )}
            </div>

            {/* "Documents we'll need" — the prototype's dark summary panel.
                Commit 4 owns the inline upload cards and the reconciliation
                against GET /api/amendment-documents; this renders the real
                doc_required outcomes already classified on this page, and is
                honest about where the upload happens today (Fill Gaps). */}
            <div style={{
              background: "#1F2A33", borderRadius: 12,
              padding: "16px 20px", marginBottom: 16, color: "#fff",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: counts.docsNeeded > 0 ? 10 : 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.85)" }}>
                  Documents we'll need{counts.docsNeeded > 0 ? ` (${counts.docsNeeded})` : ""}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>
                  {docs.length === 0
                    ? "None triggered yet"
                    : counts.docsNeeded === 0
                    ? "All uploaded"
                    : `${counts.docsNeeded} outstanding`}
                </span>
              </div>
              {docs.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {docs.map((d) => {
                    const k = docKey(d);
                    const up = uploads[k];
                    const done = isSatisfied(up);
                    return (
                      <div key={k} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        background: "rgba(255,255,255,0.06)",
                        border: `1px solid ${done ? "rgba(122,220,180,0.4)" : "rgba(255,255,255,0.12)"}`,
                        borderRadius: 8, padding: "10px 14px", flexWrap: "wrap",
                      }}>
                        <span style={{ fontSize: 14, flexShrink: 0 }}>{done ? "✓" : "📄"}</span>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          {/* Person documents say WHOSE they are — two people
                              each owing a Proof of Identity are two separate
                              requests, and the customer must be able to tell
                              them apart. Per-field documents qualify the same
                              way with the field that asked. Company-wide
                              documents are one request and carry neither. */}
                          <div style={{ fontSize: 13, fontWeight: 700 }}>
                            {d.docType}
                            {(d.personName || d.fieldLabel) && (
                              <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.72)" }}> — {d.personName || d.fieldLabel}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
                            {done
                              ? `Uploaded — ${up.name}`
                              : up && up.uploadFailed
                              ? "Upload didn't store — please try again."
                              : "Required by your correction — upload it here or on the row above."}
                          </div>
                        </div>
                        {!done && (
                          <AmendmentDocCard
                            doc={d}
                            upload={up && up.uploadFailed ? up : undefined}
                            busy={uploadingDocKey === k}
                            onUpload={onAmendmentUpload}
                            onRemove={onAmendmentRemove}
                            variant="summary-action"
                          />
                        )}
                        {done && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={() => onAmendmentRemove && onAmendmentRemove(d)}
                            style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)", cursor: "pointer", flexShrink: 0 }}
                          >
                            Remove
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, fontStyle: "italic", color: "rgba(255,255,255,0.6)" }}>
                  Any documents required by your corrections will appear here.
                </div>
              )}
            </div>

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
              {/* What's blocking, in words, from the SAME list that blocks the
                  button — never a silent grey-out. */}
              <div style={{ flex: 1, textAlign: "right", paddingRight: 16, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: isBlocked ? C.warning : C.success }}>
                  {isBlocked ? blockerMessage : "Everything's ready"}
                </div>
                <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 1 }}>
                  {isBlocked ? "Resolve these to continue" : "Nothing outstanding"}
                </div>
              </div>
              <button
                onClick={isBlocked ? undefined : () => { scrollAndSetStep(STEPS.fillGaps); setError(""); }}
                disabled={isBlocked}
                title={isBlocked ? blockerMessage : undefined}
                style={{
                  padding: "12px 28px", borderRadius: 9, fontSize: 14, fontWeight: 700,
                  fontFamily: "inherit", border: "none",
                  cursor: isBlocked ? "not-allowed" : "pointer",
                  background: isBlocked ? "#cbd5e1" : "#4a9e8e",
                  color: isBlocked ? "#64748b" : "#fff",
                  boxShadow: isBlocked ? "none" : "0 3px 12px rgba(74,158,142,0.35)",
                }}
              >
                {isBlocked ? blockerMessage : "Confirm and Continue"}
              </button>
            </div>
          </div>
  );
}

export default ConfirmStep;
