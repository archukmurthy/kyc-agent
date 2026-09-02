/**
 * AIDocumentsPage.jsx — the Documents step of the ai_documents journey.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. The step was an
 * inline IIFE in App's return — {isAiDocs && step === STEPS.documents && (() =>
 * …)()} — so, like the Fill Gaps shell, there was no named render function to
 * relocate: this extraction AUTHORS the component boundary. The body below is
 * the same text that ran in App.js, at its original indentation, so a diff shows
 * the move and nothing else. What changed is only how it gets its data: it used
 * to close over App's scope, and now arrives through the prop interface.
 *
 * PROP NAMES DELIBERATELY MATCH THE OLD APP IDENTIFIERS, destructured back into
 * locals of the same name, so the moved body stays byte-identical.
 *
 * THE TWO UPLOAD HANDLERS CAME WITH IT. handleManualDocumentUpload and
 * handleManualDocumentRemove were hoisted function declarations parked ~1,350
 * lines from the render body, inside the pre-boarding block — but their only
 * call sites are in this step, so they belong here. They are the one part of
 * this move a const-based scan would have missed entirely.
 *
 * THIS COMPONENT OWNS NO STATE. Every value and setter is drilled, because each
 * one has a consumer outside this page and must stay App-owned:
 *
 *   - docSearchResults / selfSourceResults / uploadedDocs feed doResearch, the
 *     submit payload and buildDossierPayload.
 *   - acceptedDocTypes crosses as the LIVE Set, with setAcceptedDocTypes as a
 *     callback. It is NOT snapshotted: the accept toggle reads the current Set,
 *     and doResearch reads it too. This is the wiring behind the known
 *     auto-found-docs gap — moved byte-identical, deliberately NOT fixed here.
 *   - docLoaderIdx is driven by an App-owned interval effect; hasRunRealAgent is
 *     reset by resetAll. Neither can live here.
 *   - setJourneyOpen is drilled for the "← Back" button. journeyOpen itself
 *     STAYS in App.js — the journey picker and ConfirmStep also consume it.
 *
 * The oracle is AIDocumentsPage.render.test.jsx (21 assertions), written against
 * the inline step BEFORE this move and green after it, UNCHANGED. If it goes
 * red, the move is wrong, not the test.
 */

import React from "react";
import { C } from "../../constants/theme";
import { SHOW_TEST_TOOLS } from "../../constants/appConstants";
import { docTypesForEntity } from "../../constants/docTypes";
import { DOC_LOADER_MSGS } from "../../constants/loaderMessages";
import { buildDemoDocSearchResults } from "../../demo/demoData";

export function AIDocumentsPage({
  // ── company context, read-only ──
  companyName,
  entityType,
  ownershipType,
  tenantConfig,
  demoMode,
  // ── doc-search agent state (App-owned) ──
  docSearchResults,
  setDocSearchResults,
  docSearchLoading,
  setDocSearchLoading,
  docSearchError,
  setDocSearchError,
  // ── registry self-source agent state (App-owned) ──
  selfSourceResults,
  setSelfSourceResults,
  selfSourceLoading,
  selfSourceError,
  selfSourceDiag,
  // ── customer uploads + the accept gate ──
  uploadedDocs,
  acceptedDocTypes,
  setAcceptedDocTypes,
  handleDocFile,
  removeDocFile,
  // ── loader + test-mode ──
  docLoaderIdx,
  hasRunRealAgent,
  setHasRunRealAgent,
  runRealDocSearch,
  runRealSelfSource,
  doDummyResearch,
  // ── page chrome + navigation ──
  proceedFromDocuments,
  setJourneyOpen,
  scrollAndSetStep,
  STEPS,
  error,
  setError,
  Btn,
  cardStyle: card,
}) {

  // Manual upload for registry documents that are behind a captcha and cannot
  // be retrieved automatically. The analyst downloads the document by hand from
  // the registry, then uploads it here to bring it back into the dossier.
  // Registry docs live in `selfSourceResults.results` (no stable id field), so
  // we key by array index.
  async function handleManualDocumentUpload(event, idx) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset the input up-front (before the await) so the same file can be
    // re-selected after a Remove and we don't touch a reused event later.
    event.target.value = "";

    // PR-034 — upload to Vercel Blob immediately and persist the permanent URL
    // rather than an ephemeral browser blob: URL (which does not survive a page
    // reload). The ephemeral URL is kept only as a local fallback for preview if
    // the upload fails.
    const localUrl = URL.createObjectURL(file);
    let blobUrl = null;
    // Store path within the Blob store, returned since the private-write fix.
    // Persisted alongside the URL (raw_research JSONB — no migration) because
    // signed-URL retrieval is keyed by pathname and addRandomSuffix makes it
    // unreconstructable. Null for uploads made before that change.
    let blobPathname = null;
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
      blobPathname = data.pathname || null;
      filename = data.filename || file.name;
    } catch (err) {
      // Fall back to the ephemeral URL + a flag so the UI can warn rather than
      // silently lose the file.
      uploadFailed = true;
    }

    setSelfSourceResults((prev) => {
      if (!prev) return prev;
      const results = (prev.results || []).map((doc, i) =>
        i === idx
          ? {
              ...doc,
              status: "manually_uploaded",
              manualUploadFile: file,
              manualUploadName: filename,
              // Permanent Vercel Blob URL on success; ephemeral fallback on
              // failure (uploadFailed flags the UI to warn).
              manualUploadUrl: blobUrl || localUrl,
              manualUploadBlobUrl: blobUrl,
              manualUploadPathname: blobPathname,
              manuallyUploaded: true,
              uploadFailed,
              manualUploadAt: new Date().toISOString(),
            }
          : doc
      );
      return { ...prev, results };
    });
  }

  function handleManualDocumentRemove(idx) {
    setSelfSourceResults((prev) => {
      if (!prev) return prev;
      const results = (prev.results || []).map((doc, i) =>
        i === idx
          ? {
              ...doc,
              // captchaBlocked stays true, so the "Behind captcha" UI re-appears.
              status: "manual_retrieval_required",
              manualUploadFile: null,
              manualUploadName: null,
              manualUploadUrl: null,
              manualUploadAt: null,
            }
          : doc
      );
      return { ...prev, results };
    });
  }

          const docs = docTypesForEntity(entityType, tenantConfig);
          const uploadedCount = docs.reduce((n, d) => n + (uploadedDocs[d.key] ? 1 : 0), 0);
          // Section A (Document Intelligence) — auto-sourced documents from
          // the doc search agent. Only usable docs render as cards.
          const foundDocs = (docSearchResults?.documents || [])
            .filter(d => d.status === "downloaded" || d.status === "url_found");
          const sectionAVisible = docSearchLoading || !!docSearchError ||
            (docSearchResults !== null && docSearchResults.documents.length > 0);
          // Unified loading: hold ALL results until BOTH agents finish, then
          // reveal together. Message cycles via the effect above.
          const isLoading = docSearchLoading || selfSourceLoading;
          const currentMessage = DOC_LOADER_MSGS[docLoaderIdx % DOC_LOADER_MSGS.length];

          // ── Section B: flag (but do not hide) documents already auto-sourced
          // in Section A. Only count docs the agent actually has (downloaded or
          // url_found); a failed search still asks the customer to provide it.
          const autoSourcedDocTypes = new Set(
            (docSearchResults?.documents || [])
              .filter(d => d.status === "downloaded" || d.status === "url_found")
              .map(d => d.type)
          );
          // Map doc-search agent type IDs → the DOC_TYPES `key` values used by
          // Section B (Wolfsberg = "wolfsberg", Annual Report = "annualReport"),
          // plus a range of aliases so the match is robust to either source.
          const docTypeMapping = {
            wolfsberg_questionnaire: [
              "doc_wolfsberg", "wolfsberg", "wolfsberg_questionnaire", "cbddq", "fccq",
            ],
            annual_report: [
              "doc_annual", "annual_report", "annual_report_accounts",
              "audited_financial_statements", "audited_accounts", "annualReport",
            ],
          };
          function isAutoSourced(docId, docType) {
            for (const [agentType, mappedIds] of Object.entries(docTypeMapping)) {
              if (autoSourcedDocTypes.has(agentType)) {
                if (mappedIds.includes(docId) || mappedIds.includes(docType)) {
                  return true;
                }
              }
            }
            return false;
          }

          // PR-043 — unified "Documents Sourced" list. Merge three origins into
          // one deduped, labelled, sorted array so manual uploads and the annual
          // report sit in the same panel as the automated registry docs:
          //   • registry  — selfSourceResults.results, status "retrieved"
          //   • manual    — selfSourceResults.results, status "manually_uploaded"
          //                 (carries a permanent blobUrl from PR-034)
          //   • research  — docSearchResults.documents (annual report / Wolfsberg)
          const SOURCE_LABELS = {
            registry: "Retrieved from registry",
            research: "Retrieved automatically",
            manual: "Uploaded manually",
          };
          const normDocType = (s) =>
            String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

          const registryEntries = (selfSourceResults?.results || []).map((item, i) => {
            const uploaded = item.status === "manually_uploaded";
            const captcha = !!item.captchaBlocked && !uploaded;
            const manualReview =
              item.manualReviewFlag || item.status === "manual_retrieval_required";
            const failed = item.status === "fetch_failed";
            const retrieved =
              item.status === "retrieved" || item.status === "retrieved_unverified";
            // Permanent blob URL for manual uploads (null when the upload failed);
            // automated registry docs link to the registry page instead.
            //
            // Blobs are written PRIVATE, so a manual upload can no longer be an
            // <a href> straight at the blob — a private blob is not fetchable by
            // URL. Route it through /api/get-document, which reads it with the
            // store token and streams the bytes back. Registry docs are ordinary
            // public web pages and are linked directly, unchanged.
            const blobUrl = item.manualUploadBlobUrl || null;
            const viewUrl = uploaded
              ? (item.uploadFailed || !blobUrl
                  ? null
                  : `/api/get-document?url=${encodeURIComponent(blobUrl)}`)
              : (item.searchUrl || item.sourceUrl || null);
            let host = "";
            try {
              const u = item.searchUrl || item.sourceUrl;
              host = u ? new URL(u).hostname.replace(/^www\./, "") : "";
            } catch (_) { host = ""; }
            return {
              kind: "registry",
              registryIndex: i,
              docType: normDocType(item.requirement),
              name: item.localEquivalent || item.requirement,
              subLabel: item.requirement,
              host,
              origin: uploaded ? "manual" : "registry",
              sourceLabel: uploaded
                ? SOURCE_LABELS.manual
                : (retrieved ? SOURCE_LABELS.registry : null),
              viewUrl,
              uploadFailed: !!item.uploadFailed,
              captcha,
              manualReview,
              failed,
              retrieved,
              uploaded,
              manualUploadName: item.manualUploadName || null,
              openUrl: item.searchUrl || item.sourceUrl || null,
              timestamp: item.manualUploadAt || item.retrievedAt || selfSourceResults?.searchedAt || "",
            };
          });

          const researchEntries = (docSearchResults?.documents || [])
            .filter((d) => d.status === "downloaded" || d.status === "url_found")
            .map((doc) => ({
              kind: "research",
              docType: normDocType(doc.type),
              name: doc.label,
              subLabel: doc.sourceLabel,
              origin: "research",
              sourceLabel: SOURCE_LABELS.research,
              viewUrl: doc.sourceUrl || null,
              docObj: doc,
              year: doc.year,
              confidence: doc.confidence,
              status: doc.status,
              timestamp: docSearchResults?.searchedAt || "",
            }));

          // Dedup by document type — prefer an automated entry (registry/research)
          // over a manual upload of the same type; show the manual upload only as
          // a fallback. Empty doc types are never collapsed together.
          const isAuto = (e) => e.origin !== "manual";
          const byType = new Map();
          [...registryEntries, ...researchEntries].forEach((e) => {
            const key = e.docType || `__${e.kind}_${e.registryIndex ?? e.name}`;
            const existing = byType.get(key);
            if (!existing || (isAuto(e) && !isAuto(existing))) byType.set(key, e);
          });
          // Sort: automated (registry/research) first, manual uploads last; within
          // each group newest first by timestamp.
          const mergedSourcedDocs = Array.from(byType.values()).sort((a, b) => {
            const am = a.origin === "manual" ? 1 : 0;
            const bm = b.origin === "manual" ? 1 : 0;
            if (am !== bm) return am - bm;
            return String(b.timestamp).localeCompare(String(a.timestamp));
          });

          return (
            <div>
              <div style={card}>
                <style>{`@keyframes kspin { to { transform: rotate(360deg); } }`}</style>

                {/* Testing-mode toggle — demo data vs real agent call. Hidden once
                    the real agents have been triggered (test/demo only). */}
                {(demoMode || SHOW_TEST_TOOLS) && !hasRunRealAgent && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 16,
                    padding: "8px 12px",
                    background: C.surfaceAlt,
                    borderRadius: 8,
                    border: `1px dashed ${C.border}`,
                  }}>
                    <span style={{ fontSize: 12, color: C.textMuted }}>
                      🧪 Testing mode:
                    </span>
                    <button
                      onClick={() => {
                        setDocSearchResults(
                          buildDemoDocSearchResults(companyName, ownershipType, entityType)
                        );
                        setDocSearchError(null);
                        setDocSearchLoading(false);
                      }}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        background: "transparent",
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: C.text,
                      }}
                    >
                      Use demo data
                    </button>
                    <button
                      onClick={() => {
                        // Test/demo only: trigger BOTH real agents in parallel and
                        // hide this toggle. The unified loading panel (isLoading)
                        // shows while they run; real results replace the dummy ones.
                        setHasRunRealAgent(true);
                        runRealDocSearch();
                        runRealSelfSource();
                      }}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        background: C.brandBlue,
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      Run real agent
                    </button>
                  </div>
                )}

                {/* Unified loading panel — held until BOTH agents finish, then
                    all results + uploads reveal together below. */}
                {isLoading && (
                  <div style={{ textAlign: "center", padding: "40px 20px" }}>
                    <div style={{ fontSize: 24, marginBottom: 16 }}>⏳</div>
                    <p style={{ fontWeight: 500 }}>{currentMessage}</p>
                    <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
                      This takes about 30–40 seconds
                    </p>
                  </div>
                )}

                {/* Everything below is held back until both agents complete. */}
                {!isLoading && (<>

                {/* Empty state — both agents done, nothing found anywhere. */}
                {foundDocs.length === 0 && !(selfSourceResults?.results?.length > 0) && (
                  <div style={{
                    padding: "16px", background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`, borderRadius: 10,
                    marginBottom: 20, fontSize: 13, color: C.warning,
                  }}>
                    No documents could be retrieved automatically. Please upload the required documents below.
                  </div>
                )}

                {/* Test/demo-only diagnostic — surfaces a swallowed registry-agent
                    API error (e.g. billing/credits) so it isn't hidden as "manual
                    retrieval". NEVER shown in production (gated on test/demo). */}
                {(demoMode || SHOW_TEST_TOOLS) && selfSourceDiag && (
                  <div style={{
                    padding: "12px 16px", background: "#fff1f0", border: "1px solid #ffa39e",
                    borderRadius: 10, marginBottom: 20, fontSize: 12, color: "#a8071a",
                  }}>
                    <strong>🧪 Test diagnostic — registry agent AI call failed:</strong>
                    <div style={{ marginTop: 4, fontFamily: "monospace", wordBreak: "break-word", lineHeight: 1.4 }}>
                      {selfSourceDiag}
                    </div>
                    <div style={{ marginTop: 6, color: "#a8071a99" }}>
                      Items below fell back to manual retrieval because the AI call didn't run — not because the documents are missing.
                    </div>
                  </div>
                )}

                {/* Section A error — subtle, never blocks progress */}
                {docSearchError && (
                  <div style={{
                    padding: "12px 16px",
                    background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`,
                    borderRadius: 10,
                    marginBottom: 20,
                    fontSize: 13,
                    color: C.warning,
                  }}>
                    ⚠ Could not automatically source documents for {companyName}. Please upload documents below.
                  </div>
                )}

                {/* Registry self-source error — subtle, never blocks progress */}
                {selfSourceError && (
                  <div style={{
                    padding: "12px 16px",
                    background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`,
                    borderRadius: 10,
                    marginBottom: 20,
                    fontSize: 13,
                    color: C.warning,
                  }}>
                    ⚠ Could not retrieve registry documents: {selfSourceError}
                  </div>
                )}

                {/* PR-043 — unified Documents Sourced panel: automated registry
                    docs, internet-research docs (annual report / Wolfsberg) and
                    manual uploads, deduped by type and labelled by origin. */}
                {!isLoading && mergedSourcedDocs.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: C.textMuted,
                      textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 12,
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <span>📁 Documents Sourced</span>
                      {docSearchResults?.isDemo && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: C.textMuted,
                          background: C.surfaceAlt, border: `1px solid ${C.border}`,
                          borderRadius: 99, padding: "2px 8px",
                        }}>DEMO DATA</span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
                      Documents gathered for <strong>{companyName}</strong> — from official
                      registries, public sources, and your manual uploads.
                    </p>

                    {mergedSourcedDocs.map((e) => {
                      const accepted = e.kind === "research" && acceptedDocTypes.has(e.docObj.type);
                      const positive = e.uploaded || e.retrieved || e.kind === "research";
                      const labelStyle = e.origin === "research"
                        ? { bg: C.surfaceAlt, fg: C.brandBlue }
                        : { bg: C.successBg, fg: C.success };
                      const icon = e.kind === "research"
                        ? (e.docObj.type === "wolfsberg_questionnaire" ? "📋" : "📊")
                        : "🏛️";
                      return (
                        <div key={`${e.kind}-${e.registryIndex ?? e.docType}-${e.name}`} style={{
                          display: "flex", alignItems: "flex-start", gap: 12,
                          padding: "14px 16px",
                          background: positive && !e.uploadFailed ? C.successBg : "#fff",
                          border: `1.5px solid ${positive && !e.uploadFailed ? C.successBorder : C.border}`,
                          borderRadius: 10, marginBottom: 8,
                        }}>
                          <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>{icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                              {e.name}
                              {e.year && (
                                <span style={{ fontSize: 12, fontWeight: 400, color: C.textMuted, marginLeft: 8 }}>{e.year}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                              {e.subLabel}{e.host ? ` · ${e.host}` : ""}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {e.sourceLabel && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: labelStyle.bg, color: labelStyle.fg,
                                }}>{e.sourceLabel}</span>
                              )}
                              {e.kind === "research" && e.confidence && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: e.confidence === "high" ? C.successBg : C.warningBg,
                                  color: e.confidence === "high" ? C.success : C.warning,
                                  border: `1px solid ${e.confidence === "high" ? C.successBorder : C.warningBorder}`,
                                }}>{e.confidence === "high" ? "✓ High confidence" : "~ Medium confidence"}</span>
                              )}
                              {e.captcha && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: C.warningBg, color: C.warning,
                                }}>🔒 Behind captcha</span>
                              )}
                              {!e.uploaded && !e.captcha && e.manualReview && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: C.warningBg, color: C.warning,
                                }}>⚠ Manual retrieval</span>
                              )}
                              {e.failed && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: C.surfaceAlt, color: C.textMuted,
                                }}>✗ Not found</span>
                              )}
                            </div>

                            {/* View link — /api/get-document for manual uploads (the
                                blob is private and streamed back by the server),
                                registry/source URL for automated docs. Hidden when a
                                manual upload failed (blobUrl null / uploadFailed). */}
                            {e.viewUrl && (
                              <a href={e.viewUrl} target="_blank" rel="noopener noreferrer" style={{
                                display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12,
                                color: C.brandBlue, fontWeight: 600, textDecoration: "none", marginTop: 6, padding: "4px 0",
                              }}>
                                <span style={{ fontSize: 14 }}>{e.origin === "manual" ? "📄" : "🔗"}</span>
                                View →
                              </a>
                            )}

                            {/* Manual upload failed — warn but never block the journey. */}
                            {e.uploaded && e.uploadFailed && (
                              <div style={{ marginTop: 6, fontSize: 12, color: C.warning }}>
                                ⚠ Upload could not be stored permanently — please re-upload before submitting.
                              </div>
                            )}

                            {/* Manually-uploaded doc — filename + remove. */}
                            {e.uploaded && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, color: e.uploadFailed ? C.warning : C.success }}>
                                <span>{e.uploadFailed ? "⚠" : "✓"}</span>
                                <span style={{ fontWeight: 600 }}>{e.manualUploadName}</span>
                                <span onClick={() => handleManualDocumentRemove(e.registryIndex)} style={{
                                  cursor: "pointer", color: C.textSec, fontSize: 11, textDecoration: "underline",
                                }}>Remove</span>
                              </div>
                            )}

                            {/* Captcha-blocked registry doc — offer manual download + upload. */}
                            {e.captcha && (
                              <div style={{ marginTop: 6 }}>
                                <div style={{ fontSize: 12, color: C.warning, marginBottom: 6 }}>
                                  🔒 Behind captcha — cannot be retrieved automatically
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  {e.openUrl && (
                                    <a href={e.openUrl} target="_blank" rel="noopener noreferrer" style={{
                                      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12,
                                      padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                                      background: C.surface, color: C.brandBlue, fontWeight: 600, textDecoration: "none",
                                    }}>
                                      <span style={{ fontSize: 14 }}>🔗</span>
                                      Open registry →
                                    </a>
                                  )}
                                  <input type="file" id={`upload-registry-${e.registryIndex}`}
                                    accept=".pdf,.png,.jpg,.jpeg" style={{ display: "none" }}
                                    onChange={(ev) => handleManualDocumentUpload(ev, e.registryIndex)} />
                                  <button onClick={() => document.getElementById(`upload-registry-${e.registryIndex}`).click()} style={{
                                    fontSize: 12, padding: "4px 10px", borderRadius: 6,
                                    border: `1px solid ${C.border}`, background: C.surface,
                                    color: C.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                                  }}>↑ Upload document</button>
                                </div>
                              </div>
                            )}

                            {/* Registry snapshot-evidence note (automated retrieval). */}
                            {e.retrieved && !e.uploaded && (
                              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                                📸 Snapshot captured as evidence
                              </div>
                            )}
                          </div>

                          {/* Research docs — accept-to-extract toggle (unchanged behaviour). */}
                          {e.kind === "research" && (
                            <div style={{ flexShrink: 0 }}>
                              {accepted ? (
                                <button onClick={() => setAcceptedDocTypes(prev => { const n = new Set(prev); n.delete(e.docObj.type); return n; })} style={{
                                  padding: "7px 14px", background: C.success, color: "#fff", border: "none",
                                  borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                                  display: "flex", alignItems: "center", gap: 4,
                                }}>✓ Using this</button>
                              ) : (
                                <button onClick={() => setAcceptedDocTypes(prev => new Set([...prev, e.docObj.type]))} style={{
                                  padding: "7px 14px", background: "transparent", color: C.brandBlue,
                                  border: `1.5px solid ${C.brandBlue}`, borderRadius: 8, fontSize: 12, fontWeight: 600,
                                  fontFamily: "inherit", cursor: "pointer",
                                }}>Use this document</button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Search details — collapsible diagnostic table (doc-search agent). */}
                {docSearchResults?.summaryTable?.length > 0 && (
                  <details style={{ marginTop: -8, marginBottom: 24 }}>
                    <summary style={{
                      fontSize: 12, color: C.textMuted, cursor: "pointer", userSelect: "none",
                      listStyle: "none", display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <span>▾</span>
                      <span>View search details</span>
                    </summary>
                    <div style={{ marginTop: 10, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr>
                            {Object.keys(docSearchResults.summaryTable[0] || {}).map(col => (
                              <th key={col} style={{
                                padding: "6px 10px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                                textAlign: "left", fontWeight: 700, color: C.textMuted, whiteSpace: "nowrap",
                              }}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {docSearchResults.summaryTable.map((row, i) => (
                            <tr key={i}>
                              {Object.entries(row).map(([col, val], j) => (
                                <td key={j} style={{
                                  padding: "6px 10px", border: `1px solid ${C.border}`, color: C.text,
                                  maxWidth: col === "Notes" ? 300 : 200,
                                  whiteSpace: col === "Notes" ? "normal" : "nowrap",
                                  overflow: col === "Notes" ? "visible" : "hidden",
                                  textOverflow: col === "Notes" ? "unset" : "ellipsis",
                                  wordBreak: col === "Notes" ? "break-word" : "normal",
                                  fontSize: 11, verticalAlign: "top",
                                }}>{String(val)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                {/* Section divider between A (found) and B (uploads) */}
                {sectionAVisible && (
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.8px",
                    marginBottom: 12,
                    marginTop: 4,
                    paddingTop: 20,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    📤 Documents we need from you
                  </div>
                )}

                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Upload your documents</h2>
                <p style={{ fontSize: 13, color: "#1a3a4a90", margin: "0 0 18px", lineHeight: 1.5 }}>
                  All documents are optional. Upload as many or as few as you have available. The more you provide, the less you'll need to fill in manually.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                  {docs.map(d => {
                    const file = uploadedDocs[d.key];
                    const inputId = `upload-${d.key}`;
                    return (
                      <div key={d.key} style={{
                        padding: "14px 14px", borderRadius: 12,
                        background: file ? "#f0f9f6" : "#fafcfb",
                        border: file ? "2px solid #4a9e8e" : "2px dashed rgba(26,58,74,0.18)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <div style={{ fontSize: 20 }}>{d.icon}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{d.label}</div>
                          {d.badge && (
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 999, background: d.badge.color, color: "#fff", textTransform: "uppercase" }}>{d.badge.text}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 10 }}>{d.helper}</div>
                        {isAutoSourced(d.key, d.key) && (
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginBottom: 6,
                            padding: "6px 10px",
                            background: C.successBg,
                            border: `1px solid ${C.successBorder}`,
                            borderRadius: 6,
                            fontSize: 12,
                            color: C.success,
                          }}>
                            <span>✓</span>
                            <span>
                              We sourced this automatically — upload here only if you prefer to provide your own version.
                            </span>
                          </div>
                        )}
                        {file ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid rgba(74,158,142,0.25)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ color: "#1a6b56", fontWeight: 700, fontSize: 14 }}>✓</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                                <div style={{ fontSize: 10, color: "#1a3a4a70" }}>{(file.size / 1024).toFixed(0)} KB</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={removeDocFile(d.key)}
                              title="Remove"
                              style={{ background: "transparent", border: "none", color: "#1a3a4a", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}
                            >×</button>
                          </div>
                        ) : (
                          <label htmlFor={inputId} style={{ display: "block", padding: "12px 10px", textAlign: "center", borderRadius: 8, background: "#fff", border: "1.5px dashed rgba(26,58,74,0.22)", cursor: "pointer", fontSize: 12, color: "#1a3a4a90" }}>
                            Click to upload or drag and drop
                            <div style={{ fontSize: 10, color: "#1a3a4a60", marginTop: 4 }}>{d.accepts}</div>
                          </label>
                        )}
                        <input
                          id={inputId}
                          type="file"
                          accept={d.accept}
                          onChange={handleDocFile(d.key)}
                          style={{ display: "none" }}
                        />
                      </div>
                    );
                  })}
                </div>

                {error && <div style={{ marginTop: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}

                <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: uploadedCount > 0 ? "#f0f9f6" : "#fafcfb", color: uploadedCount > 0 ? "#1a6b56" : "#1a3a4a70", fontSize: 12, fontWeight: 600 }}>
                  {uploadedCount > 0
                    ? `${uploadedCount} document${uploadedCount === 1 ? "" : "s"} ready to upload`
                    : "No documents selected — AI will use web search only"}
                </div>
                </>)}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <Btn variant="secondary" onClick={() => { setError(""); setJourneyOpen(true); scrollAndSetStep(STEPS.input); }}>← Back</Btn>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Test/demo only: continue with synthesised data instead of
                      the real research + self-source agents, so the rest of the
                      flow can be exercised without spending on live API calls.
                      Mirrors the dummy path the journey-selection page uses
                      (proceedFromDocuments → doDummyResearch in demo mode). */}
                  {(demoMode || SHOW_TEST_TOOLS) && (
                    <button
                      onClick={() => { setError(""); doDummyResearch("ai_documents"); }}
                      title="Skip the real search — fills the rest of the flow with demo data at no cost"
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "10px 16px",
                        background: "transparent",
                        border: `1px dashed ${C.border}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: C.text,
                        whiteSpace: "nowrap",
                      }}
                    >
                      🧪 Dummy search (no cost)
                    </button>
                  )}
                  <Btn variant="primary" onClick={proceedFromDocuments}>Continue →</Btn>
                </div>
              </div>
            </div>
          );
}
