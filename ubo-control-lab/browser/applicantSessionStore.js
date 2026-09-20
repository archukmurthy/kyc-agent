(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UboLabApplicantSessions = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT_VERSION = "ubo-control-lab-applicant-session-cache-v1";
  const STORAGE_KEY = "ubo-control-lab.applicant-sessions.v2";
  const MAX_SESSIONS = 8;
  const ALLOWED_MODES = new Set(["FIXTURE", "REPLAY", "LIVE"]);
  const FORBIDDEN_KEYS = /(?:password|credential|accessToken|providerSecret|rawProviderPayload|documentContents|evidenceBytes|blobUrl|filePath)/i;
  const FORBIDDEN_VALUES = /(?:^blob:|[A-Za-z]:\\(?:Users|Windows|Program Files)\\)/i;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  async function sha256(value) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new TypeError("Browser cryptographic hashing is unavailable");
    const bytes = new TextEncoder().encode(canonical(value));
    const digest = await subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  function assertSafe(value, path = "session") {
    if (typeof value === "string" && FORBIDDEN_VALUES.test(value)) throw new TypeError(`Unsafe Lab cache value at ${path}`);
    if (Array.isArray(value)) return value.forEach((item, index) => assertSafe(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, item]) => {
      if (FORBIDDEN_KEYS.test(key)) throw new TypeError(`Unsafe Lab cache field at ${path}.${key}`);
      assertSafe(item, `${path}.${key}`);
    });
  }
  function activeSnapshot(session) { return session?.snapshots?.at(-1)?.snapshot || null; }
  function cacheContent(session, options = {}) {
    if (!session?.sessionId || !ALLOWED_MODES.has(session.sourceMode)) throw new TypeError("Applicant Lab session identity is invalid");
    if (session.sourceMode === "LIVE" && options.liveOptIn !== true) throw new TypeError("Live Lab sessions require explicit local-save opt-in");
    assertSafe(session);
    const active = activeSnapshot(session);
    if (!active?.snapshotId || active.snapshotId !== active.decisionContentHash) throw new TypeError("Applicant Lab session has no valid active snapshot identity");
    return {
      contractVersion: CONTRACT_VERSION,
      sessionId: session.sessionId,
      sourceMode: session.sourceMode,
      sourceIdentity: clone(session.sourceIdentity || { fixtureId: session.fixtureId }),
      savedAt: options.savedAt || new Date().toISOString(),
      snapshotReferences: session.snapshots.map(({ snapshot }) => ({ snapshotId: snapshot.snapshotId, snapshotHash: snapshot.decisionContentHash })),
      activeSnapshotId: active.snapshotId,
      policyIdentity: clone(active.decisionContent.policy.identity),
      profileIdentity: clone(session.profileIdentity || null),
      inFlightOperation: options.inFlightOperation ? clone(options.inFlightOperation) : null,
      session: clone(session),
    };
  }
  async function seal(content) {
    return { ...content, integrityHash: await sha256(content) };
  }
  async function verify(record) {
    if (!record || record.contractVersion !== CONTRACT_VERSION || typeof record.integrityHash !== "string") {
      throw new TypeError("Unsupported cached applicant Lab session");
    }
    const { integrityHash, ...content } = record;
    if (await sha256(content) !== integrityHash) throw new TypeError("Cached applicant Lab session integrity check failed");
    assertSafe(content.session);
    const active = activeSnapshot(content.session);
    if (!active || active.snapshotId !== content.activeSnapshotId || active.decisionContentHash !== content.activeSnapshotId) {
      throw new TypeError("Cached applicant Lab active snapshot does not match its sealed identity");
    }
    return clone(record);
  }

  function createApplicantSessionCache(storage, options = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
      throw new TypeError("Applicant Lab cache requires the browser Storage contract");
    }
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_SESSIONS;
    async function read() {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return { records: [], error: null };
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new TypeError("Cached applicant Lab sessions must be an array");
        const records = [];
        for (const item of parsed) records.push(await verify(item));
        return { records, error: null };
      } catch (_error) {
        return { records: [], error: "Saved applicant Lab session was corrupted, unsupported, or unsafe and was not restored." };
      }
    }
    function write(records) {
      storage.setItem(STORAGE_KEY, JSON.stringify(records));
      return records.map(clone);
    }
    async function save(session, saveOptions = {}) {
      const record = await seal(cacheContent(session, saveOptions));
      const existing = await read();
      const records = [record, ...existing.records.filter(({ sessionId }) => sessionId !== record.sessionId)]
        .sort((left, right) => right.savedAt.localeCompare(left.savedAt)).slice(0, limit);
      write(records);
      return clone(record);
    }
    return Object.freeze({
      read,
      save,
      markInFlight(session, operationId, liveOptIn = false) {
        return save(session, {
          liveOptIn,
          inFlightOperation: { operationId, state: "SUBMISSION_STATUS_UNCERTAIN", recordedAt: new Date().toISOString() },
        });
      },
      async restoreLast() {
        const result = await read();
        return { record: result.records[0] || null, error: result.error };
      },
      async remove(sessionId) {
        const result = await read();
        const records = result.error ? [] : result.records.filter((record) => record.sessionId !== sessionId);
        if (records.length) write(records); else storage.removeItem(STORAGE_KEY);
        return records.map(clone);
      },
    });
  }

  return Object.freeze({ CONTRACT_VERSION, STORAGE_KEY, createApplicantSessionCache, sha256 });
}));
