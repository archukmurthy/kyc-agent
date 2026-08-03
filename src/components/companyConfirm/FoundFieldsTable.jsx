/**
 * FoundFieldsTable.jsx — the "Pre-filled Fields" table on the Confirm page.
 *
 * EXTRACTED FROM App.js, zero behaviour change. renderUnifiedFoundTable,
 * renderFoundRow and renderSourceBadge moved here VERBATIM — the bodies below
 * are the same text that ran in App.js. What changed is only how they get
 * their data: they used to close over App's scope, and now receive it through
 * the prop interface declared on the component.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS (checks, gapRef,
 * toggleCheck, …). Destructuring them back into locals of the same name is what
 * lets the moved bodies stay byte-identical, which is what makes "zero
 * behaviour change" checkable rather than merely claimed.
 *
 * REFS STAY REFS. gapRef and dialogueStateRef are passed through as the refs
 * they are — never snapshotted into values or lifted into state. gapRef backs
 * the gap inputs (lifting it re-renders on every keystroke and loses focus —
 * see CLAUDE.md), and dialogueStateRef holds the classification snapshots the
 * documents list, the tiles and the submit gate all read live.
 *
 * The People section is NOT here; it is still injected by App.js.
 */

import React from "react";
import { C } from "../../constants/theme";
import { Notice } from "../notices/Notice";
import ChangeDialogue from "../changeDialogue/ChangeDialogue";
import InlineCorrectionEditor from "./InlineCorrectionEditor";
import { AmendmentDocCard } from "../amendmentDocuments/AmendmentDocCard";
import { findFieldDef, isStakeholderField, resolveDisplayValue } from "../../pipeline";
import {
  rowState,
  rowContext,
  ROW_STATE,
  docKey,
  isGateConfirmedField,
  isPerFieldDocType,
  canonicalDocType,
} from "./confirmState";
import {
  badgeBaseStyle,
  groupFoundBySection,
  humaniseSection,
  safeRenderValue,
  getDisplayValue,
} from "./foundTableHelpers";

export function FoundFieldsTable({
  // ── what to render ──
  items,
  title,
  subtitle,
  cardStyle,
  activeSchema,
  // ── state read by the rows ──
  checks,
  affirmedFields,
  revealedTs,
  inlineEditOpen,
  amendmentUploads,
  uploadingDocKey,
  fieldMetadata,
  researchTimestamp,
  confirmDocs,
  rowDocAnchor,
  // Identity of the submission, for the ChangeDialogue the row opens.
  countryCode,
  dossierId,
  onboardingSubmissionId,
  // ── refs, passed AS REFS ──
  gapRef,
  dialogueStateRef,
  // ── actions ──
  toggleCheck,
  affirmRow,
  setRevealedTs,
  setInlineEditOpen,
  saveInlineCorrection,
  persistDialogueState,
  trackEvent,
  setFormVersion,
  handleAmendmentUpload,
  handleAmendmentRemove,
}) {
  const card = cardStyle;
  // Was a component-scope helper in App.js; fieldMetadata now arrives as a prop.
  const metaFor = (fieldId) => (fieldMetadata || []).find((m) => m.fieldId === fieldId);

  const renderSourceBadge = (item, idx) => {
    const m = metaFor(item.field);
    const ts = (m && m.fetchedAt) || researchTimestamp || "";
    const tsShort = ts ? ts.slice(11, 19) : "";
    if (item.sourceTier === "document") {
      const label = item.source || "Uploaded document";
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? `🕒 ${ts}` : `From uploaded ${label}`}
          style={{ ...badgeBaseStyle, color: "#0B3D91", background: "transparent" }}
        >
          {revealedTs[idx] ? `🕒 ${tsShort}` : `📄 ${label}`}
        </span>
      );
    }
    if (item.sourceTier === "tier1") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Click to show fetch timestamp"}
          style={{ ...badgeBaseStyle, color: C.textMuted, background: "transparent" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `✓ ${item.source}`}
        </span>
      );
    }
    // tier3 (indicative) — third-party / unverified source.
    if (item.sourceTier === "tier3") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Low confidence — from unverified source"}
          style={{ ...badgeBaseStyle, color: "#C2410C", background: "transparent" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `⚠ ${item.source}`}
        </span>
      );
    }
    // tier2 (probable) — company-owned source.
    return (
      <span
        onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
        title={revealedTs[idx] ? "Click to hide timestamp" : "Probable — from company source, please confirm"}
        style={{ ...badgeBaseStyle, color: C.warning, background: "transparent" }}
      >
        {revealedTs[idx] ? `🕒 ${ts}` : `~ ${item.source}`}
      </span>
    );
  };

  const renderFoundRow = ({ item, idx }) => {
    const fieldDef = findFieldDef(activeSchema, item.field);
    let displayValue =
      item.value !== null && typeof item.value === "object"
        ? safeRenderValue(item.value)
        : safeRenderValue(resolveDisplayValue(fieldDef, item.value));
    // Safety net: a stakeholder field that fell through to the plain-row table
    // (no parsed people) must never show a raw JSON-array blob like
    // '[{"full_name":...}]'. Show a neutral placeholder instead. The real fix
    // is upstream (enrichStakeholders re-attaches .stakeholders so these render
    // as cards); this guards any residual case.
    if (isStakeholderField(item.field) && /^\s*\[\s*\{/.test(String(item.value || ""))) {
      displayValue = "Director / owner information sourced — details to be confirmed";
    }
    // PR-041: empty stakeholder array → human-readable text instead of raw "[]".
    // getDisplayValue only returns a different (string) value in that exact case;
    // for every other field it returns item.value unchanged, so this is a no-op.
    const humanReadable = getDisplayValue(item);
    if (typeof humanReadable === "string" && humanReadable !== item.value) {
      displayValue = humanReadable;
    }
    const isUnmappedDropdown =
      fieldDef && fieldDef.inputType === "select" && item.unmappedDropdown;
    // Re-skin: row state drives the visual treatment, from EXISTING data only.
    // Confirmation lives in checks[idx]; confidence in verificationStatus
    // (sourceTier fallback covers rows stored before that field existed).
    // Amber tracks confidence, never "has a control"; a disputed row's info
    // tone wins over amber while its ChangeDialogue is open.
    const rowChecked = !!checks[idx];
    const correction = gapRef.current["corrected_" + item.field];
    // ONE predicate for the row's state, the tiles AND the submit gate — same
    // rowState() call, fed by the same rowContext() builder submitBlockers
    // uses, so the amber styling, the "Needs You" count and blocker kind (a)
    // are the same set by construction. Never re-derive it here.
    const state = rowState(item, rowContext(item, idx, {
      checks,
      affirmed: affirmedFields,
      corrections: gapRef.current,
    }));
    const isCorrected = state === ROW_STATE.CORRECTED;
    const isDisputed = !rowChecked && !isCorrected;
    // Amber = low confidence AND still unresolved. Ticking (affirming) or
    // correcting resolves it, which is what lets the Needs-you count fall.
    const needsAttention = state === ROW_STATE.NEEDS_YOU && rowChecked;
    const stripe = isCorrected || isDisputed ? C.info : needsAttention ? C.warning : C.border;
    const tint = isCorrected || isDisputed ? C.infoBg : needsAttention ? C.warningTint : "#fff";
    const labelColor = needsAttention ? C.warning : isCorrected || isDisputed ? C.info : C.textMuted;
    const btnBase = {
      width: 26, height: 26, borderRadius: 7, cursor: "pointer",
      fontSize: 12, fontWeight: 700, lineHeight: 1, padding: 0,
      fontFamily: "inherit",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    };
    // Right-rail status line — the prototype's second line under the source.
    const statusLine = isCorrected
      ? { text: "Customer corrected", color: C.info }
      : isDisputed
      ? { text: "Correction needed", color: C.info }
      : needsAttention
      ? { text: "Please confirm", color: C.warning }
      : null;
    return (
      <div key={item.field + idx} style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 16,
        width: "100%",
        padding: "12px 14px",
        boxSizing: "border-box",
        background: tint,
        borderLeft: `3px solid ${stripe}`,
        borderBottom: "1px solid rgba(26,58,74,0.04)",
        // Unchecking a field is NOT disabling it — keep the row fully legible.
      }}>
        {/* Main block — label ABOVE value (prototype layout), not side-by-side. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: labelColor, lineHeight: 1.3,
          }}>
            {item.label}
          </div>
          {displayValue.length > 150 ? (
            <div style={{
              fontSize: 12,
              color: C.text,
              lineHeight: 1.6,
              padding: "8px 10px",
              background: C.surfaceAlt,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              wordWrap: "break-word",
              overflowWrap: "break-word",
              whiteSpace: "pre-wrap",
              marginTop: 4,
            }}>
              {displayValue}
            </div>
          ) : (
            <div style={{
              fontSize: 14.5, fontWeight: 600, color: C.text, marginTop: 3,
              wordWrap: "break-word", overflowWrap: "break-word",
              whiteSpace: "normal", lineHeight: 1.45,
            }}>
              {/* Corrected: the customer's value leads, the registry value stays
                  beside it struck through — original + corrected coexist. */}
              {isCorrected ? (
                <>
                  <span>{String(correction)}</span>
                  <span style={{
                    marginLeft: 8, fontSize: 13, fontWeight: 500,
                    color: C.textMuted, textDecoration: "line-through",
                  }}>
                    {displayValue}
                  </span>
                </>
              ) : (
                displayValue
              )}
            </div>
          )}
          {item.originalAIValue && item.originalAIValue !== displayValue && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#1a3a4a90" }}>
              AI returned "{item.originalAIValue}" — mapped to dropdown option
            </div>
          )}
          {isUnmappedDropdown && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#8c5500" }}>
              Doesn't match any dropdown option — please correct on the next page
            </div>
          )}
          {/* The source prompt is a QUESTION, so it goes once the row answers
              it. It used to render off item.sourceTier alone, so "please
              confirm this is correct" stayed under a value the customer had
              already corrected, confirmed or marked wrong. needsAttention is
              exactly "low confidence and still unresolved" — the same
              condition driving the amber stripe. */}
          {needsAttention && item.sourceTier === "tier2" && (
            <Notice tier="tier2" style={{ marginTop: 6 }}>
              From a company source — please confirm this is correct.
            </Notice>
          )}
          {needsAttention && item.sourceTier === "tier3" && (
            <Notice tier="tier2" style={{ marginTop: 6 }}>
              From an unverified source — please verify this is correct.
            </Notice>
          )}
          {item.sharePercentageWarning && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6,
              padding: "6px 10px", background: "#FEF3C7", border: "1px solid #FCD34D",
              borderRadius: 6, fontSize: 11, color: "#92400E", lineHeight: 1.4,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
              <div>
                <div style={{ fontWeight: 600 }}>Ownership band — verify qualifier</div>
                <div style={{ marginTop: 2 }}>
                  {item.sharePercentageSuggested
                    ? `Registry likely states "${item.sharePercentageSuggested}" — confirm exact wording.`
                    : item.sharePercentageWarning}
                </div>
              </div>
            </div>
          )}
          {/* Capture-mode change dialogue — mounts beneath an unchecked field,
              captures intent/registry + records one append-only change_event.
              onResolved (commit 3) bumps formVersion so the row re-renders the
              moment classification completes and the inline editor can appear —
              the questions always come first, the value input second. */}
          {!checks[idx] && (
            <ChangeDialogue
              // `label` is here for the commit-8 country-field check: the schema
              // marks no field as country-typed, so detection reads the id AND
              // the label (e.g. field "country" / label "Address Country"). The
              // row's own label is used — the same string the customer sees.
              field={{ fieldId: item.field, label: item.label, value: item.value, source: item.source, sourceTier: item.sourceTier }}
              jurisdiction={countryCode || "GB"}
              submissionId={dossierId || onboardingSubmissionId}
              dossierId={dossierId}
              onEvent={(event) => trackEvent("change_event_captured", event)}
              onResolved={() => setFormVersion(v => v + 1)}
              persisted={dialogueStateRef.current[item.field]}
              onPersist={persistDialogueState}
            />
          )}
          {/* Inline correction editor (commit 3) — value capture ON Confirm.
              Gated on the dialogue having emitted (classification first), so a
              value can never be saved before the initial event exists. Writes
              through saveInlineCorrection: gapRef["corrected_<field>"] (same
              key Fill Gaps renders — the value shows pre-filled there) + the
              superseding change-event. Once saved, the value renders inline on
              the row above (with the original struck through) and this editor
              only re-opens on demand via "Edit again".  */}
          {!checks[idx] && (() => {
            const snap = dialogueStateRef.current[item.field];
            if (!snap || !snap.emitted) return null;
            if (isCorrected && !inlineEditOpen[item.field]) return null;
            // Reference-value exception: don't prefill a literal cross-reference
            // like "Same as registered office" — prompt for the real value.
            const isReferenceValue = typeof item.value === "string" && /\bsame as\b/i.test(item.value);
            const prefill = isReferenceValue || item.value == null || typeof item.value === "object"
              ? ""
              : String(item.value);
            return (
              <InlineCorrectionEditor
                key={"edit-" + item.field}
                fieldDef={fieldDef || {}}
                originalDisplay={displayValue}
                initialValue={isCorrected ? String(correction) : prefill}
                onSave={(v) => {
                  saveInlineCorrection(item, v);
                  setInlineEditOpen(p => ({ ...p, [item.field]: false }));
                }}
                onCancel={isCorrected ? () => setInlineEditOpen(p => ({ ...p, [item.field]: false })) : null}
              />
            );
          })()}
          {/* Inline document request (commit 4) — the upload lives WHERE the
              change happened. Same card, same store and same upload call as the
              Fill Gaps panel, so a file added in either place satisfies both.
              Matched by docType against the canonical list so two fields
              mapping to one document never ask for it twice. */}
          {!checks[idx] && (() => {
            const snap = dialogueStateRef.current[item.field];
            const live = snap && snap.event && snap.event.workflow === "doc_required" ? snap.event.docType : null;
            if (!live) return null;
            // Company-scoped row: match a company entry (no stakeholderId), so
            // it can never pick up a person's same-named document. Compared on
            // the merged name — confirmDocs carries the canonical docType. A
            // per-field document shares its title with the other fields that
            // triggered it, so it must match THIS row's field, not just the type.
            const liveType = canonicalDocType(live);
            const doc = confirmDocs.find((d) =>
              d.docType === liveType &&
              !d.stakeholderId &&
              (isPerFieldDocType(liveType) ? d.fieldId === item.field : true));
            if (!doc) return null;
            const k = docKey(doc);
            // ONE CARD PER DOCUMENT. Several rows can require the same file —
            // three corrected lines of the registered address are one Notice of
            // Change of Address — so it renders against the field that asked
            // first, not once per row.
            const anchorField = rowDocAnchor.get(k);
            if (anchorField && anchorField !== item.field) return null;
            return (
              <AmendmentDocCard
                key={"doc-" + k}
                doc={doc}
                upload={amendmentUploads[k]}
                busy={uploadingDocKey === k}
                onUpload={handleAmendmentUpload}
                onRemove={handleAmendmentRemove}
                variant="inline"
                hint="Required before you can continue."
              />
            );
          })()}
          {/* TEST VIEW — DISABLED, kept for debugging. Shows what the engine
              actually decided for this row (rule id, workflow, document,
              verifiability), including outcomes the customer never sees. It is
              read-only: it never re-classifies and never affects the gate.
              Uncomment this block, the twin in renderPersonDocuments, and the
              two imports at the top of this file to bring it back.

          {(() => {
            const snap = dialogueStateRef.current[item.field];
            if (!snap || !snap.emitted || !snap.event) return null;
            return (
              <AnalystSignalStrip
                show={SHOW_TEST_TOOLS}
                fieldId={item.field}
                signal={buildAnalystSignal({
                  event: snap.event,
                  outcome: snap.outcome,
                  correctedValue: correction,
                })}
              />
            );
          })()}
          */}
        </div>
        {/* Right rail — provenance is supporting detail (quiet, two lines),
            then the affordances. Fixed width so a long source string can never
            squeeze the value column. */}
        <div style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}>
          <div style={{
            width: 150, minWidth: 150, maxWidth: 150,
            display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
          }}>
            {renderSourceBadge(item, idx)}
            {statusLine && (
              <span style={{ fontSize: 10, fontWeight: 600, color: statusLine.color, textAlign: "right" }}>
                {statusLine.text}
              </span>
            )}
          </div>
          {/* Already confirmed on the Applicant page's five-fact gate, so this
              row is read-only here — see GATE_CONFIRMED_FIELDS. The spacer
              keeps the source-badge column aligned with every other row. */}
          {isGateConfirmedField(item.field) ? (
            <div style={{ width: 56, flexShrink: 0 }} aria-hidden="true" />
          ) : (
          <div style={{ display: "flex", gap: 4, paddingTop: 1 }}>
            {/* Contextual control PAIR, per the prototype — never three buttons.
                The prototype only ever shows two row states; ours has four, so
                the rule is applied by meaning rather than copied by position:
                  needs-attention / disputed → ✓ ✕  ("is this right or wrong?")
                  confirmed / corrected      → ✓ ✎  (settled value; tweak it)
                No capability is lost either way, because ✎ and ✕ enter the SAME
                flow (toggleCheck → ChangeDialogue → classification → inline
                editor). A confirmed row is disputed via ✎; an attention row is
                edited via ✕. Whether a document is owed remains a property of
                the field-class + change (policyTable), never of which button
                was pressed.
                The tick keeps the original checks[idx]/toggleCheck semantics and
                ALSO records affirmation, which is what moves an untouched
                low-confidence row out of "needs you". */}
            <button
              type="button"
              onClick={() => { if (!rowChecked) toggleCheck(idx); affirmRow(item); }}
              aria-label={isCorrected || isDisputed ? `Restore the original value for ${item.label}` : `Confirm ${item.label}`}
              aria-pressed={rowChecked && !needsAttention}
              title={isCorrected || isDisputed ? "Undo — keep the original value" : "Correct — keep this value"}
              style={{
                ...btnBase,
                background: rowChecked && !needsAttention ? "#4a9e8e" : "#fff",
                color: rowChecked && !needsAttention ? "#fff" : C.textMuted,
                border: rowChecked && !needsAttention ? "1.5px solid #4a9e8e" : `1.5px solid ${C.border}`,
              }}
            >✓</button>
            {needsAttention || isDisputed ? (
              <button
                type="button"
                onClick={() => { if (rowChecked) toggleCheck(idx); }}
                aria-label={`Mark ${item.label} as incorrect`}
                aria-pressed={isDisputed}
                title="Wrong — flag this value for correction"
                style={{
                  ...btnBase,
                  background: isDisputed ? C.error : "#fff",
                  color: isDisputed ? "#fff" : C.textMuted,
                  border: isDisputed ? `1.5px solid ${C.error}` : `1.5px solid ${C.border}`,
                }}
              >✕</button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isCorrected) setInlineEditOpen(p => ({ ...p, [item.field]: true }));
                  else if (rowChecked) toggleCheck(idx);
                }}
                aria-label={`Edit ${item.label}`}
                title={isCorrected ? "Edit again" : "Edit this value"}
                style={{
                  ...btnBase,
                  background: "#fff",
                  color: isCorrected ? C.info : C.textMuted,
                  border: `1.5px solid ${isCorrected ? C.infoBorder : C.border}`,
                }}
              >✎</button>
            )}
          </div>
          )}
        </div>
      </div>
    );
  };

  const renderUnifiedFoundTable = (items, title, subtitle) => {
    // The helper used to close over activeSchema; it is now a parameter.
    const groups = groupFoundBySection(items, activeSchema);
    return (
      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
        <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>{subtitle}</p>
        {groups.map(([section, rows], gi) => (
          <div key={section} style={{ marginBottom: gi < groups.length - 1 ? 14 : 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "#1a3a4a80",
              marginBottom: 6,
            }}>
              {humaniseSection(section)}
            </div>
            {/* Fidelity pass: the prototype has no table header — each row is a
                self-describing card (tiny uppercase label above its value, with
                the provenance and affordances on the right), so the column
                header bar is gone rather than restyled. */}
            {rows.map((r) => renderFoundRow(r))}
          </div>
        ))}
      </div>
    );
  };

  return renderUnifiedFoundTable(items, title, subtitle);
}

export default FoundFieldsTable;
