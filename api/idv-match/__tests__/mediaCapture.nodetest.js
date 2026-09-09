const { test } = require("node:test");
const assert = require("node:assert");

const { captureDocumentMedia, extractDocumentImageUrls } = require("../mediaCapture");

const decision = () => ({
  decision: {
    created_at: "2026-09-01T10:00:00Z",
    id_verifications: [{
      front_image: "https://didit.example/presigned/front.jpg",
      back_image: "https://didit.example/presigned/back.jpg",
      portrait_image: "not-a-url",
      selfie_image: "https://didit.example/presigned/selfie.jpg", // must be ignored
    }],
  },
});

test("extracts document image URLs (front/back), ignores selfie + non-URLs", () => {
  const urls = extractDocumentImageUrls(decision());
  const kinds = urls.map((u) => u.kind).sort();
  assert.deepStrictEqual(kinds, ["back", "front"]);
  assert.ok(!urls.some((u) => u.kind === "portrait"), "non-URL portrait skipped");
  assert.ok(!JSON.stringify(urls).includes("selfie"), "selfie never captured");
});

test("captures each document image via the media store (best-effort)", async () => {
  const calls = [];
  const media = { ingestFromUrl: async (input) => { calls.push(input); return { mediaId: `m-${calls.length}` }; } };
  const captured = await captureDocumentMedia({ attemptId: "att-1", decision: decision() }, { media });
  assert.strictEqual(captured.length, 2);
  assert.deepStrictEqual(calls.map((c) => c.evidenceKind).sort(), ["back", "front"]);
  assert.strictEqual(calls[0].attemptId, "att-1");
  assert.ok(calls.every((c) => c.evidenceKind !== "selfie"));
});

test("a media failure does not throw (best-effort)", async () => {
  const media = { ingestFromUrl: async () => { throw new Error("blob down"); } };
  const captured = await captureDocumentMedia({ attemptId: "att-1", decision: decision() }, { media });
  assert.deepStrictEqual(captured, []); // swallowed
});

test("no document images -> nothing captured", async () => {
  const media = { ingestFromUrl: async () => { throw new Error("should not be called"); } };
  const captured = await captureDocumentMedia({ attemptId: "att-1", decision: { decision: { id_verifications: [{}] } } }, { media });
  assert.deepStrictEqual(captured, []);
});
