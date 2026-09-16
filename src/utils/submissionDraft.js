// Browser draft of the in-progress wizard so a refresh/crash can be resumed
// without retyping. One slot (single active application per browser). All calls
// are best-effort: localStorage can be full, disabled, or hold stale JSON, and
// none of that must ever break the wizard.
export const DRAFT_KEY = "kyc_draft_v1";

// The draft is scoped to ONE tenant and ONE flow. A single global slot used to
// offer tenant A's half-finished application under tenant B (restoring its
// dossierId, which then saved into the wrong tenant), and offered a customer
// draft inside the analyst flow. A draft that doesn't match both is ignored.
export function saveDraft(state, scope) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      tenantId: (scope && scope.tenantId) || "",
      agentType: (scope && scope.agentType) || "",
      state,
    }));
  } catch (_) { /* quota/serialization — ignore, draft is a convenience not a guarantee */ }
}

export function loadDraft(scope) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    const wantTenant = (scope && scope.tenantId) || "";
    const wantAgent = (scope && scope.agentType) || "";
    // Legacy drafts (written before scoping) carry no tenant — ignore them
    // rather than guess which tenant they belonged to.
    if (!parsed.tenantId || parsed.tenantId !== wantTenant) return null;
    if (parsed.agentType !== wantAgent) return null;
    return parsed;
  } catch (_) { return null; }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
}
