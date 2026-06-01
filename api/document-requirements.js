/**
 * api/document-requirements.js
 * Vercel serverless route — DRS endpoint
 *
 * POST /api/document-requirements
 * Body: { incorporationCountry, entityType, ownershipType, sector? }
 *
 * Returns: { onboardingCountry, checklist[], rfiItems[], selfSourceItems[], mandatoryCount }
 *
 * Called twice per session:
 *   1. After Step 1 (sector may be absent)
 *   2. Pre-declaration recompute (sector + nestedFlows + any EDD flags now known)
 */

const {
  getRequirements,
  getMandatoryGaps,
  deriveOnboardingCountry,
} = require('../documentRequirements.js');

module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    incorporationCountry,
    entityType,
    ownershipType,
    sector,
    // Recompute-only fields (optional at Step 1)
    submittedRequirements = [],
    nestedFlows,
    fiRole,
  } = req.body;

  if (!incorporationCountry || !entityType || !ownershipType) {
    return res.status(400).json({
      error: 'incorporationCountry, entityType and ownershipType are required',
    });
  }

  try {
    const onboardingCountry = deriveOnboardingCountry(incorporationCountry);

    const checklist = getRequirements({
      incorporationCountry,
      onboardingCountry,
      entityType,
      ownershipType,
      sector,
    });

    const rfiItems        = checklist.filter(i => i.rfi === 'Required from client');
    const selfSourceItems = checklist.filter(i => i.selfSource === 'Preferred self-source');
    const mandatoryGaps   = submittedRequirements.length > 0
      ? getMandatoryGaps(
          { incorporationCountry, onboardingCountry, entityType, ownershipType, sector },
          submittedRequirements
        )
      : checklist.filter(i => i.mandatory);

    // Derive feature flags consumed by the frontend to shape Step 2
    const flags = deriveStepFlags(checklist, entityType, sector);

    return res.status(200).json({
      onboardingCountry,
      checklist,
      rfiItems,
      selfSourceItems,
      mandatoryCount:    mandatoryGaps.length,
      mandatoryGaps,
      flags,
    });
  } catch (err) {
    console.error('[DRS] Error:', err);
    return res.status(500).json({ error: 'Document requirements lookup failed', detail: err.message });
  }
}

/**
 * Derives boolean flags used by the Step 2 renderer to show/hide sections.
 * Add flags here as the form evolves — keeps the frontend declarative.
 */
function deriveStepFlags(checklist, entityType, sector) {
  const requirements = checklist.map(i => i.requirement);
  const isFI = entityType === 'Financial Institution'
    || (sector && (sector.startsWith('Financial Institution') || sector === 'Bank / deposit-taking institution'));

  return {
    showWolfsberg:       isFI,
    showUboSection:      requirements.includes('UBO ID'),
    showDirectorSection: requirements.includes('Director ID'),
    showSignatoryAddress:requirements.includes('Signatory proof of address'),
    showUkSignatory:     requirements.includes('UK signatory authority evidence'),
    showIndonesiaOverlay:requirements.some(r => r.includes('Indonesia')),
    showRegulatoryStatus:requirements.includes('Regulatory status'),
    showFinancials:      requirements.includes('Financial statements'),
    isFI,
  };
}
