(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UboLabReplay = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "ubo-control-lab.discovery-replays.v1";
  const CONTRACT_VERSION = "ubo-control-lab-discovery-replay-v1";
  const MAX_SAVED_RESULTS = 6;
  const RESULT_KEYS = new Set([
    "contractVersion", "requestId", "outcome", "candidateFacts", "operationEvidenceReferences", "issues",
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function validCompanyContext(value) {
    return isObject(value)
      && typeof value.legalEntityName === "string" && value.legalEntityName.trim()
      && typeof value.registrationNumber === "string" && value.registrationNumber.trim()
      && typeof value.jurisdiction === "string" && value.jurisdiction.trim();
  }

  function validReplayRecord(value) {
    if (!isObject(value) || value.contractVersion !== CONTRACT_VERSION || typeof value.replayId !== "string"
      || typeof value.contentHash !== "string" || !value.contentHash.startsWith("sha256:")
      || !value.replayId || typeof value.savedAt !== "string" || Number.isNaN(Date.parse(value.savedAt))
      || !validCompanyContext(value.companyContext) || !isObject(value.subject) || !isObject(value.discoveryResult)) return false;
    const result = value.discoveryResult;
    if (Object.keys(result).some((key) => !RESULT_KEYS.has(key)) || typeof result.requestId !== "string"
      || !isObject(result.outcome) || !Array.isArray(result.candidateFacts)
      || !Array.isArray(result.operationEvidenceReferences) || !Array.isArray(result.issues)) return false;
    const registration = value.companyContext.registrationNumber.trim().toUpperCase();
    return (value.subject.externalIdentifiers || []).some((identifier) =>
      String(identifier.namespace || "").toUpperCase() === "COMPANIES_HOUSE_COMPANY_NUMBER"
        && String(identifier.value || "").trim().toUpperCase() === registration);
  }

  function createReplayLibrary(storage, options = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
      throw new TypeError("Replay storage must implement the browser Storage contract");
    }
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_SAVED_RESULTS;
    const read = () => {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return { records: [], error: null };
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.some((record) => !validReplayRecord(record))) throw new TypeError("Saved replay data is invalid");
        return { records: parsed.map(clone), error: null };
      } catch (_error) {
        return { records: [], error: "Saved replay data is corrupted or unavailable and was not loaded." };
      }
    };
    const write = (records) => {
      storage.setItem(STORAGE_KEY, JSON.stringify(records));
      return records.map(clone);
    };
    return Object.freeze({
      read,
      save(record) {
        if (!validReplayRecord(record)) throw new TypeError("Discovery replay record is invalid");
        const current = read();
        const records = [clone(record), ...current.records.filter(({ replayId }) => replayId !== record.replayId)]
          .sort((left, right) => right.savedAt.localeCompare(left.savedAt)).slice(0, limit);
        return write(records);
      },
      remove(replayId) {
        if (typeof replayId !== "string" || !replayId) throw new TypeError("Replay ID is required");
        const current = read();
        if (current.error) return [];
        return write(current.records.filter((record) => record.replayId !== replayId));
      },
      clear() {
        storage.removeItem(STORAGE_KEY);
        return [];
      },
    });
  }

  return Object.freeze({ CONTRACT_VERSION, MAX_SAVED_RESULTS, STORAGE_KEY, createReplayLibrary, validReplayRecord });
}));
