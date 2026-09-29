import { extractFromDoc } from "../documentWorkflow";

afterEach(() => {
  delete global.fetch;
});

test("document extraction names the slot and sends the file; the server owns prompt, model and tools", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: "[]" }], usage: { input_tokens: 1, output_tokens: 1 } }),
  });
  const file = new File(["%PDF-1.4"], "cert.pdf", { type: "application/pdf" });
  const docType = { key: "certificate", extractionPrompt: "IGNORED BY SERVER", sourceName: "Certificate" };
  const schema = { researchFields: [] };

  const result = await extractFromDoc(docType, file, schema, "corporate", "2026-09-16T00:00:00Z", {
    headers: { "X-Tenant-Id": "acme", Authorization: "Bearer dossier:tok" },
  });

  expect(result.usage).toEqual({ input_tokens: 1, output_tokens: 1 });
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe("/api/research");
  expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Tenant-Id": "acme", Authorization: "Bearer dossier:tok" });
  const body = JSON.parse(init.body);
  expect(body.mode).toBe("extract_document");
  expect(body.docKey).toBe("certificate");
  expect(body.file.mediaType).toBe("application/pdf");
  expect(typeof body.file.base64).toBe("string");
  expect(body.file.base64.length).toBeGreaterThan(0);
  for (const key of ["prompt", "messages", "model", "tools", "max_tokens"]) {
    expect(body).not.toHaveProperty(key);
  }
});
