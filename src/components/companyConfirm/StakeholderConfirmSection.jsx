/**
 * StakeholderConfirmSection.jsx — the People section of the Confirm page.
 *
 * EXTRACTED FROM App.js (slice 2), zero behaviour change. The four render
 * functions below — the section, a person's attribute row, that person's
 * documents, and a pending customer-added person — moved here VERBATIM. What
 * changed is only how they get their data: they used to close over App's
 * scope, and now arrive through the prop interface declared on the component.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS. Destructuring them
 * back into locals of the same name is what lets the moved bodies stay
 * byte-identical, which is what makes "zero behaviour change" checkable rather
 * than merely claimed.
 *
 * THE HELPER SPLIT. The PURE helpers of this family (stkConfirmFields,
 * stkFieldFound, stkFieldDisplay, isPersonLowConfidence) live in
 * peopleHelpers.js and are imported by both sides. The IMPURE ones did NOT
 * move — personWithEdits reads stakeholdersRef, isPersonAttributeCorrected
 * reads research, isPersonAttributeSettled composes those with two state maps,
 * and stkNextPageFields / stkCorrectedFields build on them. Those stay in
 * App.js and arrive as props, so there is still ONE implementation of each
 * rule rather than a copy per side.
 *
 * REFS STAY REFS. dialogueStateRef is passed through as the ref it is and read
 * live via .current — never snapshotted, never lifted into state.
 */

import React from "react";
import { C } from "../../constants/theme";
import { Notice } from "../notices/Notice";
import { PersonCorrection, PersonRemovalPrompt } from "./PersonCorrection";
import { AmendmentDocCard } from "../amendmentDocuments/AmendmentDocCard";
import { ATTRIBUTE_BY_FIELD_KEY, resolvePersonType } from "./personType";
import { docKey, canonicalDocType, isCompanyWideDocType } from "./confirmState";
import {
  isUboLikeField,
  isRegistryExemptionNotice,
  needsStakeholderDetails,
  formatShareholding,
  findFieldDef,
} from "../../pipeline";
import { isCorporateStakeholder } from "../../workflows/applicantWorkflow";
import { isDateField } from "../../utils/dateFields";
import {
  stkConfirmFields,
  stkFieldFound,
  stkFieldDisplay,
  isPersonLowConfidence,
} from "./peopleHelpers";

export function StakeholderConfirmSection({
  // ── what to render ──
  item,
  idx,
  // ── state ──
  activeSchema,
  effectivelyListed,
  personEditing,
  personRemoving,
  revealedTs,
  researchTimestamp,
  amendmentUploads,
  uploadingDocKey,
  confirmDocs,
  companyDocAnchor,
  // ── ref, passed AS A REF ──
  dialogueStateRef,
  // ── setters ──
  setPersonEditing,
  setPersonRemoving,
  setRevealedTs,
  setStakeholdersExpanded,
  // ── actions ──
  toggleStakeholderExpanded,
  togglePersonRemoval,
  togglePersonField,
  toggleStkFieldConfirm,
  confirmAllPersonAttributes,
  affirmPersonField,
  confirmPersonRemoval,
  resolvePersonCorrection,
  removeStakeholder,
  handleAmendmentUpload,
  handleAmendmentRemove,
  // ── impure helpers that stay in App (see the header note) ──
  isStakeholderExpanded,
  isStakeholderRejected,
  isStkFieldConfirmed,
  isPersonAttributeSettled,
  isPersonAttributeCorrected,
  personWithEdits,
  researchStakeholders,
  stkNextPageFields,
  stkCorrectedFields,
  getStakeholders,
  metaFor,
  renderAddPerson,
}) {
  const renderPersonAttributeRow = (item, s, f, lowConf) => {
    const amberTag = {
      fontSize: 10, fontWeight: 700, color: "#8c5500",
      background: "#fff8ed", border: "1px solid #e0a040",
      borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
    };
    const btn = {
      width: 22, height: 22, borderRadius: 6, cursor: "pointer",
      fontSize: 11, fontWeight: 700, lineHeight: 1, padding: 0, fontFamily: "inherit",
      display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    };
    const infoTag = {
      fontSize: 10, fontWeight: 700, color: C.info,
      background: C.infoBg, border: `1px solid ${C.infoBorder}`,
      borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
    };
    const ticked = isStkFieldConfirmed(s.id, f.key);
    const corrected = isPersonAttributeCorrected(item, s, f);
    // The research row for this person, for showing what the value WAS.
    const originalPerson = researchStakeholders(item.field).find((x) => x && x.id === s.id) || null;
    const settled = isPersonAttributeSettled(item, s, f, lowConf);
    const needsAffirm = ticked && !settled;
    // The editor for THIS attribute is open right now.
    const editingThis =
      personEditing && personEditing.stakeholderId === s.id && personEditing.fieldKey === f.key;
    // "Edit on next page" is only true when it IS next-page work. While the
    // inline editor is open, or once the value has been corrected here, the
    // edit is happening on this page — saying otherwise was simply wrong.
    const disputed = !ticked && !corrected && !editingThis;
    const openEditor = () =>
      setPersonEditing({
        researchFieldId: item.field,
        stakeholderId: s.id,
        attribute: ATTRIBUTE_BY_FIELD_KEY[f.key],
        fieldKey: f.key,
      });
    return (
      <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ color: "#1a3a4a80", width: 130, flexShrink: 0 }}>{f.label}</span>
        {/* Corrected: the customer's value leads and the original stays beside
            it struck through — the same old-beside-new treatment a corrected
            pre-filled row gets. Overwriting in place lost what changed. */}
        <span style={{ fontWeight: 600, color: corrected ? C.info : "#1a3a4a", flex: 1, minWidth: 0 }}>
          {stkFieldDisplay(s, f.key)}
          {corrected && originalPerson && (
            <span style={{
              marginLeft: 8, fontWeight: 500, color: C.textMuted,
              textDecoration: "line-through",
            }}>
              {stkFieldDisplay(originalPerson, f.key)}
            </span>
          )}
        </span>
        {corrected && <span style={infoTag}>✓ corrected</span>}
        {needsAffirm && !corrected && <span style={amberTag}>❓ please confirm</span>}
        {disputed && <span style={amberTag}>✎ edit on next page</span>}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            onClick={() => {
              if (!ticked) togglePersonField(item, s, f); // undo — restore the value
              affirmPersonField(s.id, f.key);
            }}
            aria-label={disputed ? `Restore the original ${f.label}` : `Confirm ${f.label}`}
            aria-pressed={settled}
            title={disputed ? "Undo — keep the original value" : "Correct — keep this value"}
            style={{
              ...btn,
              background: settled ? "#4a9e8e" : "#fff",
              color: settled ? "#fff" : C.textMuted,
              border: settled ? "1.5px solid #4a9e8e" : `1.5px solid ${C.border}`,
            }}
          >✓</button>
          <button
            type="button"
            onClick={() => {
              // A corrected value is edited again in place, exactly as a
              // corrected pre-filled row reopens its editor.
              if (corrected) openEditor();
              else if (ticked) togglePersonField(item, s, f);
            }}
            aria-label={needsAffirm || disputed ? `Mark ${f.label} as incorrect` : `Edit ${f.label}`}
            aria-pressed={disputed}
            title={needsAffirm || disputed
              ? "Wrong — flag this value for correction"
              : corrected ? "Edit again" : "Edit this value"}
            style={{
              ...btn,
              background: disputed ? C.error : "#fff",
              color: disputed ? "#fff" : corrected ? C.info : C.textMuted,
              border: disputed ? `1.5px solid ${C.error}` : `1.5px solid ${corrected ? C.infoBorder : C.border}`,
            }}
          >{needsAffirm || disputed ? "✕" : "✎"}</button>
        </div>
      </div>
    );
  };

  const renderPendingAddedStakeholder = (fieldId, s, ubo) => {
    const addedHere = !!(s.full_name && String(s.full_name).trim());
    const type = resolvePersonType(s, fieldId);
    return (
      <div
        key={s.id}
        style={{
          background: "#f3faf8", border: "1.5px dashed #4a9e8e",
          borderRadius: 8, marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{isCorporateStakeholder(s) ? "🏢" : "➕"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a6b56" }}>
              {addedHere
                ? `${s.full_name} — added by you`
                : `New ${isCorporateStakeholder(s) ? "company" : ubo ? "beneficial owner" : "director"} added`}
            </div>
            <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.85, marginTop: 2 }}>
              {addedHere
                ? `${type.isUBO ? (type.isDirector ? "Director and beneficial owner" : "Beneficial owner") : "Director"}${s.nationality ? ` · ${s.nationality}` : ""}${s.is_pep ? " · PEP" : ""}`
                : "You'll complete their details on the next page."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeStakeholder(fieldId, s.id)}
            title="Remove"
            aria-label="Remove"
            style={{
              background: "none", border: "none", color: "#1a3a4a70",
              cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px", fontFamily: "inherit",
            }}
          >
            ×
          </button>
        </div>
        {/* The added person's own evidence, per-person keyed like everyone else. */}
        {renderPersonDocuments(s)}
      </div>
    );
  };

  const renderPersonDocuments = (s) => {
    const mine = Object.entries(dialogueStateRef.current)
      .filter(([k, snap]) => snap && snap.personScope && k.includes(`::${s.id}::`));
    if (mine.length === 0) return null;
    /**
     * ONE CARD PER DOCUMENT, not one per change.
     *
     * Correcting John's date of birth AND his nationality both classify to
     * Proof of Identity — one passport answers both, and canonicalDocs already
     * collapses them to a single entry keyed (stakeholderId, docType). The
     * card, though, was rendered per dialogue snapshot, so the customer was
     * asked for the same passport twice. Both cards even drove the same upload
     * slot, which made the duplicate purely cosmetic noise.
     *
     * Scope rules are unchanged: identity evidence stays per person, and a
     * company-wide document still renders on its anchor person only.
     *
     * The analyst strip stays per SNAPSHOT — it audits each change, so one per
     * attribute is correct there.
     */
    const seenDocKeys = new Set();
    const seenCoveredNotes = new Set();
    return (
      <div style={{ padding: "0 16px 12px" }}>
        {mine.map(([k, snap]) => {
          const ev = snap.event || {};
          // A company-wide document is the SAME single file for everyone, so it
          // renders on its anchor person only. Identity evidence stays strictly
          // per person: matched on stakeholderId, never on a company entry.
          const evDocType = canonicalDocType(ev.docType);
          const companyWide = isCompanyWideDocType(evDocType);
          const isAnchor = !companyWide || companyDocAnchor.get(evDocType) === s.id;
          const match = ev.workflow === "doc_required" && evDocType && isAnchor
            ? confirmDocs.find((d) =>
                d.docType === evDocType &&
                (companyWide ? !d.stakeholderId : d.stakeholderId === s.id))
            : null;
          // First change to require this document owns the card; later ones
          // resolve to the same docKey and render nothing.
          let doc = null;
          if (match) {
            const dk = docKey(match);
            if (!seenDocKeys.has(dk)) {
              seenDocKeys.add(dk);
              doc = match;
            }
          }
          // Same collapse for the "already covered" note.
          let showCoveredNote = false;
          if (companyWide && !isAnchor && ev.workflow === "doc_required" && !seenCoveredNotes.has(evDocType)) {
            seenCoveredNotes.add(evDocType);
            showCoveredNote = true;
          }
          return (
            <div key={k}>
              {doc && (
                <AmendmentDocCard
                  doc={doc}
                  upload={amendmentUploads[docKey(doc)]}
                  busy={uploadingDocKey === docKey(doc)}
                  onUpload={handleAmendmentUpload}
                  onRemove={handleAmendmentRemove}
                  variant="inline"
                  hint={companyWide
                    ? `One ${evDocType.toLowerCase()} covers the whole company — upload it once.`
                    : `Required for ${s.full_name}.`}
                />
              )}
              {/* Same document, already requested against another person — say
                  so rather than silently showing nothing here. */}
              {showCoveredNote && (
                <div style={{ fontSize: 11.5, color: C.textMuted, fontStyle: "italic", padding: "6px 0" }}>
                  Covered by the single {evDocType.toLowerCase()} requested for this company — you only upload it once.
                </div>
              )}
              {/* TEST VIEW — DISABLED, kept for debugging. See the twin block
                  in renderFoundRow for how to re-enable.

              <AnalystSignalStrip
                show={SHOW_TEST_TOOLS}
                fieldId={k}
                signal={buildAnalystSignal({ event: snap.event, outcome: snap.outcome })}
              />
              */}
            </div>
          );
        })}
      </div>
    );
  };

  const renderStakeholderConfirmSection = (item, idx) => {
    if (!item || !Array.isArray(item.stakeholders) || item.stakeholders.length === 0) {
      return null;
    }
    // Exclude registry exemption notices — they are not people. If nothing real
    // remains, render nothing here so the field falls through to the normal
    // confirm row showing the raw registry value.
    // Render the person as the customer has them NOW — research values with any
    // inline correction applied on top. Without this the card kept showing the
    // original after a correction was saved.
    const realStakeholders = item.stakeholders
      .filter((s) => !isRegistryExemptionNotice(s))
      .map((s) => personWithEdits(item.field, s));
    if (realStakeholders.length === 0) return null;
    const ubo = isUboLikeField(item.field);
    const fieldDef = findFieldDef(activeSchema, item.field);
    const heading = fieldDef?.label
      || (ubo ? "Ultimate Beneficial Owners / Shareholders" : "Directors / Officers");
    const count = realStakeholders.length;
    const tier = item.sourceTier;
    const sourceBadge = tier === "tier1"
      ? { bg: "#dff2ec", color: "#1a6b56", glyph: "✅" }
      : tier === "document"
      ? { bg: "#0B3D91", color: "#fff", glyph: "📄" }
      : tier === "tier3"
      ? { bg: "#FFF7ED", color: "#C2410C", glyph: "⚠" }
      : { bg: "#fff1d6", color: "#8c5500", glyph: "~" };
    const allExpanded = realStakeholders.every((s) => isStakeholderExpanded(s.id));
    return (
      <div key={`stk-${item.field}-${idx}`} style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "#1a3a4a80",
          marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid rgba(26,58,74,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
        }}>
          <span>{heading} · {count} found</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStakeholdersExpanded(realStakeholders.map((s) => s.id), !allExpanded)}
              style={{
                background: "none", border: "none", fontSize: 11, color: "#1a3a4a",
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0,
                letterSpacing: "0.04em", textTransform: "uppercase",
              }}
            >
              {allExpanded ? "Collapse all ▴" : "Expand all ▾"}
            </button>
            <span style={{
              fontSize: 10, fontWeight: 700, color: sourceBadge.color,
              background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
            }}>
              {sourceBadge.glyph} {item.source || (tier === "tier1" ? "Official source" : "Source")}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 4px", lineHeight: 1.5 }}>
          Found {count} {count === 1 ? "person" : "people"} from {item.source || "research"}. Expand each
          person to review the details we found — keep the green tick on anything correct, or untick a
          field to edit it on the next page. Anything we couldn't find is collected on the next page too.
        </p>
        <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px", fontStyle: "italic" }}>
          Editing who is on this list is coming soon — for now, untick anyone who doesn't belong.
        </p>
        {realStakeholders.map((s) => {
          const rejected = isStakeholderRejected(item.field, s.id);
          const expanded = isStakeholderExpanded(s.id);
          // Listed-company shortcut: people who don't need EDD stay a simple
          // verified card (no granular routing ticks).
          const needsEDD = needsStakeholderDetails(s, item.field, effectivelyListed);
          // Fields routed to the next page: for an EDD person that's
          // stkNextPageFields (unticked + missing-required); for a listed
          // read-only person it's purely the AI-returned values they unticked
          // to correct (we never collect missing fields for them).
          const nextPageFields = rejected
            ? []
            : needsEDD
            ? stkNextPageFields(s, ubo, item)
            : stkCorrectedFields(s, ubo)
                .filter((f) => !isPersonAttributeCorrected(item, s, f))
                .map((f) => f.label);
          // What actually needs the customer HERE: a value research returned
          // that they haven't settled. A pure gap is NOT "needs you" — there
          // is no control on this card to supply it, the row already says
          // "collected on next page", and Fill Gaps is where that happens.
          // Counting it here was telling the customer to act with no way to.
          // Reads the SAME predicate as the row and the tiles.
          const personLowConf = isPersonLowConfidence(s, item);
          const attentionFields = rejected
            ? []
            : stkConfirmFields(s, ubo)
                .filter((f) => stkFieldFound(s, f.key) && !isPersonAttributeSettled(item, s, f, personLowConf))
                .map((f) => f.label);
          // A person with outstanding attributes must not LOOK settled. The
          // header tick means "this person belongs", not "everything about them
          // is confirmed" — but rendered solid green next to a green avatar it
          // read as done, identically to a fully verified person. Same rule the
          // pre-filled rows use: their ✓ is only green when the row is checked
          // AND needs no attention.
          const personNeedsAttention = !rejected && attentionFields.length > 0;
          return (
            <div
              key={s.id}
              style={{
                background: rejected ? "#fef2f2" : personNeedsAttention ? C.warningTint : "#fafcfb",
                border: `1.5px solid ${rejected ? "#fecaca" : personNeedsAttention ? C.warningBorder : "rgba(26,58,74,0.08)"}`,
                borderRadius: 8, marginBottom: 8, overflow: "hidden",
                transition: "border-color .15s",
              }}
            >
              {/* Header row — click anywhere to expand/collapse */}
              <div
                onClick={() => toggleStakeholderExpanded(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px", cursor: "pointer", userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={!rejected}
                  onChange={() => togglePersonRemoval(item, s)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 15, height: 15, flexShrink: 0, cursor: "pointer",
                    accentColor: personNeedsAttention ? C.warning : "#4a9e8e",
                  }}
                  aria-label={
                    personNeedsAttention
                      ? `${s.full_name} belongs on this list — ${attentionFields.length} detail${attentionFields.length === 1 ? "" : "s"} still need confirming`
                      : `Confirm ${s.full_name}`
                  }
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {/* Re-skin: initials avatar in place of the person emoji
                        (companies keep the building glyph). */}
                    <span style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: rejected ? "#fde8e8" : C.successBg,
                      color: rejected ? C.error : C.success,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, letterSpacing: "0.02em",
                    }}>
                      {isCorporateStakeholder(s)
                        ? "🏢"
                        : ((s.full_name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?")}
                    </span>
                    <span style={{
                      fontSize: 14, fontWeight: 700,
                      color: rejected ? "#1a3a4a70" : "#1a3a4a",
                      textDecoration: rejected ? "line-through" : "none",
                    }}>
                      {s.full_name}
                    </span>
                    {s.role && (
                      <span style={{
                        fontSize: 11, color: "#1a3a4a80", background: "#f2f1ed",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(26,58,74,0.08)",
                      }}>
                        {s.role}
                      </span>
                    )}
                    {s.share_percentage != null && (
                      <span style={{
                        fontSize: 11, color: "#1a6b56", background: "#dff2ec",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(74,158,142,0.3)",
                      }}>
                        {formatShareholding(s.share_percentage)}
                      </span>
                    )}
                  </div>
                  {!expanded && (
                    <div style={{ fontSize: 11, color: "#1a3a4a70", marginTop: 3 }}>
                      {rejected
                        ? "⚠ Marked as incorrect — tap to review"
                        : "Tap to expand and review the details we found"}
                    </div>
                  )}
                </div>
                {/* Per-card status badge — shown ONLY when this person needs
                    something from the customer here, i.e. a found value not yet
                    confirmed. Driven by attentionFields, NOT by everything
                    routed to the next page: a gap has no control on this card,
                    so an amber "needs you" on it was a prompt with no action
                    behind it, and a green "✓ Complete" claimed the person was
                    finished while their own row still said "added on next
                    page". Nothing to say here is said with no badge; the gaps
                    speak for themselves per-row. */}
                {!rejected && attentionFields.length > 0 && (
                  <>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: C.warning, background: C.warningBg,
                      border: `1px solid ${C.warningBorder}`, borderRadius: 99,
                      padding: "2px 8px", flexShrink: 0, whiteSpace: "nowrap",
                    }}>
                      {attentionFields.length} need{attentionFields.length === 1 ? "s" : ""} you
                    </span>
                    {/* Settle the whole person in one action. stopPropagation
                        because the header row toggles expand/collapse. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmAllPersonAttributes(item, s, ubo, personLowConf);
                      }}
                      title={`Confirm all ${attentionFields.length} outstanding detail${attentionFields.length === 1 ? "" : "s"} for ${s.full_name}`}
                      aria-label={`Confirm all outstanding details for ${s.full_name}`}
                      style={{
                        fontSize: 10, fontWeight: 700, color: "#fff",
                        background: "#4a9e8e", border: "1px solid #4a9e8e",
                        borderRadius: 99, padding: "3px 10px", cursor: "pointer",
                        fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap",
                      }}
                    >
                      ✓ Confirm all
                    </button>
                  </>
                )}
                {rejected && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2",
                    border: "1px solid #fecaca", borderRadius: 99,
                    padding: "2px 8px", flexShrink: 0,
                  }}>
                    ✗ Incorrect
                  </span>
                )}
                <span style={{
                  fontSize: 14, color: "#1a3a4a70", flexShrink: 0,
                  transition: "transform 0.2s", display: "inline-block",
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                }}>
                  ▾
                </span>
              </div>

              {/* ── CD-03 person correction surface (commit 6) ──────────────
                  Removal asks why first; the answer picks the list document
                  (director → list of directors, UBO → ownership chart), and
                  that document request IS the analyst trigger. Attribute
                  corrections run the name three-way or the inline editor, then
                  emit ONE person-scoped change-event under the composite
                  fieldId. Any resulting document renders on the person, and
                  because the snapshot lives in the same dialogue store as the
                  company rows it also lands in the documents panel and the
                  submit gate automatically. */}
              {personRemoving && personRemoving.stakeholderId === s.id && (
                <div style={{ padding: "0 16px 12px" }}>
                  <PersonRemovalPrompt
                    personName={s.full_name}
                    onConfirm={(reason) => confirmPersonRemoval(s, item.field, reason)}
                    onCancel={() => setPersonRemoving(null)}
                  />
                </div>
              )}
              {/* Documents + analyst view for every recorded correction on THIS
                  person. Matches per person, never another person's entry of
                  the same type (the 6a under-collection fix). */}
              {renderPersonDocuments(s)}

              {/* Validation flag — director/UBO failed a check: stripped share
                  band, non-official source, or cross-source attribute merge.
                  Always visible (independent of expand state). The share-band
                  case is prioritised and shown with its suggested registry band. */}
              {s.requiresReview && (
                <div style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#FEF3C7",
                  border: "1px solid #FCD34D",
                  borderRadius: 6,
                  margin: "0 12px 10px",
                  fontSize: 12,
                  color: "#92400E",
                  fontWeight: 500,
                }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
                  {s.sharePercentageWarning ? (
                    <div>
                      <div style={{ fontWeight: 600 }}>Ownership band — verify qualifier</div>
                      <div style={{ marginTop: 2, fontWeight: 500 }}>
                        {s.sharePercentageSuggested
                          ? `Registry likely states "${s.sharePercentageSuggested}" — confirm exact wording.`
                          : s.sharePercentageWarning}
                      </div>
                    </div>
                  ) : (
                    <span>
                      {s.notes?.includes("cross-source")
                        ? "Details stripped — attributes from multiple sources detected. Verify details manually."
                        : "Source not confirmed as official registry. Verify this director manually before proceeding."}
                    </span>
                  )}
                </div>
              )}

              {/* Expandable body */}
              {expanded && (
                <div style={{
                  padding: "12px 16px 14px",
                  borderTop: "1px solid rgba(26,58,74,0.08)",
                }}>
                  {/* Source badge — SAME click-to-reveal-timestamp interaction as
                      the pre-filled rows (renderSourceBadge). This used to be a
                      badge plus a separate "🕐 When?" chip whose timestamp only
                      appeared in a native title tooltip: two different
                      behaviours for the same information on one page, and the
                      chip looked clickable while doing nothing. Now the badge
                      itself toggles, keyed per person so it can never toggle a
                      row's badge. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    {(() => {
                      const stkMeta = metaFor(item.field);
                      const ts = s.fetchedAt || item.fetchedAt || (stkMeta && stkMeta.fetchedAt) || researchTimestamp || "";
                      const tsKey = `stk:${s.id}`;
                      const revealed = !!revealedTs[tsKey];
                      return (
                        <span
                          onClick={ts ? () => setRevealedTs(p => ({ ...p, [tsKey]: !p[tsKey] })) : undefined}
                          title={!ts ? undefined : revealed ? "Click to hide timestamp" : "Click to show fetch timestamp"}
                          style={{
                            fontSize: 10, fontWeight: 700, color: sourceBadge.color,
                            background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
                            cursor: ts ? "pointer" : "default",
                          }}
                        >
                          {revealed
                            ? `🕒 ${ts}`
                            : `${sourceBadge.glyph} ${item.source || (tier === "tier1" ? "Official source" : "Source")}`}
                        </span>
                      );
                    })()}
                  </div>

                  {rejected ? (
                    <div style={{ fontSize: 12, color: "#1a3a4a70", fontStyle: "italic" }}>
                      This person is marked incorrect — you'll enter the correct details on the next page.
                    </div>
                  ) : !needsEDD ? (
                    // Listed-company person: the AI-returned values render
                    // read-only but each is individually unticked-able to
                    // CORRECT a value the AI got wrong — same mechanism as the
                    // private card (isStkFieldConfirmed / toggleStkFieldConfirm
                    // + "edit on next page"). This is correction of surfaced
                    // data only: fields the AI did NOT return stay hidden, so we
                    // never newly collect the full natural-person dataset for a
                    // listed company (CD-12 / PR-057 still open). Person removal
                    // remains the header checkbox above.
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {stkConfirmFields(s, ubo)
                          .filter((f) => stkFieldFound(s, f.key))
                          .map((f) => renderPersonAttributeRow(item, s, f, isPersonLowConfidence(s, item)))}
                      </div>
                      <Notice tier="tier1" style={{ marginTop: 10 }}>
                        Verified from official sources — no additional details required for a listed company.
                        Untick a field to correct a value we got wrong, or untick this person above if they
                        don't belong; you'll make the change on the next page.
                      </Notice>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {stkConfirmFields(s, ubo).map((f) => {
                          // A gap is not a warning. Nothing is wrong with a value
                          // research simply didn't return, and there is no control
                          // here to act on it — it is collected on the next page.
                          // Same calm green as the tick and the shareholding pill.
                          const deferredTag = {
                            fontSize: 10, fontWeight: 700, color: "#1a6b56",
                            background: "#dff2ec", border: "1px solid rgba(74,158,142,0.3)",
                            borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
                          };
                          if (stkFieldFound(s, f.key)) {
                            return renderPersonAttributeRow(item, s, f, isPersonLowConfidence(s, item));
                          }
                          if (!f.required) return null;
                          return (
                            <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <span style={{ width: 14, textAlign: "center", color: "#4a9e8e", flexShrink: 0 }}>＋</span>
                              <span style={{ color: "#1a3a4a80", width: 130, flexShrink: 0 }}>{f.label}</span>
                              <span style={{ color: "#1a3a4a70", flex: 1, fontStyle: "italic" }}>Not found</span>
                              <span style={deferredTag}>collected on next page</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: "#1a3a4a70", marginTop: 10, fontStyle: "italic" }}>
                        {nextPageFields.length > 0
                          ? `On the next page you'll complete: ${nextPageFields.join(", ")}.`
                          : "All details confirmed — nothing further needed on the next page."}
                      </div>
                    </>
                  )}

                  {/* Inline correction editor — LAST in the card, under the
                      next-page line. It used to render above the header, which
                      pushed the editor away from the row it belongs to and put
                      it on top of every value. It edits one of the attributes
                      listed above, so it reads in place here. */}
                  {personEditing && personEditing.stakeholderId === s.id && (
                    <div style={{ marginTop: 12 }}>
                      <PersonCorrection
                        attribute={personEditing.attribute}
                        personName={s.full_name}
                        originalValue={
                          (researchStakeholders(item.field).find((x) => x && x.id === s.id) || {})[
                            personEditing.fieldKey
                          ] ?? ""
                        }
                        // Was hardcoded to date_of_birth; detected now, so any
                        // future person date attribute gets the picker too.
                        inputType={isDateField({ field: personEditing.fieldKey }) ? "date" : "text"}
                        onResolve={(res) => resolvePersonCorrection(s, item.field, personEditing.fieldKey, res)}
                        onCancel={() => setPersonEditing(null)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Customer-added people (pending) — created here, completed next page */}
        {getStakeholders(item.field)
          .filter((s) => s.customer_added && !isRegistryExemptionNotice(s))
          .map((s) => renderPendingAddedStakeholder(item.field, s, ubo))}

      </div>
    );
  };

  return renderStakeholderConfirmSection(item, idx);
}

export default StakeholderConfirmSection;
