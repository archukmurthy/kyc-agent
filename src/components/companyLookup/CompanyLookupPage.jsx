/**
 * CompanyLookupPage.jsx — the Company Lookup screen, step 0 of the wizard.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. This is slice 2
 * and the FINAL piece of the Journey/Lookup extraction: slice 1 took the
 * {journeyOpen} branch into JourneyPicker.jsx, this takes its complement, the
 * {!journeyOpen} branch. Both were inline JSX in App's return rather than named
 * render functions, so each slice AUTHORS its component boundary. The body
 * below is the same text that ran in App.js, at its original indentation, so a
 * diff shows the move and nothing else.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS, destructured back into
 * locals of the same name, so the moved body stays byte-identical.
 *
 * THIS COMPONENT OWNS NO STATE. Every value and setter is drilled, because each
 * field feeds research kickoff, resetAll, the submit payload or downstream
 * provenance. Two of those deserve naming:
 *
 *   - setRegNumberSource is LOAD-BEARING and easy to lose. The reg-number input
 *     writes TWICE in one handler: setRegNumber(v) AND setRegNumberSource(
 *     v.trim() ? "customer" : null). A move that carries only the first looks
 *     entirely correct on this screen — the text still round-trips — and
 *     silently breaks provenance downstream, flipping the Applicant gate from
 *     "You provided this" to "Found by research". The oracle drives to that
 *     gate specifically to catch it.
 *   - setJourneyOpen is the seam into JourneyPicker. journeyOpen itself STAYS
 *     in App.js: the picker, the AI-Documents Back button and ConfirmStep all
 *     consume it.
 *
 * MOVED VERBATIM, DELIBERATELY NOT "FIXED" — three known oddities that are
 * logged decisions elsewhere, not defects to clean up in a pure move:
 *
 *   1. The Continue gate is INERT-BY-STYLE, not semantically disabled. App's
 *      <Btn> renders no `disabled` attribute; it only dims the button and
 *      withholds onClick. Assistive tech sees an enabled button that does
 *      nothing. Separate a11y decision — unchanged here.
 *   2. The pendingReseedMode === "re_derive" short-circuit is currently dead:
 *      nothing in src/ ever sets that value (the only setter call passes null,
 *      inside applyReDerive itself). Possibly an unwired feature — kept intact.
 *   3. The four inline validation messages cannot fire, because Continue's
 *      gating condition tests the same four fields as its onClick guards.
 *      Defensive code — kept intact.
 *
 * The oracle is CompanyLookupPage.render.test.jsx (24 assertions), written
 * against the inline screen BEFORE this move and green after it, UNCHANGED. If
 * it goes red, the move is wrong, not the test.
 */

import React from "react";
import { C } from "../../constants/theme";
import { COUNTRIES, SHOW_TEST_TOOLS } from "../../constants/appConstants";
import {
  getApplicableLicence,
  getOwnershipTypeOptions,
  pickLicence,
} from "../../pipeline";
import { StableInput } from "../inputs/StableInput";
import SearchableSelect from "../SearchableSelect";

export function CompanyLookupPage({
  // ── the lookup form's fields, all App-owned ──
  companyName,
  setCompanyName,
  regNumber,
  setRegNumber,
  // CRITICAL: the reg-number handler writes both. See the note above.
  setRegNumberSource,
  entityType,
  setEntityType,
  ownershipType,
  setOwnershipType,
  countryCode,
  setCountryCode,
  // ── derived context for the licence banner ──
  countryObj,
  activeEntityTypes,
  tenantConfig,
  companyName_,
  // ── research cache override ──
  forceRefresh,
  setForceRefresh,
  // ── the Continue path ──
  pendingReseedMode,
  applyReDerive,
  setSelectedJourneyCard,
  setManualOpened,
  setJourneyOpen,
  doDummyResearch,
  // ── page chrome ──
  error,
  setError,
  Btn,
  cardStyle: card,
}) {
  return (
          <div style={card}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Company Lookup</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 20px" }}>Enter the company name and country. The agent will use <strong>jurisdiction-specific requirements</strong> (UK or SG/default) to drive the research and gap collection.</p>
            <StableInput id="companyName" label="Company Legal Name" type="text" value={companyName} onUpdate={(_, v) => setCompanyName(v)} required placeholder="e.g. Tesco PLC, DBS Group Holdings" />
            {/* Optional registration / company number. When supplied it's used as
                the primary search key to pinpoint the exact company; blank = the
                same name-based search as before (slice 1). */}
            <StableInput id="regNumber" label="Registration / Company number (optional)" type="text" value={regNumber} onUpdate={(_, v) => { setRegNumber(v); setRegNumberSource(v.trim() ? "customer" : null); }} placeholder="e.g. 00445790 — the official company / registration number" />
            <p style={{ fontSize: 11, color: "#1a3a4a80", margin: "-8px 0 16px", lineHeight: 1.4 }}>
              Optional. If you know the company's official registration number, we'll use it to pinpoint the exact company and sharpen the research. Leave it blank to search by name.
            </p>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="entity-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Entity Type <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="entity-type"
                value={entityType}
                onChange={(v) => { setEntityType(v); setOwnershipType(""); }}
                placeholder="Select or type entity type…"
                options={activeEntityTypes.map(e => ({
                  value: e.id,
                  label: `${e.icon ? e.icon + " " : ""}${e.label || e.id}`,
                  description: e.description || undefined,
                }))}
              />
            </div>
            {/* Ownership Type is always visible; its options are populated from
                the selected entity type. Until an entity type is chosen it shows
                disabled with a guiding placeholder. */}
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="ownership-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                Ownership Type <span style={{ color: C.error }}>*</span>
              </label>
              <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
                How is this company owned and structured?
              </p>
              <SearchableSelect
                id="ownership-type"
                value={ownershipType}
                onChange={setOwnershipType}
                disabled={!entityType}
                placeholder={entityType ? "Select ownership type…" : "Select an entity type first…"}
                options={entityType ? getOwnershipTypeOptions(entityType, tenantConfig) : []}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="country-reg" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Registered Country <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="country-reg"
                value={countryCode}
                onChange={setCountryCode}
                placeholder="Select or type country…"
                options={COUNTRIES.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              />
            </div>
            {countryCode && (() => {
              // Resolve the licence from the tenant's configured licences,
              // not the hardcoded UK/SG fallback. If tenantConfig is missing
              // (offline fallback) fall back to the old hardcoded helper.
              const resolved = tenantConfig ? pickLicence(countryCode, tenantConfig) : null;
              const primary = tenantConfig ? (tenantConfig.licences || []).find(l => l.isPrimary) || (tenantConfig.licences || [])[0] : null;
              const isLicensedHere = !!resolved && Array.isArray(resolved.countriesCovered) && resolved.countriesCovered.includes(countryCode);
              const licenceLabel = resolved
                ? `${resolved.jurisdictionCode === "GB" ? "🇬🇧 " : resolved.jurisdictionCode === "SG" ? "🇸🇬 " : ""}${resolved.jurisdictionName || resolved.id}${resolved.regulatoryAuthority ? ` (${resolved.regulatoryAuthority})` : ""}${!isLicensedHere ? " — default for non-licensed markets" : ""}`
                : (getApplicableLicence(countryCode) === "GB" ? "🇬🇧 United Kingdom (FCA)" : "🇸🇬 Singapore (MAS) — default for non-licensed markets");
              const isFiFlow = entityType === "FI" || entityType === "Platform";
              const routesNote = entityType === "Platform" || entityType === "Direct"
                ? ` (${entityType} routes to ${isFiFlow ? "FI" : "Corporate"} schema)`
                : "";
              const primaryName = primary?.jurisdictionName || "the default licence";
              return (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: isLicensedHere ? "#f0f3f8" : "#fff8ed", fontSize: 12, marginBottom: 14, borderLeft: isLicensedHere ? "3px solid #1a3a4a" : "3px solid #e0a040" }}>
                  <div style={{ marginBottom: 4 }}><strong>🌍 Researching in:</strong> {countryObj?.name} ({countryCode})</div>
                  <div><strong>📋 Applicable licence:</strong> {licenceLabel}</div>
                  {entityType && (
                    <div style={{ marginTop: 4 }}><strong>📑 Form set:</strong> {isFiFlow ? "FI version" : "Corporate version"}{routesNote}</div>
                  )}
                  {!isLicensedHere && <div style={{ marginTop: 4, fontStyle: "italic", color: "#9d6500" }}>{companyName_} has no licence in {countryObj?.name}, so this customer is onboarded under {primaryName}. Public records will be searched in {countryObj?.name}, but {primaryName} requirements apply.</div>}
                </div>
              );
            })()}
            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}
            {/* Research cache override. Cache-first by default (saves API cost on
                repeat searches); tick to force a live re-fetch. See
                lib/researchCache.js + api/research.js. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#64748b' }}>
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={e => setForceRefresh(e.target.checked)}
                  style={{ width: 15, height: 15, cursor: 'pointer' }}
                />
                🔄 Force re-fetch (ignore cache)
              </label>
              {!forceRefresh && (
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  Cache saves API costs — only override for demos or stale data
                </span>
              )}
              {forceRefresh && (
                <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                  ⚠ Live API call — this will cost tokens
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {SHOW_TEST_TOOLS && <Btn onClick={doDummyResearch} variant="secondary">🧪 Dummy Research (skip API)</Btn>}
              <Btn
                disabled={!companyName.trim() || !countryCode || !entityType || !ownershipType}
                onClick={() => {
                  if (!companyName.trim()) { setError("Please enter a company name."); return; }
                  if (!entityType) { setError("Please select an entity type."); return; }
                  if (!ownershipType) { setError("Please select an ownership type."); return; }
                  if (!countryCode) { setError("Please select a country."); return; }
                  setError("");
                  // Wrong-TYPE re-derive: skip the search journey entirely — keep
                  // the existing research and re-resolve from the corrected type.
                  if (pendingReseedMode === "re_derive") { applyReDerive(); return; }
                  setSelectedJourneyCard(null);
                  setManualOpened(false);
                  // Both the onboarding AND pre-boarding flows now show the
                  // journey-selection page ("How would you like to complete your
                  // application?"). Pre-boarding previously skipped straight to
                  // AI research; it now offers the same options so the analyst
                  // can demo every journey. The pre-boarding auto-save effect
                  // still folds the result into the dossier once research runs,
                  // so any AI journey still lands on the Dossier view.
                  setJourneyOpen(true);
                }} variant="primary">Continue →</Btn>
            </div>
          </div>
  );
}
