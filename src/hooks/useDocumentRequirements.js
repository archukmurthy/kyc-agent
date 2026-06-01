/**
 * hooks/useDocumentRequirements.js
 *
 * React hook — calls the DRS API and returns the checklist + feature flags.
 * Drop-in for the KYC Onboarding Agent.
 *
 * Usage (Step 1 → Step 2 transition):
 *
 *   const { checklist, flags, loading, error, recompute } = useDocumentRequirements({
 *     incorporationCountry: 'United Kingdom',
 *     entityType:           'Financial Institution',
 *     ownershipType:        'Public Listed Company',
 *   });
 *
 * Usage (pre-declaration recompute at Step 5):
 *
 *   recompute({ sector: 'Crypto / VASP / digital assets', submittedRequirements: [...] });
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const DRS_ENDPOINT = '/api/document-requirements';

/**
 * @typedef {object} DRSParams
 * @property {string}   incorporationCountry
 * @property {string}   entityType
 * @property {string}   ownershipType
 * @property {string}   [sector]
 * @property {string[]} [submittedRequirements]  — for recompute pass
 */

/**
 * @typedef {object} ChecklistItem
 * @property {string}  requirement
 * @property {string}  standardDocument
 * @property {string}  localEquivalent
 * @property {string}  why
 * @property {string}  analystStep
 * @property {string}  fallback
 * @property {string}  selfSource
 * @property {string}  rfi
 * @property {boolean} mandatory
 * @property {string}  regulatoryRationale
 * @property {string}  regulatoryUrl
 * @property {string}  sourceUrl
 */

/**
 * @typedef {object} DRSResult
 * @property {string}          onboardingCountry
 * @property {ChecklistItem[]} checklist
 * @property {ChecklistItem[]} rfiItems           — items the customer must provide
 * @property {ChecklistItem[]} selfSourceItems     — items Nium will pull
 * @property {ChecklistItem[]} mandatoryGaps       — mandatory items not yet submitted
 * @property {number}          mandatoryCount
 * @property {object}          flags               — feature flags for Step 2 renderer
 * @property {boolean}         loading
 * @property {string|null}     error
 * @property {function}        recompute           — call with updated params to refresh
 */

export function useDocumentRequirements(initialParams) {
  const [result, setResult] = useState({
    onboardingCountry: null,
    checklist:         [],
    rfiItems:          [],
    selfSourceItems:   [],
    mandatoryGaps:     [],
    mandatoryCount:    0,
    flags:             {},
    loading:           false,
    error:             null,
  });

  // Track latest params so recompute() can merge updates
  const paramsRef = useRef(initialParams);

  const fetchRequirements = useCallback(async (params) => {
    if (!params?.incorporationCountry || !params?.entityType || !params?.ownershipType) return;

    setResult(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch(DRS_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error || `DRS returned ${response.status}`);
      }

      const data = await response.json();
      setResult({
        onboardingCountry: data.onboardingCountry,
        checklist:         data.checklist,
        rfiItems:          data.rfiItems,
        selfSourceItems:   data.selfSourceItems,
        mandatoryGaps:     data.mandatoryGaps,
        mandatoryCount:    data.mandatoryCount,
        flags:             data.flags,
        loading:           false,
        error:             null,
      });
    } catch (err) {
      setResult(prev => ({ ...prev, loading: false, error: err.message }));
    }
  }, []);

  // Initial call when Step 1 classifiers are ready
  useEffect(() => {
    if (initialParams?.incorporationCountry) {
      paramsRef.current = initialParams;
      fetchRequirements(initialParams);
    }
    // Re-fires only when the three classifiers change; fetchRequirements is
    // stable (useCallback) and initialParams is read via the keyed fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialParams?.incorporationCountry,
    initialParams?.entityType,
    initialParams?.ownershipType,
    // sector intentionally omitted — Step 1 call is sector-agnostic
  ]);

  /**
   * Recompute — call at pre-declaration with updated params merged over initial.
   * Typically: { sector, submittedRequirements: [...] }
   */
  const recompute = useCallback((updates = {}) => {
    const merged = { ...paramsRef.current, ...updates };
    paramsRef.current = merged;
    fetchRequirements(merged);
  }, [fetchRequirements]);

  return { ...result, recompute };
}
