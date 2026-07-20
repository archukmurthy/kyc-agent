export const LOADER_MSGS = [
  "Searching company registries...",
  "Checking regulatory databases...",
  "Extracting director information...",
  "Analysing ownership structure...",
  "Compiling financial data...",
  "Identifying jurisdiction-specific gaps...",
  "Building onboarding form...",
  "Almost done, compiling results...",
];

// Two-phase loader messages for the AI + Documents journey.
// Phase 1 messages are generated dynamically in doResearch from the
// uploadedDocs map; this list is the fallback when nothing was uploaded.
export const LOADER_MSGS_WOLFSBERG_PHASE1 = [
  "Reading your documents...",
];
export const LOADER_MSGS_WOLFSBERG_PHASE2 = [
  "Searching official registries…",
  "Checking regulatory databases…",
  "Scanning secondary sources…",
  "Almost done, compiling results…",
];

// Documents-step loading messages — cycled every 8s while the doc-search and
// registry agents run, so the ~30-40s wait has live feedback.
export const DOC_LOADER_MSGS = [
  "Searching for Wolfsberg Questionnaire and Annual Report...",
  "Checking Companies House registry...",
  "Extracting company details...",
  "Almost done — compiling results...",
];
