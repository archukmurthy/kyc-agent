import { saveDraft, loadDraft, clearDraft, DRAFT_KEY } from "../submissionDraft";

beforeEach(() => localStorage.clear());

test("saveDraft then loadDraft round-trips the state", () => {
  saveDraft({ companyName: "Acme", step: 3 });
  const d = loadDraft();
  expect(d.state).toEqual({ companyName: "Acme", step: 3 });
  expect(typeof d.savedAt).toBe("string");
});

test("loadDraft returns null when nothing saved", () => {
  expect(loadDraft()).toBeNull();
});

test("clearDraft removes the draft", () => {
  saveDraft({ step: 1 });
  clearDraft();
  expect(loadDraft()).toBeNull();
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
});

test("loadDraft returns null on corrupt JSON instead of throwing", () => {
  localStorage.setItem(DRAFT_KEY, "{not json");
  expect(loadDraft()).toBeNull();
});
