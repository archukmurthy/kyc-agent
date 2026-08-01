const { randomUUID } = require("node:crypto");

function buildRealShapedJourneyFixture(runId = randomUUID()) {
  const marker = `codex-db-smoke-${runId}`;
  const tenantId = `smoke-${runId.replace(/-/g, "").slice(0, 24)}`;
  const submittedAt = new Date().toISOString();

  const directors = [
    {
      id: `director-${runId}`,
      full_name: "Maya Thompson",
      full_name_original: "Maya Thompson",
      role: "Director",
      nationality: "British",
      date_of_birth: "1982-04",
      residential_country: "GB",
      is_company: false,
      is_pep: false,
      source: "Companies House",
      sourceTier: "tier1",
      sourceUrl: "https://find-and-update.company-information.service.gov.uk/",
      fetchedAt: submittedAt,
    },
  ];

  const ubos = [
    {
      id: `ubo-${runId}`,
      full_name: "Arjun Patel",
      full_name_original: "Arjun Patel",
      role: "Beneficial owner",
      shareholding: "32%",
      nationality: "British",
      date_of_birth: "1978-11",
      residential_country: "GB",
      is_company: false,
      is_pep: false,
      source: "Companies House PSC register",
      sourceTier: "tier1",
      sourceUrl: "https://find-and-update.company-information.service.gov.uk/",
      fetchedAt: submittedAt,
    },
  ];

  const found = [
    {
      field: "businessRegistrationNumber",
      label: "Company registration number",
      value: "12345678",
      source: "Companies House",
      sourceTier: "tier1",
      sourceUrl: "https://find-and-update.company-information.service.gov.uk/",
      verificationStatus: "verified",
      fetchedAt: submittedAt,
    },
    {
      field: "registeredAddress",
      label: "Registered address",
      value: "10 Example Street, London, EC1A 1AA",
      source: "Companies House",
      sourceTier: "tier1",
      sourceUrl: "https://find-and-update.company-information.service.gov.uk/",
      verificationStatus: "verified",
      fetchedAt: submittedAt,
    },
    {
      field: "directors",
      label: "Directors",
      value: directors.map((person) => person.full_name).join(", "),
      stakeholders: directors,
      source: "Companies House",
      sourceTier: "tier1",
      verificationStatus: "verified",
      fetchedAt: submittedAt,
    },
    {
      field: "beneficialOwners",
      label: "Beneficial owners",
      value: ubos.map((person) => person.full_name).join(", "),
      stakeholders: ubos,
      source: "Companies House PSC register",
      sourceTier: "tier1",
      verificationStatus: "verified",
      fetchedAt: submittedAt,
    },
  ];

  const coverage = {
    totalResearchFields: 6,
    populatedFields: 4,
    verifiedFields: 4,
    probableFields: 0,
    indicativeFields: 0,
    missingFieldCount: 2,
    fillRate: 4 / 6,
    verifiedFillRate: 4 / 6,
  };

  const costSummary = {
    model: "claude-sonnet-4-5",
    totals: {
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      totalCostUsd: 0.0081,
    },
    breakdown: {
      researchPass1: {
        inputTokens: 1200,
        outputTokens: 300,
        costUsd: 0.0081,
        fieldsFound: 4,
      },
    },
  };

  const company = {
    name: `Smoke Test Payments ${runId.slice(0, 8)} Ltd`,
    code: "GB",
    countryName: "United Kingdom",
    registrationNumber: "12345678",
  };

  const dossierPayload = {
    tenantId,
    company,
    entityType: "Corporate",
    ownershipType: "private_limited",
    coverage,
    includedFields: ["businessRegistrationNumber", "registeredAddress"],
    excludedFields: [],
    customQuestions: [
      {
        id: `question-${runId}`,
        text: "Describe the expected account activity.",
        fieldType: "textarea",
        required: true,
        section: "account",
      },
    ],
    verifiedData: found,
    probableData: [],
    indicativeData: [],
    stakeholders: { directors, beneficialOwners: ubos },
    requiredDocuments: [
      {
        requirement: "Certificate of incorporation",
        mandatory: true,
        source: "customer",
      },
    ],
    costSummary,
    rawResearch: {
      companyName: company.name,
      found,
      gaps: [
        {
          field: "applicantFirstName",
          label: "Applicant first name",
          section: "applicant",
          required: true,
          inputType: "text",
        },
      ],
      smokeMarker: marker,
    },
    seededBy: "analyst",
    searchAttempts: 1,
  };

  const submitPayload = {
    tenantId,
    company,
    entityType: "Corporate",
    ownershipType: "private_limited",
    journeyType: "ai_only",
    fieldValues: {
      businessRegistrationNumber: "12345678",
      // CORRECTED scalar: the customer replaced the registry value. The
      // original survives only in fieldMetadata.agentValue below (and in
      // change_events.before_value) — the whole point of the provenance trail.
      registeredAddress: "20 Example Street, London, EC1A 1AB",
      applicantFirstName: "Maya",
      applicantLastName: "Thompson",
      applicantEmail: `${marker}@example.invalid`,
      natureOfBusiness: "Cross-border payment services",
    },
    // Per-field provenance trail, as the Confirm page transmits it. Three
    // shapes on purpose, because deriveScalarProvenance resolves each
    // differently and only a real submit proves the whole chain is wired:
    //   corrected -> agent_value is the registry original, != customer_value
    //   untouched -> agent_value == final_value
    //   customer gap -> agent_value IS NULL (never claim the AI sourced it)
    // applicantFirstName/applicantEmail are deliberately absent: they arrive as
    // applicantProvenance rows and the scalar loop skips them.
    fieldMetadata: [
      {
        fieldId: "registeredAddress",
        value: "20 Example Street, London, EC1A 1AB",
        agentValue: "10 Example Street, London, EC1A 1AA",
        customerAction: "corrected",
        source: "Companies House",
        sourceTier: "tier1",
      },
      {
        fieldId: "businessRegistrationNumber",
        value: "12345678",
        customerAction: "kept",
        source: "Companies House",
        sourceTier: "tier1",
      },
      {
        fieldId: "natureOfBusiness",
        value: "Cross-border payment services",
        customerAction: "provided",
        sourceTier: "manual",
      },
    ],
    stakeholders: { directors, beneficialOwners: ubos },
    documents: [],
    costSummary,
    coverage,
    declaration: {
      declarationVersion: "v1",
      agreedAt: submittedAt,
      ipAddress: "192.0.2.10",
      userAgent: "Codex real-DB smoke test",
      timezone: "Europe/London",
    },
    applicant: {
      selectedPersonId: directors[0].id,
      firstName: "Maya",
      lastName: "Thompson",
      email: `${marker}@example.invalid`,
    },
    applicantProvenance: [
      {
        fieldId: "applicantFirstName",
        agentValue: "Maya",
        customerValue: "Maya",
        customerAction: "accepted",
        source: "Companies House",
        sourceTier: "tier1",
        retrievedAt: submittedAt,
      },
      {
        fieldId: "applicantEmail",
        agentValue: null,
        customerValue: `${marker}@example.invalid`,
        customerAction: "provided",
        source: "customer",
        sourceTier: null,
        retrievedAt: submittedAt,
      },
    ],
    applicantOverrides: [],
    submittedAt,
  };

  const changeEvent = {
    submissionId: marker,
    dossierId: null,
    fieldId: "registeredAddress",
    fieldClass: "address",
    changeType: "changed",
    beforeValue: "10 Example Street, London, EC1A 1AA",
    afterValue: "20 Example Street, London, EC1A 1AB",
    sourceType: "registry",
    sourceProvider: "Companies House",
    sourceTier: 1,
    verifiability: "structured_registry",
    customerIntent: "genuine_update",
    customerRegistryClaim: "not_reflected",
    registryRecheckResult: "not_checked",
    workflow: "doc_required",
    docType: "Notice of Change of Address",
    eddFlag: false,
    escalation: false,
    escalationReason: null,
    decided: true,
    matchedRule: "address_changed_not_reflected",
    jurisdiction: "GB",
    supersedes: null,
  };

  return {
    runId,
    marker,
    tenantId,
    company,
    directors,
    ubos,
    dossierPayload,
    submitPayload,
    changeEvent,
  };
}

module.exports = { buildRealShapedJourneyFixture };
