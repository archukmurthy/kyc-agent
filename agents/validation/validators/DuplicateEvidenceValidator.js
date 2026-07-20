var DuplicateEvidenceBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;

class DuplicateEvidenceValidator extends DuplicateEvidenceBaseValidator {
  constructor(options = {}) {
    super({ ruleId: "EVIDENCE.DUPLICATE.NOT_ALLOWED", name: "DuplicateEvidenceValidator", ...options });
  }
}

if (typeof module !== "undefined") module.exports = DuplicateEvidenceValidator;
if (typeof window !== "undefined") window.DuplicateEvidenceValidator = DuplicateEvidenceValidator;
