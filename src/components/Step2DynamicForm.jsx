/**
 * components/Step2DynamicForm.jsx
 *
 * Step 2 of the KYC Onboarding Agent — dynamically shaped by the DRS checklist.
 *
 * Props:
 *   step1Data        — { companyName, entityType, ownershipType, incorporationCountry }
 *   onComplete(data) — called when customer advances; data includes submittedRequirements[]
 *
 * What this replaces:
 *   The previous hardcoded document list per entity type.
 *   Now every section, upload card, and conditional questionnaire (Wolfsberg etc.)
 *   is derived from the live DRS checklist at runtime.
 */

import { useState } from 'react';
import { useDocumentRequirements } from '../hooks/useDocumentRequirements';

// ─── Section renderers ───────────────────────────────────────────────────────

function DocumentUploadCard({ item, onUpload, uploaded }) {
  return (
    <div style={styles.docCard}>
      <div style={styles.docCardHeader}>
        <span style={styles.docTitle}>{item.requirement}</span>
        {item.mandatory && <span style={styles.mandatoryBadge}>Required</span>}
        {!item.mandatory && <span style={styles.optionalBadge}>Optional</span>}
      </div>

      <p style={styles.docWhy}>{item.localEquivalent || item.standardDocument}</p>
      <p style={styles.docHint}>{item.why}</p>

      {item.selfSource === 'Preferred self-source' ? (
        <div style={styles.selfSourceNote}>
          <span>🔍</span>
          <span>Nium will retrieve this automatically — no upload needed</span>
        </div>
      ) : (
        <div style={styles.uploadArea}>
          {uploaded ? (
            <div style={styles.uploadedState}>
              <span>✓</span>
              <span>{uploaded.name}</span>
            </div>
          ) : (
            <label style={styles.uploadLabel}>
              <input
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => onUpload(item.requirement, e.target.files[0])}
                accept=".pdf,.jpg,.jpeg,.png"
              />
              <span>Upload document</span>
            </label>
          )}
        </div>
      )}

      {item.fallback && (
        <details style={styles.fallbackToggle}>
          <summary style={styles.fallbackSummary}>Can't provide this?</summary>
          <p style={styles.fallbackText}>{item.fallback}</p>
        </details>
      )}
    </div>
  );
}

function WolfsbergSection({ onComplete }) {
  // Wolfsberg CBDDQ — shown only when flags.showWolfsberg === true
  // In production: render the actual Wolfsberg questionnaire fields
  // For now: upload card for the completed CBDDQ PDF
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Wolfsberg CBDDQ</h3>
      <p style={styles.sectionDesc}>
        As a Financial Institution, Nium requires a completed Correspondent Banking
        Due Diligence Questionnaire (CBDDQ). You may upload your most recent completed
        version or complete one now at wolfsberg-group.com.
      </p>
      <div style={styles.docCard}>
        <div style={styles.docCardHeader}>
          <span style={styles.docTitle}>Wolfsberg CBDDQ</span>
          <span style={styles.mandatoryBadge}>Required</span>
        </div>
        <div style={styles.uploadArea}>
          <label style={styles.uploadLabel}>
            <input
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => onComplete('Wolfsberg CBDDQ', e.target.files[0])}
              accept=".pdf"
            />
            <span>Upload completed CBDDQ</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={styles.loadingState}>
      <div style={styles.spinner} />
      <p style={{ color: 'var(--color-text-secondary)', marginTop: 12 }}>
        Determining document requirements…
      </p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Step2DynamicForm({ step1Data, onComplete }) {
  const { companyName, entityType, ownershipType, incorporationCountry } = step1Data;

  const { checklist, rfiItems, selfSourceItems, flags, onboardingCountry, loading, error } =
    useDocumentRequirements({ incorporationCountry, entityType, ownershipType });

  // Track what has been uploaded this session
  const [uploads, setUploads] = useState({});

  const handleUpload = (requirementKey, file) => {
    setUploads(prev => ({ ...prev, [requirementKey]: file }));
  };

  // Group RFI items into logical sections
  const coreItems     = rfiItems.filter(i => !isPersonItem(i.requirement));
  const personItems   = rfiItems.filter(i => isPersonItem(i.requirement));

  const handleContinue = () => {
    const submittedRequirements = [
      ...Object.keys(uploads),
      // Self-source items are considered "submitted" — Nium will retrieve them
      ...selfSourceItems.map(i => i.requirement),
    ];
    onComplete({ uploads, submittedRequirements, checklist, flags });
  };

  const mandatoryUploaded = rfiItems
    .filter(i => i.mandatory && i.selfSource !== 'Preferred self-source')
    .every(i => uploads[i.requirement]);

  if (loading) return <LoadingState />;

  if (error) return (
    <div style={styles.errorState}>
      <p>Could not load document requirements: {error}</p>
    </div>
  );

  return (
    <div style={styles.container}>
      {/* Jurisdiction banner */}
      {onboardingCountry && (
        <div style={styles.jurisdictionBanner}>
          <span>📋</span>
          <span>
            Requirements for <strong>{companyName}</strong> — onboarding via{' '}
            <strong>Nium {onboardingCountry}</strong>
          </span>
        </div>
      )}

      {/* Self-source notice */}
      {selfSourceItems.length > 0 && (
        <div style={styles.selfSourceBanner}>
          <strong>Nium will retrieve automatically:</strong>{' '}
          {selfSourceItems.map(i => i.requirement).join(' · ')}
        </div>
      )}

      {/* Wolfsberg — FI only */}
      {flags.showWolfsberg && (
        <WolfsbergSection onComplete={handleUpload} />
      )}

      {/* Core company documents */}
      {coreItems.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Company documents</h3>
          {coreItems.map(item => (
            <DocumentUploadCard
              key={item.requirement}
              item={item}
              onUpload={handleUpload}
              uploaded={uploads[item.requirement]}
            />
          ))}
        </div>
      )}

      {/* Person-level documents (UBO, Director, Signatory) */}
      {personItems.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Individual verification</h3>
          <p style={styles.sectionDesc}>
            {flags.showUboSection && 'Required for each beneficial owner (25%+ threshold). '}
            {flags.showDirectorSection && 'Required for each relevant director. '}
          </p>
          {personItems.map(item => (
            <DocumentUploadCard
              key={item.requirement}
              item={item}
              onUpload={handleUpload}
              uploaded={uploads[item.requirement]}
            />
          ))}
        </div>
      )}

      {/* Continue */}
      <div style={styles.footer}>
        <p style={styles.footerNote}>
          {mandatoryUploaded
            ? 'All required documents provided — you can continue.'
            : `You can continue with missing documents and complete them later, but all required items must be provided before declaration.`}
        </p>
        <button style={styles.continueBtn} onClick={handleContinue}>
          Continue →
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPersonItem(requirement) {
  const personKeys = ['UBO', 'Director', 'Signatory', 'signatory'];
  return personKeys.some(k => requirement.includes(k));
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: 24 },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 500, margin: '0 0 4px', color: 'var(--color-text-primary)' },
  sectionDesc: { fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 8px' },
  jurisdictionBanner: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', borderRadius: 8,
    background: 'var(--color-background-info)',
    color: 'var(--color-text-info)', fontSize: 14,
  },
  selfSourceBanner: {
    padding: '10px 14px', borderRadius: 8, fontSize: 13,
    background: 'var(--color-background-secondary)',
    color: 'var(--color-text-secondary)',
    borderLeft: '3px solid var(--color-border-secondary)',
  },
  docCard: {
    border: '1px solid var(--color-border-tertiary)',
    borderRadius: 8, padding: 16,
    display: 'flex', flexDirection: 'column', gap: 8,
    background: 'var(--color-background-primary)',
  },
  docCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  docTitle: { fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' },
  mandatoryBadge: {
    fontSize: 11, padding: '2px 8px', borderRadius: 12,
    background: 'var(--color-background-danger)',
    color: 'var(--color-text-danger)',
  },
  optionalBadge: {
    fontSize: 11, padding: '2px 8px', borderRadius: 12,
    background: 'var(--color-background-secondary)',
    color: 'var(--color-text-secondary)',
  },
  docWhy: { fontSize: 13, color: 'var(--color-text-primary)', margin: 0 },
  docHint: { fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 },
  selfSourceNote: {
    display: 'flex', gap: 6, alignItems: 'center',
    fontSize: 13, color: 'var(--color-text-secondary)',
    padding: '6px 10px', borderRadius: 6,
    background: 'var(--color-background-secondary)',
  },
  uploadArea: {
    border: '1px dashed var(--color-border-secondary)',
    borderRadius: 6, padding: '12px 16px',
    display: 'flex', justifyContent: 'center',
  },
  uploadLabel: {
    fontSize: 13, cursor: 'pointer',
    color: 'var(--color-text-info)',
  },
  uploadedState: {
    display: 'flex', gap: 8, alignItems: 'center',
    fontSize: 13, color: 'var(--color-text-success)',
  },
  fallbackToggle: { marginTop: 4 },
  fallbackSummary: { fontSize: 12, cursor: 'pointer', color: 'var(--color-text-secondary)' },
  fallbackText: { fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 },
  loadingState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: 48,
  },
  spinner: {
    width: 24, height: 24, borderRadius: '50%',
    border: '2px solid var(--color-border-secondary)',
    borderTopColor: 'var(--color-text-info)',
    animation: 'spin 0.8s linear infinite',
  },
  errorState: { padding: 24, color: 'var(--color-text-danger)', fontSize: 14 },
  footer: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 16,
    padding: '16px 0', borderTop: '1px solid var(--color-border-tertiary)',
  },
  footerNote: { fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, flex: 1 },
  continueBtn: {
    padding: '10px 24px', borderRadius: 8,
    background: '#1a1a2e', color: '#fff',
    border: 'none', cursor: 'pointer',
    fontSize: 14, fontWeight: 500,
    whiteSpace: 'nowrap',
  },
};
