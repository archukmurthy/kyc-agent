import { COUNTRIES } from "../constants/appConstants";

export const DEMO_SESSION_CONTRACT = "ubo-demo-browser-session-v1";
export const DEMO_SESSION_KEY = "ubo-demo.case.v1";
export const LAB_REPLAY_KEY = "ubo-control-lab.discovery-replays.v1";
export const REPLAY_LIBRARY_EXPORT_CONTRACT = "ubo-demo-replay-library-export-v1";
export const MAX_SAVED_REPLAYS = 6;
const CALCULATION_DEFAULT_VERSION = 2;

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
    calculationMethod: "EFFECTIVE_INTEREST",
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
    analysisContext: {
      calculationMethod: draft.calculationMethod,
      sourceMode: draft.sourceMode,
      ...(draft.replayId ? { replayId: draft.replayId } : {}),
      ...(draft.replaySavedAt ? { replaySavedAt: draft.replaySavedAt } : {}),
      ...(draft.demoFixtureId ? { demoFixtureId: draft.demoFixtureId } : {}),
    },
  };
}

function normalized(value) { return String(value || "").trim().toUpperCase(); }

export function replaySubject(record) {
  if (!record?.replayId) throw new TypeError("The selected saved research record has no stable record ID.");
  const context = record.companyContext;
  if (!context?.legalEntityName || !context?.registrationNumber || !context?.jurisdiction) {
    throw new TypeError("The selected saved research record does not contain a complete researched-company identity.");
  }
  if (!record.subject?.entityId) throw new TypeError("The selected saved research record does not contain its captured subject identity.");
  const registrationNumber = String(context.registrationNumber).trim();
  const registrations = (record.subject.externalIdentifiers || [])
    .filter(({ namespace, system, identifierType }) => /COMPANIES_HOUSE|COMPANY_NUMBER|COMPANY_REGISTER/i.test(namespace || system || identifierType || ""))
    .map(({ value }) => normalized(value));
  if (registrations.length && !registrations.includes(normalized(registrationNumber))) {
    throw new TypeError("The selected saved research subject does not match its captured registration number.");
  }
  return {
    legalName: String(context.legalEntityName).trim(),
    registrationNumber,
    countryCode: String(context.jurisdiction).trim().toUpperCase(),
    savedAt: record.savedAt || null,
    replayId: record.replayId,
  };
}

export function bindDraftToReplay(draft, record) {
  const subject = replaySubject(record);
  return {
    ...draft,
    legalName: subject.legalName,
    registrationNumber: subject.registrationNumber,
    countryCode: subject.countryCode,
    sourceMode: "REPLAY",
    replayId: subject.replayId,
    replaySavedAt: subject.savedAt,
    demoFixtureId: "",
  };
}

export function findReplayById(records, replayId) {
  return (records || []).find((record) => record?.replayId === replayId) || null;
}

function replaySavedLabel(savedAt) {
  if (!savedAt || Number.isNaN(Date.parse(savedAt))) return "save time unavailable";
  return `saved ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(savedAt))} UTC`;
}

export function replayOptionLabel(record, duplicateNameCount = 1) {
  try {
    const subject = replaySubject(record);
    const suffix = duplicateNameCount > 1 ? ` · ${String(record.replayId).slice(-8)}` : "";
    return `${subject.legalName} · ${subject.registrationNumber} · ${replaySavedLabel(subject.savedAt)}${suffix}`;
  } catch (_) {
    return `Unavailable saved capture · ${String(record?.replayId || "missing ID").slice(-8)}`;
  }
}

export function readDemoSession(storage = window.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(DEMO_SESSION_KEY));
    if (parsed?.contractVersion !== DEMO_SESSION_CONTRACT || !parsed.draft) return null;
    const migrateOldCombinedDefault = parsed.calculationDefaultVersion !== CALCULATION_DEFAULT_VERSION && parsed.draft.calculationMethod === "POLICY_ALL_ROUTES";
    const calculationMethod = migrateOldCombinedDefault ? "EFFECTIVE_INTEREST" : parsed.draft.calculationMethod;
    const withMigratedMethod = (value) => migrateOldCombinedDefault && value
      ? { ...value, analysisContext: { ...(value.analysisContext || {}), calculationMethod: "EFFECTIVE_INTEREST" } }
      : value || null;
    return {
      draft: { ...emptyDemoDraft(), ...parsed.draft, ...(calculationMethod ? { calculationMethod } : {}) },
      demoCase: withMigratedMethod(parsed.demoCase),
      researchResult: withMigratedMethod(parsed.researchResult),
    };
  } catch (_) {
    return null;
  }
}

export function writeDemoSession({ draft, demoCase, researchResult }, storage = window.localStorage) {
  storage.setItem(DEMO_SESSION_KEY, JSON.stringify({
    contractVersion: DEMO_SESSION_CONTRACT,
    calculationDefaultVersion: CALCULATION_DEFAULT_VERSION,
    savedAt: new Date().toISOString(),
    draft,
    demoCase,
    researchResult,
  }));
}

export function validLabReplay(record) {
  return Boolean(record && typeof record === "object"
    && record.contractVersion === "ubo-control-lab-discovery-replay-v1"
    && typeof record.replayId === "string" && record.replayId
    && typeof record.savedAt === "string" && !Number.isNaN(Date.parse(record.savedAt))
    && typeof record.companyContext?.legalEntityName === "string" && record.companyContext.legalEntityName.trim()
    && typeof record.companyContext?.registrationNumber === "string" && record.companyContext.registrationNumber.trim()
    && record.subject && typeof record.subject === "object"
    && record.discoveryResult && typeof record.discoveryResult === "object"
    && Array.isArray(record.discoveryResult.candidateFacts));
}

export function mergeLabReplays(...collections) {
  const byId = new Map();
  collections.flat().filter((record) => record && typeof record === "object" && typeof record.replayId === "string" && record.replayId).forEach((record) => {
    const existing = byId.get(record.replayId);
    const recordTime = Date.parse(record.savedAt || "");
    const existingTime = Date.parse(existing?.savedAt || "");
    if (!existing || (!Number.isNaN(recordTime) && (Number.isNaN(existingTime) || recordTime >= existingTime))) byId.set(record.replayId, record);
  });
  return [...byId.values()].sort((left, right) => {
    const leftTime = Date.parse(left.savedAt || "");
    const rightTime = Date.parse(right.savedAt || "");
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime;
  }).slice(0, MAX_SAVED_REPLAYS);
}

function replayCompanyKey(record) {
  return [record?.companyContext?.jurisdiction, record?.companyContext?.registrationNumber]
    .map(normalized)
    .join(":");
}

export function pruneSupersededEmptyLabReplays(records) {
  const merged = mergeLabReplays(records);
  const newestUsableByCompany = new Map();
  merged.filter((record) => record.discoveryResult.candidateFacts.length > 0).forEach((record) => {
    const key = replayCompanyKey(record);
    const savedAt = Date.parse(record.savedAt);
    if (!newestUsableByCompany.has(key) || savedAt > newestUsableByCompany.get(key)) newestUsableByCompany.set(key, savedAt);
  });
  return merged.filter((record) => {
    if (record.discoveryResult.candidateFacts.length > 0) return true;
    const usableSavedAt = newestUsableByCompany.get(replayCompanyKey(record));
    return usableSavedAt === undefined || Date.parse(record.savedAt) >= usableSavedAt;
  });
}

export function readLabReplays(storage = window.localStorage) {
  try {
    const records = JSON.parse(storage.getItem(LAB_REPLAY_KEY) || "[]");
    if (!Array.isArray(records)) return [];
    const merged = mergeLabReplays(records);
    const cleaned = pruneSupersededEmptyLabReplays(merged);
    if (cleaned.length !== merged.length) storage.setItem(LAB_REPLAY_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch (_) {
    return [];
  }
}

export function saveLabReplay(record, storage = window.localStorage) {
  if (!validLabReplay(record)) throw new TypeError("The Discovery replay record is invalid and was not saved.");
  const records = pruneSupersededEmptyLabReplays(mergeLabReplays([record], readLabReplays(storage)));
  storage.setItem(LAB_REPLAY_KEY, JSON.stringify(records));
  return records;
}

export function availableLabReplays(researchResult, storage = window.localStorage) {
  return pruneSupersededEmptyLabReplays(mergeLabReplays(readLabReplays(storage), researchResult?.replayCapture ? [researchResult.replayCapture] : []));
}

export function serializeReplayLibrary(records, now = () => new Date().toISOString()) {
  const validated = mergeLabReplays(records);
  if (validated.length !== records.length || validated.some((record) => !validLabReplay(record))) throw new TypeError("The replay library contains an invalid or duplicate capture.");
  return JSON.stringify({ contractVersion: REPLAY_LIBRARY_EXPORT_CONTRACT, exportedAt: now(), records: validated }, null, 2);
}

export function importReplayLibrary(serialized, storage = window.localStorage) {
  let parsed;
  try { parsed = JSON.parse(serialized); } catch (_) { throw new TypeError("Choose a valid UBO demo replay-library JSON file."); }
  if (parsed?.contractVersion !== REPLAY_LIBRARY_EXPORT_CONTRACT || !Array.isArray(parsed.records)
    || parsed.records.some((record) => !validLabReplay(record))) {
    throw new TypeError("This file is not a valid UBO demo replay library.");
  }
  const records = pruneSupersededEmptyLabReplays(mergeLabReplays(parsed.records, readLabReplays(storage)));
  storage.setItem(LAB_REPLAY_KEY, JSON.stringify(records));
  return records;
}

export function clearDemoSession(storage = window.localStorage) {
  storage.removeItem(DEMO_SESSION_KEY);
}
