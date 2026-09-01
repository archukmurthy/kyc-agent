# Decision 0023: versioned customer-input application boundary

Status: accepted for G5.3C

Decision Application v1 remains the default exact `intake`, `applyDecisions`, `evaluate` contract. Callers opt into `ubo-decision-application-v2` explicitly to obtain `applyCustomerInput`; this preserves G3 Discovery integrations and makes operation-set negotiation deliberate.

`applyCustomerInput` treats `ubo-customer-action-v1` as untrusted interaction data. It verifies the current sealed case revision, source DecisionSnapshot, deterministic ResolutionPlan and all planned customer-work references before recording anything. Evaluation stays separate.

Structured customer relationships become customer-originated candidate claims, not graph edges. New natural people require explicit case-scoped registration and a submission-local key. Names, DOB, provider IDs and similarity are never identity rules. Existing entities resolve only by explicit canonical reference or one exact namespace/value identifier with one case match. Confirmation and negative attestation are answers; correction is an open review target; senior-management data is preparatory; an alternative selection is not proof.

Evidence actions return `EXTERNAL_EVIDENCE_REQUIRED` metadata only. Files, uploads, Artifact creation, extraction and Evidence Platform integration remain outside this boundary.
