/**
 * components/Step5Recompute.jsx
 *
 * Pre-declaration gap check — Step 5 of the KYC Onboarding Agent.
 *
 * By this point the session has:
 *   - step1Data:  { entityType, ownershipType, incorporationCountry }
 *   - sector:     collected in Steps 3–4 (confirm / fill gaps)
 *   - submitted:  string[] of requirement names already uploaded or self-sourced
 *   - extraFlags: { nestedFlows, fiRole, ... } collected in Steps 3–4
 *
 * This component calls recompute() with the full enriched params, diffs
 * required[] against submitted[], and shows only the true mandatory gaps.
 * Customer cannot proceed to declaration until mandatoryGaps.length === 0.
 */

import { useEffect } from 'react';
import { useDocumentRequirements } from '../hooks/useDocumentRequirements';

export default function Step5Recompute({
  step1Data,
  sector,
  submittedRequirements = [],
  extraFlags = {},
  onGapsClear,
  onRequestDocument,
}) {
  const { incorporationCountry, entityType, ownershipType } = step1Data;

  const { mandatoryGaps, checklist, loading, error, recompute } =
    useDocumentRequirements({ incorporationCountry, entityType, ownershipType });

  // Trigger the enriched recompute on mount — sector + submitted now available
  useEffect(() => {
    recompute({
      sector,
      submittedRequirements,
      ...extraFlags,
    });
    // Mount-once enriched recompute; inputs are snapshotted intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div style={styles.loading}>
        <p>Recalculating requirements with full application data…</p>
      </div>
    );
  }

  if (error) {
    return <div style={styles.error}>Recompute failed: {error}</div>;
  }

  if (mandatoryGaps.length === 0) {
    return (
      <div style={styles.allClear}>
        <div style={styles.allClearIcon}>✓</div>
        <h3 style={styles.allClearTitle}>All required documents received</h3>
        <p style={styles.allClearDesc}>
          {checklist.length} requirements checked · {submittedRequirements.length} items on file
        </p>
        <button style={styles.declareBtn} onClick={onGapsClear}>
          Proceed to declaration →
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.gapsBanner}>
        <strong>{mandatoryGaps.length} required item{mandatoryGaps.length > 1 ? 's' : ''} still needed</strong>
        <span> — these must be provided before you can declare.</span>
      </div>

      <div style={styles.gapsList}>
        {mandatoryGaps.map(item => (
          <div key={item.requirement} style={styles.gapItem}>
            <div style={styles.gapHeader}>
              <span style={styles.gapTitle}>{item.requirement}</span>
              <button
                style={styles.uploadBtn}
                onClick={() => onRequestDocument(item)}
              >
                Provide now
              </button>
            </div>
            <p style={styles.gapDoc}>{item.localEquivalent || item.standardDocument}</p>
            {item.fallback && (
              <details>
                <summary style={styles.fallbackSummary}>Can't provide this?</summary>
                <p style={styles.fallbackText}>{item.fallback}</p>
              </details>
            )}
          </div>
        ))}
      </div>

      <div style={styles.summaryRow}>
        <span style={styles.summaryText}>
          {submittedRequirements.length} of {checklist.filter(i => i.mandatory).length} required items on file
        </span>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: 16 },
  loading: { padding: 24, color: 'var(--color-text-secondary)', fontSize: 14 },
  error:   { padding: 24, color: 'var(--color-text-danger)',    fontSize: 14 },
  gapsBanner: {
    padding: '12px 16px', borderRadius: 8, fontSize: 14,
    background: 'var(--color-background-danger)',
    color: 'var(--color-text-danger)',
    borderLeft: '3px solid var(--color-border-danger)',
  },
  gapsList: { display: 'flex', flexDirection: 'column', gap: 10 },
  gapItem: {
    padding: 14,
    border: '1px solid var(--color-border-tertiary)',
    borderRadius: 8,
    background: 'var(--color-background-primary)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  gapHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  gapTitle:  { fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' },
  gapDoc:    { fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 },
  uploadBtn: {
    fontSize: 13, padding: '6px 14px', borderRadius: 6,
    background: 'var(--color-background-info)',
    color: 'var(--color-text-info)',
    border: '1px solid var(--color-border-info)',
    cursor: 'pointer',
  },
  fallbackSummary: { fontSize: 12, cursor: 'pointer', color: 'var(--color-text-secondary)' },
  fallbackText:    { fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 },
  summaryRow: { padding: '8px 0', borderTop: '1px solid var(--color-border-tertiary)' },
  summaryText: { fontSize: 13, color: 'var(--color-text-secondary)' },
  allClear: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: 40, gap: 12, textAlign: 'center',
  },
  allClearIcon: {
    width: 48, height: 48, borderRadius: '50%',
    background: 'var(--color-background-success)',
    color: 'var(--color-text-success)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, fontWeight: 500,
  },
  allClearTitle: { fontSize: 18, fontWeight: 500, margin: 0, color: 'var(--color-text-primary)' },
  allClearDesc:  { fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 },
  declareBtn: {
    marginTop: 8, padding: '11px 28px', borderRadius: 8,
    background: '#1a1a2e', color: '#fff',
    border: 'none', cursor: 'pointer',
    fontSize: 14, fontWeight: 500,
  },
};
