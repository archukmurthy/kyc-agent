import { saveDraft, loadDraft, clearDraft, DRAFT_KEY } from "../submissionDraft";

beforeEach(() => localStorage.clear());

const SCOPE = { tenantId: "acme", agentType: "onboarding" };

test("saveDraft then loadDraft round-trips the state", () => {
  saveDraft({ companyName: "Acme", step: 3 }, SCOPE);
  const d = loadDraft(SCOPE);
  expect(d.state).toEqual({ companyName: "Acme", step: 3 });
  expect(typeof d.savedAt).toBe("string");
});

test("loadDraft returns null when nothing saved", () => {
  expect(loadDraft(SCOPE)).toBeNull();
});

test("clearDraft removes the draft", () => {
  saveDraft({ step: 1 }, SCOPE);
  clearDraft();
  expect(loadDraft(SCOPE)).toBeNull();
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
});

test("loadDraft returns null on corrupt JSON instead of throwing", () => {
  localStorage.setItem(DRAFT_KEY, "{not json");
  expect(loadDraft(SCOPE)).toBeNull();
});

describe('draft scoping', () => {
  afterEach(() => clearDraft());

  test('a draft is returned for the same tenant and flow', () => {
    saveDraft({ companyName: 'Acme' }, { tenantId: 'acme', agentType: 'onboarding' });
    const d = loadDraft({ tenantId: 'acme', agentType: 'onboarding' });
    expect(d.state.companyName).toBe('Acme');
  });

  test('a draft from another tenant is never offered', () => {
    saveDraft({ companyName: 'Acme' }, { tenantId: 'acme', agentType: 'onboarding' });
    expect(loadDraft({ tenantId: 'other', agentType: 'onboarding' })).toBeNull();
  });

  test('an analyst draft is not offered in the customer flow', () => {
    saveDraft({ companyName: 'Acme' }, { tenantId: 'acme', agentType: 'preboarding' });
    expect(loadDraft({ tenantId: 'acme', agentType: 'onboarding' })).toBeNull();
  });

  test('a legacy draft with no recorded tenant is ignored', () => {
    localStorage.setItem('kyc_draft_v1', JSON.stringify({ savedAt: '2026-01-01T00:00:00.000Z', state: { companyName: 'Old' } }));
    expect(loadDraft({ tenantId: 'acme', agentType: 'onboarding' })).toBeNull();
  });
});
