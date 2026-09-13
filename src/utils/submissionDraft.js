// Browser draft of the in-progress wizard so a refresh/crash can be resumed
// without retyping. One slot (single active application per browser). All calls
// are best-effort: localStorage can be full, disabled, or hold stale JSON, and
// none of that must ever break the wizard.
export const DRAFT_KEY = "kyc_draft_v1";

export function saveDraft(state) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state }));
  } catch (_) { /* quota/serialization — ignore, draft is a convenience not a guarantee */ }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return parsed;
  } catch (_) { return null; }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
}
