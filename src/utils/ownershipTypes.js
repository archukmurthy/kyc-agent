/* eslint-env node */
// Ownership-type library + research-strategy definitions.
//
// Single source of truth for the customer flow (src/App.js) and the admin
// (src/admin/steps/StepEntityTypes.jsx, src/admin/defaultConfig.js). Defined
// once here and imported wherever needed so the 21-item list never drifts
// between the two surfaces.
//
// Each ownership type maps to a `researchStrategy` key in RESEARCH_STRATEGIES,
// which Phase 0 of the research pipeline uses to set search flags and tune the
// expected/low-data fill-rate thresholds.
//
// NOTE: written as CommonJS (module.exports) rather than ESM so it can be
// require()'d from Node (api/benchmark.js -> src/pipeline.js) as well as
// imported by webpack (App.js / admin). Webpack maps the named imports onto
// module.exports via its CJS interop, so the existing `import { X }` consumers
// keep working unchanged.

const OWNERSHIP_TYPE_LIBRARY = [
  { id: "private_limited", label: "Private Limited Company", aliases: ["Ltd", "Pte Ltd", "GmbH", "SARL", "Sdn Bhd"], researchStrategy: "private" },
  { id: "public_listed", label: "Public Listed Company", aliases: ["PLC", "AG", "SA", "Corp"], researchStrategy: "listed" },
  { id: "public_unlisted", label: "Public Unlisted Company", aliases: [], researchStrategy: "private" },
  { id: "llp", label: "Limited Liability Partnership (LLP)", aliases: ["LLP"], researchStrategy: "private" },
  { id: "general_partnership", label: "General Partnership", aliases: [], researchStrategy: "private" },
  { id: "sole_trader", label: "Sole Trader / Sole Proprietorship", aliases: [], researchStrategy: "private" },
  { id: "trust", label: "Trust", aliases: ["Discretionary Trust", "Unit Trust"], researchStrategy: "private" },
  { id: "charity", label: "Charity / Non-Profit Organisation", aliases: ["NGO", "Not-for-profit"], researchStrategy: "charity" },
  { id: "foundation", label: "Foundation", aliases: [], researchStrategy: "private" },
  { id: "government", label: "Government / State-Owned Entity", aliases: ["SOE", "Statutory Body"], researchStrategy: "government" },
  { id: "cooperative", label: "Cooperative / Mutual", aliases: ["Co-op", "Building Society"], researchStrategy: "private" },
  { id: "branch", label: "Branch of Foreign Company", aliases: [], researchStrategy: "branch" },
  { id: "spv", label: "Special Purpose Vehicle (SPV)", aliases: [], researchStrategy: "private" },
  { id: "holding_company", label: "Holding Company", aliases: [], researchStrategy: "private" },
  { id: "joint_venture", label: "Joint Venture", aliases: ["JV"], researchStrategy: "private" },
  { id: "correspondent_bank", label: "Correspondent Bank", aliases: [], researchStrategy: "listed" },
  { id: "payment_institution", label: "Payment Institution / EMI", aliases: ["PI", "EMI", "MSB"], researchStrategy: "regulated" },
  { id: "investment_fund", label: "Investment Fund / Fund Manager", aliases: ["Hedge Fund", "PE Fund"], researchStrategy: "regulated" },
  { id: "insurance_company", label: "Insurance Company", aliases: [], researchStrategy: "regulated" },
  { id: "central_bank", label: "Central Bank", aliases: [], researchStrategy: "government" },
  { id: "other", label: "Other", aliases: [], researchStrategy: "private" },
];

// Research strategy definitions. Used in Phase 0 to set research flags and to
// calibrate the low-data banner threshold per ownership type.
const RESEARCH_STRATEGIES = {
  listed: {
    useStockExchangeQueries: true,
    useInvestorRelations: true,
    useCorporateWebsite: true,
    useRegulatoryRegistry: true,
    useCharityRegistry: false,
    expectedFillRate: 0.65,
    lowDataThreshold: 0.40,
  },
  private: {
    useStockExchangeQueries: false,
    useInvestorRelations: false,
    useCorporateWebsite: true,
    useRegulatoryRegistry: true,
    useCharityRegistry: false,
    expectedFillRate: 0.35,
    lowDataThreshold: 0.25,
  },
  regulated: {
    useStockExchangeQueries: false,
    useInvestorRelations: false,
    useCorporateWebsite: true,
    useRegulatoryRegistry: true,
    useCharityRegistry: false,
    expectedFillRate: 0.50,
    lowDataThreshold: 0.30,
  },
  government: {
    useStockExchangeQueries: false,
    useInvestorRelations: false,
    useCorporateWebsite: true,
    useRegulatoryRegistry: true,
    useCharityRegistry: false,
    expectedFillRate: 0.40,
    lowDataThreshold: 0.25,
  },
  charity: {
    useStockExchangeQueries: false,
    useInvestorRelations: false,
    useCorporateWebsite: true,
    useRegulatoryRegistry: true,
    useCharityRegistry: true,
    expectedFillRate: 0.35,
    lowDataThreshold: 0.20,
  },
  branch: {
    useStockExchangeQueries: false,
    useInvestorRelations: false,
    useCorporateWebsite: true,
    useRegulatoryRegistry: true,
    useCharityRegistry: false,
    expectedFillRate: 0.30,
    lowDataThreshold: 0.20,
    searchParentCompanyToo: true,
  },
};

function getResearchStrategy(ownershipTypeId) {
  const ownershipType = OWNERSHIP_TYPE_LIBRARY.find((o) => o.id === ownershipTypeId);
  const strategyKey = ownershipType?.researchStrategy || "private";
  return RESEARCH_STRATEGIES[strategyKey] || RESEARCH_STRATEGIES.private;
}

// The Demo default enabled ownership types — used as the fallback when an
// entity type in the live config has no explicit `ownershipTypes` array.
const DEFAULT_OWNERSHIP_TYPES = [
  "private_limited",
  "public_listed",
  "trust",
  "charity",
  "sole_trader",
  "llp",
  "general_partnership",
  "other",
];

// Convenience: label lookup.
function ownershipTypeLabel(id) {
  return OWNERSHIP_TYPE_LIBRARY.find((o) => o.id === id)?.label || id || "";
}

module.exports = {
  OWNERSHIP_TYPE_LIBRARY,
  RESEARCH_STRATEGIES,
  getResearchStrategy,
  DEFAULT_OWNERSHIP_TYPES,
  ownershipTypeLabel,
};
