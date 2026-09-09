const { test } = require("node:test");
const assert = require("node:assert");

const { extractNameTokens } = require("../nameExtraction");

test("tokenizes text evidence into normalized name tokens", async () => {
  const set = await extractNameTokens({ text: "This certifies Jane SMITH, formerly Jane Jones." });
  assert.ok(set.has("jane") && set.has("smith") && set.has("jones"));
});

test("accepts pre-extracted tokens (normalized)", async () => {
  const set = await extractNameTokens({ extractedTokens: ["Smith", "JONES"] });
  assert.ok(set.has("smith") && set.has("jones"));
});

test("an image with no text + no OCR yields nothing (routes to review, never a false pass)", async () => {
  const set = await extractNameTokens({ filename: "cert.jpg", bytes: Buffer.from("...") });
  assert.strictEqual(set.size, 0);
});

test("an injected OCR adapter is used for image bytes", async () => {
  const ocr = async () => "Jane Smith aka Jane Jones";
  const set = await extractNameTokens({ bytes: Buffer.from("img"), contentType: "image/png" }, { ocr });
  assert.ok(set.has("smith") && set.has("jones"));
});
