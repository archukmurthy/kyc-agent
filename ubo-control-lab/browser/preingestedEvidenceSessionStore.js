(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UboLabPreingestedEvidenceSessions = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT_VERSION = "ubo-control-lab-preingested-evidence-cache-v1";
  const STORAGE_KEY = "ubo-control-lab.preingested-evidence-sessions.v1";
  const SESSION_VERSION = "ubo-control-lab-preingested-evidence-session-v1";
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
    if (typeof value === "string" && FORBIDDEN_VALUES.test(value)) throw new TypeError(`Unsafe Lab cache value at ${path}`);
    if (Array.isArray(value)) return value.forEach((item, index) => assertSafe(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, item]) => {
      if (FORBIDDEN_KEYS.test(key)) throw new TypeError(`Unsafe Lab cache field at ${path}.${key}`);
      assertSafe(item, `${path}.${key}`);
    });
  }
  function activeSnapshot(session) { return session?.snapshots?.at(-1)?.snapshot || null; }
  async function seal(session) {
    if (session?.contractVersion !== SESSION_VERSION || session?.sourceMode !== "FIXTURE" || !session?.sessionId) throw new TypeError("Pre-ingested Lab session identity is invalid");
    assertSafe(session);
    const active = activeSnapshot(session);
    if (!active?.snapshotId || active.snapshotId !== active.decisionContentHash) throw new TypeError("Pre-ingested Lab session has no valid active snapshot identity");
    const content = {
      contractVersion: CONTRACT_VERSION,
      sessionId: session.sessionId,
      savedAt: new Date().toISOString(),
      activeSnapshotId: active.snapshotId,
      artifactReference: clone(session.artifactCorrelation?.artifactReference || null),
      session: clone(session),
    };
    return { ...content, integrityHash: await sha256(content) };
  }
  async function verify(record) {
    if (!record || record.contractVersion !== CONTRACT_VERSION || typeof record.integrityHash !== "string") throw new TypeError("Unsupported cached pre-ingested Lab session");
    const { integrityHash, ...content } = record;
    if (await sha256(content) !== integrityHash) throw new TypeError("Cached pre-ingested Lab session integrity check failed");
    assertSafe(content.session);
    const active = activeSnapshot(content.session);
    if (!active || active.snapshotId !== content.activeSnapshotId || active.decisionContentHash !== content.activeSnapshotId) throw new TypeError("Cached active snapshot identity is inconsistent");
    return clone(record);
  }
  function createCache(storage) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw new TypeError("Pre-ingested Lab cache requires browser Storage");
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
          return { record: null, error: "Saved Bettercomms demo was corrupted, unsupported, or unsafe and was not restored." };
        }
      },
      clear() { storage.removeItem(STORAGE_KEY); },
    });
  }

  return Object.freeze({ CONTRACT_VERSION, STORAGE_KEY, createCache, sha256 });
}));
