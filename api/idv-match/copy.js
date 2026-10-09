"use strict";

// Verbatim applicant-facing copy for the discrepancy-bands feature. Every string
// here is fixed by the build instruction and MUST be used exactly - no
// "improving", no synonyms, no added mention of suspicion / discrepancies /
// reviews / named sources. Single source of truth; the UI (src/idv-match/) will
// render these later.

// Band A - success (Step 6).
const BAND_A_SUCCESS = Object.freeze({
  title: "Identity verified",
  body: "Your identity has been matched to the selected company officer.",
});

// Band B - neutral in-review state (Step 5d). Deliberately says nothing about
// discrepancies, comparisons, reviews, suspicion, or any named source.
const IN_REVIEW = Object.freeze({
  title: "We're completing our checks",
  body: "Your application has been saved. We'll be in touch if we need anything further.",
});

// Band C - could-not-confirm + LOA path (Step 7).
const BAND_C = Object.freeze({
  title: "We couldn't confirm your details against the company's registered officers",
  body: "To continue, please provide a letter of authorization.",
});

// Band B - the one-round dialogue (Step 5c).
const DIALOGUE = Object.freeze({
  title: "Help us confirm your details",
  intro: "The name on your identity document differs slightly from the company's registered record.",
  documentLabel: "Identity document:",
  companyLabel: "Company record:",
  question: "What explains the difference?",
  submitLabel: "Submit explanation",
});

// The five fixed explanation options (Step 5c). ids drive resolution; labels are
// verbatim and never imply the applicant is picking between two names.
const DIALOGUE_OPTIONS = Object.freeze([
  Object.freeze({ id: "same_spelling", label: "Same name, different spelling" }),
  Object.freeze({ id: "changed_name", label: "I changed my name" }),
  Object.freeze({ id: "registry_incorrect", label: "The company record is out of date or incorrect" }),
  Object.freeze({ id: "wrong_person", label: "I selected the wrong person" }),
  Object.freeze({ id: "not_sure", label: "I'm not sure" }),
]);

// "I changed my name" upload prompt (Step 5c option 2).
const NAME_CHANGE_UPLOAD_PROMPT = "Please upload a document that shows both names, such as a marriage certificate or deed poll";

// "The company record is out of date or incorrect" informational note (option 3).
const REGISTRY_NOTE = "You may wish to update the company's record at Companies House.";

// Build the 5c dialogue block. Shows ONLY the two names - no address, no other
// officers, no dates.
function dialoguePrompt({ documentName, companyName }) {
  return {
    ...DIALOGUE,
    documentName: documentName || "",
    companyName: companyName || "",
  };
}

module.exports = {
  BAND_A_SUCCESS, IN_REVIEW, BAND_C, DIALOGUE, DIALOGUE_OPTIONS,
  NAME_CHANGE_UPLOAD_PROMPT, REGISTRY_NOTE, dialoguePrompt,
};
