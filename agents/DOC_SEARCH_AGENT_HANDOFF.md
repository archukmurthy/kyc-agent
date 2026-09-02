# Doc Search Sub-Agent — Handoff Prompt
# For use in: main KYC agent system prompt or agent orchestration layer
# Owner: [assign to developer]
# Last updated: 2026-06-07

> ⚠ PRODUCTION READINESS — PR-001
> The ownership type mapping in
> agents/docSearchAgentCall.js is
> hardcoded. If new entity types or
> ownership types are added via the
> admin UI they will be silently
> misclassified. See
> PRODUCTION_READINESS.md PR-001 for
> the permanent config-driven fix.

---

## What this agent does

You have access to a separate document search sub-agent (`docSearchAgent`).
Its sole job is to locate, verify, and download official compliance and financial
documents for a target company. You do not perform document searches yourself —
you delegate that entirely to this agent.

---

## When to call it

Call the doc search agent immediately after you have confirmed the following
fields from your KYC/KYB data collection:

- Company name (full legal name)
- Country of registration
- Ownership type (see classification rules below)
- Entity category

Do not wait until the full dossier is complete. Document retrieval can run in
parallel with other enrichment steps.

---

## How to call it

```js
// Use the pre-built integration snippet:
const { callDocSearchAgent } = require(
  "./agents/docSearchAgentCall"
);

// Call after Step 1 is complete:
const documentPayload = await callDocSearchAgent({
  company,          // { name, countryName, code }
  entityType,       // "FI"|"Corporate"|"Platform"|"Direct"
  ownershipType,    // from OWNERSHIP_TYPE_LIBRARY
  effectivelyListed // isPubliclyListed || isPubliclyListedOverride
});

// documentPayload contains:
// { documents, documentSummary, documentCost, caseId }
```

---

## Ownership type translation

The main KYC agent uses different
terminology. Use mapToDocAgentOwnershipType()
from agents/docSearchAgentCall.js to
translate automatically. Do not translate
manually.

For reference, the mapping is:

| Main agent entityType | Main agent ownershipType | effectivelyListed | Doc agent ownershipType |
|---|---|---|---|
| "FI" | any | any | "public_fi" (if listed) or "fi_only" |
| any | "payment_institution" | false | "fi_only" |
| any | "correspondent_bank" | false | "fi_only" |
| any | "investment_fund" | false | "fi_only" |
| any | "insurance_company" | false | "fi_only" |
| any | "central_bank" | false | "fi_only" |
| any | "public_listed" | true | "public_only" (if not FI) |
| "Corporate" | "private_limited" | false | "corporate" |
| "Platform" | any | false | "corporate" |
| "Direct" | any | false | "corporate" |

effectivelyListed =
  isPubliclyListed || isPubliclyListedOverride
(computed in main agent after research completes)

---

## Document retrieval logic (handled inside the agent — do not re-implement)

| ownershipType | Documents the agent retrieves |
|---|---|
| `public_fi` | Wolfsberg Questionnaire + Annual Report |
| `fi_only` | Wolfsberg Questionnaire only |
| `public_only` | Annual Report only |
| `corporate` | Annual Report (best effort) |

---

## What the agent returns

```js
docResult = {
  companyName: "HSBC Holdings plc",
  country: "United Kingdom",
  ownershipType: "public_fi",
  entityCategory: "fi",

  documents: [
    {
      type: "wolfsberg_questionnaire",
      label: "Wolfsberg Questionnaire",
      filename: "HSBC_Holdings_plc_Wolfsberg_Questionnaire_2026.pdf",
      year: 2026,
      status: "downloaded",        // "downloaded" | "url_found" | "download_failed" | "not_found" | "error"
      sourceUrl: "https://...",
      sourceLabel: "Company compliance page",
      confidence: "high",          // "high" | "medium" | "low"
      localPath: "./downloads/HSBC_Holdings_plc_Wolfsberg_Questionnaire_2026.pdf",
      searchAttempts: ["source1", "source2"],
      cost: {
        inputTokens: 2841,
        outputTokens: 187,
        totalCostUSD: 0.01133
      }
    },
    {
      type: "annual_report",
      // ... same shape
    }
  ],

  summaryTable: [
    {
      "Company Name": "HSBC Holdings plc",
      "Document Type": "Wolfsberg Questionnaire",
      "Publication Year": 2026,
      "Source URL": "https://...",
      "Download Status": "downloaded",
      "File Name": "HSBC_Holdings_plc_Wolfsberg_Questionnaire_2026.pdf",
      "Input Tokens": 2841,
      "Output Tokens": 187,
      "Cost (USD)": "$0.01133",
      "Notes": ""
    }
  ],

  summary: {
    found: 2,
    notFound: 0,
    total: 2
  },

  cost: {
    model: "claude-sonnet-4-20250514",
    calls: [ /* per-call breakdown */ ],
    totals: {
      inputTokens: 5495,
      outputTokens: 390,
      totalTokens: 5885,
      inputCostUSD: 0.01649,
      outputCostUSD: 0.00585,
      totalCostUSD: 0.02234
    }
  },

  searchedAt: "2026-06-07T10:23:00Z",
  outputDir: "./downloads/case-001"
}
```

---

## How to add the result to the dossier

```js
kycDossier.documents       = docResult.documents;
kycDossier.documentSummary = docResult.summaryTable;
kycDossier.documentCost    = docResult.cost;
```

Pass `docResult.cost.totals` up to your master cost aggregator if you are
tracking total spend across all sub-agents for this onboarding session.

---

## How to handle missing documents

If `document.status === "not_found"` for a required document type:

1. Flag it in the dossier under `kycDossier.gaps`.
2. Log the `searchAttempts` array so the reviewer knows where the agent looked.
3. Do NOT retry automatically — the developer who owns the doc search agent
   is responsible for improving search coverage. Raise a task for them.
4. For Wolfsberg specifically: if not found, note it as a manual follow-up
   item for the MLRO. It should not block the dossier from progressing.

---

## What you must NOT do

- Do not implement your own document search logic. All document retrieval goes
  through `docSearchAgent`.
- Do not hardcode document URLs. The agent handles source discovery.
- Do not modify files inside `./agents/docSearchAgent.js` — that file is owned
  by a separate developer. Raise issues via your team's task tracker.

---

## For the developer taking over doc search agent development

The file you own is: `./agents/docSearchAgent.js`

Your interface contract with the main agent is:
- **Input**: `{ companyName, country, ownershipType, entityCategory, outputDir? }`
- **Output**: the `docResult` shape shown above — do not change field names or
  remove fields without coordinating with the main agent developer.

The `PRICING` constants and `CostTracker` class are exported from the file —
update `PRICING` if the model or rates change.

Backlog of improvements to build out:
- [ ] Retry logic with exponential backoff on download failure
- [ ] Caching layer — skip re-search if document already downloaded for this company within N days
- [ ] Wolfsberg Group API integration if one becomes available
- [ ] SEC EDGAR direct API integration for US-registered companies
- [ ] Support for additional document types (e.g. SOC 2, PCI DSS certificate)
- [ ] Batch mode — process multiple companies in one run at 50% API cost discount
- [ ] Confidence scoring improvements — cross-validate URL against company domain
- [ ] Webhook/callback support so main agent can be notified async when docs are ready
