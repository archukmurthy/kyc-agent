"use strict";
const NORMALIZATION = Object.freeze({ id: "conservative_text", version: "1", reference: "evidence:a4a/conservative-text-v1" });
function normalizeText(value) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB"); }
module.exports = { NORMALIZATION, normalizeText };
