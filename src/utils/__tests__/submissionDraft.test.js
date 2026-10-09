import { saveDraft, loadDraft, clearDraft, DRAFT_KEY, draftableSelfSourceResults } from "../submissionDraft";

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

  // Isolates the `!parsed.tenantId` clause specifically: this saves AND loads
  // with an empty scope, so `parsed.tenantId === wantTenant` (`"" === ""`)
  // would already be true without that clause - without it, two different
  // no-tenant sessions (both reachable: no ?tenant= present) could match each
  // other's draft.
  test('a draft saved with an empty scope is never offered back, even to an empty scope', () => {
    saveDraft({ companyName: 'NoTenant' }, { tenantId: '', agentType: '' });
    expect(loadDraft({ tenantId: '', agentType: '' })).toBeNull();
  });
});

test("draftableSelfSourceResults drops File objects and keeps everything else", () => {
  expect(draftableSelfSourceResults(null)).toBeNull();
  const input = {
    summary: { retrieved: 1 },
    results: [
      { requirement: "Certificate", status: "retrieved", sourceUrl: "https://x", manualUploadFile: new Blob(["x"]) },
      { requirement: "Register extract", status: "manually_uploaded", manualUploadName: "extract.pdf" },
    ],
  };
  const out = draftableSelfSourceResults(input);
  expect(out.summary).toEqual({ retrieved: 1 });
  expect(out.results[0]).toEqual({ requirement: "Certificate", status: "retrieved", sourceUrl: "https://x" });
  expect(out.results[1]).toEqual({ requirement: "Register extract", status: "manually_uploaded", manualUploadName: "extract.pdf" });
  expect(input.results[0].manualUploadFile).toBeDefined(); // the live state is not mutated
  expect(() => JSON.stringify(out)).not.toThrow();
});
