import {
  isStakeholderField,
  isRegistryExemptionNotice,
  looksLikeRealName,
  formatShareholding,
} from "../pipeline";

  // RFC4122 v4 UUID — uses crypto.randomUUID where available, falls back
  // to a Math.random()-based generator for older browsers.
export const genUUID = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  };

  // True when a stakeholder is a company rather than a natural person. Set by
  // enrichStakeholders (heuristic for AI-found) or explicitly when the customer
  // adds a company. Drives the corporate vs person field shape everywhere.
export const isCorporateStakeholder = (s) => !!(s && s.is_company);

  // Fallback applicant field set, mirroring the schema's applicant section
  // (see UK/SG schemas in pipeline.js). Used when activeSchema is unavailable
  // (e.g. a path that skipped the Company-input step) so the Applicant page
  // never renders blank. Shape matches what renderApplicantFields consumes:
  // { field, label, inputType, required, options }.
export const APPLICANT_FALLBACK_FIELDS = [
    { field: "applicantFirstName", label: "Applicant First Name", inputType: "text", required: true },
    { field: "applicantLastName", label: "Applicant Last Name", inputType: "text", required: true },
    { field: "applicantEmail", label: "Applicant Email", inputType: "email", required: true },
    { field: "applicantMobileCountryCode", label: "Mobile Country Code", inputType: "text", required: true },
    { field: "applicantMobile", label: "Applicant Mobile", inputType: "tel", required: true },
    { field: "applicantDateOfBirth", label: "Applicant Date of Birth", inputType: "date", required: true },
    { field: "applicantNationality", label: "Applicant Nationality (2-letter code)", inputType: "text", required: true },
    { field: "applicantBirthCountry", label: "Applicant Birth Country", inputType: "text", required: true },
    { field: "applicantPosition", label: "Applicant Position Title", inputType: "select", required: true, options: ["Director", "UBO", "Authorised Representative", "Partner", "Trustee", "Signatory", "Other"] },
    { field: "applicantIsPEP", label: "Is Applicant a PEP?", inputType: "select", required: true, options: ["Yes", "No"] },
  ];

// Derive the director/UBO candidates for the "Who is completing this
// application?" selector. Pure: state (research result, dossier
// stakeholders) is passed in by the App.js wrapper.
export const getApplicantCandidates = (research, dossierStakeholders) => {
    const found = research?.found || [];
    const candidates = [];

    const directorResult = found.find(
      (r) => isStakeholderField(r.field || r.fieldId) && String(r.field || r.fieldId).includes("director")
    );
    if (directorResult?.stakeholders) {
      directorResult.stakeholders
        .filter((s) => !isRegistryExemptionNotice(s) && looksLikeRealName(s.full_name) && !isCorporateStakeholder(s))
        .forEach((s) => {
          candidates.push({
            id: s.id,
            name: s.full_name,
            role: s.role || "Director",
            jobTitle: s.role || "Director",
            nationality: s.nationality || "",
            dob: s.date_of_birth || "",
            source: s.source || "Companies House",
            sourceTier: s.sourceTier || "tier1",
            type: "director",
          });
        });
    }

    const uboResult = found.find(
      (r) => isStakeholderField(r.field || r.fieldId) && String(r.field || r.fieldId).includes("ubo")
    );
    if (uboResult?.stakeholders) {
      uboResult.stakeholders
        .filter((s) => !isRegistryExemptionNotice(s) && looksLikeRealName(s.full_name) && !isCorporateStakeholder(s))
        .forEach((s) => {
          if (candidates.find((c) => c.name === s.full_name)) return; // already a director
          const shareTxt = s.share_percentage != null ? formatShareholding(s.share_percentage) : "";
          candidates.push({
            id: s.id,
            name: s.full_name,
            role: shareTxt ? `Owner (${shareTxt})` : "UBO",
            jobTitle: shareTxt ? "Owner" : "UBO",
            nationality: s.nationality || "",
            dob: s.date_of_birth || "",
            source: s.source || "Companies House",
            sourceTier: s.sourceTier || "tier1",
            type: "ubo",
          });
        });
    }

    if (candidates.length > 0) return candidates;

    // Fallback: customer arrived via an invite link (no research in this
    // session) — derive candidates from the dossier's saved stakeholders.
    // dossierStakeholders may be an array, a { all: [...] } wrapper, or the
    // research stakeholder-field map { directors: [...], ubo_names: [...] }.
    const flat = Array.isArray(dossierStakeholders)
      ? dossierStakeholders
      : Array.isArray(dossierStakeholders?.all)
      ? dossierStakeholders.all
      : dossierStakeholders && typeof dossierStakeholders === "object"
      ? Object.values(dossierStakeholders).flat().filter((x) => x && typeof x === "object" && x.full_name)
      : [];
    return flat
      .filter((s) => !isRegistryExemptionNotice(s) && looksLikeRealName(s.full_name) && !isCorporateStakeholder(s))
      .map((s) => {
        const shareTxt = s.share_percentage != null ? formatShareholding(s.share_percentage) : "";
        return {
          id: s.id || s.full_name,
          name: s.full_name,
          role: s.role || (shareTxt ? `Owner (${shareTxt})` : "Director"),
          jobTitle: s.role || (shareTxt ? "Owner" : "Director"),
          nationality: s.nationality || "",
          dob: s.date_of_birth || "",
          source: s.source || "Companies House",
          sourceTier: s.sourceTier || "tier1",
          type: s.role && /owner|ubo|benefic|shareh/i.test(s.role) ? "ubo" : "director",
        };
      });
  };

  // Compute per-field applicant provenance at submit time: for each applicant
  // identity field, classify the customer's value as accepted (matches the
  // agent-sourced value), overridden (changed it), or provided (no agent value).
  // When no registry person was selected, every field is customer-provided.
export const buildApplicantProvenance = ({ applicantSelectedPerson, applicantAgentValues, gapValues }) => {
    if (!applicantSelectedPerson) {
      const manualFields = [
        "applicantFirstName", "applicantLastName", "applicantEmail", "applicantMobile",
        "applicantPosition", "applicantNationality", "applicantDateOfBirth", "applicantIsPEP",
      ];
      return manualFields
        .filter((f) => gapValues[f])
        .map((f) => ({
          fieldId: f,
          fieldLabel: f.replace("applicant", "").replace(/([A-Z])/g, " $1").trim(),
          agentValue: null,
          customerValue: gapValues[f] || null,
          customerAction: "provided",
          source: null,
          sourceTier: null,
          retrievedAt: null,
          overriddenAt: null,
        }));
    }

    const provenance = [];
    const ts = new Date().toISOString();
    const fieldMap = {
      applicantFirstName: "First name",
      applicantLastName: "Last name",
      applicantPosition: "Job title",
      applicantNationality: "Nationality",
      applicantDateOfBirth: "Date of birth",
      applicantEmail: "Email address",
      applicantMobile: "Phone number",
      applicantIsPEP: "PEP status",
    };

    Object.entries(fieldMap).forEach(([fieldId, fieldLabel]) => {
      const agentVal = applicantAgentValues[fieldId] || null;
      const customerVal = gapValues[fieldId] || null;
      let action = "provided";
      let overriddenAt = null;
      if (agentVal && customerVal) {
        if (customerVal === agentVal) action = "accepted";
        else { action = "overridden"; overriddenAt = ts; }
      } else if (!agentVal && customerVal) {
        action = "provided";
      } else if (agentVal && !customerVal) {
        action = "accepted";
      }
      provenance.push({
        fieldId,
        fieldLabel,
        agentValue: agentVal,
        customerValue: customerVal,
        customerAction: action,
        source: agentVal ? applicantSelectedPerson.source : null,
        sourceTier: agentVal ? applicantSelectedPerson.sourceTier : null,
        retrievedAt: agentVal ? ts : null,
        overriddenAt,
      });
    });

    return provenance;
  };
