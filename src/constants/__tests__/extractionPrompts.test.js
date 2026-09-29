import { DOC_TYPES } from "../docTypes";
import { EXTRACTION_PROMPT_BY_DOC_KEY } from "../extractionPrompts";

test("the server lookup has exactly one prompt per document slot, identical to the slot's prompt", () => {
  expect(Object.keys(EXTRACTION_PROMPT_BY_DOC_KEY).sort()).toEqual(DOC_TYPES.map((d) => d.key).sort());
  for (const d of DOC_TYPES) {
    expect(EXTRACTION_PROMPT_BY_DOC_KEY[d.key]).toBe(d.extractionPrompt);
  }
});
