(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UboLabAdaptiveJourneySessions = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT_VERSION = "ubo-adaptive-journey-browser-cache-v1";
  const STORAGE_KEY = "ubo-control-lab.adaptive-journey.v1";
  const FORBIDDEN_KEYS = /(?:password|credential|accessToken|providerSecret|rawProviderPayload|documentContents|evidenceBytes|blobUrl|filePath|storageKey)/i;
  const FORBIDDEN_VALUES = /(?:^blob:|[A-Za-z]:\\(?:Users|Windows|Program Files)\\)/i;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  async function sha256(value) {
    if (!globalThis.crypto?.subtle) throw new TypeError("Browser cryptographic hashing is unavailable");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  function assertSafe(value, path = "session") {
    if (typeof value === "string" && FORBIDDEN_VALUES.test(value)) throw new TypeError(`Unsafe adaptive journey cache value at ${path}`);
    if (Array.isArray(value)) return value.forEach((item, index) => assertSafe(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, item]) => {
      if (FORBIDDEN_KEYS.test(key)) throw new TypeError(`Unsafe adaptive journey cache field at ${path}.${key}`);
      assertSafe(item, `${path}.${key}`);
    });
  }
  function snapshotReferences(session) {
    return (session.snapshots || []).map(({ snapshot }) => ({ snapshotId: snapshot.snapshotId, snapshotHash: snapshot.decisionContentHash }));
  }
  async function seal(session, savedAt = new Date().toISOString()) {
    if (session?.contractVersion !== "ubo-adaptive-journey-session-v1" || session.productionAuthorized !== false) throw new TypeError("Unsupported adaptive journey Lab session");
    assertSafe(session);
    const content = {
      contractVersion: CONTRACT_VERSION,
      sessionId: session.sessionId,
      sourceMode: session.sourceMode,
      savedAt,
      activeSnapshotId: session.snapshots.at(-1)?.snapshot.snapshotId || null,
      snapshotReferences: snapshotReferences(session),
      session: clone(session),
    };
    return { ...content, integrityHash: await sha256(content) };
  }
  async function verify(record) {
    if (!record || record.contractVersion !== CONTRACT_VERSION || !record.integrityHash) throw new TypeError("Unsupported cached adaptive journey");
    const { integrityHash, ...content } = record;
    if (await sha256(content) !== integrityHash) throw new TypeError("Cached adaptive journey integrity check failed");
    assertSafe(content.session);
    const references = snapshotReferences(content.session);
    if (canonical(references) !== canonical(content.snapshotReferences)) throw new TypeError("Cached adaptive journey history does not match its sealed references");
    if ((references.at(-1)?.snapshotId || null) !== content.activeSnapshotId) throw new TypeError("Cached adaptive journey active snapshot is invalid");
    return clone(record);
  }
  function createAdaptiveJourneyCache(storage) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") throw new TypeError("Adaptive journey cache requires browser Storage");
    return Object.freeze({
      async save(session) {
        const record = await seal(session);
        storage.setItem(STORAGE_KEY, JSON.stringify(record));
        return clone(record);
      },
      async restore() {
        try {
          const raw = storage.getItem(STORAGE_KEY);
          return raw ? { record: await verify(JSON.parse(raw)), error: null } : { record: null, error: null };
        } catch (_error) {
          return { record: null, error: "Saved adaptive journey was corrupted, unsupported or unsafe and was not restored." };
        }
      },
      clear() { storage.removeItem(STORAGE_KEY); },
    });
  }
  return Object.freeze({ CONTRACT_VERSION, STORAGE_KEY, createAdaptiveJourneyCache, sha256 });
}));
