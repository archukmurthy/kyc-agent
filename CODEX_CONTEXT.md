CODEX SESSION CONTEXT — Intelligence-Led KYC/KYB Onboarding Platform
Read this before starting any work. Do not skip it.

═══════════════════════════════════════
WHAT WE ARE BUILDING
═══════════════════════════════════════

An AI-powered KYC/KYB onboarding platform
for Nium (operating under Instarem). It
researches companies automatically, pre-fills
compliance forms from official sources, and
collects remaining information from the
customer.

Stack:
  React/Vite frontend (src/App.js — 4000+ lines)
  Vercel Serverless Functions (api/*.js)
  Neon Postgres (22 tables)
  Anthropic Claude API (claude-sonnet-4-20250514)
  Vercel KV (tenant config)

Live URL: https://kyc-agent-deploy.vercel.app
Repo: archukmurthy-3271s-projects/kyc-agent-deploy

═══════════════════════════════════════
THE TWO AGENTS
═══════════════════════════════════════

ONBOARDING AGENT (main flow — fully built)
  Customer journey:
  Company → Research → Applicant →
  Confirm → Fill Gaps → Required Docs →
  Declaration

  The Applicant step (Step 3) is a standalone
  page where the customer identifies themselves
  from a dropdown of known directors/UBOs.

PRE-BOARDING AGENT (analyst tool — built)
  Analyst runs research on a company before
  the customer is invited. Saves a dossier.
  Analyst sends an invite link. Customer
  clicks the link and starts at the Applicant
  step — the dossier pre-populates everything.

  Access: /?preboarding=1 password: ARCH

═══════════════════════════════════════
THE DATABASE — TWO SEPARATE STORES
═══════════════════════════════════════

entity_dossiers
  Analyst pre-boarding intelligence.
  READ-ONLY after creation.
  Contains: raw_research (full research.found
  with .stakeholders intact), verified_data,
  probable_data, indicative_data, stakeholders
  (keyed by field), ownership_type,
  entity_type, country_code, coverage columns.

onboarding_sessions + field_provenance +
session_timeline
  Customer submission data.
  Written during and after onboarding.

journey_state
  NOT YET BUILT — planned for week of
  28 Jun 2026. Will store customer form
  progress for save-and-resume.

NEVER merge entity_dossiers and journey_state.
They are intentionally separate.

═══════════════════════════════════════
CRITICAL FUNCTION — loadDossierAndStartOnboarding()
═══════════════════════════════════════

This function runs when a customer clicks
the invite link (?dossierId=&journey=customer)
or when the analyst clicks Preview.

It MUST restore ALL of these from the dossier
or downstream steps will be broken:

  setCompanyName(d.company_name)
  setEntityType(d.entity_type)
  setCountryCode(d.country_code)
  setOwnershipType(d.ownership_type)   ← critical
  setActiveSchema(...)                  ← from entity_type + country_code
  setCoverage(...)                      ← from broken-out coverage columns
  setResearch({ found: raw_research.found })
  setDossierStakeholders(d.stakeholders)
  setDossierId(dossierId)
  setAgentType("onboarding")
  setJourneyType("ai_only")
  setStep(stepsFor("ai_only").applicant)

Missing any of these breaks a specific step:
  ownershipType missing → Required Docs empty
  .stakeholders missing → Confirm page no people
  activeSchema missing → Fill Gaps empty

═══════════════════════════════════════
WHAT IS CURRENTLY BROKEN / IN PROGRESS
═══════════════════════════════════════

ON THIS BRANCH (codex/ubo-discovery-framework):

1. Companies House Officers API (commit 047878c)
   BUILT BUT NOT WORKING YET.
   Requires a REST/Public Data API key —
   the current COMPANIES_HOUSE_API_KEY is
   a Streaming key and returns 401.
   When the correct key is provided, this
   will deterministically fetch all active
   directors for UK companies instead of
   relying on AI web search snippets.
   Files: agents/registries/companiesHouseOfficers.js
          lib/applyOfficersLayer.js
          (changes to api/research.js and
          src/pipeline.js on this branch)

2. UBO Discovery Framework
   BUILT — not yet merged to main.
   Full agent package for beneficial ownership
   analysis. Separate from the main KYC flow.
   Files: agents/ubo/*
          api/ubo-discovery.js
          public/ubo-lab.html
   To activate Neon audit trail:
   node db/apply.js db/migrations/009_ubo_investigations.sql

ON MAIN (deployed):

3. Director extraction incomplete for
   large companies (e.g. Tesco PLC returns
   1 director instead of 11).
   Will be fixed by item 1 above once the
   correct API key is in place.

4. docSearchResults and selfSourceResults
   not restored on the invite link path.
   The document checklist now works
   (ownershipType was fixed 22 Jun 2026)
   but auto-sourced document panels are
   empty for invite-link customers.

═══════════════════════════════════════
WHAT NOT TO TOUCH
═══════════════════════════════════════

See AGENTS.md in the repo root for the
full DO NOT TOUCH list and all build rules.

Key ones for Codex specifically:
  src/App.js — touch ONLY the function
    named in your task
  api/research.js — changes here affect
    the entire research pipeline
  src/pipeline.js — prompt builder,
    director validation, schema definitions
  db/migrations/*.sql — never modify
    existing migrations

═══════════════════════════════════════
WHERE TO FIND THINGS
═══════════════════════════════════════

Research pipeline:
  api/research.js → src/pipeline.js
  → buildPrompt() → validateAllDirectors()
  → validateSharePercentage()

Dossier save/load:
  api/save-dossier.js (write)
  api/get-dossier.js (read)
  src/App.js → loadDossierAndStartOnboarding()
  src/App.js → buildDossierPayload()

Applicant step:
  src/App.js → renderApplicantPage()
  src/App.js → getApplicantCandidates()
  src/App.js → buildApplicantProvenance()

Stakeholder validation:
  src/pipeline.js → validateAllDirectors()
  src/pipeline.js → validateDirectorRecord()
  src/pipeline.js → validateSharePercentage()

Document requirements:
  api/document-requirements.js
  src/hooks/useDocumentRequirements.js
  src/components/Step2DynamicForm.jsx

Schema definitions:
  src/pipeline.js → UK_SCHEMA, SG_SCHEMA,
  UK_FI_SCHEMA, SG_FI_SCHEMA, getSchema()

Database migrations:
  db/migrations/ (apply with db/apply.js)
  Current tables: tenants, clients,
  onboarding_sessions, field_values,
  field_provenance, evidence_items,
  session_timeline, entity_dossiers,
  research_cache, journey_state (planned)

Test scripts:
  scripts/check-applicant-overrides.js
  scripts/test-ch-officers.js

═══════════════════════════════════════
TAGGING CONVENTION
═══════════════════════════════════════

All Codex commits must use [CODEX] prefix:
  [CODEX] feat: UBO recursive ownership
  [CODEX] fix: handle trust structures
  [CODEX] chore: update UBO handoff docs

Push to origin/codex/ubo-discovery-framework.
Do NOT push to main without explicit
instruction and a completed smoke test.