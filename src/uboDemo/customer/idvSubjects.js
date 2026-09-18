import { currentVerificationPopulation, isReadyForIdentityVerification } from "./verificationAssessment";

function normalized(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }

export function idvSubjectsFromTrace(trace) {
  const canonical = currentVerificationPopulation(trace);
  if (canonical.length) return canonical.map((item) => ({
    ...item,
    bases: item.reasons?.map(({ code }) => code) || [],
    reason: item.reasons?.[0]?.detail || "Identity verification required",
  }));
  const candidates = [
    ...(trace?.uboAssessments || []).map((item) => ({ ...item, reason: item.bases?.join(", ") || "Beneficial owner" })),
    ...(trace?.fallback?.people || []).map((item) => ({ ...item, idvRequired: item.cddIdentityVerificationRequired === true, reason: "Senior managing official fallback" })),
  ];
  const people = new Map();
  candidates.forEach((item) => {
    if (item.partyType !== "NATURAL_PERSON" || item.idvRequired !== true) return;
    const key = normalized(item.personId || item.personName);
    if (!key) return;
    const existing = people.get(key);
    if (existing) {
      existing.bases = [...new Set([...(existing.bases || []), ...(item.bases || [])])];
      return;
    }
    people.set(key, {
      personId: item.personId || key,
      personName: item.personName,
      partyType: "NATURAL_PERSON",
      bases: [...new Set(item.bases || [])],
      reason: item.reason,
    });
  });
  return [...people.values()];
}

export function traceReadyForIdv(trace) {
  if (trace?.verificationAssessment) return isReadyForIdentityVerification(trace);
  if (!trace || trace.ownershipResolution?.status !== "COMPLETE") return false;
  if ((trace.questions || []).some(({ status }) => status === "OPEN")) return false;
  if ((trace.evidence || []).some(({ status }) => status !== "SATISFIED")) return false;
  return idvSubjectsFromTrace(trace).length > 0;
}
