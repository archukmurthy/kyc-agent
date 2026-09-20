(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EvidenceLabState = api;
}(typeof globalThis === "undefined" ? this : globalThis, function build() {
  function freshProducerRequestKey(companyNumber) {
    const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `evidence-lab-recollect-GB-${String(companyNumber || "").trim().toUpperCase()}-${random}`;
  }
  function createExecutionGuard() {
    const active = new Set();
    return {
      isActive: (operation) => active.has(operation),
      async run(operation, callbacks) {
        if (active.has(operation)) return { ignored: true };
        active.add(operation); callbacks.onStart?.();
        try { const value = await callbacks.work(); callbacks.onSuccess?.(value); return { ignored: false, value }; }
        catch (error) { callbacks.onFailure?.(error); return { ignored: false, error }; }
        finally { active.delete(operation); callbacks.onFinish?.(); }
      },
    };
  }
  function createHistoryStore() {
    const entries = new Map();
    return { set: (artifactId, history) => entries.set(artifactId, history), get: (artifactId) => entries.get(artifactId), clear: () => entries.clear(), values: () => [...entries.values()] };
  }
  return { createExecutionGuard, createHistoryStore, freshProducerRequestKey };
}));
