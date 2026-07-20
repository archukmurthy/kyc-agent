var AuthorityBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;

const AUTHORITY_ROLE_ALIASES = Object.freeze({
  DIRECTOR: "DIRECTOR",
  UBO: "UBO",
  "ULTIMATE BENEFICIAL OWNER": "UBO",
  "BENEFICIAL OWNER": "UBO",
  "CONTROLLING PERSON": "CONTROLLING_PERSON",
  CONTROLLER: "CONTROLLING_PERSON",
  PARTNER: "PARTNER",
  "SOLE OWNER": "SOLE_OWNER",
  "SOLE PROPRIETOR": "SOLE_OWNER",
});

const AUTHORITY_ENTITY_ALIASES = Object.freeze({
  "PRIVATE LIMITED": "PRIVATE_LIMITED",
  "PRIVATE LIMITED COMPANY": "PRIVATE_LIMITED",
  "PRIVATELY OWNED": "PRIVATE_LIMITED",
  "LISTED PUBLIC COMPANY": "LISTED_PUBLIC_COMPANY",
  "PUBLICLY LISTED": "LISTED_PUBLIC_COMPANY",
  "PUBLIC LIMITED COMPANY": "LISTED_PUBLIC_COMPANY",
  PARTNERSHIP: "PARTNERSHIP",
  LLP: "PARTNERSHIP",
  "PARTNERSHIP LLP": "PARTNERSHIP",
  "SOLE PROPRIETOR": "SOLE_PROPRIETOR",
  "SOLE PROPRIETORSHIP": "SOLE_PROPRIETOR",
  COOPERATIVE: "COOPERATIVE",
  "CO OPERATIVE": "COOPERATIVE",
});

class AuthorityValidator extends AuthorityBaseValidator {
  constructor(options = {}) {
    super({
      ruleId: "LOA.AUTHORITY.VALID",
      name: "AuthorityValidator",
      severity: "HIGH",
      description: "Checks the extracted signer role against entity-specific rule-pack authority roles.",
      requires: {
        extractedFields: ["signerTitle"],
        evidenceTypes: ["extracted_field"],
        contextFields: ["requirementContext.entityType", "ruleContext.activeRules"],
      },
      ...options,
    });
  }

  validate(input = {}) {
    const startedAt = new Date().toISOString();
    const signerTitle = authorityGetSignerTitle(input.extraction);
    const entityType = authorityNormalizeEntityType(
      input.requirementContext && input.requirementContext.entityType
    );
    const entityRules = authorityGetEntityRules(input.ruleContext);
    const allowedRoles = entityType && entityRules[entityType]
      ? entityRules[entityType].allowedSignerRoles || []
      : [];
    const canonicalRole = authorityNormalizeRole(signerTitle);
    const delegated = authorityIsDelegatedRole(signerTitle);
    const evidenceIds = authorityGetEvidenceIds(input.extraction, input.evidence);

    let status;
    let reason;
    if (!signerTitle) {
      status = "REVIEW";
      reason = "No signer role was extracted.";
    } else if (!entityType || !entityRules[entityType]) {
      status = "REVIEW";
      reason = "The entity type is missing or is not supported by the active rule pack.";
    } else if (delegated) {
      status = "REVIEW";
      reason = `The signer role "${signerTitle}" may rely on delegated authority and requires supporting evidence.`;
    } else if (canonicalRole && allowedRoles.includes(canonicalRole)) {
      status = "PASS";
      reason = `The signer role "${signerTitle}" is permitted for ${entityType}.`;
    } else {
      status = "FAIL";
      reason = `The signer role "${signerTitle}" is not permitted for ${entityType}.`;
    }

    const completedAt = new Date().toISOString();
    return this.createFinding({
      input,
      status,
      severity: this.severity,
      message: authorityMessage(status, signerTitle),
      evidenceIds,
      decision: {
        summary: authoritySummary(status),
        outcomeReason: reason,
        ruleDescription: "The LOA signer role must be allowed for the selected jurisdiction and entity type.",
        evaluatedInputs: [
          "extraction.fields.signerTitle",
          "requirementContext.entityType",
          "ruleContext.activeRules.LOA.AUTHORITY.VALID.parameters.entityRules",
        ],
        decisionPath: [
          {
            stepId: "signer_role_authority_check",
            result: status,
            explanation: reason,
            evidenceIds,
          },
        ],
      },
      customerGuidance: authorityCustomerGuidance(status, signerTitle, allowedRoles),
      analystGuidance: {
        summary: authoritySummary(status),
        ruleExecuted: this.ruleId,
        evidenceIds,
        reasoning: reason,
        suggestedAction:
          status === "PASS"
            ? "No action required."
            : status === "REVIEW"
              ? "Review supporting delegated-authority evidence."
              : "Request an LOA signed by an allowed role.",
        reviewPriority: status === "PASS" ? "LOW" : "HIGH",
        debugNotes: [],
      },
      execution: {
        startedAt,
        completedAt,
        durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
        validatorVersion: this.version,
        rulePackVersion: input.ruleContext && input.ruleContext.rulePackVersion,
        warnings: [],
      },
    });
  }
}

function authorityGetEntityRules(ruleContext = {}) {
  const rule = (ruleContext.activeRules || []).find(
    (activeRule) => activeRule.ruleId === "LOA.AUTHORITY.VALID"
  );
  return (rule && rule.parameters && rule.parameters.entityRules) || {};
}

function authorityGetSignerTitle(extraction = {}) {
  const field = extraction.fields && extraction.fields.signerTitle;
  if (!field) return "";
  return String(typeof field === "string" ? field : field.value || "").trim();
}

function authorityNormalizeText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function authorityNormalizeRole(value) {
  return AUTHORITY_ROLE_ALIASES[authorityNormalizeText(value)] || null;
}

function authorityNormalizeEntityType(value) {
  return AUTHORITY_ENTITY_ALIASES[authorityNormalizeText(value)] || null;
}

function authorityIsDelegatedRole(value) {
  return /\b(SECRETARY|ATTORNEY|LEGAL REPRESENTATIVE|AUTHORI[ZS]ED SIGNATORY|DELEGATED AUTHORITY)\b/.test(
    authorityNormalizeText(value)
  );
}

function authorityGetEvidenceIds(extraction = {}, evidence = []) {
  const field = extraction.fields && extraction.fields.signerTitle;
  if (field && Array.isArray(field.evidenceRefs)) return field.evidenceRefs.filter(Boolean);
  return evidence
    .filter((item) => item.field === "signerTitle")
    .map((item) => item.evidenceId)
    .filter(Boolean);
}

function authoritySummary(status) {
  if (status === "PASS") return "Signer authority is valid.";
  if (status === "REVIEW") return "Signer authority requires review.";
  return "Signer authority is not valid for this entity type.";
}

function authorityMessage(status, signerTitle) {
  if (status === "PASS") return `${signerTitle} is an allowed LOA signer role.`;
  if (status === "REVIEW") return `${signerTitle || "Signer role"} requires supporting authority review.`;
  return `${signerTitle} is not an allowed LOA signer role.`;
}

function authorityCustomerGuidance(status, signerTitle, allowedRoles) {
  const allowed = allowedRoles.map((role) => role.replace(/_/g, " ")).join(", ");
  if (status === "PASS") {
    return {
      summary: `${signerTitle} is authorized to sign this LOA.`,
      whyItMatters: "The LOA must be signed by a role authorized for this entity type.",
      remediation: "No action is needed.",
      actions: [],
      examples: [],
    };
  }
  if (status === "REVIEW") {
    return {
      summary: `${signerTitle || "The signer role"} needs authority review.`,
      whyItMatters: "Delegated roles require evidence showing authority to sign.",
      remediation: "Provide a Secretary Certificate, Board Resolution, existing Letter of Authority, or equivalent supporting authority.",
      actions: [],
      examples: [],
    };
  }
  return {
    summary: `${signerTitle} is not an allowed signer for this entity type.`,
    whyItMatters: "The LOA must be signed by an authorized role.",
    remediation: `Provide an LOA signed by one of: ${allowed || "an allowed signer role"}.`,
    actions: [],
    examples: [],
  };
}

if (typeof module !== "undefined") module.exports = AuthorityValidator;
if (typeof window !== "undefined") window.AuthorityValidator = AuthorityValidator;
