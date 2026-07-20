(function () {
  const fileInput = document.getElementById("document");
  const marketInput = document.getElementById("market");
  const entityTypeInput = document.getElementById("entity-type");
  const expectedRecipientInput = document.getElementById("expected-recipient");
  const extractedRecipientInput = document.getElementById("extracted-recipient");
  const applicantNameInput = document.getElementById("applicant-name");
  const issueDateInput = document.getElementById("issue-date");
  const printedSignerNameInput = document.getElementById("printed-signer-name");
  const signerTitleInput = document.getElementById("signer-title");
  const countryOfIssueInput = document.getElementById("country-of-issue");
  const signaturePresentInput = document.getElementById("signature-present");
  const runButton = document.getElementById("run-validation");
  const jsonOutput = document.getElementById("json-output");
  const findingsOutput = document.getElementById("findings-output");

  if (!issueDateInput.value) {
    issueDateInput.value = new Date().toISOString().slice(0, 10);
  }

  function renderFindings(findings) {
    if (!findings.length) {
      findingsOutput.innerHTML = "<p>No findings returned.</p>";
      return;
    }

    const groups = [
      { title: "Recipient", matches: (ruleId) => ruleId.includes("RECIPIENT") },
      { title: "Dates", matches: (ruleId) => ruleId.includes("DATE") || ruleId.includes("VALIDITY") },
      {
        title: "Signature & Authority",
        matches: (ruleId) => ruleId.includes("SIGNATURE") || ruleId.includes("AUTHORITY"),
      },
      { title: "Other Required Fields", matches: () => true },
    ];
    const remaining = findings.slice();
    const groupedFindings = groups
      .map((group) => {
        const items = remaining.filter((finding) => group.matches(finding.ruleId));
        items.forEach((item) => remaining.splice(remaining.indexOf(item), 1));
        return { ...group, items };
      })
      .filter((group) => group.items.length);

    findingsOutput.innerHTML = groupedFindings
      .map(
        (group) => `
          <section class="finding-group">
            <h3>${group.title}</h3>
            ${group.items
              .map(
                (finding) => `
                  <article class="finding">
                    <div class="finding-header">
                      <strong>${finding.status}</strong>
                      <span>${finding.ruleId}</span>
                    </div>
                    <p>${finding.message}</p>
                    <p><b>Customer guidance:</b> ${finding.customerGuidance.summary}</p>
                    <p><b>Analyst guidance:</b> ${finding.analystGuidance.summary}</p>
                    <p><b>Decision:</b> ${finding.decision.outcomeReason}</p>
                  </article>
                `
              )
              .join("")}
          </section>
        `
      )
      .join("");
  }

  async function runValidation() {
    const file = fileInput.files && fileInput.files[0];
    const engine = new window.ValidationEngineModule.ValidationEngine({
      validators: [
        new window.RecipientValidator(),
        new window.RequiredFieldValidator(),
        new window.DateValidator(),
        new window.ValidityValidator(),
        new window.SignatureValidator(),
        new window.AuthorityValidator(),
      ],
    });
    const extractedValues = {
      applicantName: applicantNameInput.value.trim(),
      recipientName: extractedRecipientInput.value.trim(),
      issueDate: issueDateInput.value,
      signaturePresent: signaturePresentInput.checked,
      printedSignerName: printedSignerNameInput.value.trim(),
      signerTitle: signerTitleInput.value.trim(),
      countryOfIssue: countryOfIssueInput.value.trim(),
    };
    const extractionBundle = buildManualExtraction(extractedValues);

    const result = await engine.validate({
      market: marketInput.value,
      documentType: "LOA",
      applicationContext: {
        recipientName: expectedRecipientInput.value.trim(),
      },
      requirementContext: {
        entityType: entityTypeInput.value,
      },
      extraction: extractionBundle.extraction,
      evidence: extractionBundle.evidence,
      document: file
        ? {
            name: file.name,
            type: file.type,
            size: file.size,
          }
        : {
            name: "No file selected",
            type: "application/octet-stream",
            size: 0,
          },
    });

    jsonOutput.textContent = JSON.stringify(result, null, 2);
    renderFindings(result.findings);
  }

  runButton.addEventListener("click", () => {
    runValidation().catch((error) => {
      jsonOutput.textContent = JSON.stringify(
        {
          status: "FAIL",
          message: error.message,
        },
        null,
        2
      );
      findingsOutput.innerHTML = "<p>Validation could not run. Check the structured JSON panel.</p>";
    });
  });

  function buildManualExtraction(values) {
    const fields = {};
    const evidence = [];

    Object.keys(values).forEach((fieldName) => {
      const value = values[fieldName];
      const hasValue = typeof value === "boolean" ? value : String(value || "").trim().length > 0;
      if (!hasValue) return;

      const evidenceId = `ev_${fieldName}`;
      fields[fieldName] = {
        value,
        evidenceRefs: [evidenceId],
      };
      evidence.push({
        evidenceId,
        type: "extracted_field",
        source: `extraction.fields.${fieldName}`,
        field: fieldName,
        value,
        text: String(value),
        pageNumber: 1,
        boundingBox: null,
        confidence: null,
        origin: "validation_lab_manual",
        capturedAt: new Date().toISOString(),
      });
    });

    return {
      extraction: {
        text: Object.values(values).join(" "),
        fields,
        pages: [],
        extractionMetadata: {
          provider: "validation-lab-manual",
        },
      },
      evidence,
    };
  }
})();
