import { readFileAsBase64 } from "../utils/files";
import { mapExtractedKey } from "../utils/extractionMapping";

/* ═══════════════════════════════════════════
   DOC SEARCH AGENT (Step 2 — Document Intelligence)
   Browser-side helpers for the doc search sub-agent
   (agents/docSearchAgent.js, called via /api/doc-search).
   mapToDocAgentOwnershipType is copied inline from
   agents/docSearchAgentCall.js — that file is a Node.js module and cannot
   be imported into the browser bundle.
   ═══════════════════════════════════════════ */

// HARDCODED — see PRODUCTION_READINESS.md PR-001
export function mapToDocAgentOwnershipType(
  ownershipTypeId,
  entityTypeId,
  effectivelyListed
) {
  const entityIsFI = entityTypeId === "FI";

  const fiOwnershipTypes = new Set([
    "payment_institution",
    "correspondent_bank",
    "investment_fund",
    "insurance_company",
    "central_bank",
  ]);

  const ownershipIsFI =
    fiOwnershipTypes.has(ownershipTypeId);

  const isFI = entityIsFI || ownershipIsFI;

  const isListed =
    effectivelyListed ||
    ownershipTypeId === "public_listed";

  if (isFI && isListed)  return "public_fi";
  if (isFI && !isListed) return "fi_only";
  if (!isFI && isListed) return "public_only";
  return "corporate";
}

  // ─── Single-doc extraction helper. Returns { docFound, wolfsbergFields, raw }.
  // - docFound: array of result rows tagged sourceTier:"document"
  // - wolfsbergFields: only populated for the Wolfsberg slot (legacy object format),
  //     used to seed the web prompt so the AI doesn't re-search those fields.
  // - raw: parsed JSON for the by-doc audit map.
export const extractFromDoc = async (docType, file, schema, flow, fetchTs) => {
    const base64 = await readFileAsBase64(file);
    const mediaType = file.type === "image/png" || file.type === "image/jpeg" ? file.type : "application/pdf";
    const isImage = mediaType.startsWith("image/");
    const blockType = isImage ? "image" : "document";
    const resp = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        tools: [],
        messages: [{
          role: "user",
          content: [
            { type: blockType, source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: docType.extractionPrompt },
          ],
        }],
      }),
    });
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`Extraction call failed for ${docType.key}`, resp.status);
      return { docFound: [], wolfsbergFields: {}, raw: null, usage: null };
    }
    const respData = await resp.json();
    const usage = respData.usage || null;
    const txt = (respData.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const cleaned = txt.replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```\s*$/i, "").trim();
    if (docType.returnsObject) {
      // Wolfsberg legacy shape — let the web prompt do the field-id mapping.
      try {
        const parsed = JSON.parse(cleaned);
        const filtered = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && v !== ""));
        return { docFound: [], wolfsbergFields: filtered, raw: filtered, usage };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`Could not parse Wolfsberg extraction`, e, txt);
        return { docFound: [], wolfsbergFields: {}, raw: null, usage };
      }
    }
    try {
      const arr = JSON.parse(cleaned);
      if (!Array.isArray(arr)) return { docFound: [], wolfsbergFields: {}, raw: arr, usage };
      const docFound = [];
      for (const entry of arr) {
        if (!entry || !entry.fieldId || entry.value === null || entry.value === undefined || entry.value === "") continue;
        const mapped = mapExtractedKey(flow, entry.fieldId);
        if (!mapped) continue;
        const sf = schema.researchFields.find(r => r.field === mapped);
        if (!sf) continue;
        if (docFound.some(f => f.field === mapped)) continue;
        docFound.push({
          field: mapped, label: sf.label, value: String(entry.value),
          source: docType.sourceName, sourceUrl: null,
          sourceTier: "document", verificationStatus: "verified", documentType: docType.key,
          fetchedAt: fetchTs, method: "document_extract", confidence: "high",
          trust: "authoritative", wolfsberg: false,
        });
      }
      return { docFound, wolfsbergFields: {}, raw: arr, usage };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Could not parse extraction for ${docType.key}`, e, txt);
      return { docFound: [], wolfsbergFields: {}, raw: null, usage };
    }
  };

  // Pre-check document required for the NEW ownership type (Phase 0 #4 mapping).
  // Extend this map as ops confirm more types; the default is a clearly-commented
  // fallback (closest constitutional/registration document) — never a guess of a
  // specific named certificate.
export const preCheckDocForOwnershipType = (typeId) => {
    switch (typeId) {
      case "trust": return "Trust deed";
      case "llp":
      case "general_partnership": return "Partnership agreement";
      case "sole_trader": return "Tax returns";
      case "private_limited": return "Business registration documents";
      default: return "Constitutional / registration document"; // fallback (extend as ops confirm)
    }
  };
