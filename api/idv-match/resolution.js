"use strict";

// Band B resolution flow (Phase 7 / Step 5). Server-side decision logic in the
// exact order 5a -> 5b -> 5c. One round only: at most one question + one upload;
// anything unresolved goes to review. Returns decisions (never persists — the
// decision row is written by the record-only layer). Applicant-facing text comes
// from copy.js verbatim; nothing here invents wording.
const { scoreEquivalence } = require("./nameEquivalence");
const { getPolicy } = require("./policy");
const COPY = require("./copy");

// Neutral review outcome (5d).
function toReview(reasons) {
  return {
    resolved: false, outcomeType: "unresolved_to_review", resolvedBy: "reviewer",
    requiresReview: true, reasons, applicantView: COPY.IN_REVIEW,
  };
}

function acceptedVariation(eq, canonicalName, aliasName, basis, resolvedBy) {
  return {
    resolved: true, outcomeType: "same_person_variation_accepted", resolvedBy,
    basis, ruleIds: eq.ruleIds, score: eq.score,
    policyVersion: eq.policyVersion, ruleTableVersion: eq.ruleTableVersion,
    // Document spelling becomes canonical; CH spelling is kept as a known alias.
    canonicalName, aliasName, applicantView: COPY.BAND_A_SUCCESS,
  };
}

// 5a machine resolution, then 5b disclosure gate. `officerName`/`docName`/
// `mrzName` are Phase-4 structured normalized names; `*DisplayName` are the
// original-cased strings for the (name-only) dialogue prompt.
function resolveBandB({
  officerName, docName, mrzName,
  companyDisplayName, documentDisplayName,
  livenessPassed = false, ownRecord = true, restrictedFlag = false,
  escalationFlag = false, screeningHit = false,
} = {}) {
  if (!officerName) throw new TypeError("resolveBandB requires the officer name");
  // Hard exclusions can never reach the applicant (Step 4 / 5b).
  if (screeningHit || escalationFlag) return toReview(["hard_exclusion"]);

  const primary = mrzName || docName;
  const eq = scoreEquivalence(officerName, primary || { surname: "", forenames: [] });

  // 5a: known equivalence with all other identifiers agreeing -> auto-resolve.
  if (eq.outcome === "auto_resolve") {
    return acceptedVariation(eq, primary, officerName, `algorithmic equivalence${eq.ruleIds.length ? ` (rule ${eq.ruleIds.join(", ")})` : ""}`, "system");
  }

  // Not plausibly the same person (fails phonetic + transliteration + fuzzy, well
  // below the ask-threshold): don't ask "what explains the difference?" of a
  // clearly different person — route straight to review. (Precise Band-C demotion
  // for clearly-different names is BACKLOG BANDS-3.)
  if (!eq.ruleExplained && eq.score < getPolicy().thresholds.skipToReview) {
    return toReview(["not_plausibly_same_person"]);
  }

  // 5b disclosure gate: only ask if it's provably the applicant's own document
  // and nothing restricts communication.
  const gateOpen = livenessPassed === true && ownRecord === true && restrictedFlag !== true && escalationFlag !== true;
  if (!gateOpen) return toReview(["disclosure_gate_closed"]);

  // 5c: open the one-round dialogue.
  const th = getPolicy().thresholds;
  return {
    resolved: false, dialogue: true,
    prompt: COPY.dialoguePrompt({ documentName: documentDisplayName, companyName: companyDisplayName }),
    options: COPY.DIALOGUE_OPTIONS,
    submitLabel: COPY.DIALOGUE.submitLabel,
    nearThreshold: eq.score >= th.skipToReview && eq.score < th.autoResolve,
    equivalence: eq,
  };
}

// A name is "present" in an extracted document when its normalized surname and
// first forename both appear among the document's extracted name tokens.
function nameTokens(name) {
  if (!name) return [];
  return [name.surname, ...(name.forenames || [])].filter(Boolean);
}
function containsName(extractedTokenSet, name) {
  const need = nameTokens(name);
  if (!need.length || !name.surname || !(name.forenames || []).length) return false;
  return need.every((t) => extractedTokenSet.has(t)) || (extractedTokenSet.has(name.surname) && extractedTokenSet.has(name.forenames[0]));
}

// Handle a 5c explanation. `extractNames` is an injectable seam that turns an
// uploaded evidence document into a set of normalized name tokens (real
// extraction is wired later; tests inject a fake).
async function handleExplanation({ category, officerName, docName, mrzName, evidence, extractNames } = {}) {
  const primary = mrzName || docName;
  switch (category) {
    case "same_spelling": {
      // Re-run the engine treating the explanation as corroborating input. The
      // explanation ALONE never resolves — it only clears a near-threshold score.
      const eq = scoreEquivalence(officerName, primary || { surname: "", forenames: [] });
      const th = getPolicy().thresholds;
      if (eq.score >= th.combinedExplanation) {
        const basis = eq.ruleIds.length
          ? `customer explanation corroborated by equivalence rule ${eq.ruleIds.join(", ")}`
          : "customer explanation corroborated by near-threshold similarity";
        return acceptedVariation(eq, primary, officerName, basis, "applicant-dialogue");
      }
      return toReview(["explanation_not_corroborated"]);
    }

    case "changed_name": {
      if (!evidence) return { resolved: false, needsUpload: true, uploadPrompt: COPY.NAME_CHANGE_UPLOAD_PROMPT };
      const extract = extractNames || ((e) => new Set(e && e.extractedTokens ? e.extractedTokens : []));
      const tokens = await extract(evidence);
      const set = tokens instanceof Set ? tokens : new Set(tokens || []);
      // Check exactly one thing: does the document contain BOTH names?
      const hasBoth = containsName(set, officerName) && containsName(set, primary);
      if (hasBoth) {
        return { resolved: true, outcomeType: "same_person_name_change_evidenced", resolvedBy: "applicant-dialogue", canonicalName: primary, aliasName: officerName, applicantView: COPY.BAND_A_SUCCESS };
      }
      return toReview(["name_change_not_evidenced"]);
    }

    case "registry_incorrect":
      // Identity-document name proceeds as canonical; light-touch async review;
      // applicant is NOT blocked. A reportability-assessment task is created for a
      // human — the system never auto-reports.
      return {
        resolved: true, outcomeType: "registry_error_asserted", resolvedBy: "applicant-dialogue",
        basis: "uncorroborated customer assertion", canonicalName: primary,
        blocksApplicant: false, lightTouchReview: true, reportabilityAssessmentTask: true,
        applicantView: COPY.REGISTRY_NOTE, applicantProceeds: true,
      };

    case "wrong_person":
      // Return to officer selection; current attempt is closed with its result
      // preserved; a new selection creates a new attempt.
      return { resolved: false, action: "reselect_officer", closeAttempt: true };

    case "not_sure":
      return toReview(["applicant_unsure"]);

    default:
      throw new Error(`unknown explanation category: ${category}`);
  }
}

module.exports = { resolveBandB, handleExplanation, containsName };
