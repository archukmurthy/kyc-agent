# 02 — UK Corporate Policy Pack v1.6-RC Change Specification

**Baseline reviewed:** UK Corporate v1.5-RC, schema 1.2  
**Target:** UK Corporate v1.6-RC  
**Proposed schema:** 1.3  
**Status:** CONTROL ROOM CHANGE SPEC — not the final JSON artifact

---

# 1. Purpose

Create a successor pack that expresses the frozen doctrine without hard-coding it in UBO domain/UI code.

Historical v1.5-RC remains immutable.

v1.6-RC may remain `CONTROL_ROOM_REVIEW` until File 08 release-blocking sign-offs are complete.

---

# 2. Required top-level additions

```jsonc
{
  "policy_id": "UBO-UK-CORPORATE",
  "version": "1.6-RC",
  "schema_version": "1.3",
  "status": "CONTROL_ROOM_REVIEW",
  "supersedes": "1.5-RC",

  "legal_baseline": {
    "statute": "MLR_2017_AS_AMENDED_THROUGH_SI_2026_621",
    "supervisor_profile": "JMLSG",
    "psc_interpretation_profile": "IN_FORCE_UK_PSC_GUIDANCE",
    "transitional_guidance_note": "JMLSG published guidance is being updated for SI 2026/621",
    "delta_memo_ref": "SIGNOFF-A08"
  }
}
```

A pack may not become production-approved without:

- non-null effective date;
- approving authority;
- legal baseline identity;
- policy hash;
- all release-blocking sign-offs.

---

# 3. Qualification doctrine

Add a data-only qualification doctrine.

```jsonc
{
  "qualification_doctrine": {
    "person_qualifies_when": "ANY_APPLICABLE_STATUTORY_ROUTE_SATISFIED",
    "record_all_qualifying_bases": true,
    "routes": [
      {
        "id": "MANAGEMENT_CONTROL",
        "legal_basis": "MLR_2017_REG_5_1_A",
        "method": "EVIDENCE_AND_REVIEW_ASSESSMENT"
      },
      {
        "id": "EFFECTIVE_INTEREST",
        "legal_basis": "MLR_2017_REG_5_1_B",
        "method": "ubo-percentage-lookthrough-v1",
        "method_status": "ADOPTED_INTERPRETATION",
        "dimensions": ["ECONOMIC", "VOTING"]
      },
      {
        "id": "PSC_CONDITION_ATTRIBUTION",
        "legal_basis": "MLR_2017_REG_5_1_C_AND_5_2_A_CA_2006_SCH_1A",
        "method": "ubo-psc-attribution-v1",
        "method_status": "STATUTORY_ATTRIBUTION_SEMANTICS",
        "conditions": [
          "SHARES_GT_THRESHOLD",
          "VOTING_GT_THRESHOLD",
          "APPOINT_REMOVE_MAJORITY",
          "SIGNIFICANT_INFLUENCE_OR_CONTROL",
          "TRUST_OR_FIRM_CONDITION"
        ],
        "indirect_attribution": "MAJORITY_STAKE_CHAIN"
      }
    ]
  }
}
```

Exact company and LLP mappings must remain sign-off gated until verified.

---

# 4. Threshold model

Replace one lowerable statutory threshold with separate statutory and firm-policy concepts.

```jsonc
{
  "statutory_thresholds": {
    "economic": {
      "value": 25,
      "comparator": ">",
      "classification": "MANDATORY",
      "legal_basis": "MLR_2017_REG_5_1_B"
    },
    "voting": {
      "value": 25,
      "comparator": ">",
      "classification": "MANDATORY",
      "legal_basis": "MLR_2017_REG_5_1_B"
    }
  },

  "firm_collection_threshold": {
    "enabled": false,
    "value": null,
    "comparator": null,
    "classification": "FREE_WITHIN_STRICTER_THAN_STATUTE",
    "projected_role": "firm_policy_qualifying_person",
    "never_projects_statutory_role": true
  }
}
```

Do not permit a configured firm threshold to suppress statutory qualification.

---

# 5. Firm layer-holder collection

Add only as an explicitly deferred feature descriptor.

```jsonc
{
  "firm_layer_holder_collection": {
    "status": "DEFERRED_FUTURE_FIRM_POLICY",
    "enabled": false,
    "requires_firm_sop": true,
    "projected_role": "firm_policy_qualifying_person"
  }
}
```

No runtime implementation is authorised in this cycle.

---

# 6. Layer completeness doctrine

```jsonc
{
  "layer_completeness_doctrine": {
    "scope": "PER_LAYER_PER_DIMENSION",
    "closure_method": "INTERVAL_RESIDUAL_TEST",
    "outputs": [
      "STATUTORY_CLOSURE",
      "FIRM_POLICY_CLOSURE",
      "EXACTNESS_NEEDED_FOR_DETERMINATION"
    ],
    "qualifiers": [
      "HOLDERS_IDENTIFIED",
      "COMPATIBLE_DENOMINATOR",
      "SHARE_CLASS_TREATMENT_ESTABLISHED_OR_NON_MATERIAL",
      "NON_OVERLAPPING_INTERESTS",
      "CURRENTNESS_SUFFICIENT",
      "NO_MATERIAL_CONTRADICTION",
      "NO_OPEN_RELEVANT_JOINT_ARRANGEMENT"
    ],
    "precision_escalation": "ONLY_WHEN_ACTIVE_DETERMINATION_STRADDLES"
  }
}
```

The engine owns arithmetic. The pack owns which closure output matters.

---

# 7. Percentage evidence states

```jsonc
{
  "percentage_evidence_states": [
    "DECLARED_EXACT",
    "INDEPENDENT_BAND_CORROBORATED",
    "EXACT_VALUE_VERIFIED"
  ],

  "declared_exact_within_independent_band": {
    "result": "INDEPENDENT_BAND_CORROBORATED",
    "exact_value_verification": false,
    "sufficiency_by_risk": "REQUIRES_SIGNOFF_A03",
    "outside_band": "CONFLICT_THEN_R09_ASSESSMENT"
  }
}
```

Do not implement automatic exact-value verification from registry consistency.

---

# 8. Control action gating

```jsonc
{
  "control_action_gating": {
    "assess_at_regulated_subject": "ALWAYS",
    "intermediary_control_need_when": [
      "ON_RELIED_ATTRIBUTION_CHAIN",
      "POSITIVE_CONTROL_SIGNAL_PRESENT",
      "QUALIFYING_LEGAL_ENTITY_RIGHT_NEEDS_NATURAL_PERSON",
      "CONTROL_FACT_MATERIAL_TO_UNRESOLVED_STATUTORY_ROUTE"
    ],
    "numeric_customer_control_questions": {
      "mode": "LAST_RESORT_GATED",
      "conditions": [
        "FACT_MATERIAL",
        "EXISTING_FACTS_INSUFFICIENT",
        "DISCOVERY_NOT_REASONABLY_AVAILABLE_OR_INSUFFICIENT",
        "GOVERNANCE_EVIDENCE_NOT_REASONABLY_AVAILABLE_OR_INSUFFICIENT",
        "RESPONDENT_AUTHORISED_AND_PLAUSIBLY_KNOWLEDGEABLE",
        "POLICY_PERMITS_CUSTOMER_ORIGINATED_INPUT",
        "CORROBORATION_OR_REVIEW_FOLLOWS_WHERE_REQUIRED"
      ]
    }
  }
}
```

No generic per-intermediary control question.

---

# 9. Residual confirmation bundle

One presentation bundle; separate stored statements.

```jsonc
{
  "residual_confirmation_bundle": {
    "presentation": "SINGLE_INTERACTION",
    "availability": {
      "maximum_risk": "REQUIRES_SIGNOFF_A02",
      "requires_structure_sufficiently_understood": true,
      "blocked_by_positive_contrary_signal": true
    },
    "statements": [
      {
        "id": "NO_UNDISCLOSED_OTHER_SIGNIFICANT_CONTROL",
        "resolves_requirement": "UBO-R06",
        "content_status": "REQUIRES_MLRO_LEGAL_SIGNOFF"
      },
      {
        "id": "NO_TRUST_OR_SIMILAR_ARRANGEMENT",
        "resolves_requirement": "UBO-R11",
        "content_status": "REQUIRES_MLRO_LEGAL_SIGNOFF"
      },
      {
        "id": "NO_NOMINEE_OR_BEARER_ARRANGEMENT",
        "resolves_requirement": "UBO-R12",
        "content_status": "REQUIRES_MLRO_LEGAL_SIGNOFF"
      },
      {
        "id": "NO_RELEVANT_JOINT_ARRANGEMENT",
        "resolves_qualifier": "LAYER_COMPLETENESS_JOINT_ARRANGEMENT",
        "content_status": "REQUIRES_MLRO_LEGAL_SIGNOFF"
      },
      {
        "id": "FINAL_STRUCTURE_COMPLETENESS_CONFIRMATION",
        "resolves_requirement": "UBO-R14",
        "content_status": "REQUIRES_MLRO_LEGAL_SIGNOFF"
      }
    ],
    "independent_statement_results": true
  }
}
```

One positive statement branches only that statement.

---

# 10. Listed treatment

```jsonc
{
  "listed_treatment": {
    "customer_listed": {
      "status": "SUPPORTED_SUBJECT_TO_EVIDENCE",
      "authority": "MLR_2017_REG_28_5",
      "requires": ["QUALIFYING_MARKET", "LISTING_EVIDENCE"],
      "route": "listed_entity_policy"
    },
    "customer_consolidated_subsidiary_of_listed": {
      "status": "REQUIRES_SIGNOFF_A07",
      "authority": "JMLSG_CUSTOMER_LEVEL_TREATMENT",
      "requires": [
        "QUALIFYING_LISTING",
        "MAJORITY_OWNERSHIP",
        "CONSOLIDATION"
      ]
    },
    "intermediate_listed_parent_terminus": {
      "enabled": false,
      "status": "REQUIRES_SIGNOFF_A01",
      "requires_market_list": true,
      "requires_listing_and_disclosure_evidence": true
    }
  }
}
```

Do not use one generic listed short-circuit.

---

# 11. Exhaustion measure categories

Replace any universal mandatory checklist.

```jsonc
{
  "exhaustion_measure_categories": [
    "AVAILABLE_DISCOVERY",
    "STRUCTURE_EVIDENCE",
    "TARGETED_RELATIONSHIP_EVIDENCE",
    "CONTROL_ROUTE_ASSESSMENT",
    "CUSTOMER_RESOLUTION",
    "ANALYST_INVESTIGATION"
  ],
  "allowed_dispositions": [
    "EXECUTED",
    "UNAVAILABLE",
    "IRRELEVANT",
    "DISPROPORTIONATE"
  ],
  "reason_required_for_non_executed": true,
  "authorised_exhaustion_decision_origins": ["ANALYST", "COMPLIANCE"]
}
```

The category list itself remains subject to A10 sign-off.

---

# 12. Structure acquisition policy hooks

The acquisition strategy is principally Planner configuration.

The pack should expose only policy-relevant constraints:

```jsonc
{
  "structure_acquisition": {
    "allowed_strategies": [
      "DISCOVERY_LED",
      "CHART_ASSISTED",
      "SPECIALIST"
    ],
    "chart_is_candidate_structure_not_proof": true,
    "permitted_structure_evidence": [
      "OWNERSHIP_CHART",
      "CAP_TABLE",
      "SHAREHOLDER_REGISTER",
      "GROUP_STRUCTURE_NOTE",
      "REGISTRY_EXTRACT",
      "LEGAL_OR_ACCOUNTING_STRUCTURE_MEMO",
      "JURISDICTION_EQUIVALENT"
    ]
  }
}
```

Provider/jurisdiction capability remains outside the pack.

---

# 13. Phased evaluation order

```jsonc
{
  "phased_evaluation_order": [
    "BASE_APPLICABILITY",
    "CANONICAL_GRAPH_AND_DEPTH",
    "CALCULATIONS_AND_ATTRIBUTIONS",
    "QUALIFICATION",
    "DERIVED_REQUIREMENT_APPLICABILITY",
    "EVIDENCE_SUFFICIENCY",
    "INFORMATION_NEEDS",
    "RESOLUTION_PLANNING",
    "DECISION_SNAPSHOT"
  ]
}
```

Expressions may reference only same/earlier approved inputs, never future phases.

---

# 14. RegistryCapabilityProfile pinning

Do not make the RegistryCapabilityProfile a legal-policy artifact.

Require DecisionSnapshot/ResolutionPlan metadata:

```jsonc
{
  "registry_capability_profile_ref": {
    "id": "...",
    "version": "...",
    "hash": "...",
    "entitlement_context": "...",
    "capabilities_asserted": ["..."]
  }
}
```

The profile is owned by capability/configuration infrastructure.

---

# 15. Requirement rescoping

## R01 — ultimate economic interest

- evaluate at the regulated subject;
- generate frontier/relationship needs, not one need for every upstream entity;
- use effective-interest and policy closure outputs;
- do not mark natural persons UBO solely because they are terminal.

## R02 — indirect calculations

- applicability derives from graph depth and active calculations;
- never caller-supplied `ownership_layers`;
- relationship/blocking-edge needs only.

## R03 — intermediate structure/evidence

- applicability derives from graph;
- one structural/frontier need per causal gap;
- existence and relationship proof remain separate.

## R04 — voting

- subject-level applicable assessment;
- intermediary needs only on a relied control/attribution chain or positive signal;
- no universal numeric customer question.

## R05 — appointment/removal

- subject-level assessment;
- preserve source combined/alternative semantics;
- majority scope must be established before automatic qualification.

## R06 — other/management control

- deterministic positive evidence or review;
- negative leg may be part of residual bundle after sign-off;
- ambiguous/de facto cases route to review.

## R07 — qualifying-person identity attributes

- applicability derives from actual qualifying-person output;
- collect only missing attributes;
- downstream IDV/POI/POA remains outside UBO.

## R08 — corroboration

- one subject/structure-level requirement;
- distinct evidence sources, not one per extracted fact;
- band consistency does not equal exact verification.

## R09 — PSC discrepancy

Add difference taxonomy:

- `REGISTER_SCOPE_DIFFERENCE`
- `METHOD_DIFFERENCE`
- `TIMING_STALENESS`
- `MATERIAL_DISCREPANCY`

Only analyst-confirmed material discrepancy produces a host-facing Reg 30A report candidate.

## R10 — SMO fallback

- preserve current asynchronous architecture;
- use measure-category dispositions;
- preserve written manifest;
- no automatic fallback from NO_DATA.

## R11 / R12

- positive signals remain independent;
- negative legs may be bundled but recorded separately;
- specialist routing where applicable.

## R13

- retain UBO risk-signal output only;
- no host risk mutation.

## R14

- final completeness statement remains distinct;
- cannot cure other requirements;
- may be presented in the residual bundle.

---

# 16. Production approval guard

Runtime must reject or visibly hard-block a pack with:

- status not production-approved;
- null effective date;
- missing approving authority;
- unresolved release-blocking content/sign-offs;
- unsupported schema/algorithm combination.

Lab mode may load review packs with a persistent watermark.

---

# 17. Lifecycle events

Replace undefined codes E01/E02/E08/E10 with explicit semantic events or recover their approved source definitions.

No opaque event code may be required for production re-resolution.

Candidates:

- OWNERSHIP_OR_CONTROL_CHANGED
- QUALIFYING_PERSON_CHANGED
- MATERIAL_EVIDENCE_CHANGED
- REGISTRY_DISCREPANCY_CHANGED
- PERIODIC_REVIEW_DUE

Exact mapping requires source recovery/Control Room approval.

---

# 18. Migration and compatibility

- retain v1.5-RC historical artifact and hash;
- do not reinterpret historical DecisionSnapshots;
- new decisions pin v1.6-RC;
- snapshot reconstruction uses historical algorithm/policy versions;
- update contract validators additively;
- do not change DiscoveryService or ExtractionService contracts;
- preserve Decision Application v1/v2 compatibility.

---

# 19. Release-blocking sign-off markers

All unresolved matters must appear as machine-readable policy status, not comments only.

Use an explicit pattern such as:

```jsonc
{
  "approval_state": "REQUIRES_MLRO_OR_LEGAL_SIGNOFF",
  "signoff_id": "A-03"
}
```

The production runtime guard must enforce it.
