/**
 * components/Step2DynamicForm.jsx
 *
 * Required Documents step of the KYC Onboarding Agent — dynamically shaped by
 * the DRS checklist (live POST /api/document-requirements, computed from the
 * bundled documentRequirements.js engine).
 *
 * Props:
 *   step1Data        — { companyName, entityType, ownershipType, incorporationCountry }
 *   researchData     — (optional) research result, currently unused here
 *   onComplete(data) — called when customer advances; data includes submittedRequirements[]
 *
 * IMPORTANT — render the WHOLE checklist, drop nothing:
 *   Each checklist item carries a `selfSource` tag, one of:
 *     - "Client-provided only"      → customer must upload it
 *     - "Preferred self-source"     → Nium retrieves it
 *     - "Supplementary self-source" → Nium retrieves it
 *   and an `rfi` tag ("Required from client" | "Request if self-source insufficient").
 *   The previous version only showed items where rfi === "Required from client"
 *   (cards) or selfSource === "Preferred self-source" (a banner) — so anything
 *   tagged "Supplementary self-source" (e.g. Regulatory status, Business
 *   activity, UK signatory authority evidence) was dropped entirely, and the
 *   "Preferred self-source" items (Legal existence, Constitution) were buried in
 *   a one-line banner. We now partition the FULL checklist into client-provided
 *   vs Nium-sourced and render every item.
 *
 * Styling uses the app's inline palette (Nium navy + teal), matching App.js.
 */

import { useState } from 'react';
import { useDocumentRequirements } from '../hooks/useDocumentRequirements';

const C = {
  navy: '#1a3a4a', navy70: '#1a3a4a70', navy80: '#1a3a4a80',
  teal: '#4a9e8e',
  border: 'rgba(26,58,74,0.14)', borderSoft: 'rgba(26,58,74,0.08)', surface: '#fafcfb',
  successText: '#1a6b56', successBg: '#f0f9f6', successBorder: '#4a9e8e',
  dangerText: '#dc2626', dangerBg: '#fef2f2', dangerBorder: '#fecaca',
  infoText: '#1a4a7a', infoBg: '#f0f3f8', infoBorder: '#bcd0e8',
};

// Testing-only affordance (Upload all). Shown in local dev, and on the deployed
// site only when the URL carries ?test=1 (matches App.js SHOW_TEST_TOOLS).
const TEST_FLAG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('test') === '1';
const SHOW_TEST_TOOLS = process.env.NODE_ENV !== 'production' || TEST_FLAG;

const isSelfSourced = (item) => /self-source/i.test(item.selfSource || '');
const clientMayAlsoProvide = (item) => /insufficient/i.test(item.rfi || '');

// The doc-search agent (Step 2) sources two document types. The DRS checklist
// keys items by human-readable `requirement` strings (no doc IDs), and Wolfsberg
// is rendered in its own section — so we match an auto-sourced agent doc to a
// checklist card by keyword on the card title rather than by an ID lookup.
const AUTO_SOURCED_MATCHERS = {
  wolfsberg_questionnaire: /wolfsberg|cbddq|fccq/i,
  annual_report: /annual report|annual accounts|financial statement|audited account/i,
};

// Returns the doc-search result already covering this checklist item (matched by
// title keyword), or null if it was not auto-sourced. Only docs the agent
// actually has (downloaded / url_found) count — a failed search still asks.
function getAutoSourcedResult(title, docSearchResults) {
  if (!title || !docSearchResults?.documents?.length) return null;
  for (const agentDoc of docSearchResults.documents) {
    if (agentDoc.status !== 'downloaded' && agentDoc.status !== 'url_found') continue;
    const matcher = AUTO_SOURCED_MATCHERS[agentDoc.type];
    if (matcher && matcher.test(title)) return agentDoc;
  }
  return null;
}

// "Sourced automatically" banner shown at the top of a document card when the
// doc search agent already found that document.
function AutoSourcedBanner({ result, showUploadHint = true }) {
  if (!result) return null;
  return (
    <div style={styles.autoSourcedBanner}>
      <span style={styles.autoSourcedIcon}>✅</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.autoSourcedTitle}>Sourced automatically</div>
        <div style={styles.autoSourcedDesc}>
          We found this from {result.sourceLabel || result.source || 'a public source'}.
          {result.sourceUrl && (
            <>{' '}
              <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" style={styles.autoSourcedLink}>
                View document →
              </a>
            </>
          )}
        </div>
        {showUploadHint && (
          <div style={styles.autoSourcedHint}>
            Upload below only if you prefer to provide your own version.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Upload card ─────────────────────────────────────────────────────────────

function DocumentUploadCard({ item, onUpload, onRemove, uploaded, autoSourcedResult }) {
  const selfSource = isSelfSourced(item);
  const done = !!uploaded;
  const regUrl = item.regulatoryUrl || item.sourceUrl;

  const uploadedRow = (
    <div style={styles.uploadedState}>
      <div style={styles.uploadedFile}>
        <span style={styles.uploadedTick}>✓</span>
        <div style={{ minWidth: 0 }}>
          <div style={styles.uploadedName}>{uploaded?.name}</div>
          {typeof uploaded?.size === 'number' && (
            <div style={styles.uploadedSize}>{(uploaded.size / 1024).toFixed(0)} KB</div>
          )}
        </div>
      </div>
      <div style={styles.uploadedActions}>
        <label style={styles.linkBtn}>
          <input type="file" style={{ display: 'none' }} accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => e.target.files[0] && onUpload(item.requirement, e.target.files[0])} />
          Change
        </label>
        <button type="button" style={styles.removeBtn} onClick={() => onRemove(item.requirement)}>Remove</button>
      </div>
    </div>
  );

  const uploadBox = (label, hint) => (
    <label style={styles.uploadLabel}>
      <input type="file" style={{ display: 'none' }} accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => e.target.files[0] && onUpload(item.requirement, e.target.files[0])} />
      <span style={{ fontWeight: 600, color: C.teal }}>{label}</span>
      <span style={styles.uploadHint}>{hint}</span>
    </label>
  );

  // Badge: client-provided → Required/Optional; Nium-sourced → auto badge.
  const badge = selfSource
    ? <span style={styles.autoBadge}>Nium-sourced</span>
    : <span style={item.mandatory ? styles.mandatoryBadge : styles.optionalBadge}>{item.mandatory ? 'Required' : 'Optional'}</span>;

  return (
    <div style={{ ...styles.docCard, border: `1.5px solid ${done ? C.successBorder : C.border}`, background: done ? C.successBg : '#fff' }}>
      <AutoSourcedBanner result={autoSourcedResult} />
      <div style={styles.docCardHeader}>
        <span style={styles.docTitle}>{item.requirement}</span>
        {badge}
      </div>

      <p style={styles.docWhat}>{item.localEquivalent || item.standardDocument}</p>
      {item.why && <p style={styles.docHint}>{item.why}</p>}

      {selfSource ? (
        <>
          <div style={styles.selfSourceNote}>
            <span>🔍</span>
            <span>
              Nium retrieves this automatically.{' '}
              {clientMayAlsoProvide(item)
                ? 'Upload only if you already have it — it can speed up review.'
                : 'No action needed.'}
            </span>
          </div>
          {done ? uploadedRow
            : clientMayAlsoProvide(item) ? uploadBox('Upload if you have it (optional)', 'PDF, JPG or PNG') : null}
        </>
      ) : done ? uploadedRow : uploadBox('Click to upload', 'PDF, JPG or PNG')}

      {(item.fallback || item.regulatoryRationale || regUrl) && (
        <details style={styles.fallbackToggle}>
          <summary style={styles.fallbackSummary}>Why this is required / can't provide it?</summary>
          {item.regulatoryRationale && <p style={styles.fallbackText}>{item.regulatoryRationale}</p>}
          {item.fallback && <p style={styles.fallbackText}><strong>Alternative:</strong> {item.fallback}</p>}
          {regUrl && <a href={regUrl} target="_blank" rel="noopener noreferrer" style={styles.regLink}>View regulatory source ↗</a>}
        </details>
      )}
    </div>
  );
}

function WolfsbergSection({ uploaded, onComplete, onRemove, autoSourcedResult }) {
  const done = !!uploaded;
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Wolfsberg CBDDQ</h3>
      <p style={styles.sectionDesc}>
        As a Financial Institution, Nium requires a completed Correspondent Banking Due Diligence
        Questionnaire (CBDDQ). Upload your most recent completed version, or complete one at
        wolfsberg-group.com.
      </p>
      <div style={{ ...styles.docCard, border: `1.5px solid ${done ? C.successBorder : C.border}`, background: done ? C.successBg : '#fff' }}>
        <AutoSourcedBanner result={autoSourcedResult} />
        <div style={styles.docCardHeader}>
          <span style={styles.docTitle}>Wolfsberg CBDDQ</span>
          <span style={styles.mandatoryBadge}>Required</span>
        </div>
        {done ? (
          <div style={styles.uploadedState}>
            <div style={styles.uploadedFile}>
              <span style={styles.uploadedTick}>✓</span>
              <div style={{ minWidth: 0 }}>
                <div style={styles.uploadedName}>{uploaded.name}</div>
                {typeof uploaded.size === 'number' && <div style={styles.uploadedSize}>{(uploaded.size / 1024).toFixed(0)} KB</div>}
              </div>
            </div>
            <div style={styles.uploadedActions}>
              <label style={styles.linkBtn}>
                <input type="file" style={{ display: 'none' }} accept=".pdf"
                  onChange={(e) => e.target.files[0] && onComplete('Wolfsberg CBDDQ', e.target.files[0])} />
                Change
              </label>
              <button type="button" style={styles.removeBtn} onClick={() => onRemove('Wolfsberg CBDDQ')}>Remove</button>
            </div>
          </div>
        ) : (
          <label style={styles.uploadLabel}>
            <input type="file" style={{ display: 'none' }} accept=".pdf"
              onChange={(e) => e.target.files[0] && onComplete('Wolfsberg CBDDQ', e.target.files[0])} />
            <span style={{ fontWeight: 600, color: C.teal }}>Upload completed CBDDQ</span>
            <span style={styles.uploadHint}>PDF</span>
          </label>
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={styles.loadingState}>
      <style>{`@keyframes drsSpin { to { transform: rotate(360deg); } }`}</style>
      <div style={styles.spinner} />
      <p style={{ color: C.navy80, marginTop: 12, fontSize: 14 }}>Determining document requirements…</p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Step2DynamicForm({ step1Data, onComplete, docSearchResults }) {
  const { companyName, entityType, ownershipType, incorporationCountry } = step1Data;

  const { checklist, flags, onboardingCountry, loading, error } =
    useDocumentRequirements({ incorporationCountry, entityType, ownershipType });

  const [uploads, setUploads] = useState({});
  const handleUpload = (key, file) => setUploads(prev => ({ ...prev, [key]: file }));
  const handleRemove = (key) => setUploads(prev => { const n = { ...prev }; delete n[key]; return n; });

  // Partition the FULL checklist — nothing is dropped.
  const selfSourced = checklist.filter(isSelfSourced);
  const provide     = checklist.filter(i => !isSelfSourced(i));
  const coreItems   = provide.filter(i => !isPersonItem(i.requirement));
  const personItems = provide.filter(i => isPersonItem(i.requirement));

  // Auto-sourced docs (from the Step 2 doc search agent) that DON'T map to any
  // checklist card — e.g. an Annual Report for a Corporate entity, where the DRS
  // checklist has no Annual Report requirement. These would otherwise be
  // invisible on Step 6, so we surface them in their own "Already sourced" panel.
  const renderedTitles = [
    ...checklist.map(i => i.requirement),
    ...(flags.showWolfsberg ? ['Wolfsberg CBDDQ'] : []),
  ];
  const uncoveredAutoSourced = (docSearchResults?.documents || []).filter(d => {
    if (d.status !== 'downloaded' && d.status !== 'url_found') return false;
    const matcher = AUTO_SOURCED_MATCHERS[d.type];
    if (!matcher) return false;
    return !renderedTitles.some(t => matcher.test(t));
  });

  // Test-only: fill every client-provided card (+ Wolfsberg) with a dummy file
  // so the step can be completed without manually picking files.
  const handleUploadAll = () => {
    const targets = [...provide];
    if (flags.showWolfsberg) targets.push({ requirement: 'Wolfsberg CBDDQ' });
    setUploads(prev => {
      const next = { ...prev };
      targets.forEach(i => {
        if (!next[i.requirement]) {
          const fname = `test-${i.requirement.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
          try { next[i.requirement] = new File([new Blob(['test document'])], fname, { type: 'application/pdf' }); }
          catch { next[i.requirement] = { name: fname, size: 13 }; }
        }
      });
      return next;
    });
  };

  // Progress = mandatory, client-provided items the customer must upload.
  // An item also counts as provided if the doc search agent already sourced it.
  const requiredItems = provide.filter(i => i.mandatory);
  const requiredTotal = requiredItems.length;
  const requiredUploaded   = requiredItems.filter(i => uploads[i.requirement]);
  const requiredAutoSourced = requiredItems.filter(
    i => !uploads[i.requirement] && getAutoSourcedResult(i.requirement, docSearchResults)
  );
  const autoSourcedCount = requiredAutoSourced.length;
  const requiredDone  = Math.min(requiredTotal, requiredUploaded.length + autoSourcedCount);
  const allDone       = requiredTotal === 0 || requiredDone === requiredTotal;
  const pct           = requiredTotal === 0 ? 100 : Math.round((requiredDone / requiredTotal) * 100);

  const handleContinue = () => {
    const submittedRequirements = [
      ...Object.keys(uploads),
      // Nium-sourced items count as submitted — Nium will retrieve them.
      ...selfSourced.map(i => i.requirement),
    ];
    onComplete({ uploads, submittedRequirements, checklist, flags });
  };

  if (loading) return <LoadingState />;
  if (error) return <div style={styles.errorState}>Could not load document requirements: {error}</div>;

  return (
    <div style={styles.container}>
      <div>
        {onboardingCountry && (
          <div style={styles.jurisdictionBanner}>
            <span>📋</span>
            <span>Requirements for <strong>{companyName}</strong> — onboarding via <strong>Nium {onboardingCountry}</strong></span>
          </div>
        )}
        {requiredTotal > 0 && (
          <div style={styles.progressWrap}>
            <div style={styles.progressRow}>
              <span style={styles.progressLabel}>
                {requiredDone} of {requiredTotal} required document{requiredTotal > 1 ? 's' : ''} provided
                {autoSourcedCount > 0 ? ` (${autoSourcedCount} sourced automatically)` : ''}
              </span>
              {allDone && <span style={styles.progressDone}>✓ All required items in</span>}
            </div>
            <div style={styles.progressTrack}><div style={{ ...styles.progressFill, width: `${pct}%` }} /></div>
          </div>
        )}
        {SHOW_TEST_TOOLS && (
          <div style={styles.testRow}>
            <button type="button" style={styles.testBtn} onClick={handleUploadAll} title="Testing only — fills all uploads with dummy files">
              🧪 Upload all (test)
            </button>
          </div>
        )}
      </div>

      {uncoveredAutoSourced.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Already sourced for you</h3>
          <p style={styles.sectionDesc}>
            We found {uncoveredAutoSourced.length === 1 ? 'this document' : 'these documents'} automatically — no action needed.
          </p>
          {uncoveredAutoSourced.map(d => (
            <div
              key={`${d.type}-${d.label || d.sourceUrl || ''}`}
              style={{ ...styles.docCard, border: `1.5px solid ${C.successBorder}`, background: C.successBg }}
            >
              <div style={styles.docCardHeader}>
                <span style={styles.docTitle}>{d.label || 'Document'}{d.year ? ` (${d.year})` : ''}</span>
                <span style={styles.autoBadge}>Auto-sourced</span>
              </div>
              <AutoSourcedBanner result={d} showUploadHint={false} />
            </div>
          ))}
        </div>
      )}

      {flags.showWolfsberg && (
        <WolfsbergSection
          uploaded={uploads['Wolfsberg CBDDQ']}
          onComplete={handleUpload}
          onRemove={handleRemove}
          autoSourcedResult={getAutoSourcedResult('Wolfsberg CBDDQ', docSearchResults)}
        />
      )}

      {coreItems.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Company documents</h3>
          {coreItems.map(item => (
            <DocumentUploadCard key={item.requirement} item={item} onUpload={handleUpload} onRemove={handleRemove} uploaded={uploads[item.requirement]} autoSourcedResult={getAutoSourcedResult(item.requirement, docSearchResults)} />
          ))}
        </div>
      )}

      {personItems.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Individual verification</h3>
          <p style={styles.sectionDesc}>
            {flags.showUboSection && 'Required for each beneficial owner (25%+ holding). '}
            {flags.showDirectorSection && 'Required for each relevant director. '}
          </p>
          {personItems.map(item => (
            <DocumentUploadCard key={item.requirement} item={item} onUpload={handleUpload} onRemove={handleRemove} uploaded={uploads[item.requirement]} autoSourcedResult={getAutoSourcedResult(item.requirement, docSearchResults)} />
          ))}
        </div>
      )}

      {selfSourced.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Nium will retrieve these for you</h3>
          <p style={styles.sectionDesc}>
            We source these from official registries — no action needed. You can optionally upload any you already have to speed up review.
          </p>
          {selfSourced.map(item => (
            <DocumentUploadCard key={item.requirement} item={item} onUpload={handleUpload} onRemove={handleRemove} uploaded={uploads[item.requirement]} autoSourcedResult={getAutoSourcedResult(item.requirement, docSearchResults)} />
          ))}
        </div>
      )}

      <div style={styles.footer}>
        <p style={styles.footerNote}>
          {allDone
            ? 'All required documents provided — you can continue.'
            : `${requiredTotal - requiredDone} required item${requiredTotal - requiredDone > 1 ? 's' : ''} still needed. You can continue and complete them before declaration.`}
        </p>
        <button style={styles.continueBtn} onClick={handleContinue}>Continue →</button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPersonItem(requirement) {
  return ['UBO', 'Director', 'Signatory', 'signatory'].some(k => requirement.includes(k));
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: 22 },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: C.navy },
  sectionDesc: { fontSize: 13, color: C.navy80, margin: '0 0 4px', lineHeight: 1.5 },

  jurisdictionBanner: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: C.infoBg, border: `1px solid ${C.infoBorder}`, color: C.infoText, fontSize: 13 },

  progressWrap: { marginTop: 10 },
  progressRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 12, fontWeight: 600, color: C.navy },
  progressDone: { fontSize: 11, fontWeight: 700, color: C.successText },
  progressTrack: { height: 6, borderRadius: 3, background: 'rgba(74,158,142,0.15)', overflow: 'hidden' },
  progressFill: { height: '100%', background: `linear-gradient(90deg, ${C.teal}, ${C.navy})`, transition: 'width 0.4s ease' },
  testRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 10 },
  testBtn: { fontSize: 11, fontWeight: 600, color: C.navy70, background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' },

  docCard: { borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  docCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  docTitle: { fontSize: 14, fontWeight: 700, color: C.navy },
  mandatoryBadge: { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', background: C.dangerBg, color: C.dangerText, border: `1px solid ${C.dangerBorder}` },
  optionalBadge: { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', background: C.surface, color: C.navy70, border: `1px solid ${C.border}` },
  autoBadge: { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', background: C.infoBg, color: C.infoText, border: `1px solid ${C.infoBorder}` },
  docWhat: { fontSize: 13, fontWeight: 600, color: C.navy, margin: 0 },
  docHint: { fontSize: 12, color: C.navy80, margin: 0, lineHeight: 1.5 },

  selfSourceNote: { display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 13, color: C.navy80, padding: '8px 12px', borderRadius: 6, background: C.surface, lineHeight: 1.5 },

  autoSourcedBanner: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: C.successBg, border: `1px solid ${C.successBorder}`, borderRadius: 8, marginBottom: 12 },
  autoSourcedIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  autoSourcedTitle: { fontSize: 13, fontWeight: 700, color: C.successText, marginBottom: 2 },
  autoSourcedDesc: { fontSize: 12, color: C.successText, opacity: 0.85, lineHeight: 1.4 },
  autoSourcedHint: { fontSize: 11, color: C.successText, opacity: 0.7, marginTop: 4, fontStyle: 'italic' },
  autoSourcedLink: { color: C.successText, fontWeight: 600, textDecoration: 'underline' },

  uploadLabel: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, border: `1.5px dashed ${C.border}`, borderRadius: 8, padding: '14px 16px', cursor: 'pointer', background: '#fff' },
  uploadHint: { fontSize: 10, color: C.navy70 },

  uploadedState: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: '#fff', borderRadius: 8, border: `1px solid rgba(74,158,142,0.3)` },
  uploadedFile: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  uploadedTick: { color: C.successText, fontWeight: 700, fontSize: 14 },
  uploadedName: { fontSize: 12, fontWeight: 600, color: C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  uploadedSize: { fontSize: 10, color: C.navy70 },
  uploadedActions: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  linkBtn: { fontSize: 12, fontWeight: 600, color: C.teal, cursor: 'pointer' },
  removeBtn: { fontSize: 12, fontWeight: 600, color: C.dangerText, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },

  fallbackToggle: { marginTop: 2 },
  fallbackSummary: { fontSize: 12, cursor: 'pointer', color: C.teal, fontWeight: 600 },
  fallbackText: { fontSize: 12, color: C.navy80, marginTop: 6, lineHeight: 1.5 },
  regLink: { fontSize: 12, color: C.infoText, fontWeight: 600, display: 'inline-block', marginTop: 6 },

  loadingState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 48 },
  spinner: { width: 26, height: 26, borderRadius: '50%', border: `2px solid ${C.border}`, borderTopColor: C.teal, animation: 'drsSpin 0.8s linear infinite' },
  errorState: { padding: 20, color: C.dangerText, fontSize: 14, background: C.dangerBg, border: `1px solid ${C.dangerBorder}`, borderRadius: 8 },

  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 0 0', borderTop: `1px solid ${C.borderSoft}` },
  footerNote: { fontSize: 12, color: C.navy80, margin: 0, flex: 1, lineHeight: 1.5 },
  continueBtn: { padding: '11px 26px', borderRadius: 8, background: C.navy, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'inherit' },
};
