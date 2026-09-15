import { COUNTRIES } from "../constants/appConstants";

export const DEMO_SESSION_CONTRACT = "ubo-demo-browser-session-v1";
export const DEMO_SESSION_KEY = "ubo-demo.case.v1";
export const LAB_REPLAY_KEY = "ubo-control-lab.discovery-replays.v1";

export const CALCULATION_METHODS = Object.freeze([
  { code: "POLICY_ALL_ROUTES", label: "All policy routes", explanation: "Existing combined policy assessment." },
  { code: "EFFECTIVE_INTEREST", label: "Effective ownership — multiply + add", explanation: "Multiply each chain, then add the same person's independent direct and indirect interests." },
  { code: "PSC_CONDITION_ATTRIBUTION", label: "Control attribution", explanation: "Existing supported majority-control/PSC attribution assessment. Not an additive percentage formula." },
]);

export const OWNERSHIP_TYPES = Object.freeze([
  { code: "PRIVATE_LIMITED", label: "Private limited company (Ltd)" },
  { code: "PUBLIC_LIMITED", label: "Public limited company (PLC)" },
  { code: "PUBLICLY_LISTED", label: "Publicly listed company" },
  { code: "LLP", label: "Limited liability partnership (LLP)" },
  { code: "PARTNERSHIP", label: "Partnership / limited partnership" },
  { code: "CHARITY", label: "Charity / charitable organisation" },
  { code: "TRUST", label: "Trust" },
  { code: "CIC", label: "Community interest company (CIC)" },
  { code: "OTHER", label: "Other" },
]);

export function emptyDemoDraft() {
  return {
    legalName: "",
    registrationNumber: "",
    countryCode: "GB",
    ownershipType: "PRIVATE_LIMITED",
    referenceCaseId: "",
    sourceMode: "LIVE",
    replayId: "",
    calculationMethod: "POLICY_ALL_ROUTES",
  };
}

export function countryNameFor(code) {
  return COUNTRIES.find((country) => country.code === code)?.name || code;
}

export function ownershipLabelFor(code) {
  return OWNERSHIP_TYPES.find((type) => type.code === code)?.label || code;
}

export function validateDemoDraft(draft) {
  const errors = {};
  if (!draft.legalName.trim()) errors.legalName = "Enter the registered company name.";
  if (!draft.registrationNumber.trim()) errors.registrationNumber = "Enter the company registration number.";
  if (!COUNTRIES.some(({ code }) => code === draft.countryCode)) errors.countryCode = "Choose a country of registration.";
  if (!OWNERSHIP_TYPES.some(({ code }) => code === draft.ownershipType)) errors.ownershipType = "Choose an ownership type.";
  if (!CALCULATION_METHODS.some(({ code }) => code === draft.calculationMethod)) errors.calculationMethod = "Choose a calculation method.";
  return errors;
}

function newDemoCaseId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) return `demo-${window.crypto.randomUUID()}`;
  return `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDemoCase(draft) {
  return {
    demoCaseId: newDemoCaseId(),
    referenceCaseId: draft.referenceCaseId.trim(),
    company: {
      legalName: draft.legalName.trim(),
      registrationNumber: draft.registrationNumber.trim(),
      countryCode: draft.countryCode,
      countryName: countryNameFor(draft.countryCode),
      ownershipType: draft.ownershipType,
    },
    analysisContext: { calculationMethod: draft.calculationMethod, ...(draft.demoFixtureId ? { demoFixtureId: draft.demoFixtureId } : {}) },
  };
}

export function readDemoSession(storage = window.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(DEMO_SESSION_KEY));
    if (parsed?.contractVersion !== DEMO_SESSION_CONTRACT || !parsed.draft) return null;
    return { draft: { ...emptyDemoDraft(), ...parsed.draft }, demoCase: parsed.demoCase || null, researchResult: parsed.researchResult || null };
  } catch (_) {
    return null;
  }
}

export function writeDemoSession({ draft, demoCase, researchResult }, storage = window.localStorage) {
  storage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: DEMO_SESSION_CONTRACT,
    savedAt: new Date().toISOString(),
    draft,
    demoCase,
    researchResult,
  }));
}

export function readLabReplays(storage = window.localStorage) {
  try {
    const records = JSON.parse(storage.getItem(LAB_REPLAY_KEY) || "[]");
    return Array.isArray(records) ? records : [];
  } catch (_) {
    return [];
  }
}

export function saveLabReplay(record, storage = window.localStorage) {
  if (!record?.replayId) return;
  const records = [record, ...readLabReplays(storage).filter(({ replayId }) => replayId !== record.replayId)].slice(0, 6);
  storage.setItem(LAB_REPLAY_KEY, JSON.stringify(records));
}

export function clearDemoSession(storage = window.localStorage) {
  storage.removeItem(DEMO_SESSION_KEY);
}
