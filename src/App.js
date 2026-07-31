import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getTenantId, isPreviewMode } from "./utils/tenant";
import SearchableSelect from "./components/SearchableSelect";
import {
  OWNERSHIP_TYPE_LIBRARY,
  ownershipTypeLabel,
} from "./utils/ownershipTypes";
import Step2DynamicForm, { DocumentUploadCard } from "./components/Step2DynamicForm";
import Step5Recompute from "./components/Step5Recompute";
import ChangeDialogue from "./components/changeDialogue/ChangeDialogue";
import { buildChangeEvent } from "./components/changeDialogue/buildChangeEvent";
import { classifyFieldClass, deriveSource } from "./components/changeDialogue/dialogueContent";
import AmendmentDocuments from "./components/amendmentDocuments/AmendmentDocuments";
import FoundationalFactsGate from "./components/companyConfirm/FoundationalFactsGate";
import ConfirmStep from "./components/companyConfirm/ConfirmStep";
import InlineCorrectionEditor from "./components/companyConfirm/InlineCorrectionEditor";
import AnalystSignalStrip from "./components/companyConfirm/AnalystSignalStrip";
import { buildAnalystSignal } from "./components/companyConfirm/analystSignals";
import { PersonCorrection, PersonRemovalPrompt } from "./components/companyConfirm/PersonCorrection";
import AddPersonPanel from "./components/companyConfirm/AddPersonPanel";
import {
  resolvePersonType,
  personFieldId,
  parsePersonFieldId,
  PERSON_ATTRIBUTE,
  ATTRIBUTE_BY_FIELD_KEY,
} from "./components/companyConfirm/personType";
import { classifyChange } from "./changeIntelligence/classifyChange";
// eslint-disable-next-line no-unused-vars -- setHighRiskCountries is used by the
// SHOW_TEST_TOOLS window affordance below, which the rule does not see.
import {
  personHasHighRiskCountry,
  fieldHasHighRiskCountry,
  setHighRiskCountries,
} from "./changeIntelligence/highRiskCountries";
import { buildSupersedingEvent } from "./components/companyConfirm/supersedingEvent";
import {
  ROW_STATE,
  rowState,
  rowContext,
  computeConfirmCounts,
  submitBlockers,
  blockerSummary,
  canonicalDocs,
  docsNeededFrom,
  docKey,
  isCompanyWideDocType,
  isPerFieldDocType,
  canonicalDocType,
  isGateConfirmedField,
  prefillBreakdown,
  isLowConfidence,
} from "./components/companyConfirm/confirmState";
import { AmendmentDocCard } from "./components/amendmentDocuments/AmendmentDocCard";
import { uploadAmendmentDoc } from "./components/amendmentDocuments/uploadAmendmentDoc";
import { Notice } from "./components/notices/Notice";
import { evaluateSearchCap, LEGAL_NAME_ALERT, CONTACT_ADMIN_MSG } from "./reresearch/searchPolicy";
import { postReresearchFailureFlag } from "./reresearch/failureFlag";
import {
  SOURCE_TRUST,
  getOwnershipTypeOptions,
  computeResearchStrategy,
  getApplicableLicence,
  isStakeholderField,
  isUboLikeField,
  isRegistryExemptionNotice,
  makeStakeholder,
  formatDOBForDisplay,
  formatShareholding,
  enrichStakeholders,
  validateAllDirectors,
  detectPubliclyListed,
  needsStakeholderDetails,
  detectListingEvidence,
  pickLicence,
  getSchemaFromConfig,
  findFieldDef,
  resolveDisplayValue,
  mapAIValuesToOptions,
  classifySourceFromConfig,
  getVerificationStatus,
  computeCoverage,
  hasPlausibleHigherTierSource,
  buildGapRecoveryPrompt,
  mergeResearchResults,
  RESEARCH_TOOLS,
  buildPrompt,
} from "./pipeline";
import { calcCostUsd, buildCostSummary } from "./utils/costs";
import { C } from "./constants/theme";
import {
  SHOW_NIUM_REG_PANEL,
  NIUM_DEMO_REG_NUMBER,
  NIUM_DEMO_COUNTRY,
  OWNERSHIP_ID_TO_DRS,
  TEST_FLAG,
  SHOW_TEST_TOOLS,
  MANUAL_FORM_URL,
  COUNTRIES,
} from "./constants/appConstants";
import {
  DOC_TYPES,
  initialUploadedDocs,
  docTypesForEntity,
  buildPhase1Msgs,
} from "./constants/docTypes";
import {
  LOADER_MSGS,
  LOADER_MSGS_WOLFSBERG_PHASE1,
  LOADER_MSGS_WOLFSBERG_PHASE2,
  DOC_LOADER_MSGS,
} from "./constants/loaderMessages";
import {
  mapExtractedKey,
  normalizeResearchFieldIds,
  selfSourcedToRows,
} from "./utils/extractionMapping";
import {
  buildDemoDocSearchResults,
  buildDemoSelfSourceResults,
  TEST_DATA,
  DUMMY_RESEARCH_VALUES,
} from "./demo/demoData";
import { formatFetchedAt } from "./utils/files";
import { buildLocalDefaultConfig } from "./config/localDefaultConfig";
import { PreviewBanner } from "./components/banners/PreviewBanner";
import { DemoBanner } from "./components/banners/DemoBanner";
import { DemoToggle } from "./components/banners/DemoToggle";
import { StableInput } from "./components/inputs/StableInput";
import { DossierSection } from "./components/dossier/DossierSection";
import { PrePopulatedField } from "./components/inputs/PrePopulatedField";
import {
  mapToDocAgentOwnershipType,
  extractFromDoc,
  preCheckDocForOwnershipType,
} from "./workflows/documentWorkflow";
import {
  genUUID,
  isCorporateStakeholder,
  APPLICANT_FALLBACK_FIELDS,
  getApplicantCandidates as deriveApplicantCandidates,
  buildApplicantProvenance as deriveApplicantProvenance,
} from "./workflows/applicantWorkflow";

// Test affordance, same gate as every other one on this page: the CD-03 EDD
// check runs against an INJECTABLE high-risk list that is empty until the MLRO
// supplies it. Exposing the setter under SHOW_TEST_TOOLS lets the mechanism be
// exercised end-to-end before that list exists. Never present for customers.
if (SHOW_TEST_TOOLS && typeof window !== "undefined") {
  window.__setHighRiskCountries = setHighRiskCountries;
}

export default function KYCAgent({ previewMode = false } = {}) {
  // Tenant config — loaded from /api/config on mount, or from sessionStorage
  // when running in preview mode (the admin "Preview" button stages the
  // current unsaved config under the "preview_config" key).
  //
  // Tenant resolution comes from the URL (?tenant=X) so this component can
  // serve any tenant; "nium" is the default for plain /. Preview mode is
  // either triggered by the /preview route (index.js sets previewMode prop)
  // or by ?preview=true in the URL.
  const [tenantId] = useState(() => getTenantId());
  const [tenantConfig, setTenantConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const inPreview = previewMode || isPreviewMode();
  // Timestamp the staged preview config was captured (admin click time). Shown
  // in the preview banner so the admin can tell whether the tab is stale.
  const [previewTimestamp, setPreviewTimestamp] = useState(null);
  // True when /?preview=true is set but no sessionStorage staged config was
  // found — banner switches to amber + "go to admin" link.
  const [previewMissing, setPreviewMissing] = useState(false);

  // Demo mode — when on, all journeys short-circuit to doDummyResearch so the
  // flow renders instantly with sample data. Initialised from ?demo=true or
  // a prior sessionStorage opt-in so it survives step navigation.
  const [demoMode, setDemoModeState] = useState(() => {
    try {
      const params = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
      if (params && params.get("demo") === "true") return true;
      if (typeof sessionStorage !== "undefined"
          && sessionStorage.getItem("demo_mode") === "true") return true;
    } catch (_) { /* ignore */ }
    return false;
  });
  const setDemoMode = useCallback((next) => {
    setDemoModeState(next);
    try {
      if (next) sessionStorage.setItem("demo_mode", "true");
      else sessionStorage.removeItem("demo_mode");
    } catch (_) { /* ignore */ }
  }, []);
  // Visibility gate — the toggle is hidden on production end-customer URLs.
  // Surfaces when ?demo=true is in the URL, on localhost, or when a ?tenant=
  // override is being used (admin/dev/testing contexts).
  const demoToggleVisible = (() => {
    if (typeof window === "undefined") return false;
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("demo") === "true") return true;
      if (p.get("tenant")) return true;
      const host = window.location.hostname;
      if (host === "localhost" || host === "127.0.0.1") return true;
    } catch (_) { /* ignore */ }
    return false;
  })();

  useEffect(() => {
    let cancelled = false;
    // Preview can be triggered two ways: index.js route /preview (sets the
    // previewMode prop) OR admin Preview button which opens /?preview=true
    // (detected by isPreviewMode()). Both should load the staged config
    // from sessionStorage, not the live /api/config.
    const previewActive = previewMode || isPreviewMode();
    if (previewActive) {
      try {
        // sessionStorage is the canonical channel (written by the admin Preview
        // button). Fall back to legacy localStorage for tabs opened before the
        // sessionStorage migration.
        const raw = sessionStorage.getItem("preview_config")
          || localStorage.getItem("preview_config");
        const ts = sessionStorage.getItem("preview_timestamp")
          || localStorage.getItem("preview_config_ts");
        if (raw) {
          setTenantConfig(JSON.parse(raw));
          setPreviewTimestamp(ts || null);
          setPreviewMissing(false);
          setConfigLoading(false);
          return () => {};
        }
      } catch (_) { /* fall through */ }
      // No staged config — surface this in the banner and fall through to the
      // normal API fetch so the page still has SOMETHING to render.
      setPreviewMissing(true);
    }
    const url = `/api/config?tenant=${encodeURIComponent(tenantId)}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((cfg) => { if (!cancelled) { setTenantConfig(cfg); setConfigLoading(false); } })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("Falling back to local default config:", err.message);
        if (!cancelled) {
          setTenantConfig(buildLocalDefaultConfig());
          setConfigLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [previewMode, tenantId]);

  const [step, setStep] = useState(0);

  // ─── Landing page / agent selection ───
  // The correct pre-boarding access code (kept as a constant, not inlined).
  const PREBOARDING_PASSWORD = "ARCH";
  // Which agent the user selected.
  //   null = on landing page · "onboarding" = existing flow · "preboarding" = pre-boarding agent
  const [agentType, setAgentType] = useState(null);
  // Pre-boarding password gate state.
  const [preboardingUnlocked, setPreboardingUnlocked] = useState(false);
  const [preboardingPassword, setPreboardingPassword] = useState("");
  const [preboardingPasswordError, setPreboardingPasswordError] = useState(false);
  // Pre-boarding: gap fields the analyst excluded from the customer request.
  const [excludedGapFields, setExcludedGapFields] = useState(new Set());
  // Pre-boarding: analyst-authored custom questions (see shape in renderAskMorePanel).
  const [customQuestions, setCustomQuestions] = useState([]);
  // Pre-boarding: which section's "Ask for more" panel is open (sectionName|null).
  const [askMoreOpenSection, setAskMoreOpenSection] = useState(null);
  // Pre-boarding: the custom question currently being built in the open panel.
  const [newQuestion, setNewQuestion] = useState({
    text: "",
    fieldType: "text",
    required: true,
    options: "",
  });
  // Pre-boarding dossier (Part 7).
  const [dossierId, setDossierId] = useState(null);
  // PR: stable per-research-run submission id for the FRESH onboarding flow,
  // which has no dossierId. Used as the change_events key (submissionId) for both
  // the Confirm capture-dialogue WRITE and the Fill Gaps amendment-document READ,
  // so that handoff round-trips. Generated once when research completes (below);
  // cleared in resetAll. Pre-boarding is unaffected: dossierId is non-null there,
  // so `dossierId || onboardingSubmissionId` always resolves to dossierId.
  const [onboardingSubmissionId, setOnboardingSubmissionId] = useState(null);
  // Journey-origin flag: true when the customer landed via an invite link
  // (?dossierId&journey=customer or ?ref) and so never saw the lookup page —
  // Company/Research were done by the analyst before they arrived. This is the
  // SAME "dossier/invite journey" definition the reg-number "you provided this"
  // lock uses (the link-landing URL param; regNumberSource stays null on exactly
  // this journey). Captured as reactive state — not read live from the URL —
  // because resetAll does not clear the URL: clearing this flag on a "wrong
  // company" dispute reset correctly returns the redirected-to-lookup customer
  // to the full 7-step bar. Display-only: drives which step-bar pills show, never
  // routing. Set in the two link-landing paths (loadDossierAndStartOnboarding +
  // the ?ref hydration effect); cleared in resetAll.
  const [landedViaLink, setLandedViaLink] = useState(false);
  const [dossierSaving, setDossierSaving] = useState(false);
  const [dossierSaved, setDossierSaved] = useState(false);

  // Self-serve re-research (front-door "wrong company / wrong type") state.
  //  seededBy          — 'analyst' (default) | 'customer' (after a self-serve dispute)
  //  searchAttempts    — searches already consumed for this dossier (server-read)
  //  pendingReseedMode — null | 'full_research' | 're_derive', set after a dispute
  // seededBy is now always 'analyst': the only writer was the old dossier-reseed
  // dispute, which the foundational-facts gate (slice 2) supersedes with a full
  // reset. Kept as a read-only value so the downstream re-research wiring is
  // unchanged; revive a setter here if customer-seeded reseed is reintroduced.
  const [seededBy] = useState("analyst");
  const [searchAttempts, setSearchAttempts] = useState(0);
  const [pendingReseedMode, setPendingReseedMode] = useState(null);

  // Foundational-facts confirmation gate (slice 2 of 2). Shown at the top of the
  // Applicant page; the applicant section reveals only once all five facts are
  // confirmed. `factChecks` is sparse: a missing key means confirmed (default
  // ticked); a key set false means that fact was disputed. Ownership disputes
  // open `ownershipFork` ('choose' → misclassified|changed); a genuine change is
  // recorded in `ownershipChangeDeclared` and routes to the pending document slot.
  const [factChecks, setFactChecks] = useState({});
  const [ownershipFork, setOwnershipFork] = useState(null); // null | 'choose' | 'changed'
  const [ownershipChangeDeclared, setOwnershipChangeDeclared] = useState(null);
  // Registration/company number has the SAME fork as ownership: untick →
  // misclassified (start over) | genuinely changed (capture new number + request
  // the jurisdiction-appropriate change document, then resolve the gate).
  const [regNumberFork, setRegNumberFork] = useState(null); // null | 'choose' | 'changed'
  const [regNumberChangeDeclared, setRegNumberChangeDeclared] = useState(null);
  const [showDossierView, setShowDossierView] = useState(false);
  const [showInviteScreen, setShowInviteScreen] = useState(false);
  const [inviteContactName, setInviteContactName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  // Scroll to top on every step transition. React keeps the previous scroll
  // position by default — undesirable for a stepped wizard where the new
  // page's heading should be visible immediately. The smooth scroll here
  // is the catch-all; for user-triggered Next clicks we also scroll
  // instantly before the new step renders (see scrollAndSetStep below) so
  // there is no flash of the previous page's bottom.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);
  const scrollAndSetStep = useCallback((next) => {
    if (typeof window !== "undefined") {
      try { window.scrollTo({ top: 0, behavior: "instant" }); }
      catch (_) { window.scrollTo(0, 0); }
    }
    setStep(next);
  }, []);
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [entityType, setEntityType] = useState("");
  // Optional business registration / company number captured on the lookup page
  // (slice 1 of the reg-number initiative). When provided it's used as the
  // PRIMARY search key — fed to the Companies House officers layer (via the
  // `registrationNumber` body field /api/research already accepts) and injected
  // into the web-research prompt. Blank or unresolved silently falls back to the
  // existing name-based search (the company name is always in the prompt+body,
  // so there's no dead end). Provenance is "customer" here (customer-typed);
  // slice 2's confirmation gate verifies it. Distinct from `niumRegNumber`,
  // which is the test-gated Nium-journey field.
  const [regNumber, setRegNumber] = useState("");
  // Provenance of `regNumber`, kept EXPLICIT rather than inferred from whether
  // the string is non-empty. Set to "customer" ONLY by the lookup-page input
  // handler (the customer typed it themselves this session). Every link-landing
  // path (?dossierId / ?ref) leaves it null — even once `regNumber` is later
  // restored from a loaded dossier — so slice 2's FoundationalFactsGate locks
  // the "✓ You provided this" row only for the genuine lookup journey and keeps
  // it verifiable/uncheckable everywhere else.
  const [regNumberSource, setRegNumberSource] = useState(null);
  // Registration number for the Nium API Lookup journey (test mode only). The
  // Nium eKYB publicDetails endpoint searches registries by registration number
  // — a name-only search returns HTTP 400 — so this is required for that one
  // journey. Not used by the AI/manual journeys.
  const [niumRegNumber, setNiumRegNumber] = useState("");
  // Companies House name → reg-number resolver state (test mode only).
  const [niumSearchLoading, setNiumSearchLoading] = useState(false);
  const [niumSearchResults, setNiumSearchResults] = useState(null);
  const [niumSearchError, setNiumSearchError] = useState("");
  // Ownership type (Step 1) — drives the Phase 0 research strategy. Reset to ""
  // whenever the entity type changes, since each entity type exposes a
  // different set of allowed ownership types.
  const [ownershipType, setOwnershipType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [research, setResearch] = useState(null);
  // Coverage analysis (Phase 2) for the current research result. Null until the
  // first research pass completes.
  const [coverage, setCoverage] = useState(null);
  // Whether the Phase 3 gap-recovery second pass ran for the current result.
  const [gapRecoveryRan, setGapRecoveryRan] = useState(false);
  // Transient status line shown on the research loader between/within passes.
  const [researchStatus, setResearchStatus] = useState("");
  const [researchTimestamp, setResearchTimestamp] = useState("");
  // Research result cache (cache-first with force-refresh override). See
  // lib/researchCache.js + api/research.js. `forceRefresh` bypasses the cache;
  // `servedFromCache`/`cachedAt` drive the "Served from cache" badge.
  const [forceRefresh, setForceRefresh] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [servedFromCache, setServedFromCache] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [cachedAt, setCachedAt] = useState(null);
  // DRS (document requirements service) session state. Populated when the
  // customer completes the dynamic documents step; consumed by the
  // pre-declaration gap gate (Step5Recompute).
  const [drsSubmitted, setDrsSubmitted] = useState([]);   // submittedRequirements[]
  const [drsFlags, setDrsFlags] = useState({});           // feature flags from Step 2
  const [drsGapsCleared, setDrsGapsCleared] = useState(false); // declaration gate
  // Derived: is the company being onboarded publicly listed? Drives the
  // stakeholder-EDD suppression on Fill Gaps (listed-company directors and
  // sub-25% UBOs skip the detailed gap form).
  const isPubliclyListed = useMemo(() => detectPubliclyListed(research), [research]);
  const [checks, setChecks] = useState({});
  // PR: durable per-field store for the Confirm change-dialogue working state
  // (answers + progress + emitted), lifted out of the per-field <ChangeDialogue>
  // so it survives the Confirm subtree unmounting on navigation. Without this,
  // leaving Confirm (→ Fill Gaps) and returning re-mounts each dialogue with
  // empty local state and re-asks already-answered questions. Keyed by fieldId;
  // cleared in resetAll. (`checks` itself already persists — it's parent state.)
  const dialogueStateRef = useRef({});
  // MERGE (not replace): the dialogue persists {index, answers, emitted, event,
  // eventId}, while the inline-capture save path (commit 3) stashes its own
  // keys on the same snapshot (lastSavedValue, the chained eventId of the
  // latest superseding write). A replace would clobber whichever side wrote
  // second.
  const persistDialogueState = useCallback((fieldId, snapshot) => {
    if (fieldId != null) {
      dialogueStateRef.current[fieldId] = { ...dialogueStateRef.current[fieldId], ...snapshot };
    }
  }, []);
  // Per-person rejection for stakeholder fields. Shape:
  //   { [fieldId]: Set<stakeholderId> }
  // A stakeholder id present in the set means the customer unchecked that
  // person on Confirm. Sets are recreated immutably on every toggle.
  const [rejectedStakeholders, setRejectedStakeholders] = useState({});
  // Which stakeholder cards are expanded on Confirm, keyed by stakeholder id.
  // Absent / false = collapsed. All cards start collapsed.
  const [expandedStakeholders, setExpandedStakeholders] = useState({});
  // Manual "this is a publicly listed company" toggle on Confirm. When on, it
  // suppresses stakeholder EDD forms on Fill Gaps the same way auto-detection
  // would (see effectivelyListed below).
  const [isPubliclyListedOverride, setIsPubliclyListedOverride] = useState(false);
  // Single source of truth for "treat as listed" — auto-detected OR manually
  // declared on Confirm. Used by the gap forms, validation, the Fill Gaps
  // caller, and the submission payload so the behaviour stays consistent.
  const effectivelyListed = isPubliclyListed || isPubliclyListedOverride;
  const [revealedTs, setRevealedTs] = useState({});
  // Confirm-page affirmation, keyed by FIELD ID (stable across the tier sort —
  // unlike `checks`, which is research.found-index-keyed and must stay that
  // way). Every row arrives pre-ticked, so "ticked" cannot distinguish
  // "customer agreed" from "customer hasn't looked"; ticking a low-confidence
  // row records that agreement here so the Needs-you count can reach zero.
  // Purely additive: it never touches checks, the dialogue, or capture.
  const [affirmedFields, setAffirmedFields] = useState({});
  // The same thing for a PERSON's individual attributes, keyed
  // `<stakeholderId>::<attributeKey>`. Separate map because person attributes
  // are not research.found rows and have no index of their own.
  const [affirmedPersonFields, setAffirmedPersonFields] = useState({});
  // Amendment documents derived server-side from the append-only event store
  // (authoritative in production). Unioned with the LIVE dialogue outcomes so
  // the requirement shows the instant a change is classified — before the
  // round-trip lands, and at all in a DB-less dev environment. De-duped by
  // docType in canonicalDocs so one real document is never asked for twice.
  const [persistedAmendmentDocs, setPersistedAmendmentDocs] = useState([]);
  const [uploadingDocKey, setUploadingDocKey] = useState(null);
  // Which rows have the inline correction editor open (field id → bool). A
  // corrected row renders its value inline and re-opens the editor on demand.
  const [inlineEditOpen, setInlineEditOpen] = useState({});
  const gapRef = useRef({});
  // Per-person stakeholder data on Fill Gaps. Parallel to gapRef, but each
  // field id maps to an array of stakeholder records (objects with full_name,
  // nationality, date_of_birth, is_pep, etc). Kept in a ref so text-field
  // edits don't churn the whole tree every keystroke. setStakeholderVersion
  // is the explicit re-render trigger for changes that need to surface to
  // the UI (add/remove/select/toggle/text).
  const stakeholdersRef = useRef({});
  const [, setStakeholderVersion] = useState(0);
  const [stakeholderErrors, setStakeholderErrors] = useState([]);
  // Per-granular-field green ticks for stakeholders on Confirm, mirroring the
  // per-field `checks` design for regular rows. Shape: { [stakeholderId]:
  // { [fieldKey]: boolean } }. A found field defaults to confirmed (ticked);
  // unticking routes that field to the next page for editing.
  const [stakeholderFieldChecks, setStakeholderFieldChecks] = useState({});
  // bumped whenever we mutate gapRef from outside the input (e.g. test-data fill)
  // so StableInput components re-sync from the new ref values.
  const [, setFormVersion] = useState(0);
  const [declared, setDeclared] = useState(false);
  const [done, setDone] = useState(false);
  const [device, setDevice] = useState({});
  const [loaderIdx, setLoaderIdx] = useState(0);
  const [loaderPhase, setLoaderPhase] = useState(0); // 0 = no Wolfsberg, 1 = extraction, 2 = web research
  const [submitTs, setSubmitTs] = useState("");
  const [activeSchema, setActiveSchema] = useState(null);
  const [uploadedDocs, setUploadedDocs] = useState(initialUploadedDocs());
  // Journey selection (Part 1) — lives between Step 1 input and the rest.
  const [journeyType, setJourneyType] = useState("");          // "ai_documents" | "ai_only" | "manual" | ""
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [selectedJourneyCard, setSelectedJourneyCard] = useState(null); // "A" | "B" | "C"
  const [manualOpened, setManualOpened] = useState(false);
  // Part 5 — silent metadata trail of every pre-fill / customer action.
  const [fieldMetadata, setFieldMetadata] = useState([]);
  // Loader messages — replaced per-run in doResearch when documents are
  // being processed. Phase 0 = web only, Phase 1 = doc extraction, Phase 2 = web.
  const [phase1Msgs, setPhase1Msgs] = useState(LOADER_MSGS_WOLFSBERG_PHASE1);

  // Doc search agent state (Step 2 — Document Intelligence, Section A).
  // null = not yet run; otherwise the /api/doc-search response shape
  // { documents, summaryTable, summary, cost, searchedAt, isDemo? }.
  const [docSearchResults, setDocSearchResults] = useState(null);
  const [docSearchLoading, setDocSearchLoading] = useState(false);
  const [docSearchError, setDocSearchError] = useState(null);
  const [selfSourceResults, setSelfSourceResults] = useState(null);
  // PR-071 — amendment-document uploads (Fill Gaps). Lifted out of
  // AmendmentDocuments so the permanent blobUrls persist in the dossier payload
  // and survive navigating away from Fill Gaps and back. Keyed by fieldId::docType.
  const [amendmentUploads, setAmendmentUploads] = useState({});
  const [selfSourceLoading, setSelfSourceLoading] = useState(false);
  const [selfSourceError, setSelfSourceError] = useState(null);
  useEffect(() => {
    if (agentType !== "preboarding" || activeSchema || !countryCode || !entityType) return;
    try { setActiveSchema(getSchemaFromConfig(countryCode, entityType, tenantConfig)); }
    catch (_) { /* leave schema unset until research resolves it */ }
  }, [agentType, activeSchema, countryCode, entityType, tenantConfig]);
  // Documents-step unified loader: cycles DOC_LOADER_MSGS every 8s while either
  // agent (doc search OR registry self-source) is running.
  const [docLoaderIdx, setDocLoaderIdx] = useState(0);
  // Test/demo only: true once the user clicks "Run real agent" on the Documents
  // step, which hides the button and swaps dummy results for real ones.
  const [hasRunRealAgent, setHasRunRealAgent] = useState(false);
  // Test/demo only: a swallowed registry-agent API error (e.g. billing/credits)
  // captured from the self-source response, so it isn't hidden as "manual".
  const [selfSourceDiag, setSelfSourceDiag] = useState(null);

  // Applicant identity wiring (Fill Gaps → DB). Tracks which director/UBO the
  // applicant identified themselves as, the agent-sourced values shown for each
  // applicant field, and which pre-filled fields the customer changed.
  // applicantSelectedPerson shape: { id, name, role, source, sourceTier, ... };
  // null = not listed / manual. applicantAgentValues: { fieldId: agentValue }.
  // applicantOverrides: [{ fieldId, fieldLabel, agentValue, customerValue, overriddenAt }].
  const [applicantSelectedPerson, setApplicantSelectedPerson] = useState(null);
  const [applicantAgentValues, setApplicantAgentValues] = useState({});
  // Standalone Applicant page: inline required-field validation error, and the
  // dossier stakeholders loaded when a customer arrives via an invite link
  // (?dossierId=&journey=customer) without having run research in this session.
  const [applicantValidationError, setApplicantValidationError] = useState(null);
  // PR-044 — "I am not listed" applicant path. `applicantNotListed` records the
  // EXPLICIT "I am not listed — fill in manually" choice (distinct from "nothing
  // selected yet", which also leaves applicantSelectedPerson null). When set, the
  // applicant must prove authority to act: `authorityToActFile` holds that upload
  // for the session (durable storage is PR-034, out of scope). This document now
  // lives only here — it was removed from the Required Docs checklist.
  const [applicantNotListed, setApplicantNotListed] = useState(false);
  const [authorityToActFile, setAuthorityToActFile] = useState(null);
  // PR-072 — Signatory ID proof, COPIED from the Required Docs section onto the
  // Applicant page and shown for EVERY applicant (unlike authorityToActFile,
  // which is conditional on "not listed"). Its own session-hold slot; durable
  // storage is PR-034, out of scope. NOTE: this Applicant-page slot is
  // INDEPENDENT of the Required Docs Signatory ID upload — uploading here does
  // NOT satisfy the Required Docs one (and vice versa). "One-upload-satisfies-
  // both" is a possible later enhancement, deliberately deferred for now.
  const [signatoryIdFile, setSignatoryIdFile] = useState(null);
  const [dossierStakeholders, setDossierStakeholders] = useState(null);
  // Reserved for the future live locked/unlocked override UI; the authoritative
  // override list is recomputed deterministically at submit (buildApplicantProvenance).
  // eslint-disable-next-line no-unused-vars
  const [applicantOverrides, setApplicantOverrides] = useState([]);

  // Tracks real token counts and costs from every API call in this journey.
  // Null for a phase means that phase did not run yet. Captured from the
  // Anthropic `usage` object (research/extraction) and the doc-search agent's
  // own CostTracker (doc search).
  const [costTracker, setCostTracker] = useState({
    docSearch: null,
    researchPass1: null,
    researchPass2: null,
    docExtraction: null,
  });
  // Which auto-found documents the customer has accepted for use in research.
  // Shape: Set of document types, e.g. Set(["wolfsberg_questionnaire"]).
  const [acceptedDocTypes, setAcceptedDocTypes] = useState(new Set());

  // Step routing: ai_documents flow inserts a Documents step between Input and Research.
  // stepsFor() takes a journey explicitly so async handlers can compute the
  // correct step index without relying on a stale state closure (e.g. during
  // back-and-forth navigation between Documents and Journey).
  const stepsFor = (j) => j === "ai_documents"
    ? { input: 0, documents: 1, research: 2, applicant: 3, confirm: 4, fillGaps: 5, documentRequirements: 6, declare: 7 }
    : { input: 0, research: 1, applicant: 2, confirm: 3, fillGaps: 4, documentRequirements: 5, declare: 6 };
  const isAiDocs = journeyType === "ai_documents";
  const STEPS = stepsFor(journeyType);
  const stepNames = isAiDocs
    ? ["Company", "Documents", "Research", "Applicant", "Confirm", "Fill Gaps", "Required Docs", "Declare"]
    : ["Company", "Research", "Applicant", "Confirm", "Fill Gaps", "Required Docs", "Declare"];

  // Loader messages — four modes: Nium API lookup, no docs (existing),
  // doc-extraction phase, web phase. The Nium journey swaps in registry-specific
  // copy so the spinner reflects what's actually happening (a direct API call,
  // not AI web research). Memoised because the Nium branch builds a fresh array
  // (interpolating companyName) and loaderMsgs is a dependency of the loader
  // interval effect below — a new reference every render would re-arm it.
  const loaderMsgs = useMemo(() => {
    if (journeyType === "nium_api") {
      return [
        "Connecting to Nium KYB registry…",
        `Looking up ${companyName || "the company"}…`,
        "Retrieving company details…",
        "Loading stakeholder data…",
        "Almost done…",
      ];
    }
    return loaderPhase === 1
      ? phase1Msgs
      : loaderPhase === 2
        ? LOADER_MSGS_WOLFSBERG_PHASE2
        : LOADER_MSGS;
  }, [journeyType, companyName, loaderPhase, phase1Msgs]);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setLoaderIdx(i => Math.min(i + 1, loaderMsgs.length - 1)), 2500);
    return () => clearInterval(t);
  }, [loading, loaderMsgs]);

  useEffect(() => {
    const fetchIP = async () => { try { const r = await fetch("https://api.ipify.org?format=json"); const d = await r.json(); return d.ip; } catch { return "Could not detect"; } };
    fetchIP().then(ip => setDevice({ ipAddress: ip, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, screenRes: window.screen.width + "x" + window.screen.height, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }, []);

  const countryObj = COUNTRIES.find(c => c.code === countryCode);

  // Fields referenced by any other field's dependsOn — when their value changes
  // we bump formVersion so conditional fields show/hide. Computed once per
  // schema change so text-field updates stay cheap. Also tracks
  // `corrected_<researchField>` for deps whose parent now lives in researchFields.
  const parentFieldsRef = useRef(new Set());
  useEffect(() => {
    const s = new Set();
    if (activeSchema) {
      activeSchema.gapFields.forEach(f => {
        if (f.dependsOn) Object.keys(f.dependsOn).forEach(k => {
          s.add(k);
          if (activeSchema.researchFields.some(rf => rf.field === k)) {
            s.add("corrected_" + k);
          }
        });
      });
    }
    parentFieldsRef.current = s;
  }, [activeSchema]);

  const updateGap = useCallback((field, value) => {
    gapRef.current[field] = value;
    if (parentFieldsRef.current.has(field)) setFormVersion(v => v + 1);
  }, []);

  // Effective parent value for dependsOn evaluation:
  //   1. customer correction (if user unchecked the research item and entered a new value)
  //   2. direct gap-field value
  //   3. AI-researched value
  const dependsOnSatisfied = (g) => {
    if (!g.dependsOn) return true;
    return Object.entries(g.dependsOn).every(([k, v]) => {
      const corrected = gapRef.current["corrected_" + k];
      if (corrected !== undefined && corrected !== "") return corrected === v;
      const gap = gapRef.current[k];
      if (gap !== undefined && gap !== "") return gap === v;
      if (research && research.found) {
        const item = research.found.find(it => it.field === k);
        if (item) return item.value === v;
      }
      return false;
    });
  };

  const resetAll = () => {
    setStep(STEPS.input); setResearch(null); setActiveSchema(null);
    setChecks({}); setRejectedStakeholders({}); setExpandedStakeholders({}); setIsPubliclyListedOverride(false); setRevealedTs({}); setResearchTimestamp("");
    setAffirmedFields({}); setInlineEditOpen({});
    dialogueStateRef.current = {}; // drop persisted change-dialogue answers on Start Over
    gapRef.current = {}; setFormVersion(v => v + 1);
    stakeholdersRef.current = {}; setStakeholderVersion(v => v + 1); setStakeholderErrors([]);
    setStakeholderFieldChecks({});
    setError(""); setDeclared(false);
    setUploadedDocs(initialUploadedDocs());
    setJourneyType(""); setJourneyOpen(false); setSelectedJourneyCard(null); setManualOpened(false);
    setFieldMetadata([]);
    setLoaderPhase(0);
    setCoverage(null); setGapRecoveryRan(false); setResearchStatus("");
    setDrsSubmitted([]); setDrsFlags({}); setDrsGapsCleared(false);
    setDocSearchResults(null); setDocSearchLoading(false); setDocSearchError(null); setHasRunRealAgent(false); setSelfSourceDiag(null); setAcceptedDocTypes(new Set());
    setCostTracker({ docSearch: null, researchPass1: null, researchPass2: null, docExtraction: null });
    setApplicantSelectedPerson(null); setApplicantAgentValues({}); setApplicantOverrides([]);
    setApplicantValidationError(null); setDossierStakeholders(null);
    setApplicantNotListed(false); setAuthorityToActFile(null); setSignatoryIdFile(null);
    setAmendmentUploads({}); // PR-071 — drop amendment uploads on Start Over
    // Foundational-facts gate → back to all-confirmed default for the next run.
    setFactChecks({}); setOwnershipFork(null); setOwnershipChangeDeclared(null);
    setRegNumberFork(null); setRegNumberChangeDeclared(null);
    // Landing page hidden for stakeholder review weekend — instead of
    // returning to agent selection, reset to the agent type implied by the URL
    // so "Start New Application" keeps the user in the right flow.
    const preboardingParam =
      new URLSearchParams(
        window.location.search
      ).get("preboarding");
    setAgentType(
      preboardingParam === "1"
        ? "preboarding"
        : "onboarding"
    );
    setPreboardingUnlocked(false);
    setPreboardingPassword("");
    setPreboardingPasswordError(false);
    setExcludedGapFields(new Set());
    setCustomQuestions([]);
    setAskMoreOpenSection(null);
    setNewQuestion({ text: "", fieldType: "text", required: true, options: "" });
    setDossierId(null);
    setOnboardingSubmissionId(null);
    setDossierSaving(false);
    setDossierSaved(false);
    setShowDossierView(false);
    setRegNumber("");
    setRegNumberSource(null);
    // Wrong-company dispute → redirected to the lookup page: this is now a
    // genuine KYC/lookup journey, so restore the full 7-step bar.
    setLandedViaLink(false);
    setNiumRegNumber("");
    setNiumSearchResults(null);
    setNiumSearchError("");
    setNiumSearchLoading(false);
  };

  // Fire-and-forget event tracking → /api/track-event. Never awaited, never
  // blocks the UI. Failures are swallowed (tracking must never break the flow).
  function trackEvent(eventType, eventData = {}) {
    fetch("/api/track-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        eventType,
        eventData,
        sessionId: null, // no session yet at the landing page
        timestamp: new Date().toISOString(),
      }),
    }).catch((err) => console.warn("[trackEvent] Failed:", err));
  }

  // Landing page viewed — fires on mount and whenever the user returns to the
  // agent-selection screen (agentType back to null).
  useEffect(() => {
    if (agentType === null) {
      trackEvent("landing_page_viewed", {
        url: window.location.href,
        referrer: document.referrer || null,
        isDemo: demoMode || false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentType]);

  // Pre-boarding agent unlocked (correct password entered).
  useEffect(() => {
    if (agentType === "preboarding" && preboardingUnlocked) {
      trackEvent("preboarding_agent_unlocked", {
        viewedAt: new Date().toISOString(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentType, preboardingUnlocked]);

  // Auto-save dossier when research completes in pre-boarding mode. The
  // simplified flow skips the Confirm / Fill Gaps steps, so the dossier is
  // persisted automatically once research returns and the Dossier View renders
  // without a click.
  //
  // IMPORTANT — only fire once the flow has reached the Confirm step. On the
  // Documents journey (Card A) the self-source agent seeds research.found while
  // the customer is still on the Documents step (to pick the Annual Report /
  // Wolfsberg before running extraction). Without the step gate that partial
  // seed would immediately auto-save and jump to the Dossier, skipping doc
  // selection and the real extraction + AI research pass. doResearch /
  // doDummyResearch / the Nium lookup all advance to stepsFor(journey).confirm
  // when research genuinely completes, which is the correct trigger.
  useEffect(() => {
    // The dossier auto-saves for the analyst pre-boarding flow AND for a customer
    // self-serve re-research (seededBy 'customer') — same engine, same audit
    // record, only the trigger differs. The customer reaches confirm only after
    // clearing the applicant gate, so the gate stays ahead of the saved dossier.
    if (
      ((agentType === "preboarding" && preboardingUnlocked) || seededBy === "customer") &&
      step === stepsFor(journeyType).confirm &&
      research?.found?.length > 0 &&
      !showDossierView &&
      !dossierSaving &&
      !dossierSaved
    ) {
      // Small delay to ensure all state is settled after research.
      const timer = setTimeout(() => {
        saveDossier();
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentType, preboardingUnlocked, step, journeyType, research?.found]);

  // Customer invite landing. When the app is opened via an invite link
  // (`?ref=<token>`), restore the dossier snapshot the analyst captured at
  // send-time (localStorage, keyed by token) and drop the customer straight
  // onto the populated Confirm page — the exact view "Preview Customer
  // Onboarding" shows. Without this, a fresh page load has no in-memory
  // research and lands on a blank onboarding step. Runs once on mount; if no
  // snapshot is found (e.g. a different browser/device) it quietly falls back
  // to the normal onboarding entry. (Cross-device hydration from the
  // server-persisted invite record is future work — PR-029.)
  const inviteHydratedRef = useRef(false);
  useEffect(() => {
    if (inviteHydratedRef.current) return;
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    inviteHydratedRef.current = true;
    let snap = null;
    try {
      const raw = localStorage.getItem("nium_invite_" + ref);
      if (raw) snap = JSON.parse(raw);
    } catch (_) { /* ignore malformed/unavailable storage */ }
    if (!snap || !snap.research) return;
    const jt = snap.journeyType || "ai_only";
    setCompanyName(snap.companyName || "");
    setCountryCode(snap.countryCode || "");
    setEntityType(snap.entityType || "");
    setOwnershipType(snap.ownershipType || "");
    setJourneyType(jt);
    setActiveSchema(snap.activeSchema || null);
    setResearch(snap.research);
    setCoverage(snap.coverage || null);
    setFieldMetadata(snap.fieldMetadata || []);
    setChecks(snap.checks || {});
    setAgentType("onboarding");
    setStep(stepsFor(jt).confirm);
    // Customer landed via the ?ref invite link — same dossier/invite journey
    // marker as the ?dossierId path (drives the step-bar subset, display only).
    setLandedViaLink(true);
    trackEvent("invite_link_opened", { token: ref, companyName: snap.companyName || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Customer invite landing (dossier-backed). When opened via the dossier link
  // (`?dossierId=<id>&journey=customer`), fetch the dossier server-side and drop
  // the customer straight onto the standalone Applicant page. Works cross-device
  // (unlike the localStorage `?ref` path). Runs once on mount.
  const dossierHydratedRef = useRef(false);
  useEffect(() => {
    if (dossierHydratedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const dId = params.get("dossierId");
    const journey = params.get("journey");
    const tenantParam = params.get("tenant");
    if (!dId || journey !== "customer") return;
    dossierHydratedRef.current = true;
    loadDossierAndStartOnboarding(dId, tenantParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDossierAndStartOnboarding(id, tenant) {
    // Customer landed via the dossier/invite link — mark the journey so the step
    // bar hides the analyst-completed Company/Research steps (display only).
    setLandedViaLink(true);
    try {
      const res = await fetch(`/api/get-dossier?id=${encodeURIComponent(id)}&tenant=${encodeURIComponent(tenant || "nium")}`);
      const data = await res.json();
      if (data.success && data.dossier) {
        const d = data.dossier;
        if (d.company_name) setCompanyName(d.company_name);
        if (d.entity_type) setEntityType(d.entity_type);
        if (d.country_code) setCountryCode(d.country_code);
        if (d.ownership_type) setOwnershipType(d.ownership_type);
        // Resolve the schema so the Applicant gap fields (and the rest of the
        // flow) have field definitions to render — the dossier stores entity
        // type + country, not the schema itself.
        let dossierSchema = null;
        if (d.entity_type && d.country_code) {
          try {
            dossierSchema = getSchemaFromConfig(d.country_code, d.entity_type, tenantConfig);
            setActiveSchema(dossierSchema);
          }
          catch (_) { /* leave schema unset; page still renders the selector */ }
        }
        // Primary source: raw_research.found — the complete, intact research
        // data with .stakeholders arrays and verificationStatus on every row.
        // Fallback: the stripped tiered arrays (older dossiers, or if
        // raw_research is somehow missing) which lack .stakeholders.
        let found = [];
        if (d.raw_research?.found?.length) {
          found = d.raw_research.found;
          // eslint-disable-next-line no-console
          console.log("[loadDossier] Using raw_research:", found.length, "fields");
        } else if (d.verified_data?.length || d.probable_data?.length || d.indicative_data?.length) {
          found = [
            ...(Array.isArray(d.verified_data) ? d.verified_data : []),
            ...(Array.isArray(d.probable_data) ? d.probable_data : []),
            ...(Array.isArray(d.indicative_data) ? d.indicative_data : []),
          ];
          // eslint-disable-next-line no-console
          console.log("[loadDossier] Fallback to tiered arrays:", found.length, "fields");
        }
        // The dossier-load path skips the live research pipeline, so re-attach
        // parsed .stakeholders arrays to stakeholder-field items the same way the
        // live flow does. enrichStakeholders is idempotent (keeps existing
        // .stakeholders) and parses .value whether it's a JSON array string
        // ('[{"full_name":...}]') or legacy text ("John Smith (40%)").
        found = enrichStakeholders(normalizeResearchFieldIds(found, dossierSchema));
        // Belt-and-braces: for any stakeholder field still without people (e.g.
        // .value wasn't parseable), pull from the dossier's saved stakeholders
        // map, which is keyed by field id. Use the raw response (d.stakeholders),
        // not the dossierStakeholders state which isn't updated yet this tick.
        const rawDossierStakeholders = d.stakeholders || {};
        found = found.map((item) => {
          const fieldId = item.field || item.fieldId || "";
          if (!isStakeholderField(fieldId)) return item;
          if (Array.isArray(item.stakeholders) && item.stakeholders.length > 0) return item;
          if (Array.isArray(rawDossierStakeholders[fieldId]) && rawDossierStakeholders[fieldId].length) {
            return { ...item, stakeholders: rawDossierStakeholders[fieldId] };
          }
          return item;
        });
        if (found.length > 0) {
          setResearch({ companyName: d.company_name, found });
          // PR-056 — match the KYC/research path (see the live-research and
          // lookup paths): pre-accept every scalar field (checked by default) so
          // the customer only unchecks what's wrong. Without this, `checks` stays
          // {} from resetAll on the dossier-load path, so every scalar arrives
          // UNCHECKED and each row spuriously shows its change-dialogue on arrival
          // (4765: `!checks[idx]`). Stakeholders are unaffected — they default to
          // confirmed via their own separate state.
          const c = {};
          found.forEach((_, i) => { c[i] = true; });
          setChecks(c);
        }
        // Bug 2 — restore self-sourced registry results folded into raw_research
        // at save time, so the "Sourced from company registry" section and the
        // per-card "Sourced automatically" banners reappear after the dossier →
        // onboarding round-trip. Null-safe: a company with no self-source has no
        // selfSourceResults on raw_research, so this restores null (renders clean).
        setSelfSourceResults(d.raw_research?.selfSourceResults || null);
        // PR-071 — restore amendment-document uploads (permanent blobUrls) so the
        // Amendment Documentation section reappears filled after reload. Null-safe.
        setAmendmentUploads(d.raw_research?.amendmentUploads || {});
        // PR-043 — restore the internet-research docs (annual report / Wolfsberg)
        // so they reappear in the unified Documents Sourced panel after reload.
        // Null-safe, same as selfSourceResults above.
        setDocSearchResults(d.raw_research?.docSearchResults || null);
        // Belt-and-braces fallback for getApplicantCandidates if raw_research
        // rows somehow lack .stakeholders.
        if (d.stakeholders) setDossierStakeholders(d.stakeholders);

        // Restore coverage so the Confirm-page coverage bar renders. There is no
        // single `coverage` column — reconstruct it from the broken-out counts
        // (fill_rate / verified_fill_rate are stored as 0–100 ints, so /100).
        if (d.total_fields != null || d.verified_fields != null) {
          const verified = d.verified_fields || 0;
          const probable = d.probable_fields || 0;
          const indicative = d.indicative_fields || 0;
          setCoverage({
            totalResearchFields: d.total_fields || 0,
            populatedFields: verified + probable + indicative,
            verifiedFields: verified,
            probableFields: probable,
            indicativeFields: indicative,
            missingFieldCount: d.missing_fields || 0,
            missingFields: [],
            fillRate: d.fill_rate != null ? Number(d.fill_rate) / 100 : null,
            verifiedFillRate: d.verified_fill_rate != null ? Number(d.verified_fill_rate) / 100 : null,
          });
        }

        setDossierId(id);
        trackEvent("invite_link_opened", { dossierId: id, companyName: d.company_name || null, via: "dossier_link" });
      }
    } catch (err) {
      // Fail gracefully — land on the Applicant page with empty fields.
      // eslint-disable-next-line no-console
      console.error("[loadDossier] Failed:", err);
    }
    // Always advance to the Applicant step regardless of whether the dossier
    // loaded (ai_only step map applies; documents step is analyst-only here).
    setAgentType("onboarding");
    setJourneyType("ai_only");
    setStep(stepsFor("ai_only").applicant);
  }

  const isStakeholderRejected = (fieldId, stakeholderId) => {
    const set = rejectedStakeholders[fieldId];
    return set ? set.has(stakeholderId) : false;
  };

  const toggleStakeholderRejection = (fieldId, stakeholderId) => {
    setRejectedStakeholders((prev) => {
      const current = new Set(prev[fieldId] ? Array.from(prev[fieldId]) : []);
      if (current.has(stakeholderId)) current.delete(stakeholderId);
      else current.add(stakeholderId);
      return { ...prev, [fieldId]: current };
    });
  };

  // Per-granular-field green-tick state for a stakeholder. Found fields default
  // to confirmed (true); unticking routes the field to the next page for edit.
  const isStkFieldConfirmed = (stakeholderId, key) => {
    const m = stakeholderFieldChecks[stakeholderId];
    return m && key in m ? m[key] : true;
  };
  const toggleStkFieldConfirm = (stakeholderId, key) => {
    setStakeholderFieldChecks((prev) => {
      const cur = prev[stakeholderId] || {};
      const curVal = key in cur ? cur[key] : true;
      return { ...prev, [stakeholderId]: { ...cur, [key]: !curVal } };
    });
  };

  /**
   * Per-attribute AFFIRMATION for people — the exact counterpart of
   * `affirmedFields` on the pre-filled rows, and for the same reason.
   *
   * Every attribute arrives ticked, so `isStkFieldConfirmed` alone cannot tell
   * "the customer agreed" from "the customer hasn't looked". A pre-filled row
   * from a low-confidence source must be explicitly ticked before it counts as
   * confirmed; a person attribute from the SAME source was counting as
   * confirmed untouched, purely because it renders as a card instead of a row.
   * Three directors sourced from Investor Relations were silently confirmed.
   *
   * Additive state, exactly like affirmedFields: it never touches
   * stakeholderFieldChecks, the dialogue, or what gets submitted.
   */
  const personFieldKey = (stakeholderId, key) => `${stakeholderId}::${key}`;
  const isPersonFieldAffirmed = (stakeholderId, key) =>
    !!affirmedPersonFields[personFieldKey(stakeholderId, key)];
  const affirmPersonField = (stakeholderId, key) =>
    setAffirmedPersonFields((prev) => ({ ...prev, [personFieldKey(stakeholderId, key)]: true }));

  /** Tier of a person's data — their own if present, else the row that carried
   *  them, which is what the person card's source badge already displays. */
  const isPersonLowConfidence = (s, item) =>
    isLowConfidence({ sourceTier: (s && s.sourceTier) || (item && item.sourceTier) });

  /**
   * THE per-attribute predicate. One rule, three consumers — the attribute row's
   * tick, the card's "needs you" badge, and the tile/gate counts — so they can
   * never disagree, exactly as rowState() does for the pre-filled rows.
   */
  const isPersonAttributeSettled = (s, f, lowConf) =>
    isStkFieldConfirmed(s.id, f.key) && (!lowConf || isPersonFieldAffirmed(s.id, f.key));

  const isStakeholderExpanded = (id) => expandedStakeholders[id] === true;
  const toggleStakeholderExpanded = (id) => {
    setExpandedStakeholders((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const setStakeholdersExpanded = (ids, expanded) => {
    setExpandedStakeholders((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = expanded; });
      return next;
    });
  };

  // Read + write helpers for per-person stakeholder data on Fill Gaps. The
  // ref is the source of truth; setStakeholderVersion bumps the explicit
  // re-render counter so completion badges, PEP-details visibility, and
  // validation messaging stay in sync with what's in the ref.
  const getStakeholders = (fieldId) => stakeholdersRef.current[fieldId] || [];
  const setStakeholders = (fieldId, arr) => {
    stakeholdersRef.current = { ...stakeholdersRef.current, [fieldId]: arr };
    setStakeholderErrors([]);
    setStakeholderVersion((v) => v + 1);
  };
  const updateStakeholderField = (fieldId, stakeholderId, key, value) => {
    const current = getStakeholders(fieldId);
    const next = current.map((s) => (s.id === stakeholderId ? { ...s, [key]: value } : s));
    setStakeholders(fieldId, next);
  };
  // Returns the created person so callers that need its stable sh_ id (the
  // add-a-person flow addresses its change-events by composite fieldId) can use
  // it. Existing callers ignore the return value.
  const addStakeholder = (fieldId, overrides = {}) => {
    const current = getStakeholders(fieldId);
    const person = makeStakeholder({ customer_added: true, ...overrides });
    setStakeholders(fieldId, [...current, person]);
    return person;
  };
  const removeStakeholder = (fieldId, stakeholderId) => {
    const current = getStakeholders(fieldId);
    setStakeholders(fieldId, current.filter((s) => s.id !== stakeholderId));
  };

  // Repeatable positions ([{ title, start_date }]) for corporate stakeholders.
  const addStkPosition = (fieldId, sid) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = [...((s && s.positions) || []), { title: "", start_date: "" }];
    updateStakeholderField(fieldId, sid, "positions", positions);
  };
  const updateStkPosition = (fieldId, sid, idx, key, value) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = ((s && s.positions) || []).map((p, i) => (i === idx ? { ...p, [key]: value } : p));
    updateStakeholderField(fieldId, sid, "positions", positions);
  };
  const removeStkPosition = (fieldId, sid, idx) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = ((s && s.positions) || []).filter((_, i) => i !== idx);
    updateStakeholderField(fieldId, sid, "positions", positions);
  };

  // Initialise / re-sync stakeholdersRef from research.found whenever we
  // enter Fill Gaps. Preserves user edits across navigation: any
  // stakeholder id that's already in the ref keeps its existing fields and
  // only has its customer_rejected flag re-applied from the current
  // rejectedStakeholders set. New ids from research get seeded; manually
  // added (customer_added=true) entries are preserved verbatim.
  const initStakeholdersForFillGaps = useCallback(() => {
    if (!research || !Array.isArray(research.found)) return;
    const nextMap = { ...stakeholdersRef.current };
    research.found.forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      if (!Array.isArray(result.stakeholders) || result.stakeholders.length === 0) return;
      const fieldId = result.field;
      // Registry exemption notices are not people — keep them out of the ref so
      // they can never become a person card or EDD form.
      const aiStakeholders = result.stakeholders.filter((s) => !isRegistryExemptionNotice(s));
      const existing = nextMap[fieldId] || [];
      const existingById = new Map(existing.map((s) => [s.id, s]));
      const rejectedIds = rejectedStakeholders[fieldId] || new Set();
      const aiIds = new Set(aiStakeholders.map((s) => s.id));

      const seeded = aiStakeholders.map((ai) => {
        const prior = existingById.get(ai.id);
        const isRejected = rejectedIds.has(ai.id);
        if (prior) {
          // Preserve customer edits; only re-apply the rejection flag and the
          // name-clearing behaviour for newly-rejected entries.
          if (isRejected && !prior.customer_rejected) {
            return {
              ...prior,
              customer_rejected: true,
              full_name_original: prior.full_name_original || ai.full_name,
              full_name: "",
            };
          }
          if (!isRejected && prior.customer_rejected) {
            return {
              ...prior,
              customer_rejected: false,
              full_name: prior.full_name || prior.full_name_original || ai.full_name,
            };
          }
          return { ...prior, customer_rejected: isRejected };
        }
        // First seed for this person.
        if (isRejected) {
          return {
            ...ai,
            customer_rejected: true,
            full_name_original: ai.full_name,
            full_name: "",
          };
        }
        return { ...ai, customer_rejected: false };
      });

      // Keep customer-added persons that aren't part of the AI list.
      const customerAdded = existing.filter((s) => s.customer_added && !aiIds.has(s.id));
      nextMap[fieldId] = [...seeded, ...customerAdded];
    });
    stakeholdersRef.current = nextMap;
    setStakeholderVersion((v) => v + 1);
  }, [research, rejectedStakeholders]);

  useEffect(() => {
    if (step === STEPS.fillGaps) initStakeholdersForFillGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, research, rejectedStakeholders]);

  // Amendment documents the store says are currently owed. Refetched on entering
  // Confirm and whenever a row is crossed/re-checked, so the list reflects the
  // latest non-superseded event per field. The live-outcome union in
  // confirmDocs covers the window before this lands (and a DB-less dev run), so
  // a slow or failed fetch can never make a required document disappear.
  useEffect(() => {
    const submissionId = dossierId || onboardingSubmissionId;
    if (!submissionId || step !== STEPS.confirm) return undefined;
    let cancelled = false;
    fetch(`/api/amendment-documents?submissionId=${encodeURIComponent(submissionId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPersistedAmendmentDocs(Array.isArray(data.documents) ? data.documents : []);
      })
      .catch((err) => console.warn("[confirm] amendment-documents fetch failed:", err));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, dossierId, onboardingSubmissionId, checks]);

  const fillTestData = () => {
    getCombinedGaps().forEach(g => {
      const current = gapRef.current[g.field];
      if (current && String(current).trim().length > 0) return;
      let val = TEST_DATA[g.field];
      if (val === undefined && g.field.startsWith("corrected_")) {
        const original = g.field.replace(/^corrected_/, "");
        val = TEST_DATA[original] || "Corrected value";
      }
      if (val === undefined) {
        if (g.inputType === "select" && Array.isArray(g.options) && g.options.length > 0) {
          // Options may be plain strings (hardcoded fields) or { value, label }
          // objects (config-saved fields). The <select> option value is the
          // extracted string, so set that — not the whole object — or it won't
          // match and the dropdown stays on "Select...".
          const first = g.options[0];
          val = (first && typeof first === "object") ? (first.value ?? first.label) : first;
        } else {
          val = "Sample value";
        }
      }
      gapRef.current[g.field] = val;
    });
    setFormVersion(v => v + 1);

    // Also fill stakeholder compliance fields for any per-person cards
    // currently in stakeholdersRef. Doesn't add new people, doesn't overwrite
    // already-filled fields — keeps existing edits intact and just paints
    // sensible demo values into the blanks.
    const demoCountry = countryObj ? countryObj.name : "United Kingdom";
    const demoIdType = "passport";
    const demoIdNum = "GB1234567";
    const demoDob = "1980-05-15";
    const demoNationality = countryCode === "GB" ? "British" : countryCode === "SG" ? "Singaporean" : "British";
    // Corporate-stakeholder KYB demo values. business_type's option value is a
    // string here, but extract defensively in case the source becomes {value,label}.
    const demoBusinessType = (() => {
      const first = Array.isArray(BUSINESS_TYPE_OPTIONS) ? BUSINESS_TYPE_OPTIONS[0] : null;
      return (first && typeof first === "object") ? (first.value ?? first.label) : (first || "Private Limited Company");
    })();
    const demoBrn = "12345678";
    let touched = false;
    Object.keys(stakeholdersRef.current || {}).forEach((fieldId) => {
      const list = stakeholdersRef.current[fieldId] || [];
      const next = list.map((s) => {
        const out = { ...s };
        if (!out.full_name && out.customer_rejected && out.full_name_original) {
          out.full_name = out.full_name_original;
        }
        if (!out.full_name && out.customer_added) out.full_name = out.is_company ? "Demo Company Ltd" : "Demo Person";
        if (out.is_company) {
          // Corporate stakeholder (UBO / parent company): KYB fields, no person EDD.
          if (!out.business_type) out.business_type = demoBusinessType;
          if (!out.business_registration_number) out.business_registration_number = demoBrn;
          if (!out.registered_country) out.registered_country = demoCountry;
        } else {
          if (!out.nationality) out.nationality = demoNationality;
          if (!out.date_of_birth) out.date_of_birth = demoDob;
          if (!out.residential_country) out.residential_country = demoCountry;
          if (!out.id_type) out.id_type = demoIdType;
          if (!out.id_number) out.id_number = demoIdNum;
          if (out.is_pep === null || out.is_pep === undefined) out.is_pep = false;
        }
        return out;
      });
      stakeholdersRef.current[fieldId] = next;
      touched = true;
    });
    if (touched) {
      setStakeholderErrors([]);
      setStakeholderVersion(v => v + 1);
    }
  };

  // Unified post-Confirm gap list.
  //   1. corrections — fields the user unchecked on Confirm (any tier)
  //   2. missing_research — research fields the AI couldn't find from
  //      any source (rendered as plain text inputs, optional)
  //   3. schema.gapFields — always-manual fields
  const getCombinedGaps = () => {
    if (!research || !activeSchema) return [];
    const apiGaps = research.gaps || activeSchema.gapFields;

    // Corrections — fields the user unchecked on Confirm. We must preserve
    // the original field's inputType and (for selects) options so the
    // correction is collected with the same UI as the original; defaulting
    // to "text" would mean a dropdown loses its option list at this point.
    const unchecked = (research.found || [])
      .filter((item, i) => !checks[i])
      .map(item => {
        const def = findFieldDef(activeSchema, item.field) || {};
        return {
          field: "corrected_" + item.field,
          label: item.label + " (correction needed)",
          reason: "Original: " + resolveDisplayValue(def, item.value),
          inputType: def.inputType || "text",
          options: def.options || undefined,
          dependsOn: def.dependsOn || undefined,
          required: true,
          section: "corrections",
        };
      });

    // Missing research — fields the AI couldn't find. Same principle: keep
    // the configured inputType/options so a dropdown stays a dropdown.
    const foundIds = new Set((research.found || []).map(i => i.field));
    const missingResearch = (activeSchema.researchFields || [])
      .filter(rf => !foundIds.has(rf.field))
      .map(rf => ({
        field: rf.field,
        label: rf.label,
        inputType: rf.inputType || "text",
        options: rf.options || undefined,
        dependsOn: rf.dependsOn || undefined,
        required: false,
        section: "missing_research",
      }));

    return [...unchecked, ...missingResearch, ...apiGaps];
  };

  const allGapsFilled = () => getCombinedGaps().filter(g => g.required).every(g => {
    if (!dependsOnSatisfied(g)) return true;
    const v = gapRef.current[g.field];
    if (!v || !String(v).trim()) return false;
    return true;
  });

  const doResearch = async (journeyOverride) => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    // Clear any prior cache badge; the response handler re-derives it.
    setServedFromCache(false); setCachedAt(null);
    // Fresh research run: clear prior research/extraction costs but keep the
    // doc-search cost captured earlier on Step 2.
    setCostTracker(prev => ({ ...prev, researchPass1: null, researchPass2: null, docExtraction: null }));
    const journey = journeyOverride || journeyType || "ai_only";
    const researchStartTime = Date.now();
    trackEvent("research_started", {
      companyName,
      countryCode,
      entityType,
      ownershipType,
      journeyType: journey,
      agentType: agentType || "onboarding",
      startedAt: new Date().toISOString(),
    });
    const S = stepsFor(journey);
    const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
    setActiveSchema(schema);
    setLoading(true); setStep(S.research); setLoaderIdx(0);
    try {
      // ─── Phase 1: extract from each uploaded document, in DOC_TYPES order ───
      const flow = schema.flow === "fi" ? "fi" : "corporate";
      const hasAnyDocs = DOC_TYPES.some(d => uploadedDocs[d.key]);
      const runDocPhase = journey === "ai_documents" && hasAnyDocs;

      let docFound = [];                  // sourceTier:"document" rows, ordered by DOC_TYPES priority
      let wolfsbergFields = {};           // legacy obj for prompt injection

      if (runDocPhase) {
        setPhase1Msgs(buildPhase1Msgs(uploadedDocs));
        setLoaderPhase(1); setLoaderIdx(0);
        // Accumulate real token counts across every per-document extraction call.
        let docExtractIn = 0, docExtractOut = 0, docExtractCalls = 0;
        for (let i = 0; i < DOC_TYPES.length; i++) {
          const dt = DOC_TYPES[i];
          const file = uploadedDocs[dt.key];
          if (!file) continue;
          const fetchTs = new Date().toISOString();
          const { docFound: dFound, wolfsbergFields: wFields, usage: dUsage } = await extractFromDoc(dt, file, schema, flow, fetchTs);
          if (dUsage) {
            docExtractIn += dUsage.input_tokens || 0;
            docExtractOut += dUsage.output_tokens || 0;
            docExtractCalls += 1;
          }
          if (dt.key === "wolfsberg") wolfsbergFields = wFields;
          // Dedup: keep first source (which respects DOC_TYPES priority order).
          for (const row of dFound) {
            if (!docFound.some(f => f.field === row.field)) docFound.push(row);
          }
        }
        if (docExtractCalls > 0) {
          setCostTracker(prev => ({
            ...prev,
            docExtraction: {
              inputTokens: docExtractIn,
              outputTokens: docExtractOut,
              totalTokens: docExtractIn + docExtractOut,
              costUsd: calcCostUsd(docExtractIn, docExtractOut),
              apiCallCount: docExtractCalls,
            },
          }));
        }
        setLoaderPhase(2); setLoaderIdx(0);
      }

      // ─── Phase 2: web research, optionally seeded with Wolfsberg fields ───
      // Accepted auto-sourced documents (Step 2 Section A) are appended to the
      // prompt so the research engine fetches and extracts fields from their
      // URLs — same as customer uploads, but via sourceUrl. Appended here
      // rather than inside buildPrompt so the shared src/pipeline.js (also
      // used by api/benchmark.js) stays unchanged.
      let researchPrompt = buildPrompt(companyName, countryObj ? countryObj.name : countryCode, countryCode, schema, wolfsbergFields, ownershipType);
      // Optional registration number → PRIMARY search key. Appended client-side
      // (like the AUTOMATICALLY SOURCED DOCUMENTS block below) so the shared
      // src/pipeline.js buildPrompt stays untouched. The company name is still
      // in the prompt, so an absent or wrong number safely falls back to the
      // name-based search — never a dead end.
      const trimmedRegNumber = regNumber.trim();
      if (trimmedRegNumber) {
        researchPrompt += `\n\nPRIMARY COMPANY IDENTIFIER:\n` +
          `The customer provided this official business registration / company number: ${trimmedRegNumber}.\n` +
          `Use it as the PRIMARY key to identify the exact company in ` +
          `${countryObj ? countryObj.name : countryCode} (Companies House and any ` +
          `other applicable company register), so you pull the precise entity ` +
          `rather than name-matching. If this number does not correspond to a ` +
          `real company, ignore it and fall back to researching by the company ` +
          `name "${companyName}".\n`;
      }
      const acceptedDocs = (docSearchResults?.documents || [])
        .filter(d => acceptedDocTypes.has(d.type));
      if (acceptedDocs.length > 0) {
        researchPrompt += `\n\nAUTOMATICALLY SOURCED DOCUMENTS:\n`;
        researchPrompt += `The following documents have been ` +
          `sourced automatically and are available ` +
          `for field extraction:\n\n`;
        acceptedDocs.forEach(doc => {
          researchPrompt += `- ${doc.label} (${doc.year})\n`;
          researchPrompt += `  URL: ${doc.sourceUrl}\n`;
          researchPrompt += `  Source: ${doc.sourceLabel}\n`;
          researchPrompt += `  Please extract all relevant ` +
            `compliance fields from this document.\n\n`;
        });
      }
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: researchPrompt,
          tools: RESEARCH_TOOLS,
          // Cache key fields — presence of companyName enables the cache layer
          // in api/research.js for this (main research) call only.
          companyName,
          jurisdiction: countryCode,
          entityType,
          forceRefresh,
          // Optional reg number → drives the deterministic Companies House
          // officers layer in api/research.js (already wired to accept it).
          // Undefined when blank, so the officers layer resolves from name.
          registrationNumber: trimmedRegNumber || undefined,
        })
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const claudeErr = errData && errData.details && errData.details.error;
        if (claudeErr && claudeErr.type === "rate_limit_error") {
          throw new Error("Anthropic rate limit reached for this minute. Wait ~60 seconds and try again, or add credits to raise your limit.");
        }
        if (claudeErr && claudeErr.message) {
          throw new Error(`${errData.error || "Claude API error"}: ${claudeErr.message}`);
        }
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      // Cache status: api/research.js tags cache hits with _fromCache/_cachedAt.
      if (data._fromCache) {
        setServedFromCache(true);
        setCachedAt(data._cachedAt);
      } else {
        setServedFromCache(false);
        setCachedAt(null);
        setForceRefresh(false); // reset force refresh after a live fetch
      }
      let text = "";
      for (const block of (data.content || [])) { if (block.type === "text" && block.text) text += block.text; }
      text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const si = text.indexOf("{"); const ei = text.lastIndexOf("}");
      if (si === -1 || ei === -1) throw new Error("No JSON found in response");
      let parsed;
      try {
        parsed = JSON.parse(text.slice(si, ei + 1));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Raw research response (could not parse):", text);
        throw new Error(`Response was not valid JSON (${e.message}). Likely the model hit max_tokens — see browser console for the full response.`);
      }
      const webFetchTs = new Date().toISOString();
      // Classify one raw research row into our tiered/verification shape.
      // Shared by the first pass and the Phase 3 gap-recovery pass.
      const classifyWebRow = (item, ts) => {
        const isWolfsbergSrc = !!(item.source && /wolfsberg/i.test(item.source));
        const tier = isWolfsbergSrc
          ? "document"
          : classifySourceFromConfig([item.source, item.sourceUrl].filter(Boolean).join(" "), countryCode, tenantConfig);
        return {
          ...item,
          sourceUrl: item.sourceUrl || null,
          sourceTier: tier,
          verificationStatus: getVerificationStatus(tier),
          documentType: isWolfsbergSrc ? "wolfsberg" : null,
          fetchedAt: ts,
          method: isWolfsbergSrc ? "document_extract" : "web_search",
          confidence: tier === "tier1" || tier === "document" ? "high" : "low",
          trust: tier === "tier1" || tier === "document" ? "authoritative" : "secondary",
          wolfsberg: isWolfsbergSrc,
        };
      };
      const webFound = (parsed.found || []).map((item) => classifyWebRow(item, webFetchTs));

      // ─── Capture research pass-1 cost from the Anthropic usage object ───
      // api/research.js passes the response through verbatim, so data.usage
      // holds the real token counts for this call.
      if (data?.usage) {
        const inputTokens = data.usage.input_tokens || 0;
        const outputTokens = data.usage.output_tokens || 0;
        setCostTracker(prev => ({
          ...prev,
          researchPass1: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            costUsd: calcCostUsd(inputTokens, outputTokens),
            fieldsFound: (parsed.found || []).length,
            // web search calls used in this response
            webSearchCalls: (data.content || []).filter(
              b => b.type === "server_tool_use" && b.name === "web_search"
            ).length,
          },
        }));
      }

      // Doc-extracted rows take priority over anything web returned for the same field.
      const docFieldIds = new Set(docFound.map(f => f.field));
      const mergedRaw = normalizeResearchFieldIds(
        [...docFound, ...webFound.filter(f => !docFieldIds.has(f.field))],
        schema
      );
      // Coerce free-text values for dropdown fields onto one of the configured
      // option values (e.g. "Private Limited Company" → "private_limited") so
      // the gap form can pre-select correctly on correction.
      let merged = enrichStakeholders(mapAIValuesToOptions(mergedRaw, schema));

      // ─── Phase 2: coverage analysis ───
      let cov = computeCoverage(merged, schema);

      // ─── Phase 3: gap-recovery second pass ───
      const recoveryStrategy = ownershipType ? computeResearchStrategy(ownershipType, countryCode) : null;
      const upgradeable = merged.filter(
        (r) => r.verificationStatus === "indicative" && hasPlausibleHigherTierSource(r.field)
      );
      const shouldRunGapRecovery =
        (cov.fillRate < 0.60 || cov.verifiedFillRate < 0.40) && cov.missingFields.length > 0;
      let ranGapRecovery = false;
      if (shouldRunGapRecovery) {
        ranGapRecovery = true;
        setResearchStatus(`Found ${cov.populatedFields} fields — running targeted search for ${cov.missingFieldCount} more…`);
        try {
          const gapResp = await fetch("/api/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: buildGapRecoveryPrompt(
                { name: companyName, countryName: countryObj ? countryObj.name : countryCode },
                cov.missingFields,
                upgradeable,
                recoveryStrategy
              ),
              tools: RESEARCH_TOOLS,
            }),
          });
          if (gapResp.ok) {
            const gapData = await gapResp.json();
            let gapText = "";
            for (const block of (gapData.content || [])) { if (block.type === "text" && block.text) gapText += block.text; }
            gapText = gapText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const gsi = gapText.indexOf("{"); const gei = gapText.lastIndexOf("}");
            if (gsi !== -1 && gei !== -1) {
              const gapParsed = JSON.parse(gapText.slice(gsi, gei + 1));
              const gapTs = new Date().toISOString();
              // ─── Capture research pass-2 cost from the Anthropic usage object ───
              if (gapData?.usage) {
                const inputTokens = gapData.usage.input_tokens || 0;
                const outputTokens = gapData.usage.output_tokens || 0;
                setCostTracker(prev => ({
                  ...prev,
                  researchPass2: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    costUsd: calcCostUsd(inputTokens, outputTokens),
                    fieldsFound: (gapParsed.found || []).length,
                    webSearchCalls: (gapData.content || []).filter(
                      b => b.type === "server_tool_use" && b.name === "web_search"
                    ).length,
                    ran: true,
                  },
                }));
              }
              const gapRows = normalizeResearchFieldIds((gapParsed.found || [])
                .map((item) => classifyWebRow(item, gapTs))
                // Never let gap recovery override a document-sourced row.
                .filter((r) => !docFieldIds.has(r.field)), schema);
              const remerged = mergeResearchResults(merged, gapRows);
              merged = enrichStakeholders(mapAIValuesToOptions(remerged, schema));
              cov = computeCoverage(merged, schema);
            }
          }
        } catch (gapErr) {
          // Gap recovery is best-effort — keep the first-pass results on failure.
          // eslint-disable-next-line no-console
          console.warn("Gap recovery pass failed:", gapErr.message);
        }
        setResearchStatus("");
      }

      // Fold in registry self-sourced fields (retrieved on the Documents step)
      // so tier-1 registry data survives this overwrite and reaches Confirm. The
      // runRealSelfSource merge remains the backup for the case where self-source
      // finishes AFTER this research pass.
      const selfSourcedRows = selfSourcedToRows(selfSourceResults?.selfSourcedFields, schema);
      // Use this SAME list for research, metadata, and checks below — otherwise
      // the appended registry rows get no checks entry and wrongly surface as
      // "unchecked" corrections on Confirm / Fill Gaps.
      const mergedFound = normalizeResearchFieldIds(
        mergeResearchResults(merged, selfSourcedRows),
        schema
      );
      // Deterministic director/UBO three-rule gate (registry-only names, active
      // status only, no cross-person attribute merging). Runs after parsing /
      // enrichment and before results reach state. See validateAllDirectors().
      const validatedFound = validateAllDirectors(mergedFound);
      setResearch({ ...parsed, found: validatedFound });
      setOnboardingSubmissionId(genUUID()); // fresh submission id for this research run (amendment-doc handoff)
      setResearchTimestamp(webFetchTs);
      setCoverage(cov);
      setGapRecoveryRan(ranGapRecovery);

      trackEvent("research_completed", {
        companyName,
        fieldsFound: merged?.length || 0,
        fillRate: cov?.fillRate ?? null,
        verifiedFields: cov?.verifiedFields ?? null,
        totalCostUsd: costTracker?.researchPass1?.costUsd || null,
        durationMs: Date.now() - researchStartTime,
        agentType: agentType || "onboarding",
      });

      // Build silent metadata trail (Part 5).
      const meta = mergedFound.map(item => ({
        fieldId: item.field, value: item.value,
        source: item.source || "Unknown", sourceUrl: item.sourceUrl || null,
        sourceTier: item.sourceTier, verificationStatus: item.verificationStatus,
        documentType: item.documentType || null,
        fetchedAt: item.fetchedAt, method: item.method, confidence: item.confidence,
        customerAction: null, customerActionAt: null,
      }));
      setFieldMetadata(meta);

      // Unified pre-fill engine: pre-check every found item. Customer unchecks
      // anything wrong, including tier-2/tier-3 items (which carry an inline
      // warning on the Confirm page).
      const c = {};
      mergedFound.forEach((_, i) => { c[i] = true; });
      setChecks(c);
      setAffirmedFields({}); setInlineEditOpen({});
      setRejectedStakeholders({});
      setStakeholderFieldChecks({});
      setExpandedStakeholders({});
      setIsPubliclyListedOverride(false);
      stakeholdersRef.current = {};
      setStakeholderVersion(v => v + 1);
      setStakeholderErrors([]);
      setRevealedTs({});
      gapRef.current = {};
      setFormVersion(v => v + 1);
      // Onboarding inserts the Applicant step between Research and Confirm;
      // pre-boarding skips it (Company → Research → Dossier).
      setStep(agentType === "preboarding" ? S.confirm : S.applicant);
    } catch (err) {
      // Failure fallback. For a customer self-serve re-research, never leave them
      // hanging and never hand them to an analyst mid-session: flag the failure
      // as a first-class data point (reused change_events store) and fall through
      // to manual entry so they can proceed.
      if (seededBy === "customer") {
        postReresearchFailureFlag({
          dossierId,
          jurisdiction: countryCode,
          stage: "re_research",
          reason: err.message,
        });
        setError("We couldn't complete that search just now. You can continue by entering your application manually below.");
        setJourneyOpen(true);
        setStep(S.input);
      } else {
        setError("Research failed: " + err.message);
        setStep(S.input);
      }
    }
    finally { setLoading(false); setLoaderPhase(0); setResearchStatus(""); }
  };

  // Bypasses /api/research and synthesises a plausible result using
  // DUMMY_RESEARCH_VALUES + the selected country's authoritative source list.
  // Mirrors the production flow: doc-uploaded fields tagged sourceTier:"document",
  // plus a sprinkle of tier-2 web rows.
  const doDummyResearch = async (journeyOverride) => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    // Demo: default the ownership type if the tester skipped it on Step 1.
    if (!ownershipType) setOwnershipType("public_listed");
    const journey = journeyOverride || journeyType || "ai_only";
    const S = stepsFor(journey);
    const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
    setActiveSchema(schema);
    setLoading(true); setStep(S.research); setLoaderIdx(0);

    const hasAnyDocs = DOC_TYPES.some(d => uploadedDocs[d.key]);
    const runDocPhase = journey === "ai_documents" && hasAnyDocs;

    // Demo: document-based journeys (Upload+AI, Max Prefill) normally populate
    // their doc-search + registry results on the Documents step. In demo mode
    // that step is skipped, so seed the same dummy results here — otherwise the
    // dossier's "Documents Sourced" section is empty. Reuse any results already
    // present (e.g. tester walked through the Documents step) rather than
    // clobbering them.
    const wantsDocs = journey === "ai_documents" || journey === "max_prefill";
    const effectiveOwnership = ownershipType || "public_listed";
    const demoDocResults = wantsDocs
      ? (docSearchResults || buildDemoDocSearchResults(companyName, effectiveOwnership, entityType))
      : docSearchResults;
    const demoSelfSource = wantsDocs
      ? (selfSourceResults || buildDemoSelfSourceResults(companyName))
      : selfSourceResults;
    if (demoDocResults && demoDocResults !== docSearchResults) setDocSearchResults(demoDocResults);
    if (demoSelfSource && demoSelfSource !== selfSourceResults) setSelfSourceResults(demoSelfSource);

    if (runDocPhase) {
      setPhase1Msgs(buildPhase1Msgs(uploadedDocs));
      setLoaderPhase(1);
      await new Promise(r => setTimeout(r, 1500));
      setLoaderPhase(2); setLoaderIdx(0);
      await new Promise(r => setTimeout(r, 1500));
    } else {
      await new Promise(r => setTimeout(r, 3000));
    }

    const authPattern = (SOURCE_TRUST[countryCode] || ["public registry"])[0];
    const authSource = authPattern.replace(/\b\w/g, c => c.toUpperCase());

    // Build a mock "doc-extracted" set: pick representative fields for each
    // uploaded doc so the navy badge gets exercised on Confirm.
    const docExtractedByField = {};   // field → { docKey, sourceName }
    if (runDocPhase) {
      const mockMap = {
        wolfsberg: ["regulatory_authority", "licence_number", "has_licence", "ubo_parent_company", "ubo_share_percentage", "non_resident_customers", "services_other_fis"],
        certificate: ["business_name", "registration_number", "incorporation_date", "registered_address_line1", "tradeName", "businessRegistrationNumber", "registeredDate", "addressLine1", "businessType", "registeredCountry"],
        licence: ["licence_number", "regulatory_authority", "has_licence"],
        annualReport: ["annual_turnover", "employee_count", "operating_countries", "publicly_listed", "annualRevenue", "employees", "countriesOfOperation", "stockListing"],
        financialStatements: ["annual_turnover", "employee_count", "annualRevenue", "employees"],
        orgChart: ["ubo_parent_company", "ubo_share_percentage", "uboAnalysis"],
        amlPolicy: [],
      };
      DOC_TYPES.forEach(dt => {
        if (!uploadedDocs[dt.key]) return;
        const fields = mockMap[dt.key] || [];
        fields.forEach(f => {
          if (!(f in docExtractedByField)) {
            docExtractedByField[f] = { docKey: dt.key, sourceName: dt.sourceName };
          }
        });
      });
    }

    const dummyTs = new Date().toISOString();
    const foundRaw = schema.researchFields.map((f, i) => {
      const docHit = docExtractedByField[f.field];
      // Exercise all three tiers in the demo: most rows tier1 (official), a
      // slice tier2 (company-owned), a slice tier3 (third-party/unverified).
      const isCompanyOwned = !docHit && f.tier === 2 && i % 4 === 0;
      const isThirdParty = !docHit && f.tier === 2 && i % 4 === 2;
      const tier2Sources = ["Company website", "Annual Report", "Investor Relations"];
      const tier3Sources = ["Wikipedia", "LinkedIn", "Crunchbase"];
      const source = docHit
        ? docHit.sourceName
        : (isThirdParty ? tier3Sources[i % tier3Sources.length]
          : isCompanyOwned ? tier2Sources[i % tier2Sources.length]
          : authSource);
      const sourceTier = docHit ? "document" : (isThirdParty ? "tier3" : isCompanyOwned ? "tier2" : "tier1");
      // For dropdown fields, pick the first configured option's label so the
      // mapping step downstream produces a real option.value. Falls back to
      // the test data table for free-text fields.
      let value = DUMMY_RESEARCH_VALUES[f.field];
      if (value === undefined) {
        if (f.inputType === "select" && Array.isArray(f.options) && f.options.length) {
          const first = f.options[0];
          value = (first && typeof first === "object")
            ? (first.label || first.value)
            : first;
        } else {
          value = "Sample " + f.label;
        }
      }
      return {
        field: f.field, label: f.label, value, source,
        sourceUrl: null,
        sourceTier,
        verificationStatus: getVerificationStatus(sourceTier),
        documentType: docHit ? docHit.docKey : null,
        fetchedAt: dummyTs,
        method: docHit ? "document_extract" : "web_search",
        confidence: sourceTier === "tier1" || sourceTier === "document" ? "high" : "low",
        trust: sourceTier === "tier1" || sourceTier === "document" ? "authoritative" : "secondary",
        wolfsberg: docHit && docHit.docKey === "wolfsberg",
      };
    });
    // Same dropdown-value coercion the live research path uses, so dummy and
    // live results render identically on Confirm and Fill Gaps.
    const found0 = enrichStakeholders(mapAIValuesToOptions(foundRaw, schema));
    // Demo: fold in registry self-sourced fields so the registry → Confirm
    // prefill is visible under ?test=1 too (mirrors the doResearch path).
    const found = normalizeResearchFieldIds(
      mergeResearchResults(found0, selfSourcedToRows(demoSelfSource?.selfSourcedFields, schema)),
      schema
    );

    const tagged = {
      companyName,
      jurisdiction: schema.region,
      countryOfRegistration: countryCode,
      found,
      gaps: schema.gapFields.map(f => ({ ...f, reason: "Not publicly available" })),
    };
    setResearch(tagged);
    setOnboardingSubmissionId(genUUID()); // fresh submission id for this research run (amendment-doc handoff)
    setResearchTimestamp(dummyTs);

    // Demo coverage (Part 14). Gap recovery is skipped in demo mode.
    setCoverage({
      totalResearchFields: 35,
      populatedFields: 28,
      verifiedFields: 20,
      probableFields: 5,
      indicativeFields: 3,
      missingFieldCount: 7,
      missingFields: [],
      fillRate: 0.80,
      verifiedFillRate: 0.57,
    });
    setGapRecoveryRan(false);

    setFieldMetadata(found.map(item => ({
      fieldId: item.field, value: item.value,
      source: item.source, sourceUrl: null,
      sourceTier: item.sourceTier, verificationStatus: item.verificationStatus, documentType: item.documentType,
      fetchedAt: item.fetchedAt, method: item.method, confidence: item.confidence,
      customerAction: null, customerActionAt: null,
    })));

    const c = {};
    found.forEach((_, i) => { c[i] = true; });
    setChecks(c);
    setRejectedStakeholders({});
    setStakeholderFieldChecks({});
    setExpandedStakeholders({});
    // Leave the manual "publicly listed" override OFF by default — the user
    // ticks it on Confirm only if they want to override and skip stakeholder
    // EDD forms. (Previously demo mode pre-checked this; now it starts unticked.)
    setIsPubliclyListedOverride(false);
    stakeholdersRef.current = {};
    setStakeholderVersion(v => v + 1);
    setStakeholderErrors([]);
    setRevealedTs({});
    gapRef.current = {};
    setFormVersion(v => v + 1);
    setLoading(false); setLoaderPhase(0);
    setStep(agentType === "preboarding" ? S.confirm : S.applicant);
  };

  // Resolve company name → registration number via Companies House (UK), so the
  // analyst doesn't have to know the number. Auto-fills niumRegNumber with the
  // top match and lists the rest to pick from. Test-mode tooling only.
  const findNiumRegNumber = async () => {
    if (!companyName.trim()) { setNiumSearchError("Enter a company name first."); return; }
    setNiumSearchError("");
    setNiumSearchResults(null);
    setNiumSearchLoading(true);
    try {
      const r = await fetch(
        `/api/company-search?q=${encodeURIComponent(companyName.trim())}&country=${encodeURIComponent(countryCode || "GB")}`
      );
      const data = await r.json();
      if (data.error) {
        setNiumSearchError(data.error);
      } else if (!data.results || data.results.length === 0) {
        setNiumSearchError(data.message || `No UK company found matching "${companyName}".`);
      } else {
        setNiumSearchResults(data.results);
        // Convenience: auto-fill the top match; the user can pick another below.
        setNiumRegNumber(data.results[0].registrationNumber);
      }
    } catch (err) {
      setNiumSearchError("Lookup failed: " + err.message);
    }
    setNiumSearchLoading(false);
  };

  // KYC Lookup Agent journey (TEST MODE ONLY) — pulls verified registry data
  // from the Nium eKYB API (POST /api/kyc-lookup → agents/kycLookupAgent.js)
  // instead of AI research. The agent returns the SAME found-item shape as AI
  // research (tier1 / verified, stakeholders with nationality + DOB
  // pre-populated), so the result flows into the exact same Confirm step and
  // the rest of the wizard is identical. Mirrors the doDummyResearch tail so
  // Confirm/Fill-Gaps render identically regardless of data source.
  const startNiumApiLookup = async () => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    // The Nium eKYB registry searches by registration number (a name-only
    // search returns HTTP 400). While the Companies House resolver is parked,
    // use a fixed preprod placeholder — the sandbox returns dummy data for any
    // registration number, so the journey always returns a result.
    const lookupRegNumber = SHOW_NIUM_REG_PANEL ? niumRegNumber.trim() : NIUM_DEMO_REG_NUMBER;
    // Demo mode: force the country the fixture lives under (SG) so the lookup
    // always resolves, even when the analyst picked GB/US on the previous screen.
    const lookupCountryCode = SHOW_NIUM_REG_PANEL ? countryCode : NIUM_DEMO_COUNTRY;
    setError("");
    setJourneyOpen(false);
    setManualOpened(false);

    const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
    setActiveSchema(schema);
    const S = stepsFor("ai_only");
    setLoading(true); setStep(S.research); setLoaderIdx(0); setLoaderPhase(0);
    setResearchStatus("Calling Nium KYB API…");

    const startedAt = Date.now();
    trackEvent("nium_api_lookup_started", {
      companyName, countryCode, entityType, ownershipType,
      agentType: agentType || "onboarding", startedAt: new Date().toISOString(),
    });

    // Cap the lookup so a hung Nium API call can't leave the Research step
    // spinning forever (niumClient's fetches have no timeout of their own).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch("/api/kyc-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ companyName, countryCode: lookupCountryCode, registrationNumber: lookupRegNumber }),
      });
      const data = await response.json();

      if (data.success && data.fields?.length) {
        const ts = data.searchedAt || new Date().toISOString();
        // Same dropdown-value coercion + stakeholder enrichment the AI paths
        // use, so Nium results render identically on Confirm and Fill Gaps.
        const normalizedLookupFields = normalizeResearchFieldIds(data.fields, schema);
        const found = enrichStakeholders(mapAIValuesToOptions(normalizedLookupFields, schema));
        // Show the company name the registry actually returned (e.g. the demo
        // fixture "STAR FINANCE PRIVATE LIMITED") rather than what was typed, so
        // testers don't mistake the sample data for their searched company. Strip
        // a trailing registration number the sandbox appends to the legal name.
        const niumLegalName = (found.find(f => f.originalField === "legal_name" || f.field === "tradeName" || f.field === "business_name") || {}).value;
        const displayName = niumLegalName
          ? String(niumLegalName).replace(/\s+\d{4,}$/, "").trim()
          : companyName;
        const tagged = {
          companyName: displayName,
          jurisdiction: schema.region,
          countryOfRegistration: countryCode,
          found,
          gaps: schema.gapFields.map(f => ({ ...f, reason: "Not in Nium registry response" })),
        };
        setResearch(tagged);
        setOnboardingSubmissionId(genUUID()); // fresh submission id for this research run (amendment-doc handoff)
        setResearchTimestamp(ts);

        const cov = computeCoverage(found, schema);
        setCoverage(cov);
        setGapRecoveryRan(false);

        setFieldMetadata(found.map(item => ({
          fieldId: item.field, value: item.value,
          source: item.source, sourceUrl: item.sourceUrl || null,
          sourceTier: item.sourceTier, verificationStatus: item.verificationStatus,
          documentType: null,
          fetchedAt: item.fetchedAt || ts, method: "nium_api", confidence: "high",
          customerAction: null, customerActionAt: null,
        })));

        const c = {};
        found.forEach((_, i) => { c[i] = true; });
        setChecks(c);
        setRejectedStakeholders({});
        setStakeholderFieldChecks({});
        setExpandedStakeholders({});
        setIsPubliclyListedOverride(false);
        stakeholdersRef.current = {};
        setStakeholderVersion(v => v + 1);
        setStakeholderErrors([]);
        setRevealedTs({});
        gapRef.current = {};
        setFormVersion(v => v + 1);

        trackEvent("nium_api_lookup_complete", {
          companyName,
          fieldsFound: data.fields.length,
          stakeholders: data.stakeholders?.all?.length || 0,
          durationMs: data.durationMs ?? (Date.now() - startedAt),
          publicDetailsId: data.publicDetailsId,
        });

        setLoading(false); setLoaderPhase(0); setResearchStatus("");
        setStep(agentType === "preboarding" ? S.confirm : S.applicant);
      } else {
        // No data — surface a clear error and return to the journey screen.
        // The analyst chose the Nium API journey deliberately; do NOT silently
        // switch to AI research. They decide whether to retry or pick another
        // journey type.
        const base = `Nium API returned no results for ${companyName}. Check the API connection or try a different journey type.`;
        const msg = data.error ? `${base} (${data.error})` : base;
        trackEvent("nium_api_lookup_failed", { companyName, error: data.error || "no_results" });
        setLoading(false); setLoaderPhase(0); setResearchStatus("");
        setStep(S.input);
        setJourneyOpen(true);
        setError(msg);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[startNiumApiLookup] Error:", err);
      // Network / unexpected failure — same rule: clear error, no AI fallback.
      const reason = err.name === "AbortError"
        ? "the request timed out after 120s"
        : err.message;
      trackEvent("nium_api_lookup_failed", { companyName, error: reason });
      setLoading(false); setLoaderPhase(0); setResearchStatus("");
      setStep(stepsFor("ai_only").input);
      setJourneyOpen(true);
      setError(`Nium API lookup failed for ${companyName}: ${reason}. Check the API connection or try a different journey type.`);
    } finally {
      clearTimeout(timer);
    }
  };

  // Continue handler from Documents step → triggers research with whatever
  // was uploaded (zero docs is fine; web search runs alone). In demo mode
  // we skip the API entirely and synthesise sample data.
  const proceedFromDocuments = () => {
    setError("");
    if (demoMode) { doDummyResearch("ai_documents"); return; }
    doResearch();
  };

  // ─── Doc search agent (Step 2 — Document Intelligence, Section A) ───
  // Calls the real sub-agent via /api/doc-search. Demo mode and local dev /
  // ?test=1 default to buildDemoDocSearchResults instead (no API spend);
  // the testing-mode toggle on Step 2 can trigger this explicitly.
  // Capture doc-search cost from the agent's CostTracker totals. Works for
  // both the real /api/doc-search response and the demo builder (both expose
  // data.cost.totals with real-shaped token counts).
  const captureDocSearchCost = (data) => {
    if (!data?.cost?.totals) return;
    const t = data.cost.totals;
    setCostTracker(prev => ({
      ...prev,
      docSearch: {
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        totalTokens: t.totalTokens,
        costUsd: calcCostUsd(t.inputTokens, t.outputTokens),
        apiCallCount: data.cost.calls?.length || 1,
        documentsSearched: data.summary?.total || 0,
        documentsFound: data.summary?.found || 0,
        // Per-call detail for JSONB storage
        callDetail: data.cost.calls || [],
      },
    }));
  };

  // Safety timeout for the document/registry agents. The self-source agent
  // retrieves registry items one-by-one (some behind captchas / screenshots)
  // and can occasionally never return — locally there is no serverless
  // max-duration to kill it, so without this the Documents step waits on
  // `selfSourceLoading` forever. On timeout we abort the request, surface a
  // note, and let the customer proceed (web research still covers the fields).
  const AGENT_TIMEOUT_MS = 120000; // 2 minutes — matches the typical serverless cap.

  const runRealSelfSource = () => {
    setSelfSourceResults(null);
    setSelfSourceLoading(true);
    setSelfSourceError(null);
    setSelfSourceDiag(null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    fetch("/api/self-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        companyName,
        incorporationCountry: countryObj ? countryObj.name : countryCode,
        entityType,
        ownershipType,
        niumEntityType: (entityType || "").toLowerCase(),
        companyRegistrationNumber: niumRegNumber || null,
        tenantId,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setSelfSourceResults(data);

          // ── PR-026: Merge registry-sourced fields into researchResults ────
          // selfSourcedFields shape: { [fieldId]: { value, tier, source, ... } }
          // mergeResearchResults() treats tier-1 registry sources as highest
          // priority — they win over AI web search for the same field.
          if (data.selfSourcedFields && Object.keys(data.selfSourcedFields).length > 0) {
            const selfSourcedRows = selfSourcedToRows(data.selfSourcedFields, activeSchema);
            // research is null until the Research step runs, so guard prev — at
            // the Documents step we seed it; once research exists we merge.
            setResearch(prev => prev
              ? { ...prev, found: mergeResearchResults(prev.found || [], selfSourcedRows) }
              : { found: selfSourcedRows });
          }

          // ── Cost tracking ─────────────────────────────────────────────────
          if (data.cost?.totals) {
            const t = data.cost.totals;
            setCostTracker(prev => ({
              ...prev,
              selfSource: {
                inputTokens: t.inputTokens,
                outputTokens: t.outputTokens,
                totalTokens: t.totalTokens,
                costUsd: t.totalCostUSD,
                apiCallCount: data.cost.calls?.length || 0,
                itemsRetrieved: data.summary?.retrieved || 0,
                fieldsMapped: Object.keys(data.selfSourcedFields || {}).length,
                callDetail: data.cost.calls || [],
              },
            }));
          }
        } else {
          setSelfSourceError(data.error || "Self-source failed");
        }
        // Test/demo diagnostic: the agent swallows AI extraction errors (e.g.
        // billing/credits, rate limits) and falls back to "manual retrieval", so
        // a genuine API failure looks like "document not found". Capture the first
        // such error here; it is only ever rendered in test/demo mode.
        const apiErr = (data.results || [])
          .map(r => r && r.extracted && r.extracted.notes)
          .find(n => n && /Extraction error|credit balance|invalid_request_error|rate_limit|authentication_error|overloaded/i.test(n));
        setSelfSourceDiag(apiErr || null);
        setSelfSourceLoading(false);
      })
      .catch(err => {
        setSelfSourceError(
          err.name === "AbortError"
            ? "Registry self-source timed out — continuing without it. Web research and document upload still cover these fields."
            : err.message
        );
        setSelfSourceLoading(false);
      })
      .finally(() => clearTimeout(timer));
  };

  const runRealDocSearch = () => {
    setDocSearchResults(null);
    setDocSearchLoading(true);
    setDocSearchError(null);

    const docOwnershipType = mapToDocAgentOwnershipType(
      ownershipType,
      entityType,
      false // effectivelyListed not known yet — research hasn't run
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    fetch("/api/doc-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        companyName,
        country: countryObj ? countryObj.name : countryCode,
        ownershipType: docOwnershipType,
        niumEntityType: (entityType || "").toLowerCase(),
        tenantId,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setDocSearchResults(data);
          captureDocSearchCost(data);
        } else {
          setDocSearchError(data.error || "Doc search failed");
        }
        setDocSearchLoading(false);
      })
      .catch(err => {
        setDocSearchError(
          err.name === "AbortError"
            ? "Document search timed out — you can upload documents manually below and continue."
            : err.message
        );
        setDocSearchLoading(false);
      })
      .finally(() => clearTimeout(timer));
  };

  // Kick off the doc search once when the Documents step is entered.
  useEffect(() => {
    if (!isAiDocs || step !== STEPS.documents) return;
    if (docSearchResults !== null || docSearchLoading) return;
    if (!companyName.trim()) return;
    if (demoMode || SHOW_TEST_TOOLS) {
      // Demo/test mode: show dummy doc-search AND dummy registry results
      // immediately. The real agents are NOT auto-fired here — the "Run real
      // agent" button (test mode only) lets the user trigger both on demand,
      // which clears these dummies and replaces them with real results.
      const demo = buildDemoDocSearchResults(companyName, ownershipType, entityType);
      setDocSearchResults(demo);
      captureDocSearchCost(demo);
      setDocSearchLoading(false);
      setSelfSourceResults(buildDemoSelfSourceResults(companyName));
    } else {
      // Run both agents in parallel — doc search (Wolfsberg/Annual Report)
      // and registry self-source (Companies House / ACRA / etc.)
      runRealDocSearch();
      runRealSelfSource();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isAiDocs]);

  // Documents-step loader: cycle the progress message every 8s while either
  // agent is running; reset to the first message once both finish.
  useEffect(() => {
    const loading = docSearchLoading || selfSourceLoading;
    if (!loading) { setDocLoaderIdx(0); return; }
    const id = setInterval(() => setDocLoaderIdx(i => (i + 1) % DOC_LOADER_MSGS.length), 8000);
    return () => clearInterval(id);
  }, [docSearchLoading, selfSourceLoading]);

  // Stale-result guard: clear doc search state whenever the customer is back
  // on Step 1 (Back navigation or Start Over), so a changed company name
  // triggers a fresh search on the next visit to the Documents step.
  useEffect(() => {
    if (step !== STEPS.input) return;
    setDocSearchResults(null);
    setDocSearchLoading(false);
    setDocSearchError(null);
    setSelfSourceResults(null);
    setSelfSourceLoading(false);
    setSelfSourceError(null);
    setHasRunRealAgent(false);
    setSelfSourceDiag(null);
    setAcceptedDocTypes(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Generic per-doc file handler. Clears the slot on null.
  const handleDocFile = (key) => (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dt = DOC_TYPES.find(d => d.key === key);
    if (!dt) return;
    const accepted = dt.accept.split(",").map(s => s.trim());
    if (!accepted.includes(file.type)) {
      setError(`${dt.label}: file must be ${dt.accepts}.`);
      return;
    }
    if (file.size > 20 * 1024 * 1024) { setError(`${dt.label}: file must be 20MB or smaller.`); return; }
    setError("");
    setUploadedDocs(prev => ({ ...prev, [key]: file }));
  };
  const removeDocFile = (key) => () => setUploadedDocs(prev => ({ ...prev, [key]: null }));

  // ── Foundational-facts confirmation gate handlers (slice 2 of 2) ──────────
  // The five-fact gate at the top of the Applicant page is controlled: these
  // handlers own its check state and outcomes. A disputed fact (other than the
  // ownership fork) — or an "ownership misclassified" choice — is a HARD reset to
  // the fresh lookup page via resetAll() (nothing pre-filled). This deliberately
  // replaces the old dossier-reseed dispute (which carried state forward); the
  // re-research engine itself is untouched and still reachable elsewhere.
  const isFactConfirmed = (key) => factChecks[key] !== false;

  const toggleFact = (key) => {
    // Flip this fact's confirm state. Toggling ownership opens/closes its fork.
    const wasConfirmed = factChecks[key] !== false;
    setFactChecks((prev) => ({ ...prev, [key]: wasConfirmed ? false : true }));
    if (key === "ownershipType") {
      setOwnershipFork(wasConfirmed ? "choose" : null);
      if (wasConfirmed === false) setOwnershipChangeDeclared(null);
    }
    if (key === "registrationNumber") {
      setRegNumberFork(wasConfirmed ? "choose" : null);
      if (wasConfirmed === false) setRegNumberChangeDeclared(null);
    }
  };

  // Re-tick everything → back to the all-confirmed default (cancel a dispute).
  const cancelFactDispute = () => {
    setFactChecks({});
    setOwnershipFork(null);
    setOwnershipChangeDeclared(null);
    setRegNumberFork(null);
    setRegNumberChangeDeclared(null);
  };

  // Ownership genuinely changed → record the declared change and move to the
  // NEW-type capture (the "changed" fork now shows a select). This no longer
  // dead-ends: resolveOwnershipChange (below) captures the new type, requests the
  // documents, and confirms the gate so the applicant section reappears.
  const declareOwnershipChanged = () => {
    setOwnershipFork("changed");
    setOwnershipChangeDeclared({
      from: ownershipTypeLabel(ownershipType) || ownershipType || "",
      at: new Date().toISOString(),
    });
  };

  // "It genuinely changed" resolution: capture the NEW ownership type, request the
  // two supporting documents into Fill Gaps (via change_events → the Amendment
  // Documentation panel, keyed dossierId||onboardingSubmissionId so both journeys
  // work), and RESOLVE the gate (re-confirm the ownership fact + close the fork) so
  // the applicant fields + Continue REAPPEAR. This un-traps the journey.
  //
  // DEFERRED: the inline-on-Applicant document-upload card is a later piece — for
  // now these documents surface in Fill Gaps' Amendment Documentation. We also do
  // NOT reshape the question set / EDD off the new type (that's PR-049): the stored
  // ownershipType is left unchanged; we only record the change + request docs.
  const resolveOwnershipChange = (newTypeId) => {
    if (!newTypeId) return;
    const submissionId = dossierId || onboardingSubmissionId;
    const isUKJur = countryCode === "GB" || activeSchema?.region === "UK";
    const certLabel = isUKJur
      ? "Certificate of Re-registration / Conversion (Companies House)"
      : "Certificate of Change / Conversion (Amended Certificate of Incorporation)";
    const docs = [
      { fieldId: "ownership_change_certificate", docType: certLabel },
      { fieldId: "ownership_change_precheck", docType: preCheckDocForOwnershipType(newTypeId) },
    ];
    if (submissionId && typeof fetch === "function") {
      docs.forEach(({ fieldId, docType }) => {
        const ev = buildChangeEvent({
          field: { fieldId, fieldClass: "structural" },
          jurisdiction: countryCode || "GB",
          submissionId,
          dossierId,
          storedChangeType: "changed",
          intent: "genuine_update",
          registryStatus: null,
          engineResult: { workflow: "doc_required", docType, decided: true },
        });
        fetch("/api/change-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ev),
        }).catch((err) => console.warn("[ownership-change] doc persist failed:", err));
      });
    }
    // Record the new type (audit) and RESOLVE the gate → applicant fields reappear.
    setOwnershipChangeDeclared((prev) => ({
      ...(prev || {}),
      to: ownershipTypeLabel(newTypeId) || newTypeId,
      at: new Date().toISOString(),
    }));
    setFactChecks((prev) => ({ ...prev, ownershipType: true })); // re-confirm → gate passes
    setOwnershipFork(null);
  };

  // Registration/company number genuinely changed → move to new-number capture.
  // `from` is passed in from the render (where the displayed reg value is known).
  const declareRegNumberChanged = (fromValue) => {
    setRegNumberFork("changed");
    setRegNumberChangeDeclared({ from: fromValue || "", at: new Date().toISOString() });
  };

  // "Registration number genuinely changed" resolution: capture the NEW number,
  // request the jurisdiction-appropriate change document into Fill Gaps (via
  // change_events, keyed dossierId||onboardingSubmissionId), and RESOLVE the gate.
  // A BRN change is evidenced by a jurisdiction-dependent document — Certificate
  // of Change of Registration Number / Notice of Registration / updated Extract
  // from the Commercial Register — same document class, label per jurisdiction.
  // DEFERRED (as with ownership): inline-on-Applicant doc card is a later piece
  // (docs surface in Fill Gaps for now); the stored regNumber is left unchanged.
  const resolveRegNumberChange = (newNumber) => {
    const trimmed = (newNumber || "").trim();
    if (!trimmed) return;
    const submissionId = dossierId || onboardingSubmissionId;
    const isUKJur = countryCode === "GB" || activeSchema?.region === "UK";
    const regChangeDoc = isUKJur
      ? "Certificate of Change of Registration Number / updated Companies House extract"
      : "Certificate of Change of Registration Number / Notice of Registration (updated Extract from the Commercial Register)";
    if (submissionId && typeof fetch === "function") {
      const ev = buildChangeEvent({
        field: { fieldId: "reg_number_change_certificate", fieldClass: "factualId" },
        jurisdiction: countryCode || "GB",
        submissionId,
        dossierId,
        storedChangeType: "changed",
        intent: "genuine_update",
        registryStatus: null,
        engineResult: { workflow: "doc_required", docType: regChangeDoc, decided: true },
      });
      fetch("/api/change-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ev),
      }).catch((err) => console.warn("[reg-number-change] doc persist failed:", err));
    }
    setRegNumberChangeDeclared((prev) => ({ ...(prev || {}), to: trimmed, at: new Date().toISOString() }));
    setFactChecks((prev) => ({ ...prev, registrationNumber: true })); // re-confirm → gate passes
    setRegNumberFork(null);
  };

  // Wrong-TYPE correction (interpretation): keep the existing research, re-resolve
  // the schema from the corrected classifier, re-save as customer-seeded. No new
  // AI search, no attempt spent. Per this slice's scope we do NOT auto-strip/add
  // type-conditional questions or fire any EDD behaviour (deferred) — the field
  // set is left to the existing schema resolution.
  const applyReDerive = () => {
    try { setActiveSchema(getSchemaFromConfig(countryCode, entityType, tenantConfig)); }
    catch (_) { /* leave schema as-is */ }
    setPendingReseedMode(null);
    setDossierSaved(false);
    saveDossier(); // persists seeded_by:customer (seededBy state is 'customer')
    scrollAndSetStep(STEPS.applicant); // applicant gate stays AHEAD of confirm
  };

  // Journey-screen Continue → routes per selected card.
  const proceedFromJourney = () => {
    if (!selectedJourneyCard) { setError("Please choose an option to continue."); return; }
    setError("");

    // Two-retry cap: search cards (A/B/E) are blocked once the customer has used
    // their searches — only manual entry (C) remains. Card C is never blocked.
    const isSearchCard = ["A", "B", "E"].includes(selectedJourneyCard);
    if (isSearchCard && evaluateSearchCap(searchAttempts).locked) {
      setError(CONTACT_ADMIN_MSG);
      return;
    }
    // A customer re-search consumes an attempt — increment the server-authoritative
    // counter (optimistic locally, reconciled from the server response). The new
    // dossier carries the count forward via buildDossierPayload.
    if (isSearchCard && seededBy === "customer") {
      setSearchAttempts((n) => n + 1);
      if (dossierId) {
        fetch("/api/search-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dossierId }),
        })
          .then((r) => r.json())
          .then((d) => { if (d && Number.isFinite(d.attempts)) setSearchAttempts(d.attempts); })
          .catch(() => {});
      }
    }

    if (selectedJourneyCard === "A") {
      setJourneyType("ai_documents");
      setJourneyOpen(false);
      setManualOpened(false);
      // Demo: skip docs upload (no point uploading) and go straight to dummy.
      if (demoMode) { doDummyResearch("ai_documents"); return; }
      scrollAndSetStep(1); // documents step
    } else if (selectedJourneyCard === "B") {
      setJourneyType("ai_only");
      setJourneyOpen(false);
      setManualOpened(false);
      // STEPS in this branch is { input:0, research:1, ... }
      if (demoMode) { doDummyResearch("ai_only"); return; }
      doResearch("ai_only");
    } else if (selectedJourneyCard === "C") {
      setJourneyType("manual");
      window.open(manualFormUrl_, "_blank", "noopener,noreferrer");
      setManualOpened(true);
    } else if (selectedJourneyCard === "E") {
      // Max Prefill. TODO: implement the dedicated max-prefill pipeline that
      // pulls from every source at once (documents + registries + web + Nium
      // KYB). For now route through standard AI research so both the onboarding
      // and pre-boarding demos flow end to end and land on Confirm / Dossier.
      setJourneyType("max_prefill");
      setJourneyOpen(false);
      setManualOpened(false);
      if (demoMode) { doDummyResearch("max_prefill"); return; }
      doResearch("max_prefill");
    }
  };

  const buildApplicantProvenance = () =>
    deriveApplicantProvenance({ applicantSelectedPerson, applicantAgentValues, gapValues: gapRef.current });

  // Final submission: build the metadata + payload, log, persist to Neon via
  // /api/submit, advance to Done. The DB write is best-effort — a failure
  // never blocks the customer from reaching the success screen.
  const submitApplication = async () => {
    const submittedAt = new Date().toISOString();
    setSubmitTs(submittedAt);

    // Append manual-input metadata for every gapRef entry that has a value.
    const manualEntries = [];
    Object.entries(gapRef.current).forEach(([fieldId, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const isCorrection = fieldId.startsWith("corrected_");
      const key = isCorrection ? fieldId.slice("corrected_".length) : fieldId;
      // Carry the ORIGINAL registry value on the correction entry. Without it
      // the original is lost from this trail entirely: finalMeta below drops
      // the AI entry for any corrected field, so the manual entry would be the
      // only record and it holds the CUSTOMER's value. The server writes this
      // into field_provenance.agent_value, giving a corrected scalar a second
      // durable home for its original — change_events.before_value was
      // previously the only one.
      const originalMeta = isCorrection ? fieldMetadata.find(m => m.fieldId === key) : null;
      const originalRow = isCorrection ? (research?.found || []).find(r => r.field === key) : null;
      const rawAgentValue = originalMeta && originalMeta.value !== undefined && originalMeta.value !== null
        ? originalMeta.value
        : (originalRow ? originalRow.value : null);
      manualEntries.push({
        fieldId: key,
        value: String(value),
        source: "Customer input",
        sourceUrl: null,
        sourceTier: "manual",
        documentType: null,
        fetchedAt: submittedAt,
        method: "manual",
        confidence: "verified",
        customerAction: isCorrection ? "corrected" : "entered",
        customerActionAt: submittedAt,
        // The pre-correction registry value + where it came from. Null for a
        // plain gap entry — the AI never had a value to be corrected.
        agentValue: rawAgentValue === null || rawAgentValue === undefined
          ? null
          : (typeof rawAgentValue === "object" ? JSON.stringify(rawAgentValue) : String(rawAgentValue)),
        agentSource: isCorrection ? ((originalMeta && originalMeta.source) || (originalRow && originalRow.source) || null) : null,
        agentSourceTier: isCorrection ? ((originalMeta && originalMeta.sourceTier) || (originalRow && originalRow.sourceTier) || null) : null,
        agentFetchedAt: isCorrection ? ((originalMeta && originalMeta.fetchedAt) || (originalRow && originalRow.fetchedAt) || null) : null,
      });
    });
    const finalMeta = [...fieldMetadata.filter(m => !manualEntries.some(e => e.fieldId === m.fieldId && e.customerAction === "corrected")), ...manualEntries];
    setFieldMetadata(finalMeta);

    // Build a flat fieldId → value map. For corrections, the manual value wins.
    const fieldValues = {};
    (research?.found || []).forEach((it, i) => {
      if (checks[i]) fieldValues[it.field] = it.value;
    });
    Object.entries(gapRef.current).forEach(([fieldId, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const key = fieldId.startsWith("corrected_") ? fieldId.slice("corrected_".length) : fieldId;
      fieldValues[key] = String(value);
    });

    // Build structured stakeholder payload from stakeholdersRef. Each
    // stakeholder field id maps to an array of person records with both
    // the AI-found provenance (source/sourceUrl/sourceTier/fetchedAt) and
    // the customer-completed compliance fields. Empty fields are kept so
    // the downstream consumer can see which gaps were left blank.
    const stakeholderPayload = {};
    (research?.found || []).forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      const list = getStakeholders(result.field);
      if (!list || list.length === 0) return;
      stakeholderPayload[result.field] = list.map((s) => {
        const fullEddCollected = needsStakeholderDetails(s, result.field, effectivelyListed);
        // Corporate stakeholder — emit the KYB shape (businessName, businessType,
        // businessRegistrationNumber, registeredCountry, sharePercentage,
        // positions[]) rather than the person EDD fields.
        if (s.is_company) {
          return {
            id: s.id,
            is_company: true,
            businessName: s.full_name || "",
            businessType: s.business_type || "",
            businessRegistrationNumber: s.business_registration_number || "",
            registeredCountry: s.registered_country || "",
            sharePercentage: s.share_percentage != null ? s.share_percentage : null,
            positions: (s.positions || [])
              .filter((p) => p && (p.title || p.start_date))
              .map((p) => ({ title: p.title || "", startDate: p.start_date || "" })),
            source: s.source || "",
            sourceUrl: s.sourceUrl || "",
            sourceTier: s.sourceTier || "",
            fetchedAt: s.fetchedAt || null,
            customer_confirmed: !s.customer_rejected,
            customer_added: !!s.customer_added,
            customer_rejected: !!s.customer_rejected,
            full_name_original: s.full_name_original || null,
          };
        }
        return {
          id: s.id,
          full_name: s.full_name || "",
          role: s.role || "",
          share_percentage: s.share_percentage != null ? s.share_percentage : null,
          // Was the full enhanced-due-diligence form collected for this person?
          full_edd_collected: fullEddCollected,
          edd_skip_reason: fullEddCollected ? null : "publicly_listed_company",
          nationality: s.nationality || "",
          date_of_birth: s.date_of_birth || "",
          residential_country: s.residential_country || "",
          id_type: s.id_type || "",
          id_number: s.id_number || "",
          is_pep: s.is_pep,
          pep_details: s.pep_details || null,
          source: s.source || "",
          sourceUrl: s.sourceUrl || "",
          sourceTier: s.sourceTier || "",
          fetchedAt: s.fetchedAt || null,
          customer_confirmed: !s.customer_rejected,
          customer_added: !!s.customer_added,
          customer_rejected: !!s.customer_rejected,
          full_name_original: s.full_name_original || null,
        };
      });
    });

    // Applicant identity + per-field provenance (accepted / overridden / provided).
    const applicantProvenance = buildApplicantProvenance();
    const applicantOverridesList = applicantProvenance.filter((p) => p.customerAction === "overridden");
    const applicant = {
      selectedPersonId: applicantSelectedPerson?.id || null,
      selectedPersonName: applicantSelectedPerson?.name || null,
      selectedPersonRole: applicantSelectedPerson?.role || null,
      selectedFromResearch: !!applicantSelectedPerson,
      firstName: gapRef.current.applicantFirstName || null,
      lastName: gapRef.current.applicantLastName || null,
      email: gapRef.current.applicantEmail || null,
      phone: gapRef.current.applicantMobile || null,
      jobTitle: gapRef.current.applicantPosition || null,
      nationality: gapRef.current.applicantNationality || null,
      dateOfBirth: gapRef.current.applicantDateOfBirth || null,
      isPEP: gapRef.current.applicantIsPEP || null,
    };

    const payload = {
      submissionId: genUUID(),
      submittedAt,
      applicant,
      applicantProvenance,
      applicantOverrides: applicantOverridesList,
      applicantDataAmended: applicantOverridesList.length > 0,
      company: {
        name: research?.companyName || companyName,
        countryCode,
        countryName: countryObj ? countryObj.name : countryCode,
        entityType,
        ownershipType,
        ownershipTypeLabel: ownershipTypeLabel(ownershipType),
        schemaJurisdiction: activeSchema?.region === "UK" ? "GB" : "SG",
      },
      journeyType,
      documentsUploaded: DOC_TYPES.filter(d => uploadedDocs[d.key]).map(d => d.key),
      researchTimestamp,
      fromCache: false,
      isPubliclyListed: effectivelyListed,
      listingDetectedFrom: effectivelyListed ? detectListingEvidence(research) : null,
      // Enhanced research pipeline: ownership-type strategy + coverage metrics.
      research: {
        ownershipType,
        ownershipTypeLabel: ownershipTypeLabel(ownershipType),
        researchStrategy: (OWNERSHIP_TYPE_LIBRARY.find(o => o.id === ownershipType) || {}).researchStrategy || null,
        gapRecoveryRan,
        coverage: coverage ? {
          totalResearchFields: coverage.totalResearchFields,
          populatedFields: coverage.populatedFields,
          verifiedFields: coverage.verifiedFields,
          probableFields: coverage.probableFields,
          indicativeFields: coverage.indicativeFields,
          missingFieldCount: coverage.missingFieldCount,
          fillRate: Math.round(coverage.fillRate * 100),
          verifiedFillRate: Math.round(coverage.verifiedFillRate * 100),
        } : null,
      },
      // DRS — document requirements collected at the dynamic documents step.
      documentRequirements: {
        submittedRequirements: drsSubmitted,
        flags: drsFlags,
      },
      fieldValues,
      fieldMetadata: finalMeta.map(m => ({
        ...m,
        verificationStatus: m.verificationStatus
          || (research?.found || []).find(r => r.field === m.fieldId)?.verificationStatus
          || "manual",
      })),
      stakeholders: stakeholderPayload,
      declaration: {
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
        platform: device.platform,
        timezone: device.timezone,
        timestamp: submittedAt,
        language: device.language,
        agreedAt: submittedAt,
        certifiedAt: submittedAt,
      },
    };

    // Per-phase real-token cost summary for this journey (doc search, research
    // pass 1 & 2, doc extraction). Totals are recomputed from summed real
    // token counts inside buildCostSummary.
    const submitCompany = { name: payload.company.name, code: countryCode };
    const costSummary = buildCostSummary(
      costTracker,
      submitCompany,
      entityType,
      ownershipType,
      coverage || null
    );
    payload.costSummary = costSummary;

    // eslint-disable-next-line no-console
    console.log("APPLICATION_SUBMISSION", payload);

    // Persist to Neon via /api/submit. Best-effort: a DB failure must never
    // block the customer from reaching the success screen.
    try {
      const resp = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          company: submitCompany,
          entityType,
          ownershipType,
          journeyType,
          fieldValues,
          // The per-field provenance trail. It was built for the payload log
          // but never actually transmitted, which is why field_provenance left
          // agent_value NULL for every scalar. Sending it lets the server
          // record the AI/registry original alongside the customer's value.
          fieldMetadata: payload.fieldMetadata,
          stakeholders: stakeholderPayload,
          documents: docSearchResults?.documents || [],
          costSummary,
          coverage: coverage || null,
          declaration: payload.declaration,
          applicant,
          applicantProvenance,
          applicantOverrides: applicantOverridesList,
          applicantDataAmended: applicantOverridesList.length > 0,
          submittedAt,
        }),
      });
      const result = await resp.json();
      if (result.sessionId) {
        // eslint-disable-next-line no-console
        console.log(`[Submit] ✅ Saved — session: ${result.sessionId}`);
        trackEvent("application_submitted", {
          companyName: submitCompany.name,
          sessionId: result.sessionId,
          totalCostUsd: costSummary?.totals?.totalCostUsd ?? null,
          totalTokens: costSummary?.totals?.totalTokens ?? null,
          fillRate: coverage?.fillRate ?? null,
          agentType: agentType || "onboarding",
          submittedAt: new Date().toISOString(),
        });
      }
      if (result.warning) {
        // eslint-disable-next-line no-console
        console.warn(`[Submit] ⚠ ${result.warning}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Submit] ❌ Failed:", err);
    }

    setDone(true);
  };

  // Toggle a Confirm-page checkbox AND record the action in metadata.
  const toggleCheck = (idx) => {
    const item = (research && research.found) ? research.found[idx] : null;
    const nowChecked = !checks[idx]; // true = re-checked (accepted / undo)
    setChecks(prev => ({ ...prev, [idx]: !prev[idx] }));
    if (!item) return;

    const at = new Date().toISOString();
    setFieldMetadata(prevMeta => prevMeta.map(m =>
      m.fieldId === item.field ? { ...m, customerAction: nowChecked ? "accepted" : "rejected", customerActionAt: at } : m
    ));

    // Re-check = the customer UNDID their change → retract its amendment-document
    // request. Append a compensating REVERT event (workflow 'accept_silent'); the
    // original change event is NEVER deleted or mutated (append-only store).
    // deriveAmendmentDocuments reads the latest event per field, so this later
    // non-doc event nets the document to "not owed" — the Fill Gaps card drops and
    // the Confirm notice clears (the dialogue isn't rendered once re-checked).
    // Only write a revert when a change was actually emitted for this field.
    // Same submissionId keying as the change write, so it works in both journeys.
    //
    // NOTE: the change AND this revert both remain in the append-only audit store
    // on purpose (a future rule may care that e.g. a UBO was changed then put
    // back). Materiality / which fields matter / MLRO-surfacing are pending Danny
    // (CD-register) — do NOT infer materiality or surface anything here.
    if (nowChecked) {
      const snap = dialogueStateRef.current[item.field];
      if (snap && snap.emitted) {
        const revertEvent = buildChangeEvent({
          field: { fieldId: item.field, fieldClass: classifyFieldClass(item.field) },
          jurisdiction: countryCode || "GB",
          submissionId: dossierId || onboardingSubmissionId,
          dossierId,
          storedChangeType: "changed",
          intent: null,
          registryStatus: null,
          engineResult: { workflow: "accept_silent", docType: null, decided: true },
        });
        if (typeof fetch === "function") {
          fetch("/api/change-events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(revertEvent),
          }).catch((err) => console.warn("[toggleCheck] revert persist failed:", err));
        }
      }
      // Clear the dialogue snapshot so a later RE-uncheck starts a FRESH dialogue
      // that emits a new change event (R6: toggling re-adds the document each time).
      delete dialogueStateRef.current[item.field];
      // Inline capture (commit 3): a re-check is an undo — drop the inline
      // corrected value too. gapRef entries always win over accepted AI values
      // in submitApplication, so a stale correction left behind here would
      // silently override the value the customer just re-accepted.
      if (gapRef.current["corrected_" + item.field] !== undefined) {
        delete gapRef.current["corrected_" + item.field];
        setFormVersion(v => v + 1);
      }
    }
  };

  // Record that the customer explicitly ticked this row. Additive only — it
  // does not touch `checks`, so nothing downstream (corrections, dialogue,
  // submit) changes; it exists so an untouched low-confidence row can be told
  // apart from one the customer actually agreed with. See confirmState.js.
  const affirmRow = (item) => {
    if (!item || !item.field) return;
    setAffirmedFields(prev => (prev[item.field] ? prev : { ...prev, [item.field]: true }));
  };

  // ── CD-03 person-scoped corrections (commit 6) ──────────────────────────────
  // Which person-attribute is currently being corrected, keyed by composite
  // fieldId; and which person is mid-removal, keyed by stakeholder id.
  const [personEditing, setPersonEditing] = useState(null); // { fieldId, stakeholderId, attribute, fieldKey }
  const [personRemoving, setPersonRemoving] = useState(null); // { fieldId, stakeholderId, name }
  const [addingPerson, setAddingPerson] = useState(false);    // commit 7 add-a-person panel

  /**
   * Emit ONE person-scoped change-event through the SAME pipeline the company
   * rows use: classify → buildChangeEvent → POST /api/change-events. The only
   * difference is the composite fieldId (`<personType>::<sh_id>::<attribute>`),
   * which makes each person-attribute independently addressable, independently
   * supersedable, and independently resolvable by deriveAmendmentDocuments.
   *
   * Snapshots land in dialogueStateRef under that composite key, so the
   * documents list, the summary panel, the submit gate and the analyst strip
   * all pick person documents up with no extra wiring — one pipeline, not two.
   */
  const emitPersonChange = ({ person, researchFieldId, attribute, value = null, nameCase = null, reason = null }) => {
    const type = resolvePersonType(person, researchFieldId);
    const compositeId = personFieldId(type.personType, person.id, attribute);
    const engineInput = {
      personScope: true,
      personType: type.personType,
      attribute,
      nameCase,
      // PEP is add-only: the customer declaring "yes" is what CD-03 rules on.
      pepValue: attribute === PERSON_ATTRIBUTE.PEP
        ? (value === true || value === "yes" ? "yes" : "no")
        : null,
      // Threshold crossing needs reliable per-person ownership data, which the
      // person-type stub cannot supply — 'unknown' records UNDECIDED rather
      // than guessing (CD-03's deliberate gap, see policyTable PERSON_RULES).
      thresholdCrossing: attribute === PERSON_ATTRIBUTE.OWNERSHIP_PCT ? "unknown" : null,
      // EDD flag: injectable list, empty until the MLRO supplies it.
      highRiskCountry: personHasHighRiskCountry({
        ...person,
        ...(attribute === PERSON_ATTRIBUTE.NATIONALITY ? { nationality: value } : {}),
        ...(attribute === PERSON_ATTRIBUTE.RESIDENTIAL_ADDRESS ? { residential_country: value } : {}),
      }),
    };
    const engineResult = classifyChange(engineInput);

    const prev = dialogueStateRef.current[compositeId];
    // Provenance goes through the SAME deriveSource the company path uses.
    // change_events.source_tier is a SMALLINT, and a stakeholder carries the
    // string form ("tier1"); deriveSource normalises it to 1. Passing the raw
    // string makes real Postgres reject the whole INSERT — invisible locally,
    // because the route always answers 200 and the fake DB never type-checks.
    const src = deriveSource({ sourceTier: person.sourceTier, source: person.source });
    const event = buildChangeEvent({
      field: {
        fieldId: compositeId,
        // fieldClass stays inside the existing closed enum — person type maps
        // onto 'director' / 'ubo', both already valid, so writeEvent's guard
        // passes with no schema or vocabulary change.
        fieldClass: type.personType === "director" ? "director" : "ubo",
        value: person[Object.keys(ATTRIBUTE_BY_FIELD_KEY).find(k => ATTRIBUTE_BY_FIELD_KEY[k] === attribute)] ?? null,
        sourceType: src.sourceType,
        sourceProvider: src.sourceProvider,
        sourceTier: src.sourceTier,
        verifiability: "structured_registry",
      },
      jurisdiction: countryCode || "GB",
      submissionId: dossierId || onboardingSubmissionId,
      dossierId,
      // The stored vocabulary is add|remove|changed. An addition must record as
      // 'add' — filing it as 'changed' would misdescribe it to an analyst
      // reading the trail, and deriveChangeType's presence semantics agree
      // (no prior value → add).
      storedChangeType:
        attribute === PERSON_ATTRIBUTE.REMOVAL
          ? "remove"
          : (attribute === PERSON_ATTRIBUTE.ADDED
            || attribute === PERSON_ATTRIBUTE.ADDED_POI
            || attribute === PERSON_ATTRIBUTE.ADDED_POA)
            ? "add"
            : "changed",
      intent: null,
      registryStatus: "unknown",
      engineResult,
      afterValue: value == null ? null : String(value),
      // Chain to the tail, never a consumed head (the 3.1 rule).
      supersedesId: prev && prev.tailEventId != null ? prev.tailEventId : (prev && !prev.headConsumed ? prev.eventId : null),
    });

    dialogueStateRef.current[compositeId] = {
      ...prev,
      emitted: true,
      event,
      outcome: engineResult,
      headConsumed: true,
      tailEventId: null,
      personScope: true,
      reason,
    };

    if (typeof fetch === "function") {
      fetch("/api/change-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      })
        .then((r) => r.json())
        .then((d) => {
          const cur = dialogueStateRef.current[compositeId];
          if (cur) {
            dialogueStateRef.current[compositeId] = {
              ...cur,
              tailEventId: d && d.success && d.id != null ? d.id : null,
            };
          }
          if (d && d.success === false && d.warning) {
            console.warn("[confirm] person change-event rejected:", d.warning);
          }
        })
        .catch((err) => console.warn("[confirm] person change-event persist failed:", err));
    }
    trackEvent("person_change_captured", event);
    setFormVersion(v => v + 1);
    return { compositeId, engineResult, type };
  };

  /** Resolve one person correction: capture the value, then emit the event(s). */
  const resolvePersonCorrection = (person, researchFieldId, fieldKey, resolution) => {
    const { attribute, value, nameCase } = resolution;

    // "This isn't the right person" resolves as a REMOVAL, not a name edit.
    if (attribute === PERSON_ATTRIBUTE.REMOVAL) {
      emitPersonChange({ person, researchFieldId, attribute, reason: resolution.reason || null });
      if (!isStakeholderRejected(researchFieldId, person.id)) {
        toggleStakeholderRejection(researchFieldId, person.id);
      }
      setPersonEditing(null);
      return;
    }

    // Capture the value where Fill Gaps already reads it, so nothing is retyped.
    if (fieldKey && value != null) {
      updateStakeholderField(researchFieldId, person.id, fieldKey, value);
    }
    emitPersonChange({ person, researchFieldId, attribute, value, nameCase });

    // A UBO's legal name change needs the ownership chart AS WELL as the POI;
    // one event carries one docType, so the companion list document is its own
    // person-attribute event. (Director-only already gets the list doc from the
    // name rule itself, so no second event there.)
    const type = resolvePersonType(person, researchFieldId);
    if (attribute === PERSON_ATTRIBUTE.NAME && nameCase === "legal_change" && type.personType === "ubo") {
      emitPersonChange({ person, researchFieldId, attribute: "name_list", value });
    }
    setPersonEditing(null);
  };

  /**
   * Unticking a person attribute now OPENS the CD-03 correction flow instead of
   * silently routing the field to the next page. Re-ticking closes it. The
   * existing stakeholderFieldChecks state is preserved exactly as before — this
   * only adds the correction panel on top of it.
   */
  const togglePersonField = (item, s, f) => {
    const wasConfirmed = isStkFieldConfirmed(s.id, f.key);
    toggleStkFieldConfirm(s.id, f.key);
    const attribute = ATTRIBUTE_BY_FIELD_KEY[f.key];
    if (wasConfirmed && attribute) {
      setPersonEditing({ researchFieldId: item.field, stakeholderId: s.id, attribute, fieldKey: f.key });
    } else {
      setPersonEditing(null);
    }
  };

  /** Crossing a person asks WHY first; un-crossing is a plain undo. */
  const togglePersonRemoval = (item, s) => {
    if (isStakeholderRejected(item.field, s.id)) {
      toggleStakeholderRejection(item.field, s.id);
      setPersonRemoving(null);
      return;
    }
    setPersonRemoving({ researchFieldId: item.field, stakeholderId: s.id, name: s.full_name });
  };

  /**
   * ADD A PERSON (commit 7). The customer states the type, so person type here
   * is EXPLICIT — the created stakeholder carries real isDirector/isUBO flags,
   * which is the interface personType.js assumes and the stub otherwise fakes.
   *
   * Emits the CD-03 events for an addition, each as its own person-scoped
   * change-event under the composite fieldId, so they flow through the same
   * derive → scope-aware dedup (6a) → panel → gate path as every other
   * document. Nothing new is wired: a distinct stakeholderId is all the
   * per-person keying needs.
   */
  const addPersonFromConfirm = ({ type, full_name, date_of_birth, nationality, residential_country, is_pep }) => {
    const isDirector = type === "director" || type === "both";
    const isUBO = type === "ubo" || type === "both";
    // Attach the person to the matching research field so Fill Gaps renders
    // them alongside the people already found there.
    const rows = (research?.found || []).filter((r) => isStakeholderField(r.field));
    const preferred = rows.find((r) => (isUBO ? isUboLikeField(r.field) : !isUboLikeField(r.field)));
    const targetField = (preferred || rows[0] || {}).field;
    if (!targetField) return null;

    const person = addStakeholder(targetField, {
      full_name,
      date_of_birth: date_of_birth || "",
      nationality: nationality || "",
      residential_country: residential_country || "",
      is_pep: is_pep === true ? true : is_pep === false ? false : null,
      // The real person-type interface — stated, not inferred.
      isDirector,
      isUBO,
    });

    const emit = (attribute, value) =>
      emitPersonChange({ person, researchFieldId: targetField, attribute, value });

    // 1. The list document proving the person belongs (director → list of
    //    directors, UBO → ownership chart). Requesting it IS the analyst review.
    emit(PERSON_ATTRIBUTE.ADDED, full_name);
    // 2. The person's own evidence — a no-op for a director-only person, whose
    //    rules resolve to accept_silent with no document.
    emit(PERSON_ATTRIBUTE.ADDED_POI, full_name);
    emit(PERSON_ATTRIBUTE.ADDED_POA, residential_country || full_name);
    // 3. PEP is add-only, and this is the moment it can be declared.
    if (is_pep === true) emit(PERSON_ATTRIBUTE.PEP, true);

    setAddingPerson(false);
    setExpandedStakeholders((prev) => ({ ...prev, [person.id]: true }));
    return person;
  };

  /** Confirm-why removal from the person card's own checkbox. */
  const confirmPersonRemoval = (person, researchFieldId, reason) => {
    emitPersonChange({ person, researchFieldId, attribute: PERSON_ATTRIBUTE.REMOVAL, reason });
    if (!isStakeholderRejected(researchFieldId, person.id)) {
      toggleStakeholderRejection(researchFieldId, person.id);
    }
    setPersonRemoving(null);
  };

  // Commit 3 (Option B core) — save handler for the inline correction editor.
  // Two consistent destinations, in order:
  //   1. gapRef["corrected_<field>"] — the SAME client-state key Fill Gaps
  //      renders and submitApplication/allGapsFilled/field_provenance consume,
  //      so submit works unchanged and Fill Gaps shows the value pre-filled.
  //   2. A SUPERSEDING change-event carrying afterValue, cloned from the
  //      dialogue's initial classification (never re-classified) with
  //      supersedesId when the initial write returned its id. One event per
  //      logical save: the editor commits on its Save button (not keystrokes)
  //      and an unchanged re-save is skipped.
  const saveInlineCorrection = (item, value) => {
    const fieldId = item.field;
    updateGap("corrected_" + fieldId, value);
    setFormVersion(v => v + 1); // surface the saved state on the Confirm row
    const snap = dialogueStateRef.current[fieldId];
    if (!snap || !snap.emitted || !snap.event) return; // nothing to supersede yet
    if (snap.lastSavedValue === value) return;         // idempotent double-save guard
    // CD-03 EDD (commit 8) — re-run the SAME country check against the CORRECTED
    // value. The initial event was classified off the found value; a customer who
    // corrects "Registered Country" into a high-risk country has to raise the
    // flag, and the superseding event otherwise clones the original verbatim.
    const superseding = buildSupersedingEvent(snap, value, {
      eddFlag: fieldHasHighRiskCountry({ fieldId: item.field, label: item.label }, value),
    });
    if (!superseding) return;
    // Consume the head and clear the tail BEFORE the write lands: from here on
    // the only safe targets are the id this write returns, or null. Falling
    // back to an already-superseded row would throw in writeEvent, be swallowed
    // as a 200 by the route, and lose the event — taking the registry original
    // with it on any field where change_events is its only durable home.
    dialogueStateRef.current[fieldId] = {
      ...snap,
      lastSavedValue: value,
      headConsumed: true,
      tailEventId: null,
    };
    // Deliberate observability log (commit-3 verification): the payload must be
    // inspectable even where the POST can't persist (no DATABASE_URL).
    // eslint-disable-next-line no-console
    console.log("[confirm] superseding change-event:", superseding);
    if (typeof fetch === "function") {
      fetch("/api/change-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(superseding),
      })
        .then((r) => r.json())
        .then((d) => {
          // Chain the lineage: a later re-edit supersedes THIS event, not the
          // head. The id is an OPAQUE token (the Neon driver may return a
          // bigint as a string) — stored and passed back verbatim, never
          // compared numerically. A failed/no-id write leaves tailEventId null,
          // which is the safe un-linked path, not an error.
          const cur = dialogueStateRef.current[fieldId];
          if (cur) {
            dialogueStateRef.current[fieldId] = {
              ...cur,
              tailEventId: d && d.success && d.id != null ? d.id : null,
            };
          }
          if (d && d.success === false && d.warning) {
            // The route always answers 200, so a swallowed writeEvent throw is
            // only visible here. Surface it rather than losing it silently.
            console.warn("[confirm] superseding event rejected:", d.warning);
          }
        })
        .catch((err) => console.warn("[confirm] superseding event persist failed:", err));
    }
    trackEvent("change_event_superseded", superseding);
  };

  const card = { background: "rgba(255,255,255,0.95)", borderRadius: 14, border: "1px solid rgba(26,58,74,0.06)", boxShadow: "0 4px 20px rgba(26,58,74,0.05)", padding: "24px 28px", marginBottom: 16 };
  const Btn = ({ children, onClick, variant, disabled }) => {
    const base = { padding: "12px 26px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.4 : 1, border: "none" };
    const v = { primary: { ...base, background: "#1a3a4a", color: "#fff" }, secondary: { ...base, background: "transparent", color: "#1a3a4a", border: "2px solid #1a3a4a" }, green: { ...base, background: "#4a9e8e", color: "#fff" } };
    return <button style={v[variant] || v.primary} onClick={disabled ? undefined : onClick}>{children}</button>;
  };

  // Friendly title for an admin-defined section key (e.g. "registered_address"
  // → "Registered Address", "uboAnalysis" → "UBO Analysis"). Used as a
  // fallback for sections that aren't in the hardcoded sectionConfig.
  const humaniseSection = (s) => {
    if (!s) return "Other";
    return String(s)
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  };

  const sectionConfig = {
    corrections: { title: "Corrections Required", icon: "🔄", sub: "You unchecked these fields — please provide correct values", twoCol: true },
    missing_research: { title: "Missing Research Fields", icon: "❓", sub: "We could not find these from any source — fill in if you have the data (all optional).", twoCol: true },
    applicant: { title: "Applicant Details", icon: "👤", sub: "Person authorised to submit this application", twoCol: true },
    business: { title: "Business Details", icon: "🏢", sub: "Confirm and complete business information", twoCol: true },
    business_entity: { title: "Business Entity", icon: "🏢", sub: "Registered identity and core business details", twoCol: true },
    registered_address: { title: "Registered Address", icon: "📍", sub: "Address from the official registry", twoCol: true },
    business_address: { title: "Business Address", icon: "📍", sub: "Operating address (if different from registered)", twoCol: true },
    business_activity: { title: "Business Activity", icon: "📊", sub: "Activity, size and operating profile", twoCol: true },
    operations: { title: "Operations", icon: "⚙", sub: "Branches, services and products", twoCol: true },
    ownership: { title: "Ownership & Control", icon: "👥", sub: "Directors, UBOs and corporate structure", twoCol: true },
    regulatory: { title: "Regulatory Details", icon: "🏛", sub: "Licensing and regulatory status", twoCol: true },
    nature: { title: "Nature & Size of Business", icon: "🏢", sub: "Business activity and size details", twoCol: true },
    fi: { title: "FI Specific Questions", icon: "🏦", sub: "Licensing, services, and customer profile", twoCol: false },
    stakeholders: { title: "Stakeholders & Transaction Mix", icon: "👥", sub: "Directors, UBOs, signatories and payment-mix breakdown", twoCol: true },
    disclosures: { title: "Corporate Disclosures", icon: "📋", sub: "Past regulatory or legal events", twoCol: false },
    account: { title: "Expected Account Usage", icon: "💰", sub: "Transaction volumes, purpose, and source of funds", twoCol: false },
    usage: { title: "Account Usage & Volumes", icon: "💰", sub: "Expected transaction volumes and counterparties", twoCol: true },
    bank: { title: "Bank Account Details", icon: "🏦", sub: "Settlement account for transactions", twoCol: true },
    documents: { title: "Additional Documents", icon: "📄", sub: "Upload supporting documentation", twoCol: false },
  };

  // Discover the section keys to render on Fill Gaps. Two-tier order:
  //   1. Pinned sections from sectionConfig (so well-known sections like
  //      Corrections / Missing Research / Applicant / Business / ... keep
  //      their canonical order at the top).
  //   2. Any *additional* sections present in the gap data (e.g. custom
  //      admin-defined sections like "Registered Address" / "Business
  //      Address" / anything else) appended in the order they first appear
  //      in the schema definitions, then by gap-item order.
  // This replaces the previous hardcoded list, which silently dropped any
  // section it didn't recognise.
  const gapSectionOrder = () => {
    const pinned = ["corrections", "missing_research", "applicant", "business", "business_address", "nature", "fi", "stakeholders", "disclosures", "account", "usage", "bank", "documents"];
    const seen = new Set();
    const out = [];
    const pinnedSet = new Set(pinned);
    pinned.forEach((s) => out.push(s));
    pinned.forEach((s) => seen.add(s));
    // Walk the schema in definition order so admin-defined sections show
    // up in the order the admin laid them out.
    if (activeSchema) {
      const walk = (arr) => (arr || []).forEach((f) => {
        const s = f.section;
        if (!s || pinnedSet.has(s) || seen.has(s)) return;
        seen.add(s);
        out.push(s);
      });
      walk(activeSchema.researchFields);
      walk(activeSchema.gapFields);
    }
    // Catch any leftover sections present in the live gap list but not in
    // the schema (e.g. fields the AI returned with an unfamiliar section).
    getCombinedGaps().forEach((g) => {
      const s = g.section;
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    });
    return out;
  };

  // Build the "who is completing this application?" candidate list from the
  // research results: every active director plus every individual (non-corporate)
  // UBO, de-duplicated by name. Drives the applicant-section person selector.
  const getApplicantCandidates = () =>
    deriveApplicantCandidates(research, dossierStakeholders);

  // Clear the applicant gap fields a person-selection had pre-filled (used when
  // the customer switches to "I am not listed").
  const clearApplicantPrefill = () => {
    ["applicantFirstName", "applicantLastName", "applicantPosition", "applicantNationality", "applicantDateOfBirth"].forEach((f) => {
      gapRef.current[f] = "";
    });
  };

  // Pre-fill the applicant gap fields from a selected director/UBO and record
  // the agent-sourced values so submit-time provenance can detect overrides.
  const selectApplicantPerson = (person) => {
    if (!person) {
      setApplicantSelectedPerson(null);
      setApplicantAgentValues({});
      setApplicantOverrides([]);
      clearApplicantPrefill();
      setFormVersion((v) => v + 1);
      return;
    }
    setApplicantSelectedPerson(person);
    const av = {};
    if (person.name) {
      const parts = String(person.name).trim().split(/\s+/);
      av.applicantFirstName = parts[0] || "";
      av.applicantLastName = parts.slice(1).join(" ");
    }
    if (person.jobTitle) av.applicantPosition = person.jobTitle;
    if (person.nationality) av.applicantNationality = person.nationality;
    if (person.dob) av.applicantDateOfBirth = person.dob;
    setApplicantAgentValues(av);
    setApplicantOverrides([]);
    Object.entries(av).forEach(([fieldId, value]) => { gapRef.current[fieldId] = value; });
    setFormVersion((v) => v + 1);
  };

  const renderApplicantPersonSelector = () => {
    const candidates = getApplicantCandidates();
    if (candidates.length === 0) {
      // No individual directors/UBOs identified (e.g. registry returned only a
      // corporate parent, or name extraction failed). Show a note rather than
      // silently hiding the selector so the page doesn't look broken.
      return (
        <div style={{
          padding: "12px 16px",
          background: C.surfaceAlt,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          fontSize: 13,
          color: C.textSec,
          marginBottom: 20,
        }}>
          We were not able to identify individual directors or owners for this
          company from our research. Please fill in your details below.
        </div>
      );
    }
    return (
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "#1a3a4a80", display: "block", marginBottom: 6, fontWeight: 600 }}>
          Who is completing this application?
        </label>
        <select
          value={applicantSelectedPerson?.id || (applicantNotListed ? "none" : "")}
          onChange={(e) => {
            const id = e.target.value;
            // "none" is the explicit "I am not listed" declaration → record it so
            // the Authority-to-act gate (PR-044) shows. Any other change clears it.
            if (id === "none") { setApplicantNotListed(true); selectApplicantPerson(null); return; }
            setApplicantNotListed(false);
            if (!id) { selectApplicantPerson(null); return; }
            selectApplicantPerson(candidates.find((c) => c.id === id) || null);
          }}
          style={{ width: "100%", border: "1.5px solid rgba(26,58,74,0.14)", borderRadius: 8, padding: "10px 14px", fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#1a3a4a", cursor: "pointer" }}
        >
          <option value="">Select your name...</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}  —  {c.role}</option>
          ))}
          <option value="none">I am not listed — fill in manually</option>
        </select>
        <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "6px 2px 0" }}>
          Picking your name pre-fills the fields below from the official registry. Edit any field that's wrong.
        </p>
      </div>
    );
  };

  // The applicant gap fields (first/last name, email, mobile, job title, DOB,
  // nationality, PEP) rendered as a standalone block. Same StableInput rendering
  // the Fill Gaps applicant section used — extracted here now that Applicant is
  // its own step.
  const renderApplicantFields = () => {
    const schemaItems = getCombinedGaps()
      .filter((g) => g.section === "applicant")
      .filter(dependsOnSatisfied);
    // Fall back to the hardcoded applicant fields when the schema yields none
    // (activeSchema null / not yet resolved), so the page is never blank.
    const items = schemaItems.length > 0 ? schemaItems : APPLICANT_FALLBACK_FIELDS;
    if (items.length === 0) return null;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
        {items.map((g) => (
          <StableInput
            key={g.field}
            id={g.field}
            label={g.label}
            type={g.inputType}
            value={gapRef.current[g.field] || ""}
            onUpdate={updateGap}
            required={g.required}
            options={g.options}
            placeholder={g.placeholder || ("Enter " + g.label.toLowerCase())}
          />
        ))}
      </div>
    );
  };

  // Testing-only: auto-complete the applicant form with sample data. Mirrors
  // fillTestData (Fill Gaps) — pulls from TEST_DATA, keeps any value already
  // entered, and falls back to sensible values for schema fields not in
  // TEST_DATA. Gated by SHOW_TEST_TOOLS at the button, so prod never sees it.
  const fillApplicantTestData = () => {
    const schemaItems = getCombinedGaps()
      .filter((g) => g.section === "applicant")
      .filter(dependsOnSatisfied);
    const items = schemaItems.length > 0 ? schemaItems : APPLICANT_FALLBACK_FIELDS;
    items.forEach((g) => {
      const current = gapRef.current[g.field];
      if (current && String(current).trim().length > 0) return; // keep existing edits
      let val = TEST_DATA[g.field];
      if (val === undefined) {
        const it = String(g.inputType || "text").toLowerCase();
        if (it === "select" && Array.isArray(g.options) && g.options.length > 0) {
          const first = g.options[0];
          val = first && typeof first === "object" ? (first.value ?? first.label) : first;
        } else if (it === "date") {
          val = "1985-06-15";
        } else if (it === "email") {
          val = "jane.smith@example.com";
        } else {
          val = "Sample value";
        }
      }
      gapRef.current[g.field] = val;
    });
    // PR-044: also satisfy the Authority-to-act hard gate in test mode by
    // attaching a dummy file (harmless when the not-listed card isn't shown).
    if (!authorityToActFile) {
      const fname = "test-authority-to-act.pdf";
      let dummy;
      try { dummy = new File([new Blob(["test authority to act"])], fname, { type: "application/pdf" }); }
      catch { dummy = { name: fname, size: 21 }; }
      setAuthorityToActFile(dummy);
    }
    // PR-072: also satisfy the always-shown Signatory ID hard gate in test mode.
    if (!signatoryIdFile) {
      const fname = "test-signatory-id.pdf";
      let dummy;
      try { dummy = new File([new Blob(["test signatory id"])], fname, { type: "application/pdf" }); }
      catch { dummy = { name: fname, size: 18 }; }
      setSignatoryIdFile(dummy);
    }
    setFormVersion((v) => v + 1);
  };

  // Standalone Applicant page (step between Research and Confirm). Reuses the
  // director/UBO person selector + the applicant gap fields, with its own
  // header, required-field validation, and Continue → Confirm.
  const renderApplicantPage = () => {
    // The five foundational facts used to research the company. Reg-number
    // provenance (G2) is gated on the EXPLICIT `regNumberSource` flag, never on
    // `regNumber` truthiness — so a number restored from a loaded dossier (the
    // ?dossierId / ?ref link journeys, which leave the source null) is treated as
    // system-retrieved and stays verifiable, not locked as "you provided this".
    // A customer-typed number (source === "customer") is pre-confirmed and
    // display-only; otherwise the schema-correct registration-number research
    // field is the system-retrieved value the customer must verify; neither →
    // "Not provided" and non-disputable (nothing to confirm).
    //
    // PR-059 B: resolve the reg field id from the active schema's flow rather
    // than a hardcoded literal. Corporate schemas store it as
    // `businessRegistrationNumber`, fi schemas as `registration_number`; reading
    // the literal `registration_number` matched only the fi case and, for a
    // corporate entity, could surface a stray/contaminated row instead of the
    // real value Confirm shows. mapExtractedKey() is the single source of truth
    // for that mapping (same one the extraction pipeline uses).
    const regFlow =
      activeSchema?.flow === "fi" || entityType === "FI" || entityType === "Platform"
        ? "fi"
        : "corporate";
    const regFieldId = mapExtractedKey(regFlow, "registration_number") || "registration_number";
    const customerReg = regNumberSource === "customer" ? (regNumber || "").trim() : "";
    const systemReg = customerReg
      ? ""
      : ((research?.found || []).find((f) => f.field === regFieldId)?.value || "");
    const regProvenance = customerReg ? "customer" : systemReg ? "system" : "none";
    const regValue = customerReg || systemReg || "";

    const facts = [
      { key: "companyName", label: "Company legal name", value: research?.companyName || companyName || "—", disputable: true },
      {
        key: "registrationNumber",
        label: "Registration / company number",
        // After a genuine change is resolved, reflect the NEW number the customer
        // provided (stored regNumber left unchanged) + note that the change
        // document was added to Fill Gaps.
        value: regNumberChangeDeclared?.to
          ? regNumberChangeDeclared.to
          : (regValue || "Not provided"),
        disputable: regProvenance === "system",
        note: regNumberChangeDeclared?.to
          ? `Changed from "${regNumberChangeDeclared.from}" — additional documents are required and have been added to your Fill Gaps checklist.`
          : regProvenance === "customer"
            ? "✓ You provided this"
            : regProvenance === "system"
            ? "Found by research — please verify"
            : "Not provided on lookup",
      },
      { key: "country", label: "Registration country", value: countryObj?.name || countryCode || "—", disputable: true },
      { key: "entityType", label: "Entity type", value: entityType || "—", disputable: true },
      {
        key: "ownershipType",
        label: "Ownership type",
        // After a genuine ownership change is resolved, reflect the NEW type the
        // customer selected (the stored `ownershipType` is intentionally left
        // unchanged — reshaping the schema/questions off the new type is PR-049),
        // and note that the supporting documents were added to Fill Gaps.
        value: ownershipChangeDeclared?.to
          ? ownershipChangeDeclared.to
          : (ownershipTypeLabel(ownershipType) || ownershipType || "—"),
        disputable: true,
        note: ownershipChangeDeclared?.to
          ? `Changed from "${ownershipChangeDeclared.from}" — additional documents are required and have been added to your Fill Gaps checklist.`
          : undefined,
      },
    ];

    // All five confirmed (a disputed fact, or a pending ownership fork, hides the
    // applicant section below). A four-fact dispute resets; ownership forks.
    const fourDisputed = facts.some((f) => f.key !== "ownershipType" && f.key !== "registrationNumber" && f.disputable && factChecks[f.key] === false);
    const ownershipDisputed = factChecks.ownershipType === false;
    const regNumberDisputed = factChecks.registrationNumber === false;
    const factsConfirmed = !fourDisputed && !ownershipDisputed && !regNumberDisputed && ownershipFork === null && regNumberFork === null;

    // PR-044 — Authority-to-act, shown only when the applicant declares they are
    // NOT a listed director/officer. Content mirrors documentRequirements.js's
    // 'Authority to act' item (which is now removed from the Required Docs
    // checklist so it's asked exactly once, here). The card is the SAME reused
    // DocumentUploadCard from the Required Docs page. Only the regulatory citation
    // is jurisdiction-specific (UK MLR 2017 vs SG MAS PSN01); applies to both.
    // TODO(PR-044): SG Apostille/notarisation overlay is a later addition.
    const isUK = countryCode === "GB" || activeSchema?.region === "UK";
    // Unlisted = the applicant is NOT one of the company's listed directors/
    // officers. Two ways to be unlisted: (a) explicitly choosing "I am not listed"
    // in the dropdown, or (b) research found no director/UBO candidates at all, so
    // the dropdown isn't shown and the page falls straight to manual entry. Both
    // must prove authority to act (PR-044).
    const applicantUnlisted = applicantNotListed || getApplicantCandidates().length === 0;
    const authorityToActItem = {
      requirement: "Authority to act",
      standardDocument: "Board resolution / power of attorney / mandate",
      localEquivalent: "Board resolution / power of attorney / authorised mandate",
      why: "Confirm the relationship and product are authorised and the named signatories may bind the customer.",
      fallback: "Do not activate the relationship until authority and signatory identity are resolved.",
      mandatory: true,
      selfSource: "Client-provided only",
      regulatoryRationale: isUK ? "Money Laundering Regulations 2017" : "MAS Notice PSN01",
      regulatoryUrl: isUK
        ? "https://www.legislation.gov.uk/id/uksi/2017/692"
        : "https://www.mas.gov.sg/regulation/notices/psn01-aml-cft-notice---specified-payment-services",
    };
    // Hard gate: when unlisted, Continue is blocked until the file is uploaded.
    const authorityGateBlocks = applicantUnlisted && !authorityToActFile;

    // PR-072 — Signatory ID card, COPIED verbatim from the Required Docs section
    // (the DocumentUploadCard driven by the DRS "Signatory ID" checklist item)
    // onto the Applicant page. Shown for EVERY applicant (always), unlike
    // authority-to-act. App.js (src/) cannot import root documentRequirements.js
    // (CRA ModuleScopePlugin), so — exactly as authorityToActItem does — the item
    // is reconstructed inline with the SAME content the DRS produces: title +
    // Required pill, the accepted-documents guidance (buildIdLocalEquivalent incl.
    // residency + UK/JMLSG onboarding-country overlay), the "Verify each
    // signatory…" line, and the "Why this is required / can't provide it?"
    // expander. UK vs SG split mirrors the isUK toggle used above (LICENSED_MARKETS
    // GB → UK/JMLSG; everything else → Singapore/MAS default).
    const signatoryIdItem = {
      requirement: "Signatory ID",
      standardDocument: "Government-issued photo ID for each authorised signatory",
      localEquivalent: isUK
        ? "For each authorised signatory. Document types accepted may include: Passport; UK photocard driving licence; National identity card (where accepted). The exact document accepted may vary depending on residency status, onboarding channel, document verifiability, translation/transliteration quality, and local policy. For cross-border onboarding, passport is usually the clearest first ask. Onboarding-country overlay (United Kingdom): UK/JMLSG-style practice: passport is the safest first ask for cross-border onboarding; photocard driving licence works best for UK residents; national ID cards are more case-specific."
        : "For each authorised signatory. Document types accepted may include: NRIC (citizen / PR); FIN card (foreign resident); Passport. The exact document accepted may vary depending on residency status, onboarding channel, document verifiability, translation/transliteration quality, and local policy. Passport is the safer ask for non-residents or where local electronic verification is unavailable. Onboarding-country overlay (Singapore): MAS-style practice: use resident local photo ID where reliable, but ask for passport for non-residents, cross-border cases, or where local ID cannot be independently verified.",
      why: "Verify each signatory before the relationship is activated or the first permitted transaction occurs.",
      fallback: "Do not activate the relationship until authority and signatory identity are resolved.",
      mandatory: true,
      selfSource: "Client-provided only",
      regulatoryRationale: isUK ? "Money Laundering Regulations 2017" : "MAS Notice PSN01",
      regulatoryUrl: isUK
        ? "https://www.legislation.gov.uk/id/uksi/2017/692"
        : "https://www.mas.gov.sg/regulation/notices/psn01-aml-cft-notice---specified-payment-services",
    };
    // Hard gate: Signatory ID is always required — Continue is blocked until the
    // file is uploaded, for every applicant. Combined with the conditional
    // authority-to-act gate below.
    const signatoryGateBlocks = !signatoryIdFile;
    const continueBlocked = signatoryGateBlocks || authorityGateBlocks;

    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 40px" }}>
        <FoundationalFactsGate
          facts={facts}
          isConfirmed={isFactConfirmed}
          onToggle={toggleFact}
          ownershipFork={ownershipFork}
          ownershipChangeFrom={ownershipChangeDeclared?.from || ""}
          onReset={resetAll}
          onOwnershipChanged={declareOwnershipChanged}
          onCancel={cancelFactDispute}
          ownershipTypeOptions={OWNERSHIP_TYPE_LIBRARY.map((o) => ({ value: o.id, label: o.label }))}
          onOwnershipChangeResolved={resolveOwnershipChange}
          regNumberFork={regNumberFork}
          regNumberChangeFrom={regNumberChangeDeclared?.from || ""}
          onRegNumberChanged={() => declareRegNumberChanged(regValue)}
          onRegNumberChangeResolved={resolveRegNumberChange}
        />

        {factsConfirmed && (
          <>
            <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1a3a4a", margin: "0 0 8px 0" }}>
                  Tell us about yourself
                </h2>
                <p style={{ fontSize: 14, color: "#1a3a4a80", margin: 0, lineHeight: 1.6 }}>
                  As the person completing this application, we need a few details about you.
                  We have pre-filled what we already know.
                </p>
              </div>
              {SHOW_TEST_TOOLS && (
                <button
                  type="button"
                  onClick={fillApplicantTestData}
                  title="Testing only — fills the applicant form with sample data"
                  style={{
                    flexShrink: 0,
                    padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                    background: "transparent", color: "#4a9e8e",
                    border: "2px dashed #4a9e8e",
                  }}
                >
                  ✨ Fill with test data
                </button>
              )}
            </div>

            <div style={card}>
              {renderApplicantPersonSelector()}
              {renderApplicantFields()}
            </div>

            {/* PR-072 — Signatory ID proof, COPIED from Required Docs. Always
                shown (every applicant), directly below the applicant fields and
                ABOVE the conditional Authority-to-act card. Reuses the exact same
                Required Docs DocumentUploadCard. This is a COPY — the Signatory ID
                card ALSO still renders in Required Docs (Step2DynamicForm),
                unchanged. The upload slot here is INDEPENDENT of the Required Docs
                one (see signatoryIdFile comment; one-satisfies-both is a deferred
                future enhancement). */}
            <div style={{ ...card, marginTop: 16 }}>
              <p style={{ fontSize: 13, color: "#1a3a4a", margin: "0 0 12px", lineHeight: 1.6 }}>
                Please upload government-issued photo ID for each authorised
                signatory. This is required before we can continue.
              </p>
              <DocumentUploadCard
                item={signatoryIdItem}
                uploaded={signatoryIdFile}
                onUpload={(_req, file) => handleSignatoryIdUpload(file)}
                onRemove={() => setSignatoryIdFile(null)}
                autoSourcedResult={null}
              />
            </div>

            {/* PR-044 — Authority-to-act proof, directly below the applicant
                fields, shown whenever the applicant is unlisted: either "I am not
                listed" was selected, or no directors/UBOs were found (manual-entry
                fallback). Reuses the Required Docs DocumentUploadCard. */}
            {applicantUnlisted && (
              <div style={{ ...card, marginTop: 16 }}>
                <p style={{ fontSize: 13, color: "#1a3a4a", margin: "0 0 12px", lineHeight: 1.6 }}>
                  Because you are <strong>not one of the company's listed directors or officers</strong>,
                  please upload a document showing you are authorised to act for the company.
                </p>
                <DocumentUploadCard
                  item={authorityToActItem}
                  uploaded={authorityToActFile}
                  onUpload={(_req, file) => handleAuthorityToActUpload(file)}
                  onRemove={() => setAuthorityToActFile(null)}
                  autoSourcedResult={null}
                />
              </div>
            )}

            {/* PR: Continue + Start Over share one row (Start Over left, Continue
                right). Start Over is onboarding-only (!landedViaLink) — hidden on
                the dossier/invite journey; the empty <span/> keeps Continue
                right-aligned there. Start Over reuses resetAll (pre-filled lookup,
                not a blank wipe). Layout only — onClick/gating unchanged. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 24 }}>
              {!landedViaLink ? <Btn variant="secondary" onClick={resetAll}>Start Over</Btn> : <span />}
            <button
              disabled={continueBlocked}
              onClick={() => {
                // Hard gate (PR-072): Signatory ID is always required for every
                // applicant — check it before the conditional authority-to-act gate.
                if (!signatoryIdFile) {
                  setApplicantValidationError(
                    "Please upload the signatory ID document before continuing."
                  );
                  return;
                }
                // Hard gate: unlisted applicants must upload authority-to-act first.
                if (applicantUnlisted && !authorityToActFile) {
                  setApplicantValidationError(
                    "Please upload your authority-to-act document before continuing."
                  );
                  return;
                }
                const required = ["applicantFirstName", "applicantLastName", "applicantEmail"];
                const missing = required.filter((f) => !String(gapRef.current[f] || "").trim());
                if (missing.length > 0) {
                  setApplicantValidationError(
                    "Please fill in " + missing.length + " required field" +
                    (missing.length > 1 ? "s" : "") + " before continuing."
                  );
                  return;
                }
                setApplicantValidationError(null);
                scrollAndSetStep(STEPS.confirm);
              }}
              style={{
                padding: "12px 28px",
                background: continueBlocked ? "#9CA3AF" : (C.niumBlue || "#0B3D91"),
                color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700,
                fontFamily: "inherit", cursor: continueBlocked ? "not-allowed" : "pointer",
              }}
            >
              Continue →
            </button>
            </div>

            {/* PR-072 — Signatory ID gate reason. Shown first (always-required
                slot); the authority-to-act reason follows when that card blocks too. */}
            {signatoryGateBlocks && (
              <div style={{
                marginTop: 12, padding: "10px 14px", background: "#FFFBEB",
                border: "1px solid #FCD34D", borderRadius: 8, fontSize: 13, color: "#92400E",
              }}>
                Upload the signatory ID document above to continue.
              </div>
            )}

            {authorityGateBlocks && (
              <div style={{
                marginTop: 12, padding: "10px 14px", background: "#FFFBEB",
                border: "1px solid #FCD34D", borderRadius: 8, fontSize: 13, color: "#92400E",
              }}>
                Upload your authority-to-act document above to continue.
              </div>
            )}

            {applicantValidationError && (
              <div style={{
                marginTop: 12, padding: "10px 14px", background: "#FEF2F2",
                border: "1px solid #FCA5A5", borderRadius: 8, fontSize: 13, color: "#DC2626",
              }}>
                {applicantValidationError}
              </div>
            )}

          </>
        )}
      </div>
    );
  };

  const renderGapSection = (sectionKey) => {
    // "Additional Documents" (documents) section hidden on the Fill Gaps page
    // for all flows (FI / Corporate, AI-only / document+AI) per request. Kept
    // restorable: remove this guard to bring the section back.
    if (sectionKey === "documents") return null;
    const items = getCombinedGaps()
      .filter(g => g.section === sectionKey)
      .filter(dependsOnSatisfied);
    if (items.length === 0) return null;
    const cfg = sectionConfig[sectionKey] || { title: humaniseSection(sectionKey), icon: "📋", sub: "", twoCol: true };

    return (
      <div style={card} key={sectionKey}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{cfg.icon} {cfg.title}</h3>
        <p style={{ fontSize: 12, color: "#1a3a4a60", margin: "0 0 14px" }}>{cfg.sub}</p>
        <div style={cfg.twoCol ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" } : {}}>
          {items.map(g => <StableInput key={g.field} id={g.field} label={g.label} type={g.inputType} value={gapRef.current[g.field] || ""} onUpdate={updateGap} required={g.required} options={g.options} placeholder={g.placeholder || ("Enter " + g.label.toLowerCase())} />)}
        </div>
        {/* Part 8 — analyst custom questions (from pre-boarding) wired into the
            customer's Fill Gaps for this section, rendered as fillable fields. */}
        {customQuestions.filter(q => q.section === sectionKey).map(q => (
          <div key={q.id} style={{ marginBottom: 4 }}>
            <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "1px 6px", marginBottom: 4, textTransform: "uppercase" }}>Additional</span>
            <StableInput
              id={`custom_${q.id}`}
              label={q.question}
              required={q.required}
              type={q.fieldType === "yesno" ? "select" : q.fieldType}
              options={q.fieldType === "yesno" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : q.fieldType === "select" ? (q.options || []).map(o => ({ value: o, label: o })) : undefined}
              value={gapRef.current[`custom_${q.id}`] || ""}
              onUpdate={updateGap}
              placeholder={q.fieldType === "textarea" ? "Enter your response..." : `Enter ${String(q.question).toLowerCase()}`}
            />
          </div>
        ))}
      </div>
    );
  };

  const jurisdictionBadge = activeSchema ? (() => {
    // Region drives only the colour; the label comes from the resolved
    // licence so tenants with non-UK/SG licences show the real jurisdiction.
    const flag = activeSchema.jurisdiction === "GB" ? "🇬🇧 "
      : activeSchema.jurisdiction === "SG" ? "🇸🇬 "
      : "";
    const text = activeSchema.label ? `${flag}${activeSchema.label}` : (activeSchema.region === "UK" ? "🇬🇧 UK Licence" : "🇸🇬 SG Licence");
    const bg = activeSchema.region === "UK" ? "#1a3a4a" : "#4a9e8e";
    return (
      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: bg, color: "#fff", marginLeft: 8 }}>
        {text}
      </span>
    );
  })() : null;

  const entityBadge = entityType ? (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: "#e0a040", color: "#fff", marginLeft: 8 }}>
      {entityType}
    </span>
  ) : null;

  // Lookup the metadata entry for a given fieldId — used by the "When?"
  // click-to-reveal badge so timestamps come from fieldMetadata, the
  // single source of truth.
  const metaFor = (fieldId) => fieldMetadata.find(m => m.fieldId === fieldId);

  // Source-tier visual treatment per row.
  // document → dark navy badge with the document type label
  // tier1    → green pill with the source name
  // tier2    → amber pill with "From an unverified source — please confirm"
  //
  // Badges live in a fixed 180px cell on each confirm row; text WRAPS inside
  // the badge (whiteSpace: normal) rather than pushing the cell wider — a
  // nowrap badge with a long source string was collapsing the value column.
  const badgeBaseStyle = {
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: 6,
    maxWidth: 175,
    width: "100%",
    boxSizing: "border-box",
    whiteSpace: "normal",
    wordWrap: "break-word",
    overflowWrap: "break-word",
    lineHeight: 1.3,
    textAlign: "right",
    cursor: "pointer",
    display: "inline-block",
  };
  // Re-skin: provenance is supporting detail, not the headline — quiet
  // text-only badges (the row's state stripe carries the confidence signal).
  // Same glyph vocabulary per tier, same click-to-reveal-timestamp behaviour.
  const renderSourceBadge = (item, idx) => {
    const m = metaFor(item.field);
    const ts = (m && m.fetchedAt) || researchTimestamp || "";
    const tsShort = ts ? ts.slice(11, 19) : "";
    if (item.sourceTier === "document") {
      const label = item.source || "Uploaded document";
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? `🕒 ${ts}` : `From uploaded ${label}`}
          style={{ ...badgeBaseStyle, color: "#0B3D91", background: "transparent" }}
        >
          {revealedTs[idx] ? `🕒 ${tsShort}` : `📄 ${label}`}
        </span>
      );
    }
    if (item.sourceTier === "tier1") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Click to show fetch timestamp"}
          style={{ ...badgeBaseStyle, color: C.textMuted, background: "transparent" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `✓ ${item.source}`}
        </span>
      );
    }
    // tier3 (indicative) — third-party / unverified source.
    if (item.sourceTier === "tier3") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Low confidence — from unverified source"}
          style={{ ...badgeBaseStyle, color: "#C2410C", background: "transparent" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `⚠ ${item.source}`}
        </span>
      );
    }
    // tier2 (probable) — company-owned source.
    return (
      <span
        onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
        title={revealedTs[idx] ? "Click to hide timestamp" : "Probable — from company source, please confirm"}
        style={{ ...badgeBaseStyle, color: C.warning, background: "transparent" }}
      >
        {revealedTs[idx] ? `🕒 ${ts}` : `~ ${item.source}`}
      </span>
    );
  };

  // Prevent "[object Object]" rendering when an object/array sneaks into a
  // field value (e.g. structured UBO data) where a string is expected.
  const safeRenderValue = (value) => {
    if (value === null || value === undefined) {
      return "—";
    }
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  // Render one row of the Confirm table — extracted so the section-grouped
  // and ungrouped paths share the same DOM.
  //
  // Layout: flex row with FIXED-width label (180px) and source-badge (180px)
  // cells and a flex:1 value cell with minWidth:0. The previous grid used
  // fr-unit columns with whiteSpace:nowrap badges — a long source string
  // forced the source column to its content width and squeezed the value
  // column to near-zero, rendering values vertically.
  // PR-041: a stakeholder field whose value is an EMPTY array (e.g. a publicly
  // listed company that is exempt from recording persons with significant
  // control) must render human-readable text, not a raw "[]". The empty array
  // arrives either as the string "[]" or as an actual []. When the AI captured a
  // meaningful exemption note in `source`, surface that; otherwise fall back to a
  // generic message. Returns item.value unchanged for every other case, so the
  // normal render path (dropdown mapping, the [{ safety net, etc.) is untouched.
  const getDisplayValue = (item) => {
    const fieldId = item.field || item.fieldId || "";
    const val = item.value;
    if (isStakeholderField(fieldId)) {
      const isEmptyArrayString = typeof val === "string" && val.trim() === "[]";
      const isEmptyArray = Array.isArray(val) && val.length === 0;
      const hasNoStakeholders = !item.stakeholders || item.stakeholders.length === 0;
      if ((isEmptyArrayString || isEmptyArray) && hasNoStakeholders) {
        const sourceLabel = item.source || "";
        const hasUsefulSource = sourceLabel.length > 10 && !sourceLabel.startsWith("http");
        return hasUsefulSource
          ? sourceLabel
          : "No persons with significant control recorded";
      }
    }
    return val;
  };

  const renderFoundRow = ({ item, idx }) => {
    const fieldDef = findFieldDef(activeSchema, item.field);
    let displayValue =
      item.value !== null && typeof item.value === "object"
        ? safeRenderValue(item.value)
        : safeRenderValue(resolveDisplayValue(fieldDef, item.value));
    // Safety net: a stakeholder field that fell through to the plain-row table
    // (no parsed people) must never show a raw JSON-array blob like
    // '[{"full_name":...}]'. Show a neutral placeholder instead. The real fix
    // is upstream (enrichStakeholders re-attaches .stakeholders so these render
    // as cards); this guards any residual case.
    if (isStakeholderField(item.field) && /^\s*\[\s*\{/.test(String(item.value || ""))) {
      displayValue = "Director / owner information sourced — details to be confirmed";
    }
    // PR-041: empty stakeholder array → human-readable text instead of raw "[]".
    // getDisplayValue only returns a different (string) value in that exact case;
    // for every other field it returns item.value unchanged, so this is a no-op.
    const humanReadable = getDisplayValue(item);
    if (typeof humanReadable === "string" && humanReadable !== item.value) {
      displayValue = humanReadable;
    }
    const isUnmappedDropdown =
      fieldDef && fieldDef.inputType === "select" && item.unmappedDropdown;
    // Re-skin: row state drives the visual treatment, from EXISTING data only.
    // Confirmation lives in checks[idx]; confidence in verificationStatus
    // (sourceTier fallback covers rows stored before that field existed).
    // Amber tracks confidence, never "has a control"; a disputed row's info
    // tone wins over amber while its ChangeDialogue is open.
    const rowChecked = !!checks[idx];
    const correction = gapRef.current["corrected_" + item.field];
    // ONE predicate for the row's state, the tiles AND the submit gate — same
    // rowState() call, fed by the same rowContext() builder submitBlockers
    // uses, so the amber styling, the "Needs You" count and blocker kind (a)
    // are the same set by construction. Never re-derive it here.
    const state = rowState(item, rowContext(item, idx, {
      checks,
      affirmed: affirmedFields,
      corrections: gapRef.current,
    }));
    const isCorrected = state === ROW_STATE.CORRECTED;
    const isDisputed = !rowChecked && !isCorrected;
    // Amber = low confidence AND still unresolved. Ticking (affirming) or
    // correcting resolves it, which is what lets the Needs-you count fall.
    const needsAttention = state === ROW_STATE.NEEDS_YOU && rowChecked;
    const stripe = isCorrected || isDisputed ? C.info : needsAttention ? C.warning : C.border;
    const tint = isCorrected || isDisputed ? C.infoBg : needsAttention ? C.warningTint : "#fff";
    const labelColor = needsAttention ? C.warning : isCorrected || isDisputed ? C.info : C.textMuted;
    const btnBase = {
      width: 26, height: 26, borderRadius: 7, cursor: "pointer",
      fontSize: 12, fontWeight: 700, lineHeight: 1, padding: 0,
      fontFamily: "inherit",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    };
    // Right-rail status line — the prototype's second line under the source.
    const statusLine = isCorrected
      ? { text: "Customer corrected", color: C.info }
      : isDisputed
      ? { text: "Correction needed", color: C.info }
      : needsAttention
      ? { text: "Please confirm", color: C.warning }
      : null;
    return (
      <div key={item.field + idx} style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 16,
        width: "100%",
        padding: "12px 14px",
        boxSizing: "border-box",
        background: tint,
        borderLeft: `3px solid ${stripe}`,
        borderBottom: "1px solid rgba(26,58,74,0.04)",
        // Unchecking a field is NOT disabling it — keep the row fully legible.
      }}>
        {/* Main block — label ABOVE value (prototype layout), not side-by-side. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: labelColor, lineHeight: 1.3,
          }}>
            {item.label}
          </div>
          {displayValue.length > 150 ? (
            <div style={{
              fontSize: 12,
              color: C.text,
              lineHeight: 1.6,
              padding: "8px 10px",
              background: C.surfaceAlt,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              wordWrap: "break-word",
              overflowWrap: "break-word",
              whiteSpace: "pre-wrap",
              marginTop: 4,
            }}>
              {displayValue}
            </div>
          ) : (
            <div style={{
              fontSize: 14.5, fontWeight: 600, color: C.text, marginTop: 3,
              wordWrap: "break-word", overflowWrap: "break-word",
              whiteSpace: "normal", lineHeight: 1.45,
            }}>
              {/* Corrected: the customer's value leads, the registry value stays
                  beside it struck through — original + corrected coexist. */}
              {isCorrected ? (
                <>
                  <span>{String(correction)}</span>
                  <span style={{
                    marginLeft: 8, fontSize: 13, fontWeight: 500,
                    color: C.textMuted, textDecoration: "line-through",
                  }}>
                    {displayValue}
                  </span>
                </>
              ) : (
                displayValue
              )}
            </div>
          )}
          {item.originalAIValue && item.originalAIValue !== displayValue && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#1a3a4a90" }}>
              AI returned "{item.originalAIValue}" — mapped to dropdown option
            </div>
          )}
          {isUnmappedDropdown && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#8c5500" }}>
              Doesn't match any dropdown option — please correct on the next page
            </div>
          )}
          {item.sourceTier === "tier2" && (
            <Notice tier="tier2" style={{ marginTop: 6 }}>
              From a company source — please confirm this is correct.
            </Notice>
          )}
          {item.sourceTier === "tier3" && (
            <Notice tier="tier2" style={{ marginTop: 6 }}>
              From an unverified source — please verify this is correct.
            </Notice>
          )}
          {item.sharePercentageWarning && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6,
              padding: "6px 10px", background: "#FEF3C7", border: "1px solid #FCD34D",
              borderRadius: 6, fontSize: 11, color: "#92400E", lineHeight: 1.4,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
              <div>
                <div style={{ fontWeight: 600 }}>Ownership band — verify qualifier</div>
                <div style={{ marginTop: 2 }}>
                  {item.sharePercentageSuggested
                    ? `Registry likely states "${item.sharePercentageSuggested}" — confirm exact wording.`
                    : item.sharePercentageWarning}
                </div>
              </div>
            </div>
          )}
          {/* Capture-mode change dialogue — mounts beneath an unchecked field,
              captures intent/registry + records one append-only change_event.
              onResolved (commit 3) bumps formVersion so the row re-renders the
              moment classification completes and the inline editor can appear —
              the questions always come first, the value input second. */}
          {!checks[idx] && (
            <ChangeDialogue
              // `label` is here for the commit-8 country-field check: the schema
              // marks no field as country-typed, so detection reads the id AND
              // the label (e.g. field "country" / label "Address Country"). The
              // row's own label is used — the same string the customer sees.
              field={{ fieldId: item.field, label: item.label, value: item.value, source: item.source, sourceTier: item.sourceTier }}
              jurisdiction={countryCode || "GB"}
              submissionId={dossierId || onboardingSubmissionId}
              dossierId={dossierId}
              onEvent={(event) => trackEvent("change_event_captured", event)}
              onResolved={() => setFormVersion(v => v + 1)}
              persisted={dialogueStateRef.current[item.field]}
              onPersist={persistDialogueState}
            />
          )}
          {/* Inline correction editor (commit 3) — value capture ON Confirm.
              Gated on the dialogue having emitted (classification first), so a
              value can never be saved before the initial event exists. Writes
              through saveInlineCorrection: gapRef["corrected_<field>"] (same
              key Fill Gaps renders — the value shows pre-filled there) + the
              superseding change-event. Once saved, the value renders inline on
              the row above (with the original struck through) and this editor
              only re-opens on demand via "Edit again".  */}
          {!checks[idx] && (() => {
            const snap = dialogueStateRef.current[item.field];
            if (!snap || !snap.emitted) return null;
            if (isCorrected && !inlineEditOpen[item.field]) return null;
            // Reference-value exception: don't prefill a literal cross-reference
            // like "Same as registered office" — prompt for the real value.
            const isReferenceValue = typeof item.value === "string" && /\bsame as\b/i.test(item.value);
            const prefill = isReferenceValue || item.value == null || typeof item.value === "object"
              ? ""
              : String(item.value);
            return (
              <InlineCorrectionEditor
                key={"edit-" + item.field}
                fieldDef={fieldDef || {}}
                originalDisplay={displayValue}
                initialValue={isCorrected ? String(correction) : prefill}
                onSave={(v) => {
                  saveInlineCorrection(item, v);
                  setInlineEditOpen(p => ({ ...p, [item.field]: false }));
                }}
                onCancel={isCorrected ? () => setInlineEditOpen(p => ({ ...p, [item.field]: false })) : null}
              />
            );
          })()}
          {/* Inline document request (commit 4) — the upload lives WHERE the
              change happened. Same card, same store and same upload call as the
              Fill Gaps panel, so a file added in either place satisfies both.
              Matched by docType against the canonical list so two fields
              mapping to one document never ask for it twice. */}
          {!checks[idx] && (() => {
            const snap = dialogueStateRef.current[item.field];
            const live = snap && snap.event && snap.event.workflow === "doc_required" ? snap.event.docType : null;
            if (!live) return null;
            // Company-scoped row: match a company entry (no stakeholderId), so
            // it can never pick up a person's same-named document. Compared on
            // the merged name — confirmDocs carries the canonical docType. A
            // per-field document shares its title with the other fields that
            // triggered it, so it must match THIS row's field, not just the type.
            const liveType = canonicalDocType(live);
            const doc = confirmDocs.find((d) =>
              d.docType === liveType &&
              !d.stakeholderId &&
              (isPerFieldDocType(liveType) ? d.fieldId === item.field : true));
            if (!doc) return null;
            const k = docKey(doc);
            return (
              <AmendmentDocCard
                key={"doc-" + k}
                doc={doc}
                upload={amendmentUploads[k]}
                busy={uploadingDocKey === k}
                onUpload={handleAmendmentUpload}
                onRemove={handleAmendmentRemove}
                variant="inline"
                hint="Required before you can continue."
              />
            );
          })()}
          {/* Build-time analyst view (commit 5) — what the engine actually
              decided for this row, including the outcomes the customer never
              sees, and an explicit "no automated consequence" note where the
              engine produces nothing. Read-only: it displays the recorded
              decision, never re-classifies and never affects the gate.
              SHOW_TEST_TOOLS is passed as a prop so the silence-later
              guarantee is a testable contract, not a module-load accident. */}
          {(() => {
            const snap = dialogueStateRef.current[item.field];
            if (!snap || !snap.emitted || !snap.event) return null;
            return (
              <AnalystSignalStrip
                show={SHOW_TEST_TOOLS}
                fieldId={item.field}
                signal={buildAnalystSignal({
                  event: snap.event,
                  outcome: snap.outcome,
                  correctedValue: correction,
                })}
              />
            );
          })()}
        </div>
        {/* Right rail — provenance is supporting detail (quiet, two lines),
            then the affordances. Fixed width so a long source string can never
            squeeze the value column. */}
        <div style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}>
          <div style={{
            width: 150, minWidth: 150, maxWidth: 150,
            display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
          }}>
            {renderSourceBadge(item, idx)}
            {statusLine && (
              <span style={{ fontSize: 10, fontWeight: 600, color: statusLine.color, textAlign: "right" }}>
                {statusLine.text}
              </span>
            )}
          </div>
          {/* Already confirmed on the Applicant page's five-fact gate, so this
              row is read-only here — see GATE_CONFIRMED_FIELDS. The spacer
              keeps the source-badge column aligned with every other row. */}
          {isGateConfirmedField(item.field) ? (
            <div style={{ width: 56, flexShrink: 0 }} aria-hidden="true" />
          ) : (
          <div style={{ display: "flex", gap: 4, paddingTop: 1 }}>
            {/* Contextual control PAIR, per the prototype — never three buttons.
                The prototype only ever shows two row states; ours has four, so
                the rule is applied by meaning rather than copied by position:
                  needs-attention / disputed → ✓ ✕  ("is this right or wrong?")
                  confirmed / corrected      → ✓ ✎  (settled value; tweak it)
                No capability is lost either way, because ✎ and ✕ enter the SAME
                flow (toggleCheck → ChangeDialogue → classification → inline
                editor). A confirmed row is disputed via ✎; an attention row is
                edited via ✕. Whether a document is owed remains a property of
                the field-class + change (policyTable), never of which button
                was pressed.
                The tick keeps the original checks[idx]/toggleCheck semantics and
                ALSO records affirmation, which is what moves an untouched
                low-confidence row out of "needs you". */}
            <button
              type="button"
              onClick={() => { if (!rowChecked) toggleCheck(idx); affirmRow(item); }}
              aria-label={isCorrected || isDisputed ? `Restore the original value for ${item.label}` : `Confirm ${item.label}`}
              aria-pressed={rowChecked && !needsAttention}
              title={isCorrected || isDisputed ? "Undo — keep the original value" : "Correct — keep this value"}
              style={{
                ...btnBase,
                background: rowChecked && !needsAttention ? "#4a9e8e" : "#fff",
                color: rowChecked && !needsAttention ? "#fff" : C.textMuted,
                border: rowChecked && !needsAttention ? "1.5px solid #4a9e8e" : `1.5px solid ${C.border}`,
              }}
            >✓</button>
            {needsAttention || isDisputed ? (
              <button
                type="button"
                onClick={() => { if (rowChecked) toggleCheck(idx); }}
                aria-label={`Mark ${item.label} as incorrect`}
                aria-pressed={isDisputed}
                title="Wrong — flag this value for correction"
                style={{
                  ...btnBase,
                  background: isDisputed ? C.error : "#fff",
                  color: isDisputed ? "#fff" : C.textMuted,
                  border: isDisputed ? `1.5px solid ${C.error}` : `1.5px solid ${C.border}`,
                }}
              >✕</button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isCorrected) setInlineEditOpen(p => ({ ...p, [item.field]: true }));
                  else if (rowChecked) toggleCheck(idx);
                }}
                aria-label={`Edit ${item.label}`}
                title={isCorrected ? "Edit again" : "Edit this value"}
                style={{
                  ...btnBase,
                  background: "#fff",
                  color: isCorrected ? C.info : C.textMuted,
                  border: `1.5px solid ${isCorrected ? C.infoBorder : C.border}`,
                }}
              >✎</button>
            )}
          </div>
          )}
        </div>
      </div>
    );
  };

  // Group rows by their schema-defined section so related fields (e.g.
  // Registered Address fields) appear together with a heading. Within each
  // section, rows preserve the caller's sort (typically: documents → tier1
  // → tier2, then schema field order). Returns an array of [section, rows]
  // pairs in the same order the sections appear in the schema, so the page
  // reads like the admin's schema layout.
  const groupFoundBySection = (items) => {
    const groups = new Map();
    items.forEach(({ item, idx }) => {
      const def = findFieldDef(activeSchema, item.field);
      const section = def?.section || item.section || "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push({ item, idx });
    });
    // Order sections by their first appearance in the schema.
    const sectionOrder = new Map();
    let pos = 0;
    if (activeSchema) {
      [...(activeSchema.researchFields || []), ...(activeSchema.gapFields || [])].forEach((f) => {
        const s = f.section;
        if (s && !sectionOrder.has(s)) sectionOrder.set(s, pos++);
      });
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const oa = sectionOrder.has(a) ? sectionOrder.get(a) : 9999;
      const ob = sectionOrder.has(b) ? sectionOrder.get(b) : 9999;
      return oa - ob;
    });
  };

  // One unified table grouped by source tier, sorted within group by
  // schema research-field order — then wrapped into per-section blocks so
  // the customer sees a clear heading for each logical group (e.g.
  // Registered Address vs Business Address rather than interleaved rows).
  const renderUnifiedFoundTable = (items, title, subtitle) => {
    const groups = groupFoundBySection(items);
    return (
      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
        <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>{subtitle}</p>
        {groups.map(([section, rows], gi) => (
          <div key={section} style={{ marginBottom: gi < groups.length - 1 ? 14 : 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "#1a3a4a80",
              marginBottom: 6,
            }}>
              {humaniseSection(section)}
            </div>
            {/* Fidelity pass: the prototype has no table header — each row is a
                self-describing card (tiny uppercase label above its value, with
                the provenance and affordances on the right), so the column
                header bar is gone rather than restyled. */}
            {rows.map((r) => renderFoundRow(r))}
          </div>
        ))}
      </div>
    );
  };

  // Stakeholder fields (directors / UBOs / shareholders / signatories) with
  // structured per-person data render as a card-per-person block instead of
  // a single grid row. Rendered as its own section above the unified table
  // so the row layout for everything else stays untouched. Items without a
  // populated stakeholders array fall through to the normal row renderer
  // for backward compatibility with legacy stored values.
  // Granular data points shown per stakeholder on Confirm. Each found point
  // gets a green tick (untick → routes to next page for edit); each missing
  // required point shows a "next page" tag. Mirrors the per-row green-tick
  // design used for regular confirm rows.
  const stkConfirmFields = (s, ubo) => {
    if (s && s.is_company) {
      // Corporate stakeholder field set.
      return [
        { key: "full_name", label: "Business name", required: true },
        { key: "business_type", label: "Business type", required: true },
        { key: "business_registration_number", label: "Registration number", required: true },
        { key: "registered_country", label: "Registered country", required: true },
        { key: "share_percentage", label: "Shareholding", required: false },
        { key: "positions", label: "Position(s)", required: false },
      ];
    }
    return [
      { key: "full_name", label: "Full legal name", required: true },
      { key: "role", label: "Role / position", required: false },
      ...(ubo ? [{ key: "share_percentage", label: "Shareholding", required: false }] : []),
      { key: "nationality", label: "Nationality", required: true },
      { key: "date_of_birth", label: "Date of birth", required: true },
      { key: "residential_country", label: "Country of residence", required: false },
      { key: "is_pep", label: "PEP status", required: true },
    ];
  };
  const stkFieldFound = (s, key) => {
    if (key === "is_pep") return s.is_pep === true || s.is_pep === false;
    if (key === "share_percentage") return s.share_percentage != null && String(s.share_percentage).trim() !== "";
    if (key === "positions") return Array.isArray(s.positions) && s.positions.some((p) => p && p.title);
    return s[key] != null && String(s[key]).trim() !== "";
  };
  const stkFieldDisplay = (s, key) => {
    if (key === "date_of_birth") return formatDOBForDisplay(s.date_of_birth) || s.date_of_birth || "";
    if (key === "share_percentage") return formatShareholding(s.share_percentage);
    if (key === "is_pep") return s.is_pep === true ? "Yes" : s.is_pep === false ? "No" : "";
    if (key === "positions") {
      return (s.positions || [])
        .filter((p) => p && p.title)
        .map((p) => (p.start_date ? `${p.title} (since ${p.start_date})` : p.title))
        .join(", ");
    }
    return s[key] != null ? String(s[key]) : "";
  };
  /**
   * ONE found-attribute row for a person card, shared by the EDD and the
   * listed-company branches so the two can never drift apart.
   *
   * A low-confidence attribute renders UNTICKED until the customer ticks it,
   * which is what "affirm" means here — the pre-filled rows behave the same
   * way, and an attribute arriving pre-ticked from an unverified source is not
   * agreement. First click affirms; a second click unticks to correct it on
   * the next page, the existing behaviour.
   */
  const renderPersonAttributeRow = (item, s, f, lowConf) => {
    const amberTag = {
      fontSize: 10, fontWeight: 700, color: "#8c5500",
      background: "#fff8ed", border: "1px solid #e0a040",
      borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
    };
    const ticked = isStkFieldConfirmed(s.id, f.key);
    const settled = isPersonAttributeSettled(s, f, lowConf);
    const needsAffirm = ticked && !settled;
    return (
      <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={settled}
          onChange={() => {
            if (needsAffirm) affirmPersonField(s.id, f.key);
            else togglePersonField(item, s, f);
          }}
          style={{ width: 14, height: 14, accentColor: "#4a9e8e", flexShrink: 0, cursor: "pointer" }}
          aria-label={needsAffirm ? `Confirm ${f.label} — from an unverified source` : `Confirm ${f.label}`}
        />
        <span style={{ color: "#1a3a4a80", width: 130, flexShrink: 0 }}>{f.label}</span>
        <span style={{ fontWeight: 600, color: "#1a3a4a", flex: 1, minWidth: 0 }}>{stkFieldDisplay(s, f.key)}</span>
        {needsAffirm && <span style={amberTag}>❓ please confirm</span>}
        {!ticked && <span style={amberTag}>✎ edit on next page</span>}
      </label>
    );
  };

  // Field labels that will land on the next page for this person/company: any
  // found field the customer unticked, plus any missing required field.
  const stkNextPageFields = (s, ubo) =>
    stkConfirmFields(s, ubo)
      .filter((f) => {
        const found = stkFieldFound(s, f.key);
        if (found) return !isStkFieldConfirmed(s.id, f.key);
        return f.required;
      })
      .map((f) => f.label);

  // AI-returned fields the customer unticked on a person card to correct them
  // (field-level correction). Strictly value-present fields — never the missing
  // ones — so a listed-company person can only correct what was surfaced, not
  // trigger new collection. Used to route a listed person's corrected values to
  // an editable card on Fill Gaps (mirrors the private side's per-field edit).
  const stkCorrectedFields = (s, ubo) =>
    stkConfirmFields(s, ubo).filter(
      (f) => stkFieldFound(s, f.key) && !isStkFieldConfirmed(s.id, f.key)
    );
  const stkHasCorrections = (s, ubo) => stkCorrectedFields(s, ubo).length > 0;

  // Render a customer-added (pending) stakeholder card on Confirm. Commit 7:
  // a person added HERE arrives with their details and their CD-03 documents
  // already requested, so the card names them and carries their evidence —
  // rather than the old placeholder that only said "complete them next page".
  const renderPendingAddedStakeholder = (fieldId, s, ubo) => {
    const addedHere = !!(s.full_name && String(s.full_name).trim());
    const type = resolvePersonType(s, fieldId);
    return (
      <div
        key={s.id}
        style={{
          background: "#f3faf8", border: "1.5px dashed #4a9e8e",
          borderRadius: 8, marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{isCorporateStakeholder(s) ? "🏢" : "➕"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a6b56" }}>
              {addedHere
                ? `${s.full_name} — added by you`
                : `New ${isCorporateStakeholder(s) ? "company" : ubo ? "beneficial owner" : "director"} added`}
            </div>
            <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.85, marginTop: 2 }}>
              {addedHere
                ? `${type.isUBO ? (type.isDirector ? "Director and beneficial owner" : "Beneficial owner") : "Director"}${s.nationality ? ` · ${s.nationality}` : ""}${s.is_pep ? " · PEP" : ""}`
                : "You'll complete their details on the next page."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeStakeholder(fieldId, s.id)}
            title="Remove"
            aria-label="Remove"
            style={{
              background: "none", border: "none", color: "#1a3a4a70",
              cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px", fontFamily: "inherit",
            }}
          >
            ×
          </button>
        </div>
        {/* The added person's own evidence, per-person keyed like everyone else. */}
        {renderPersonDocuments(s)}
      </div>
    );
  };

  /**
   * The documents + analyst view for ONE person, resolved per person-attribute.
   * Shared by the found-person cards and the added-person card so an added
   * person's evidence surfaces exactly like everyone else's.
   */
  const renderPersonDocuments = (s) => {
    const mine = Object.entries(dialogueStateRef.current)
      .filter(([k, snap]) => snap && snap.personScope && k.includes(`::${s.id}::`));
    if (mine.length === 0) return null;
    return (
      <div style={{ padding: "0 16px 12px" }}>
        {mine.map(([k, snap]) => {
          const ev = snap.event || {};
          // A company-wide document is the SAME single file for everyone, so it
          // renders on its anchor person only. Identity evidence stays strictly
          // per person: matched on stakeholderId, never on a company entry.
          const evDocType = canonicalDocType(ev.docType);
          const companyWide = isCompanyWideDocType(evDocType);
          const isAnchor = !companyWide || companyDocAnchor.get(evDocType) === s.id;
          const doc = ev.workflow === "doc_required" && evDocType && isAnchor
            ? confirmDocs.find((d) =>
                d.docType === evDocType &&
                (companyWide ? !d.stakeholderId : d.stakeholderId === s.id))
            : null;
          return (
            <div key={k}>
              {doc && (
                <AmendmentDocCard
                  doc={doc}
                  upload={amendmentUploads[docKey(doc)]}
                  busy={uploadingDocKey === docKey(doc)}
                  onUpload={handleAmendmentUpload}
                  onRemove={handleAmendmentRemove}
                  variant="inline"
                  hint={companyWide
                    ? `One ${evDocType.toLowerCase()} covers the whole company — upload it once.`
                    : `Required for ${s.full_name}.`}
                />
              )}
              {/* Same document, already requested against another person — say
                  so rather than silently showing nothing here. */}
              {companyWide && !isAnchor && ev.workflow === "doc_required" && (
                <div style={{ fontSize: 11.5, color: C.textMuted, fontStyle: "italic", padding: "6px 0" }}>
                  Covered by the single {evDocType.toLowerCase()} requested for this company — you only upload it once.
                </div>
              )}
              <AnalystSignalStrip
                show={SHOW_TEST_TOOLS}
                fieldId={k}
                signal={buildAnalystSignal({ event: snap.event, outcome: snap.outcome })}
              />
            </div>
          );
        })}
      </div>
    );
  };

  /** The "add a person the research missed" affordance for the People section. */
  const renderAddPerson = () => (
    <div style={{ marginTop: 12 }}>
      {addingPerson ? (
        <AddPersonPanel onAdd={addPersonFromConfirm} onCancel={() => setAddingPerson(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAddingPerson(true)}
          style={{
            width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "11px 18px", background: "transparent", color: "#1a6b56",
            border: "1.5px dashed #4a9e8e", borderRadius: 8,
            fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
          }}
        >
          + Add a director or beneficial owner we missed
        </button>
      )}
    </div>
  );

  const renderStakeholderConfirmSection = (item, idx) => {
    if (!item || !Array.isArray(item.stakeholders) || item.stakeholders.length === 0) {
      return null;
    }
    // Exclude registry exemption notices — they are not people. If nothing real
    // remains, render nothing here so the field falls through to the normal
    // confirm row showing the raw registry value.
    const realStakeholders = item.stakeholders.filter((s) => !isRegistryExemptionNotice(s));
    if (realStakeholders.length === 0) return null;
    const ubo = isUboLikeField(item.field);
    const fieldDef = findFieldDef(activeSchema, item.field);
    const heading = fieldDef?.label
      || (ubo ? "Ultimate Beneficial Owners / Shareholders" : "Directors / Officers");
    const count = realStakeholders.length;
    const tier = item.sourceTier;
    const sourceBadge = tier === "tier1"
      ? { bg: "#dff2ec", color: "#1a6b56", glyph: "✅" }
      : tier === "document"
      ? { bg: "#0B3D91", color: "#fff", glyph: "📄" }
      : tier === "tier3"
      ? { bg: "#FFF7ED", color: "#C2410C", glyph: "⚠" }
      : { bg: "#fff1d6", color: "#8c5500", glyph: "~" };
    const allExpanded = realStakeholders.every((s) => isStakeholderExpanded(s.id));
    return (
      <div key={`stk-${item.field}-${idx}`} style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "#1a3a4a80",
          marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid rgba(26,58,74,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
        }}>
          <span>{heading} · {count} found</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStakeholdersExpanded(realStakeholders.map((s) => s.id), !allExpanded)}
              style={{
                background: "none", border: "none", fontSize: 11, color: "#1a3a4a",
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0,
                letterSpacing: "0.04em", textTransform: "uppercase",
              }}
            >
              {allExpanded ? "Collapse all ▴" : "Expand all ▾"}
            </button>
            <span style={{
              fontSize: 10, fontWeight: 700, color: sourceBadge.color,
              background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
            }}>
              {sourceBadge.glyph} {item.source || (tier === "tier1" ? "Official source" : "Source")}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 4px", lineHeight: 1.5 }}>
          Found {count} {count === 1 ? "person" : "people"} from {item.source || "research"}. Expand each
          person to review the details we found — keep the green tick on anything correct, or untick a
          field to edit it on the next page. Anything we couldn't find is collected on the next page too.
        </p>
        <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px", fontStyle: "italic" }}>
          Editing who is on this list is coming soon — for now, untick anyone who doesn't belong.
        </p>
        {realStakeholders.map((s) => {
          const rejected = isStakeholderRejected(item.field, s.id);
          const expanded = isStakeholderExpanded(s.id);
          // Listed-company shortcut: people who don't need EDD stay a simple
          // verified card (no granular routing ticks).
          const needsEDD = needsStakeholderDetails(s, item.field, effectivelyListed);
          // Fields routed to the next page: for an EDD person that's
          // stkNextPageFields (unticked + missing-required); for a listed
          // read-only person it's purely the AI-returned values they unticked
          // to correct (we never collect missing fields for them).
          const nextPageFields = rejected
            ? []
            : needsEDD
            ? stkNextPageFields(s, ubo)
            : stkCorrectedFields(s, ubo).map((f) => f.label);
          // What actually needs the customer HERE: a value research returned
          // that they haven't settled. A pure gap is NOT "needs you" — there
          // is no control on this card to supply it, the row already says
          // "added on next page", and Fill Gaps is where it is collected.
          // Counting it here was telling the customer to act with no way to.
          // Reads the SAME predicate as the row and the tiles.
          const personLowConf = isPersonLowConfidence(s, item);
          const attentionFields = rejected
            ? []
            : stkConfirmFields(s, ubo)
                .filter((f) => stkFieldFound(s, f.key) && !isPersonAttributeSettled(s, f, personLowConf))
                .map((f) => f.label);
          return (
            <div
              key={s.id}
              style={{
                background: rejected ? "#fef2f2" : "#fafcfb",
                border: `1.5px solid ${rejected ? "#fecaca" : "rgba(26,58,74,0.08)"}`,
                borderRadius: 8, marginBottom: 8, overflow: "hidden",
                transition: "border-color .15s",
              }}
            >
              {/* Header row — click anywhere to expand/collapse */}
              <div
                onClick={() => toggleStakeholderExpanded(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px", cursor: "pointer", userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={!rejected}
                  onChange={() => togglePersonRemoval(item, s)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 15, height: 15, flexShrink: 0, accentColor: "#4a9e8e", cursor: "pointer" }}
                  aria-label={`Confirm ${s.full_name}`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {/* Re-skin: initials avatar in place of the person emoji
                        (companies keep the building glyph). */}
                    <span style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: rejected ? "#fde8e8" : C.successBg,
                      color: rejected ? C.error : C.success,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, letterSpacing: "0.02em",
                    }}>
                      {isCorporateStakeholder(s)
                        ? "🏢"
                        : ((s.full_name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?")}
                    </span>
                    <span style={{
                      fontSize: 14, fontWeight: 700,
                      color: rejected ? "#1a3a4a70" : "#1a3a4a",
                      textDecoration: rejected ? "line-through" : "none",
                    }}>
                      {s.full_name}
                    </span>
                    {s.role && (
                      <span style={{
                        fontSize: 11, color: "#1a3a4a80", background: "#f2f1ed",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(26,58,74,0.08)",
                      }}>
                        {s.role}
                      </span>
                    )}
                    {s.share_percentage != null && (
                      <span style={{
                        fontSize: 11, color: "#1a6b56", background: "#dff2ec",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(74,158,142,0.3)",
                      }}>
                        {formatShareholding(s.share_percentage)}
                      </span>
                    )}
                  </div>
                  {!expanded && (
                    <div style={{ fontSize: 11, color: "#1a3a4a70", marginTop: 3 }}>
                      {rejected
                        ? "⚠ Marked as incorrect — tap to review"
                        : "Tap to expand and review the details we found"}
                    </div>
                  )}
                </div>
                {/* Per-card status badge — shown ONLY when this person needs
                    something from the customer here, i.e. a found value not yet
                    confirmed. Driven by attentionFields, NOT by everything
                    routed to the next page: a gap has no control on this card,
                    so an amber "needs you" on it was a prompt with no action
                    behind it, and a green "✓ Complete" claimed the person was
                    finished while their own row still said "added on next
                    page". Nothing to say here is said with no badge; the gaps
                    speak for themselves per-row. */}
                {!rejected && attentionFields.length > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: C.warning, background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`, borderRadius: 99,
                    padding: "2px 8px", flexShrink: 0, whiteSpace: "nowrap",
                  }}>
                    {attentionFields.length} need{attentionFields.length === 1 ? "s" : ""} you
                  </span>
                )}
                {rejected && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2",
                    border: "1px solid #fecaca", borderRadius: 99,
                    padding: "2px 8px", flexShrink: 0,
                  }}>
                    ✗ Incorrect
                  </span>
                )}
                <span style={{
                  fontSize: 14, color: "#1a3a4a70", flexShrink: 0,
                  transition: "transform 0.2s", display: "inline-block",
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                }}>
                  ▾
                </span>
              </div>

              {/* ── CD-03 person correction surface (commit 6) ──────────────
                  Removal asks why first; the answer picks the list document
                  (director → list of directors, UBO → ownership chart), and
                  that document request IS the analyst trigger. Attribute
                  corrections run the name three-way or the inline editor, then
                  emit ONE person-scoped change-event under the composite
                  fieldId. Any resulting document renders on the person, and
                  because the snapshot lives in the same dialogue store as the
                  company rows it also lands in the documents panel and the
                  submit gate automatically. */}
              {personRemoving && personRemoving.stakeholderId === s.id && (
                <div style={{ padding: "0 16px 12px" }}>
                  <PersonRemovalPrompt
                    personName={s.full_name}
                    onConfirm={(reason) => confirmPersonRemoval(s, item.field, reason)}
                    onCancel={() => setPersonRemoving(null)}
                  />
                </div>
              )}
              {personEditing && personEditing.stakeholderId === s.id && (
                <div style={{ padding: "0 16px 12px" }}>
                  <PersonCorrection
                    attribute={personEditing.attribute}
                    personName={s.full_name}
                    originalValue={s[personEditing.fieldKey] ?? ""}
                    inputType={personEditing.fieldKey === "date_of_birth" ? "date" : "text"}
                    onResolve={(res) => resolvePersonCorrection(s, item.field, personEditing.fieldKey, res)}
                    onCancel={() => setPersonEditing(null)}
                  />
                </div>
              )}
              {/* Documents + analyst view for every recorded correction on THIS
                  person. Matches per person, never another person's entry of
                  the same type (the 6a under-collection fix). */}
              {renderPersonDocuments(s)}

              {/* Validation flag — director/UBO failed a check: stripped share
                  band, non-official source, or cross-source attribute merge.
                  Always visible (independent of expand state). The share-band
                  case is prioritised and shown with its suggested registry band. */}
              {s.requiresReview && (
                <div style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#FEF3C7",
                  border: "1px solid #FCD34D",
                  borderRadius: 6,
                  margin: "0 12px 10px",
                  fontSize: 12,
                  color: "#92400E",
                  fontWeight: 500,
                }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
                  {s.sharePercentageWarning ? (
                    <div>
                      <div style={{ fontWeight: 600 }}>Ownership band — verify qualifier</div>
                      <div style={{ marginTop: 2, fontWeight: 500 }}>
                        {s.sharePercentageSuggested
                          ? `Registry likely states "${s.sharePercentageSuggested}" — confirm exact wording.`
                          : s.sharePercentageWarning}
                      </div>
                    </div>
                  ) : (
                    <span>
                      {s.notes?.includes("cross-source")
                        ? "Details stripped — attributes from multiple sources detected. Verify details manually."
                        : "Source not confirmed as official registry. Verify this director manually before proceeding."}
                    </span>
                  )}
                </div>
              )}

              {/* Expandable body */}
              {expanded && (
                <div style={{
                  padding: "12px 16px 14px",
                  borderTop: "1px solid rgba(26,58,74,0.08)",
                }}>
                  {/* Source badge — SAME click-to-reveal-timestamp interaction as
                      the pre-filled rows (renderSourceBadge). This used to be a
                      badge plus a separate "🕐 When?" chip whose timestamp only
                      appeared in a native title tooltip: two different
                      behaviours for the same information on one page, and the
                      chip looked clickable while doing nothing. Now the badge
                      itself toggles, keyed per person so it can never toggle a
                      row's badge. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    {(() => {
                      const stkMeta = metaFor(item.field);
                      const ts = s.fetchedAt || item.fetchedAt || (stkMeta && stkMeta.fetchedAt) || researchTimestamp || "";
                      const tsKey = `stk:${s.id}`;
                      const revealed = !!revealedTs[tsKey];
                      return (
                        <span
                          onClick={ts ? () => setRevealedTs(p => ({ ...p, [tsKey]: !p[tsKey] })) : undefined}
                          title={!ts ? undefined : revealed ? "Click to hide timestamp" : "Click to show fetch timestamp"}
                          style={{
                            fontSize: 10, fontWeight: 700, color: sourceBadge.color,
                            background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
                            cursor: ts ? "pointer" : "default",
                          }}
                        >
                          {revealed
                            ? `🕒 ${ts}`
                            : `${sourceBadge.glyph} ${item.source || (tier === "tier1" ? "Official source" : "Source")}`}
                        </span>
                      );
                    })()}
                  </div>

                  {rejected ? (
                    <div style={{ fontSize: 12, color: "#1a3a4a70", fontStyle: "italic" }}>
                      This person is marked incorrect — you'll enter the correct details on the next page.
                    </div>
                  ) : !needsEDD ? (
                    // Listed-company person: the AI-returned values render
                    // read-only but each is individually unticked-able to
                    // CORRECT a value the AI got wrong — same mechanism as the
                    // private card (isStkFieldConfirmed / toggleStkFieldConfirm
                    // + "edit on next page"). This is correction of surfaced
                    // data only: fields the AI did NOT return stay hidden, so we
                    // never newly collect the full natural-person dataset for a
                    // listed company (CD-12 / PR-057 still open). Person removal
                    // remains the header checkbox above.
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {stkConfirmFields(s, ubo)
                          .filter((f) => stkFieldFound(s, f.key))
                          .map((f) => renderPersonAttributeRow(item, s, f, isPersonLowConfidence(s, item)))}
                      </div>
                      <Notice tier="tier1" style={{ marginTop: 10 }}>
                        Verified from official sources — no additional details required for a listed company.
                        Untick a field to correct a value we got wrong, or untick this person above if they
                        don't belong; you'll make the change on the next page.
                      </Notice>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {stkConfirmFields(s, ubo).map((f) => {
                          // A gap is not a warning. Nothing is wrong with a value
                          // research simply didn't return, and there is no control
                          // here to act on it — it is collected on the next page.
                          // Same calm green as the tick and the shareholding pill.
                          const deferredTag = {
                            fontSize: 10, fontWeight: 700, color: "#1a6b56",
                            background: "#dff2ec", border: "1px solid rgba(74,158,142,0.3)",
                            borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
                          };
                          if (stkFieldFound(s, f.key)) {
                            return renderPersonAttributeRow(item, s, f, isPersonLowConfidence(s, item));
                          }
                          if (!f.required) return null;
                          return (
                            <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <span style={{ width: 14, textAlign: "center", color: "#4a9e8e", flexShrink: 0 }}>＋</span>
                              <span style={{ color: "#1a3a4a80", width: 130, flexShrink: 0 }}>{f.label}</span>
                              <span style={{ color: "#1a3a4a70", flex: 1, fontStyle: "italic" }}>Not found</span>
                              <span style={deferredTag}>added on next page</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: "#1a3a4a70", marginTop: 10, fontStyle: "italic" }}>
                        {nextPageFields.length > 0
                          ? `On the next page you'll complete: ${nextPageFields.join(", ")}.`
                          : "All details confirmed — nothing further needed on the next page."}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Customer-added people (pending) — created here, completed next page */}
        {getStakeholders(item.field)
          .filter((s) => s.customer_added && !isRegistryExemptionNotice(s))
          .map((s) => renderPendingAddedStakeholder(item.field, s, ubo))}

      </div>
    );
  };

  // ── Per-person stakeholder forms on Fill Gaps ────────────────────────
  // Each accepted/rejected/customer-added person renders as an accordion
  // card with name, role, nationality, DOB, residential country, ID type
  // & number, and PEP toggle + details. Reads/writes through the
  // stakeholdersRef helpers — explicit re-render on every change so
  // completion badges and the conditional PEP-details textarea stay
  // synced with the underlying data.

  const stakeholderLabelStyle = {
    display: "block", fontSize: 12, fontWeight: 600,
    color: "#1a3a4a", marginBottom: 5,
  };

  const stakeholderLockedStyle = {
    padding: "10px 14px", background: "#f2f1ed", borderRadius: 8,
    border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14,
    color: "#1a3a4a80", display: "flex", alignItems: "center",
    justifyContent: "space-between",
  };

  const stakeholderRequiredKeys = (s) => {
    if (s && s.is_company) {
      // Corporate stakeholder: KYB fields, no person EDD.
      return ["full_name", "business_type", "business_registration_number", "registered_country"];
    }
    const keys = ["full_name", "nationality", "date_of_birth", "is_pep"];
    if (s && s.is_pep === true) keys.push("pep_details");
    return keys;
  };

  const stakeholderMissingFields = (s) => {
    return stakeholderRequiredKeys(s).filter((k) => {
      if (k === "is_pep") return s.is_pep === null || s.is_pep === undefined;
      const v = s[k];
      return v == null || String(v).trim() === "";
    });
  };

  // Common legal/business types for a corporate stakeholder.
  const BUSINESS_TYPE_OPTIONS = [
    "Private Limited Company",
    "Public Limited Company (PLC)",
    "Limited Liability Partnership (LLP)",
    "Partnership",
    "Sole Proprietorship",
    "Trust",
    "Fund",
    "Foundation",
    "Government / State-owned",
    "Other",
  ];

  // Next-page (Fill Gaps) body for a CORPORATE stakeholder — KYB fields plus a
  // repeatable positions list. A found field stays verified while its Confirm
  // green tick is on; unticking opens it for edit (same as the person form).
  const renderStakeholderCardCorporateBody = (fieldId, s) => {
    const aiFound = !s.customer_rejected && !s.customer_added;
    const nameLocked = aiFound && isStkFieldConfirmed(s.id, "full_name");
    const positions = s.positions || [];
    return (
      <>
        {/* Business name */}
        {nameLocked ? (
          <div style={{ marginBottom: 14 }}>
            <label style={stakeholderLabelStyle}>Business Name <span style={{ color: "#d44" }}>*</span></label>
            <div style={stakeholderLockedStyle}>
              <span>{s.full_name}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
            </div>
          </div>
        ) : (
          <StableInput
            id={`stk_${fieldId}_${s.id}_business_name`}
            label="Business Name"
            type="text"
            value={s.full_name || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "full_name", v)}
            required
            placeholder="Registered / legal name"
          />
        )}

        {/* Business type */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_business_type`}
          label="Business Type"
          type="select"
          value={s.business_type || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "business_type", v)}
          required
          options={BUSINESS_TYPE_OPTIONS}
        />

        {/* Business registration number */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_brn`}
          label="Business Registration Number"
          type="text"
          value={s.business_registration_number || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "business_registration_number", v)}
          required
          placeholder="e.g. Companies House / ACRA number"
        />

        {/* Registered country — pre-filled & verified when the AI found it */}
        <PrePopulatedField
          id={`stk_${fieldId}_${s.id}_reg_country`}
          label="Registered Country"
          type="select"
          value={s.registered_country || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "registered_country", v)}
          options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
          sourceLabel={s.source}
          startEditing={!isStkFieldConfirmed(s.id, "registered_country")}
          required
        />

        {/* Shareholding (optional) */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_share`}
          label="Shareholding %"
          type="text"
          value={s.share_percentage != null ? String(s.share_percentage) : ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "share_percentage", v === "" ? null : v)}
          placeholder="e.g. 100"
        />

        {/* Positions — repeatable { title, start_date } */}
        <div style={{ marginBottom: 4 }}>
          <label style={stakeholderLabelStyle}>Position(s)</label>
          {positions.length === 0 && (
            <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 8px", fontStyle: "italic" }}>
              No positions added yet.
            </p>
          )}
          {positions.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <StableInput
                  id={`stk_${fieldId}_${s.id}_pos_${i}_title`}
                  label="Title"
                  type="text"
                  value={p.title || ""}
                  onUpdate={(_, v) => updateStkPosition(fieldId, s.id, i, "title", v)}
                  placeholder="e.g. Parent Company, Corporate Director"
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <StableInput
                  id={`stk_${fieldId}_${s.id}_pos_${i}_start`}
                  label="Start date"
                  type="date"
                  value={p.start_date || ""}
                  onUpdate={(_, v) => updateStkPosition(fieldId, s.id, i, "start_date", v)}
                />
              </div>
              <button
                type="button"
                onClick={() => removeStkPosition(fieldId, s.id, i)}
                title="Remove position"
                aria-label="Remove position"
                style={{
                  background: "none", border: "none", color: "#1a3a4a70",
                  cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px 10px",
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addStkPosition(fieldId, s.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14,
              padding: "8px 14px", background: "transparent", color: "#1a3a4a",
              border: "1.5px dashed #4a9e8e", borderRadius: 8,
              fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            + Add position
          </button>
        </div>
      </>
    );
  };

  const renderStakeholderCard = (fieldId, stakeholder, index) => {
    const ubo = isUboLikeField(fieldId);
    const isRejected = !!stakeholder.customer_rejected;
    const isAdded = !!stakeholder.customer_added;
    const isAIFound = !isRejected && !isAdded;
    const missing = stakeholderMissingFields(stakeholder);
    const isComplete = missing.length === 0;

    // A found field stays locked/verified only while its Confirm-page green tick
    // is still on; unticking it on Confirm opens it for editing here.
    const nameLocked = isAIFound && isStkFieldConfirmed(stakeholder.id, "full_name");
    const roleLocked = isAIFound && stakeholder.role && isStkFieldConfirmed(stakeholder.id, "role");

    return (
      <div
        key={stakeholder.id}
        style={{
          borderRadius: 10,
          border: `1.5px solid ${isComplete ? "#4a9e8e" : isRejected ? "#fecaca" : "rgba(26,58,74,0.14)"}`,
          background: isRejected ? "#fef9f9" : "#fff",
          marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>{isCorporateStakeholder(stakeholder) ? "🏢" : "👤"}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {stakeholder.full_name || `${isCorporateStakeholder(stakeholder) ? "Company" : "Person"} ${index + 1}`}
              </div>
              {(stakeholder.role || stakeholder.share_percentage != null) && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>
                  {stakeholder.role || ""}
                  {stakeholder.role && stakeholder.share_percentage != null ? " · " : ""}
                  {formatShareholding(stakeholder.share_percentage)}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
              background: isComplete ? "#dff2ec" : "#fff8ed",
              color: isComplete ? "#1a6b56" : "#8c5500",
              border: `1px solid ${isComplete ? "#4a9e8e" : "#e0a040"}40`,
            }}>
              {isComplete
                ? "✅ Complete"
                : `⚠ ${missing.length} field${missing.length > 1 ? "s" : ""} needed`}
            </span>
            {isAIFound && stakeholder.source && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#dff2ec", color: "#1a6b56",
              }}>
                ✓ {stakeholder.source}
              </span>
            )}
            {isRejected && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca",
              }}>
                Correction needed
              </span>
            )}
            {(isAdded || isRejected) && (
              <button
                type="button"
                onClick={() => removeStakeholder(fieldId, stakeholder.id)}
                style={{
                  background: "none", border: "none", color: "#1a3a4a70",
                  cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px",
                  fontFamily: "inherit",
                }}
                title="Remove this person"
                aria-label="Remove"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 0 }}>
          {isCorporateStakeholder(stakeholder) ? renderStakeholderCardCorporateBody(fieldId, stakeholder) : (
          <>
          {/* Name */}
          {nameLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Full Legal Name <span style={{ color: "#d44" }}>*</span></label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.full_name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <>
              {isRejected && stakeholder.full_name_original && (
                <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 4px" }}>
                  AI found: "{stakeholder.full_name_original}" — please enter the correct name
                </p>
              )}
              <StableInput
                id={`stk_${fieldId}_${stakeholder.id}_full_name`}
                label={`Full Legal Name`}
                type="text"
                value={stakeholder.full_name || ""}
                onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "full_name", v)}
                required
                placeholder="Full legal name"
              />
            </>
          )}

          {/* Role */}
          {roleLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Role / Position</label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.role}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_role`}
              label="Role / Position"
              type="text"
              value={stakeholder.role || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "role", v)}
              placeholder={ubo ? "e.g. Shareholder, UBO" : "e.g. CEO, Director, CFO"}
            />
          )}

          {/* Nationality — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_nationality`}
            label="Nationality"
            type="text"
            value={stakeholder.nationality || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "nationality", v)}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "nationality")}
            required
            placeholder="e.g. British, American, Singaporean"
          />

          {/* Date of birth — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_dob`}
            label="Date of Birth"
            type="date"
            value={stakeholder.date_of_birth || ""}
            displayValue={formatDOBForDisplay(stakeholder.date_of_birth)}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "date_of_birth", v)}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "date_of_birth")}
            required
            placeholder="YYYY-MM-DD"
          />

          {/* Country of residence — pre-filled & locked (editable) when the AI
              found it on the registry; falls through to a country picker when empty */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_country`}
            label="Country of Residence"
            type="select"
            value={stakeholder.residential_country || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "residential_country", v)}
            options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "residential_country")}
          />

          {/* Identity Document Type and Identity Document Number are intentionally
              hidden at Fill Gaps — these are collected later in the verification
              flow, not from the registry. Uncomment to restore.
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_type`}
            label="Identity Document Type"
            type="select"
            value={stakeholder.id_type || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_type", v)}
            options={[
              { value: "passport", label: "Passport" },
              { value: "national_id", label: "National ID Card" },
              { value: "driving_licence", label: "Driving Licence" },
              { value: "other", label: "Other" },
            ]}
          />
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_number`}
            label="Identity Document Number"
            type="text"
            value={stakeholder.id_number || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_number", v)}
            placeholder="Passport or ID number"
          />
          */}

          {/* PEP three-button toggle */}
          <div style={{ marginBottom: 14 }}>
            <label style={stakeholderLabelStyle}>
              Politically Exposed Person (PEP)? <span style={{ color: "#d44" }}>*</span>
            </label>
            <p style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.4, margin: "0 0 8px" }}>
              A PEP holds or has held a prominent public function, or is closely associated with someone who does.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { val: false, label: "No", c: "#4a9e8e", bg: "#dff2ec" },
                { val: true, label: "Yes", c: "#dc2626", bg: "#fef2f2" },
                { val: null, label: "Not Sure", c: "#1a3a4a", bg: "#e0e8f4" },
              ].map((opt) => {
                const selected = stakeholder.is_pep === opt.val;
                return (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => updateStakeholderField(fieldId, stakeholder.id, "is_pep", opt.val)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 8,
                      border: `1.5px solid ${selected ? opt.c : "rgba(26,58,74,0.14)"}`,
                      background: selected ? opt.bg : "transparent",
                      color: selected ? opt.c : "#1a3a4a80",
                      fontWeight: selected ? 700 : 500, fontSize: 13,
                      fontFamily: "inherit", cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional PEP details */}
          {stakeholder.is_pep === true && (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_pep_details`}
              label="PEP Details"
              type="textarea"
              value={stakeholder.pep_details || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "pep_details", v)}
              required
              placeholder="Please describe the political position, function, or connection"
            />
          )}
          </>
          )}
        </div>
      </div>
    );
  };

  // Read-only green summary shown for a listed company's stakeholders that
  // don't require enhanced due diligence (directors/officers, and UBOs < 25%).
  // `field` is the research row; `isPartial` renders it as a subsection above
  // the >= 25% UBO forms.
  const renderListedCompanyStakeholderSummary = (field, stakeholders, isPartial = false) => {
    const ubo = isUboLikeField(field.field);
    const fieldLabel = ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers";
    const lower = fieldLabel.toLowerCase();
    return (
      <div style={{
        borderRadius: 10,
        border: "1px solid #4a9e8e",
        background: "#f3faf8",
        overflow: "hidden",
        marginBottom: isPartial ? 16 : 0,
      }}>
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid #cfe9e1",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {isPartial ? `Other ${fieldLabel}` : fieldLabel}
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                Publicly listed company — verified from official sources. No additional details required.
              </div>
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 99,
            background: "#4a9e8e", color: "#fff", whiteSpace: "nowrap",
          }}>
            🏛 Listed Company
          </span>
        </div>

        <div style={{ padding: "12px 16px" }}>
          {stakeholders.length === 0 ? (
            <p style={{ fontSize: 13, color: "#1a6b56", fontStyle: "italic", margin: 0 }}>
              No {lower} found in public records.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {stakeholders.map((s) => (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", background: "rgba(255,255,255,0.6)",
                  borderRadius: 8, border: "1px solid #cfe9e1",
                }}>
                  <span style={{ fontSize: 16 }}>👤</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1a3a4a" }}>{s.full_name}</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", marginTop: 2 }}>
                      {[s.role, s.share_percentage != null ? `${formatShareholding(s.share_percentage)} shareholding` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#1a6b56", whiteSpace: "nowrap" }}>
                    ✓ Verified
                  </span>
                </div>
              ))}
            </div>
          )}

          <p style={{ fontSize: 12, color: "#1a6b56", marginTop: 12, marginBottom: 0, lineHeight: 1.5, fontStyle: "italic" }}>
            As a publicly listed company, {lower} information is publicly disclosed through regulatory
            filings. Enhanced due diligence details (nationality, date of birth, PEP status) are not
            required for listed company {lower}.
          </p>
        </div>
      </div>
    );
  };

  // ── Fill Gaps stakeholder rendering, split in two ───────────────────────
  // renderStakeholderForms  → only people who need customer input (rendered
  //   in the "additional details needed" section, near the other gap inputs).
  // renderStakeholderSummary → read-only confirmed info / "no action required"
  //   (rendered in the "verified — for reference" section at the bottom).
  // Both return null when they have nothing to show, so the caller can hide
  // the section divider when a field contributes no content.

  // Split "add a stakeholder" buttons (individual vs company) for the Fill Gaps
  // people sections. The blank record is created in the ref and renders its
  // person/company form immediately below.
  const renderAddStakeholderButtons = (fieldId, ubo) => (
    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
      {[
        { label: `+ Add ${ubo ? "individual owner" : "individual"}`, overrides: {} },
        { label: "+ Add company", overrides: { is_company: true } },
      ].map((b) => (
        <button
          key={b.label}
          type="button"
          onClick={() => addStakeholder(fieldId, b.overrides)}
          style={{
            flex: "1 1 0", minWidth: 150,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "10px 18px", background: "transparent", color: "#1a3a4a",
            border: "1.5px dashed #4a9e8e", borderRadius: 8,
            fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );

  // Light, identify-only replacement card (PR-057 interim). Shown ONLY on Fill
  // Gaps for a listed-company person the customer unticked on Confirm. Collects
  // just enough to identify the replacement — full legal name (required) + role
  // — NOT the full UBO/EDD set (no nationality/DOB/PEP/residence). Writes through
  // the same stakeholdersRef helpers as every other person card.
  const renderLightReplacementCard = (fieldId, s) => {
    const named = !!(s.full_name && s.full_name.trim());
    return (
      <div
        key={s.id}
        style={{
          borderRadius: 10,
          border: `1.5px solid ${named ? "#4a9e8e" : "rgba(26,58,74,0.14)"}`,
          background: "#fff", marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>👤</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {s.full_name || "Replacement director"}
              </div>
              {s.full_name_original && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>
                  Replacing: {s.full_name_original}
                </div>
              )}
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
            background: named ? "#dff2ec" : "#fff8ed",
            color: named ? "#1a6b56" : "#8c5500",
            border: `1px solid ${named ? "#4a9e8e" : "#e0a040"}40`,
          }}>
            {named ? "✅ Identified" : "⚠ Name needed"}
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 12px" }}>
            Identify-only — a listed company's directors are public record, so we only need to know
            who replaces the person you removed.
          </p>
          <div style={{ marginBottom: 14 }}>
            <StableInput
              id={`stk_${fieldId}_${s.id}_full_name`}
              label="Full Legal Name"
              type="text"
              value={s.full_name || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "full_name", v)}
              required
              placeholder="Full legal name"
            />
          </div>
          <StableInput
            id={`stk_${fieldId}_${s.id}_role`}
            label="Role / Position"
            type="text"
            value={s.role || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "role", v)}
            placeholder="e.g. Director"
          />
        </div>
      </div>
    );
  };

  // One editable input for a single corrected field, reusing the exact
  // components the private EDD card uses (StableInput / PrePopulatedField).
  // Pre-filled with the AI value and opened for editing (the field is unticked
  // by definition), so the customer edits the surfaced value in place.
  const renderCorrectionField = (fieldId, s, f) => {
    const onUpdate = (_, v) => updateStakeholderField(fieldId, s.id, f.key, v);
    switch (f.key) {
      case "full_name":
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_full_name`} label="Full Legal Name" type="text"
              value={s.full_name || ""} onUpdate={onUpdate} required placeholder="Full legal name" />
          </div>
        );
      case "role":
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_role`} label="Role / Position" type="text"
              value={s.role || ""} onUpdate={onUpdate} placeholder="e.g. CEO, Director, CFO" />
          </div>
        );
      case "nationality":
        return (
          <PrePopulatedField key={f.key} id={`stk_${fieldId}_${s.id}_nationality`} label="Nationality" type="text"
            value={s.nationality || ""} onUpdate={onUpdate} sourceLabel={s.source} startEditing required
            placeholder="e.g. British, American, Singaporean" />
        );
      case "date_of_birth":
        return (
          <PrePopulatedField key={f.key} id={`stk_${fieldId}_${s.id}_dob`} label="Date of Birth" type="date"
            value={s.date_of_birth || ""} displayValue={formatDOBForDisplay(s.date_of_birth)} onUpdate={onUpdate}
            sourceLabel={s.source} startEditing required placeholder="YYYY-MM-DD" />
        );
      case "residential_country":
        return (
          <PrePopulatedField key={f.key} id={`stk_${fieldId}_${s.id}_country`} label="Country of Residence" type="select"
            value={s.residential_country || ""} onUpdate={onUpdate}
            options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
            sourceLabel={s.source} startEditing />
        );
      case "share_percentage":
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_share`} label="Shareholding" type="text"
              value={s.share_percentage != null ? String(s.share_percentage) : ""} onUpdate={onUpdate}
              placeholder="e.g. 30%" />
          </div>
        );
      default:
        return (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <StableInput id={`stk_${fieldId}_${s.id}_${f.key}`} label={f.label} type="text"
              value={stkFieldDisplay(s, f.key)} onUpdate={onUpdate} />
          </div>
        );
    }
  };

  // Field-level correction card for a listed-company person the customer did
  // NOT remove but whose AI-returned value(s) they unticked on Confirm. Renders
  // ONLY the unticked fields as editable — correction, not collection. Mirrors
  // the private per-field edit; the person-level removal path is the separate
  // light replacement card above.
  const renderFieldCorrectionCard = (fieldId, s, ubo) => {
    const corrected = stkCorrectedFields(s, ubo);
    if (corrected.length === 0) return null;
    return (
      <div
        key={s.id}
        style={{
          borderRadius: 10, border: "1.5px solid #e0a040",
          background: "#fff", marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>👤</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {s.full_name || (ubo ? "Beneficial owner" : "Director")}
              </div>
              {s.role && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>{s.role}</div>
              )}
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
            background: "#fff8ed", color: "#8c5500", border: "1px solid #e0a04040",
          }}>
            ✎ {corrected.length} correction{corrected.length > 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 12px" }}>
            You marked {corrected.length === 1 ? "a detail" : "these details"} as incorrect on the previous
            page. Correct {corrected.length === 1 ? "it" : "them"} below — we only collect the
            value{corrected.length > 1 ? "s" : ""} you're fixing.
          </p>
          {corrected.map((f) => renderCorrectionField(fieldId, s, f))}
        </div>
      </div>
    );
  };

  const renderStakeholderForms = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const personLabel = ubo ? "beneficial owner" : "director";
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);

    // Drop registry exemption notices — never real people / EDD forms.
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    const needingDetails = validStakeholders.filter((s) => needsStakeholderDetails(s, fieldId, effectivelyListed));

    // Listed-company replacement path: a person the customer unticked on Confirm
    // gets a LIGHT identify-only card here (not the full EDD set). These people
    // return false from needsStakeholderDetails (which we must not change), so
    // detect them via the customer_rejected flag seeded by initStakeholdersForFillGaps.
    const lightReplacements = effectivelyListed
      ? validStakeholders.filter((s) => s.customer_rejected && !needsStakeholderDetails(s, fieldId, effectivelyListed))
      : [];

    // Listed-company field-level corrections: a person the customer kept but
    // whose AI-returned value(s) they unticked on Confirm. Correction-only —
    // these people return false from needsStakeholderDetails so they'd otherwise
    // sit in the read-only summary with no way to edit. People needing full EDD
    // (>=25% UBOs) already correct fields inside renderStakeholderCard, and
    // private-company people flow through needingDetails — so this list is
    // listed-only, not-rejected, not-EDD. (Private corrections are unchanged.)
    const fieldCorrections = effectivelyListed
      ? validStakeholders.filter(
          (s) =>
            !s.customer_rejected &&
            !needsStakeholderDetails(s, fieldId, effectivelyListed) &&
            stkHasCorrections(s, ubo)
        )
      : [];

    // Private company with no real people found yet: prompt to add one. This is
    // a customer action, so it belongs in the forms section.
    if (!effectivelyListed && validStakeholders.length === 0) {
      return (
        <div key={`stk-forms-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
          <div style={{
            margin: "0 0 14px", padding: "10px 14px", borderRadius: 8,
            background: "#fff8ed", border: "1px solid #e0a040",
            fontSize: 12, color: "#8c5500",
          }}>
            No {personLabel}s were found automatically. Please add at least one {personLabel} below.
          </div>
          {renderAddStakeholderButtons(fieldId, ubo)}
        </div>
      );
    }

    // Nobody needs input → nothing in the forms section (summary handles the
    // read-only reference at the bottom of the page). For a listed company the
    // section still renders if the customer unticked someone (light replacement).
    if (needingDetails.length === 0 && lightReplacements.length === 0 && fieldCorrections.length === 0) return null;

    return (
      <div key={`stk-forms-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
        {!effectivelyListed ? (
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 14px", lineHeight: 1.5 }}>
            Complete the required details for each {personLabel} below. Names and roles marked
            "Verified" came from the research on the previous page; everything else needs your input.
          </p>
        ) : needingDetails.length > 0 ? (
          <div style={{
            padding: "12px 16px", background: "#fff8ed", border: "1px solid #e0a040",
            borderRadius: 8, fontSize: 13, color: "#8c5500",
            marginBottom: 16, display: "flex", gap: 8,
          }}>
            <span>⚠</span>
            <span>
              Although this is a listed company, the following beneficial owner
              {needingDetails.length > 1 ? "s hold" : " holds"} 25% or more of shares and requires
              enhanced due diligence details.
            </span>
          </div>
        ) : null}
        {needingDetails.map((s, i) => renderStakeholderCard(fieldId, s, i))}

        {/* Listed-company light replacement cards — only for unticked people. */}
        {lightReplacements.length > 0 && (
          <>
            <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 14px", lineHeight: 1.5 }}>
              You removed {lightReplacements.length === 1 ? `a ${personLabel}` : `${lightReplacements.length} ${personLabel}s`} on
              the previous page. Please identify {lightReplacements.length === 1 ? "their replacement" : "their replacements"} below —
              just a name and role. A listed company's {personLabel}s are public record, so no further details are needed.
            </p>
            {lightReplacements.map((s) => renderLightReplacementCard(fieldId, s))}
          </>
        )}

        {/* Listed-company field-level corrections — kept people whose surfaced
            value(s) the customer unticked to fix. Correction-only, no EDD. */}
        {fieldCorrections.length > 0 && (
          <>
            <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 14px", lineHeight: 1.5 }}>
              You marked {fieldCorrections.length === 1 ? "a detail" : "some details"} as incorrect on the
              previous page. Please correct {fieldCorrections.length === 1 ? "it" : "them"} below. As a listed
              company, no further details are collected — only the values you're fixing.
            </p>
            {fieldCorrections.map((s) => renderFieldCorrectionCard(fieldId, s, ubo))}
          </>
        )}

        {!effectivelyListed && renderAddStakeholderButtons(fieldId, ubo)}
      </div>
    );
  };

  const renderStakeholderSummary = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    // Read-only "verified" reference: people needing no input. Exclude listed
    // people the customer is actively correcting (a field unticked) — they now
    // render as an editable correction card in the forms section above, so
    // showing them here too would duplicate them with the stale value.
    const confirmedOnly = validStakeholders.filter(
      (s) =>
        !needsStakeholderDetails(s, fieldId, effectivelyListed) &&
        !(effectivelyListed && !s.customer_rejected && stkHasCorrections(s, ubo))
    );

    // Listed company with no real owners (e.g. PSC-exempt — only an exemption
    // notice): clean "No action required" reference card.
    if (validStakeholders.length === 0 && effectivelyListed) {
      return (
        <div key={`stk-summary-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
          <div style={{
            padding: "14px 16px", background: "#f3faf8", border: "1px solid #4a9e8e",
            borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {heading} — No action required
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                This is a publicly listed company. Ownership information is publicly disclosed through
                regulatory filings. No additional details required.
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Nothing read-only to show (e.g. a private company — everyone is in the
    // forms section above, so no duplicate rendering here).
    if (confirmedOnly.length === 0) return null;

    return (
      <div key={`stk-summary-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
        {renderListedCompanyStakeholderSummary(researchItem, confirmedOnly, false)}
      </div>
    );
  };

  const validateStakeholders = () => {
    const errors = [];
    (research?.found || []).forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      if (!Array.isArray(result.stakeholders) || result.stakeholders.length === 0) return;
      const list = getStakeholders(result.field);
      // Registry exemption notices are not people — never validate them.
      const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
      const ubo = isUboLikeField(result.field);
      const personLabel = ubo ? "beneficial owner" : "director";

      // Listed-company light replacement cards (PR-057): a person the customer
      // unticked needs only a name (identify-only). Validate this before the
      // "no one needs full details" early return below.
      if (effectivelyListed) {
        validStakeholders
          .filter((s) => s.customer_rejected && !needsStakeholderDetails(s, result.field, effectivelyListed))
          .forEach((s) => {
            if (!s.full_name || !s.full_name.trim()) {
              errors.push(`Please name the replacement ${personLabel} for the person you removed.`);
            }
          });
      }

      // Only validate stakeholders that still need the full gap form. For a
      // listed company that's the >= 25% UBOs; for a private company it's
      // everyone (so behaviour is unchanged).
      const toValidate = validStakeholders.filter((s) => needsStakeholderDetails(s, result.field, effectivelyListed));

      // Listed company where no one needs details — nothing to validate.
      if (effectivelyListed && toValidate.length === 0) return;

      if (validStakeholders.length === 0) {
        errors.push(`Please add at least one ${personLabel}.`);
        return;
      }
      toValidate.forEach((s, idx) => {
        const isCo = !!s.is_company;
        const display = (s.full_name && s.full_name.trim()) || (isCo ? `Company ${idx + 1}` : `Person ${idx + 1}`);
        const missing = stakeholderMissingFields(s);
        missing.forEach((k) => {
          if (k === "full_name") errors.push(isCo ? `Please enter the business name for company ${idx + 1}.` : `Please enter the full name for person ${idx + 1}.`);
          else if (k === "business_type") errors.push(`Please select the business type for ${display}.`);
          else if (k === "business_registration_number") errors.push(`Please enter the registration number for ${display}.`);
          else if (k === "registered_country") errors.push(`Please select the registered country for ${display}.`);
          else if (k === "nationality") errors.push(`Please enter nationality for ${display}.`);
          else if (k === "date_of_birth") errors.push(`Please enter date of birth for ${display}.`);
          else if (k === "is_pep") errors.push(`Please answer the PEP question for ${display}.`);
          else if (k === "pep_details") errors.push(`Please provide PEP details for ${display}.`);
        });
      });
    });
    return errors;
  };

  // Sort key per spec: documents first, tier1 next, tier2 last; within group
  // by the schema researchFields order.
  const sourceTierRank = { document: 0, tier1: 1, tier2: 2, tier3: 3 };
  const fieldOrderMap = activeSchema ? new Map(activeSchema.researchFields.map((f, i) => [f.field, i])) : new Map();
  const sortedFound = (research?.found || [])
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const ra = sourceTierRank[a.item.sourceTier] ?? 99;
      const rb = sourceTierRank[b.item.sourceTier] ?? 99;
      if (ra !== rb) return ra - rb;
      const fa = fieldOrderMap.has(a.item.field) ? fieldOrderMap.get(a.item.field) : 999;
      const fb = fieldOrderMap.has(b.item.field) ? fieldOrderMap.get(b.item.field) : 999;
      return fa - fb;
    });

  // Split out stakeholder items with real people so they render as cards above
  // the regular pre-filled table. A field whose only entries are registry
  // exemption notices has no real people, so it stays in the regular flow as a
  // normal row (showing the raw registry value).
  const hasRealStakeholders = (item) =>
    isStakeholderField(item.field) &&
    Array.isArray(item.stakeholders) &&
    item.stakeholders.some((s) => !isRegistryExemptionNotice(s));
  const stakeholderFound = sortedFound.filter(({ item }) => hasRealStakeholders(item));
  const regularFound = sortedFound.filter(({ item }) => !hasRealStakeholders(item));

  // Pre-boarding confirm only: a stakeholder field can fall into regularFound
  // when its .stakeholders array is empty/exemption-only — the plain field table
  // would then show the raw JSON-array value. Split these out so renderConfirmFields
  // can parse them into cards (or a clean message) instead of raw JSON. Onboarding
  // confirm is untouched (it renders stakeholderFound/regularFound directly).
  const stakeholderRegular = regularFound.filter(({ item }) => isStakeholderField(item.field));
  const trueRegular = regularFound.filter(({ item }) => !isStakeholderField(item.field));

  // Render a stakeholder field that fell through to the regular list. Parse a
  // JSON-array value into stakeholder cards; if no real persons remain, show a
  // clean message rather than raw JSON; non-JSON values render as a labelled row.
  const renderStakeholderFallback = (item, idx) => {
    const val = typeof item.value === "string" ? item.value.trim() : "";
    const niceLabel = String(item.label || item.field || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
    if (val.startsWith("[")) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          const stakeholders = parsed
            .map((p) => makeStakeholder({
              full_name: p.full_name || p.name || "",
              role: p.role || p.position || "",
              share_percentage: p.share_percentage ?? p.ownership_percentage ?? null,
              source: item.source,
              sourceUrl: item.sourceUrl,
              sourceTier: item.sourceTier,
              fetchedAt: item.fetchedAt,
            }))
            .filter((s) => s.full_name)
            .filter((s) => !isRegistryExemptionNotice(s));
          if (stakeholders.length > 0) {
            return renderStakeholderConfirmSection({ ...item, stakeholders }, idx);
          }
        }
      } catch (_) {
        // not valid JSON — fall through to the labelled row below
      }
      // JSON array but no registrable persons (e.g. publicly listed company).
      return (
        <div key={`stk-fallback-${item.field}-${idx}`} style={{ padding: "10px 14px", background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.textMuted, fontStyle: "italic", marginBottom: 12 }}>
          {niceLabel}: No registrable persons found (publicly listed company)
        </div>
      );
    }
    // Non-JSON stakeholder value — show a clean labelled row, never raw JSON.
    return (
      <div key={`stk-fallback-${item.field}-${idx}`} style={{ padding: "10px 14px", background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, marginBottom: 12 }}>
        <strong>{niceLabel}:</strong> {safeRenderValue(item.value)}
      </div>
    );
  };

  // Fill Gaps stakeholder rendering, split into two sections. Forms (input
  // needed) render with the other gap inputs; summaries (read-only) render at
  // the bottom for reference. Render functions return null when empty, so the
  // section dividers below only appear when there's actual content.
  const stakeholderGapRows = (research?.found || []).filter((r) => {
    if (!isStakeholderField(r.field) || !Array.isArray(r.stakeholders)) return false;
    if (r.stakeholders.some((s) => !isRegistryExemptionNotice(s))) return true;
    // Listed company whose only "owners" were exemption notices (filtered out
    // of .stakeholders): still surface the "no action required" summary.
    return effectivelyListed && typeof r.value === "string" && r.value.trim().length > 0;
  });
  const stakeholderFormNodes = stakeholderGapRows.map((r) => renderStakeholderForms(r)).filter(Boolean);
  const stakeholderSummaryNodes = stakeholderGapRows.map((r) => renderStakeholderSummary(r)).filter(Boolean);
  const hasStakeholderForms = stakeholderFormNodes.length > 0;
  const hasStakeholderSummary = stakeholderSummaryNodes.length > 0;

  // Confirm-page documents: persisted (server-derived) ∪ live dialogue
  // outcomes, collapsed with the SCOPE-AWARE key (commit 6a) — per person for
  // identity evidence, per type for company evidence. Feeds the inline row
  // card, the person cards, the summary panel and blocker kind (b): one list,
  // four surfaces, one satisfaction rule.
  const stakeholderNameById = (() => {
    const byId = new Map();
    (research?.found || []).forEach((row) => {
      (row.stakeholders || []).forEach((s) => { if (s && s.id) byId.set(s.id, s.full_name || null); });
    });
    // Customer-added / edited people live in the ref, and win on name.
    Object.values(stakeholdersRef.current || {}).forEach((list) => {
      (list || []).forEach((s) => { if (s && s.id && s.full_name) byId.set(s.id, s.full_name); });
    });
    return byId;
  })();
  // Field label by field id, so a per-field document request can name the field
  // that asked for it — several 'Supporting Registration Document' requests
  // share one title and are otherwise indistinguishable.
  const fieldLabelById = new Map(
    (research?.found || []).filter((r) => r && r.field).map((r) => [r.field, r.label || r.field])
  );
  const withPersonName = (list) => (Array.isArray(list) ? list : []).map((d) => {
    const p = d && d.fieldId ? parsePersonFieldId(d.fieldId) : null;
    if (p) return { ...d, personName: stakeholderNameById.get(p.stakeholderId) || null };
    return d && d.fieldId ? { ...d, fieldLabel: fieldLabelById.get(d.fieldId) || null } : d;
  });
  // Persisted first, then live — canonicalDocs keeps first-occurrence order.
  const rawAmendmentDocs = [
    ...withPersonName(persistedAmendmentDocs),
    ...withPersonName(docsNeededFrom(dialogueStateRef.current)),
  ];
  const confirmDocs = canonicalDocs(rawAmendmentDocs);

  // A company-wide document (ownership chart, directors list) is ONE request no
  // matter how many people's changes asked for it. Anchor it to the first
  // person who triggered it, so exactly one person card carries the upload and
  // the others show a pointer instead of a duplicate request for the same file.
  // Derived here rather than during the person-card render pass: a render-order
  // "first one wins" mutation would double-fire under StrictMode.
  const companyDocAnchor = (() => {
    const anchor = new Map();
    rawAmendmentDocs.forEach((d) => {
      if (!d || !d.docType || !isCompanyWideDocType(d.docType)) return;
      const type = canonicalDocType(d.docType);
      if (anchor.has(type)) return;
      const p = parsePersonFieldId(d.fieldId);
      if (p) anchor.set(type, p.stakeholderId);
    });
    return anchor;
  })();

  /**
   * Per-person attributes as countable items, so the tiles describe the WHOLE
   * page rather than only the pre-filled table. Built from exactly the same
   * helpers the person-card badge uses (stkConfirmFields / stkFieldFound /
   * isStkFieldConfirmed, gated by needsStakeholderDetails), so the badge on a
   * card and this person's share of the tile can never disagree.
   *
   * `resolvableHere` is the load-bearing distinction: a FOUND attribute can be
   * ticked or corrected on this page, but an attribute research did not return
   * has no input on the person card — it is collected on Fill Gaps, which is
   * why the card tags it "added on next page". Counting it is honest; blocking
   * on it would strand the customer with no control to clear it.
   */
  const personConfirmItems = (() => {
    const out = [];
    stakeholderFound.forEach(({ item }) => {
      const ubo = isUboLikeField(item.field);
      (item.stakeholders || [])
        .filter((s) => !isRegistryExemptionNotice(s))
        .forEach((s) => {
          if (isStakeholderRejected(item.field, s.id)) return;
          const needsEDD = needsStakeholderDetails(s, item.field, effectivelyListed);
          const lowConf = isPersonLowConfidence(s, item);
          stkConfirmFields(s, ubo).forEach((f) => {
            const found = stkFieldFound(s, f.key);
            // A low-confidence attribute needs an EXPLICIT tick, exactly as a
            // low-confidence pre-filled row does — arriving pre-ticked is not
            // agreement. Same source, same standard, whether it renders as a
            // row or inside a person card.
            const settled = isPersonAttributeSettled(s, f, lowConf);
            // Mirrors stkNextPageFields (EDD people) and stkCorrectedFields
            // (listed read-only people), plus the affirmation requirement.
            const outstanding = needsEDD ? (found ? !settled : f.required) : found && !settled;
            out.push({
              stakeholderId: s.id,
              fieldId: item.field,
              key: f.key,
              label: f.label,
              personName: s.full_name || null,
              found,
              outstanding,
              confirmed: found && settled,
              resolvableHere: found,
            });
          });
        });
    });
    return out;
  })();

  // Confirm-page tile counts and the gate's blockers, from the ONE shared
  // predicate. Computed during render — not memoised — because gapRef and
  // dialogueStateRef are refs: a memo would serve stale values after an inline
  // save. Re-render is driven by the same setFormVersion bump the save fires.
  const confirmStateInput = {
    // VITAL ROWS ONLY — the rows the customer can actually act on in the
    // pre-filled table, carrying their original research.found index (checks is
    // index-keyed). Stakeholder fields render as person cards with their own
    // affordances and are not gate-eligible until commit 6 wires per-person
    // corrections; counting them here would block the customer on a control
    // this page does not give them.
    rows: regularFound,
    checks,
    affirmed: affirmedFields,
    corrections: gapRef.current,
    docs: confirmDocs,
    uploads: amendmentUploads,
    personItems: personConfirmItems,
  };
  const confirmCounts = computeConfirmCounts(confirmStateInput);
  // requiredGaps is deliberately EMPTY here. Every value the customer can
  // supply on Confirm is already covered by kind (a) — a crossed row with no
  // correction is an attention row. The remaining required gaps live on Fill
  // Gaps and are invisible from this page; blocking on a field the customer
  // cannot see would be an illegible trap, and allGapsFilled still enforces
  // them at the Fill Gaps gate (kept as the backstop).
  const confirmBlockers = submitBlockers({ ...confirmStateInput, requiredGaps: [] });
  const confirmBlockerMessage = blockerSummary(confirmBlockers);

  // Upload handler shared by the inline Confirm card and the Fill Gaps panel —
  // one store (amendmentUploads), keyed fieldId::docType, lifted here so blobs
  // survive Confirm↔Fill Gaps navigation and land in the dossier payload.
  const handleAmendmentUpload = async (file, doc) => {
    const k = docKey(doc);
    setUploadingDocKey(k);
    const record = await uploadAmendmentDoc(file);
    setUploadingDocKey(null);
    setAmendmentUploads(prev => ({ ...prev, [k]: record }));
  };
  const handleAmendmentRemove = (doc) => {
    const k = docKey(doc);
    setAmendmentUploads(prev => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const docCount = (research?.found || []).filter(i => i.sourceTier === "document").length;
  const tier1Count = (research?.found || []).filter(i => i.sourceTier === "tier1").length;
  const tier2Count = (research?.found || []).filter(i => i.sourceTier === "tier2").length;
  const tier3Count = (research?.found || []).filter(i => i.sourceTier === "tier3").length;

  /**
   * How much research actually pre-filled, by source — counted in DATA POINTS.
   *
   * A stakeholder row is one row but many values: three directors with five
   * known attributes each is fifteen pre-filled fields, not one. The old count
   * used research.found.length, so every people-heavy run was understated by
   * roughly the number of people on it.
   *
   * Attributes inherit their row's tier, which is what the person card's own
   * source badge already displays ("Companies House"), so the breakdown agrees
   * with what the customer sees. Rejected people and unticked fields still
   * count: this measures what research DELIVERED, not what survived review.
   */
  const prefill = prefillBreakdown(
    (research?.found || []).map((item) => {
      if (!hasRealStakeholders(item)) return { sourceTier: item.sourceTier, count: 1 };
      const ubo = isUboLikeField(item.field);
      const count = item.stakeholders
        .filter((s) => !isRegistryExemptionNotice(s))
        .reduce(
          (n, s) => n + stkConfirmFields(s, ubo).filter((f) => stkFieldFound(s, f.key)).length,
          0
        );
      return { sourceTier: item.sourceTier, count };
    })
  );

  // Resolved values from tenant config with safe fallbacks. Keep these on the
  // happy path (after configLoading guard) so any null deref is contained.
  const companyName_ = tenantConfig?.company?.name || "Nium";
  const companyLogo_ = tenantConfig?.company?.logo || null;
  const manualFormUrl_ = tenantConfig?.company?.manualFormUrl || MANUAL_FORM_URL;
  const activeEntityTypes = (tenantConfig?.entityTypes || [])
    .filter(e => e.active !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  if (configLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: "#1a3a4a",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, border: "3px solid rgba(74,158,142,0.2)",
            borderTopColor: "#4a9e8e", borderRadius: "50%", margin: "0 auto 14px",
            animation: "kspin 0.9s linear infinite",
          }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Loading configuration…</div>
          <style>{`@keyframes kspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // LANDING PAGE — agent selection. Renders before Step 1. Onboarding Agent
  // routes into the existing flow; Pre-boarding Agent is password-gated (ARCH)
  // and shows a coming-soon screen after a correct code.
  // Currently unrouted: the landing page is hidden for the stakeholder review
  // weekend (see the agentType === null routing block). Kept for restore.
  // ───────────────────────────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  function renderLandingPage() {
    return (
      <div style={{
        minHeight: "100vh",
        background: C.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: C.text,
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
            {tenantConfig?.company?.logo ? (
              <img
                src={tenantConfig.company.logo}
                alt={tenantConfig.company.name}
                style={{ height: 40, objectFit: "contain" }}
              />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: 12, background: C.niumBlue,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 800, color: "#fff",
              }}>
                N
              </div>
            )}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: "0 0 8px 0", letterSpacing: "-0.5px" }}>
            {tenantConfig?.company?.name || "Nium"} Intelligence Platform
          </h1>
          <p style={{ fontSize: 16, color: C.textSec, margin: 0, maxWidth: 480, lineHeight: 1.5 }}>
            Select the agent you would like to work with today.
          </p>
        </div>

        {/* Agent cards */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 720, width: "100%" }}>
          {/* Onboarding Agent */}
          <div
            onClick={() => {
              trackEvent("agent_selected", {
                agentType: "onboarding",
                selectedAt: new Date().toISOString(),
              });
              setAgentType("onboarding");
            }}
            style={{
              flex: "1 1 280px", maxWidth: 320, padding: "32px 28px",
              background: C.surface, border: `2px solid ${C.border}`, borderRadius: 16,
              cursor: "pointer", transition: "all 0.15s", textAlign: "left",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = C.niumBlue;
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>
              Onboarding Agent
            </div>
            <div style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6, marginBottom: 20 }}>
              AI-powered KYC/KYB onboarding. Research, confirm, fill gaps and submit a complete application.
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: C.niumBlue }}>
              Start onboarding →
            </div>
          </div>

          {/* Pre-boarding Agent */}
          <div
            onClick={() => {
              trackEvent("agent_selected", {
                agentType: "preboarding",
                selectedAt: new Date().toISOString(),
                note: "password gate shown",
              });
              setAgentType("preboarding");
            }}
            style={{
              flex: "1 1 280px", maxWidth: 320, padding: "32px 28px",
              background: C.surface, border: `2px solid ${C.border}`, borderRadius: 16,
              cursor: "pointer", transition: "all 0.15s", textAlign: "left", position: "relative",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "#7C3AED";
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{
              position: "absolute", top: 16, right: 16, fontSize: 10, fontWeight: 700,
              color: "#7C3AED", background: "#F3F0FF", border: "1px solid #DDD6FE",
              borderRadius: 99, padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.5px",
            }}>
              Coming Soon
            </div>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>
              Pre-boarding Agent
            </div>
            <div style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6, marginBottom: 20 }}>
              Intelligence-led due diligence before customer contact. Build a complete entity dossier and generate a targeted customer request.
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#7C3AED" }}>
              Access pre-boarding →
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p style={{ marginTop: 40, fontSize: 12, color: C.textMuted, textAlign: "center" }}>
          Powered by Nium Intelligence Platform
        </p>
      </div>
    );
  }

  function renderPreboardingGate() {
    const handlePasswordSubmit = () => {
      if (preboardingPassword === PREBOARDING_PASSWORD) {
        trackEvent("preboarding_password_correct", {
          unlockedAt: new Date().toISOString(),
        });
        setPreboardingUnlocked(true);
        setPreboardingPasswordError(false);
        setStep(0); // start the pre-boarding flow at the company-input step
        setError("");
      } else {
        trackEvent("preboarding_password_failed", {
          attemptedAt: new Date().toISOString(),
          // Never log the actual password attempt.
        });
        setPreboardingPasswordError(true);
        setPreboardingPassword("");
      }
    };

    return (
      <div style={{
        minHeight: "100vh",
        background: C.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: C.text,
      }}>
        <div style={{
          width: "100%", maxWidth: 400, background: C.surface, borderRadius: 16,
          padding: "40px 36px", border: `1px solid ${C.border}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.06)", textAlign: "center",
        }}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>🔒</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "0 0 8px 0" }}>
            Pre-boarding Agent
          </h2>
          <p style={{ fontSize: 14, color: C.textSec, marginBottom: 28, lineHeight: 1.5 }}>
            This feature is currently under development and restricted to authorised access only.
          </p>

          <div style={{ marginBottom: 16 }}>
            <input
              type="password"
              value={preboardingPassword}
              onChange={e => {
                setPreboardingPassword(e.target.value);
                setPreboardingPasswordError(false);
              }}
              onKeyDown={e => { if (e.key === "Enter") handlePasswordSubmit(); }}
              placeholder="Enter access code"
              autoFocus
              style={{
                width: "100%", padding: "12px 16px", fontSize: 15,
                border: `1.5px solid ${preboardingPasswordError ? C.error : C.border}`,
                borderRadius: 8, outline: "none", fontFamily: "inherit",
                background: C.surface, color: C.text, boxSizing: "border-box",
                textAlign: "center", letterSpacing: "0.2em",
              }}
            />
            {preboardingPasswordError && (
              <p style={{ fontSize: 12, color: C.error, marginTop: 6, textAlign: "center" }}>
                Incorrect access code. Please try again.
              </p>
            )}
          </div>

          <button
            onClick={handlePasswordSubmit}
            style={{
              width: "100%", padding: "12px 0", background: "#7C3AED", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
              fontFamily: "inherit", cursor: "pointer", marginBottom: 16,
            }}
          >
            Access Pre-boarding Agent
          </button>

          <button
            onClick={() => {
              trackEvent("returned_to_landing", {
                fromAgent: agentType,
                returnedAt: new Date().toISOString(),
              });
              setAgentType(null);
              setPreboardingPassword("");
              setPreboardingPasswordError(false);
            }}
            style={{
              background: "none", border: "none", fontSize: 13,
              color: C.textMuted, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ← Back to agent selection
          </button>
        </div>
      </div>
    );
  }

  // ─── Pre-boarding renderers (analyst flow) ───────────────────────────────
  // Reuse the onboarding research / schema / stakeholder / coverage logic; only
  // the presentation differs. Purple accent (#7C3AED) replaces niumBlue. These
  // are called from inside the main return (agentType === "preboarding"), so
  // they close over all the confirm/fill-gaps render vars.

  // Shared confirm field content (coverage bar, listed toggle, people found,
  // pre-filled fields, unchecked warning). Called by BOTH onboarding confirm and
  // pre-boarding confirm — reused, not duplicated.
  const renderConfirmFields = () => (
    <>
      {/* Part 9 — coverage summary bar. */}
      {coverage && (
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ flex: 1, padding: "12px 16px", background: C.successBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.success, lineHeight: 1 }}>{coverage.verifiedFields}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.success, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Verified</div>
          </div>
          <div style={{ flex: 1, padding: "12px 16px", background: C.warningBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.warning, lineHeight: 1 }}>{coverage.probableFields}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.warning, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Confirm</div>
          </div>
          {coverage.indicativeFields > 0 && (
            <div style={{ flex: 1, padding: "12px 16px", background: "#FFF7ED", borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#C2410C", lineHeight: 1 }}>{coverage.indicativeFields}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#C2410C", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Low Confidence</div>
            </div>
          )}
          <div style={{ flex: 1, padding: "12px 16px", background: C.surfaceAlt, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.textMuted, lineHeight: 1 }}>{coverage.missingFieldCount}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Complete</div>
          </div>
        </div>
      )}

      {SHOW_TEST_TOOLS && (
        <div
          onClick={() => setIsPubliclyListedOverride(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 16px",
            background: isPubliclyListedOverride ? "#f3faf8" : "#f2f1ed",
            border: `1.5px solid ${isPubliclyListedOverride ? "#4a9e8e" : "rgba(26,58,74,0.14)"}`,
            borderRadius: 10, marginBottom: 16,
            cursor: "pointer", transition: "all 0.15s", userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={isPubliclyListedOverride}
            onChange={() => setIsPubliclyListedOverride(v => !v)}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 16, height: 16, accentColor: "#4a9e8e", cursor: "pointer", flexShrink: 0 }}
            aria-label="This is a publicly listed company"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: isPubliclyListedOverride ? "#1a6b56" : "#1a3a4a" }}>
              🏛 This is a publicly listed company
            </div>
            <div style={{ fontSize: 12, marginTop: 2, color: isPubliclyListedOverride ? "#1a6b56" : "#1a3a4a70" }}>
              {isPubliclyListedOverride
                ? "✓ Stakeholder compliance details will not be collected on the next page"
                : "Check this box to skip detailed stakeholder forms on the next page"}
            </div>
          </div>
          {isPubliclyListedOverride && (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1a6b56", background: "#f3faf8", border: "1px solid #4a9e8e", borderRadius: 99, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>
              Listed ✓
            </span>
          )}
        </div>
      )}

      {(stakeholderFound.length > 0 || stakeholderRegular.length > 0) && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>People Found</h3>
          <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>
            Directors and beneficial owners we identified from official sources. Verify each name; you'll provide additional compliance details on the next page.
          </p>
          {stakeholderFound.map(({ item, idx }) => renderStakeholderConfirmSection(item, idx))}
          {stakeholderRegular.map(({ item, idx }) => renderStakeholderFallback(item, idx))}
        </div>
      )}

      {trueRegular.length > 0 && renderUnifiedFoundTable(trueRegular, "Pre-filled Fields", "Documents → Official sources → Unverified web. Tier-2 rows carry an inline warning.")}

      {(research.found || []).filter((_, i) => !checks[i]).length > 0 && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fff8ed", borderRadius: 6, fontSize: 12, color: "#b07d10", borderLeft: "3px solid #e0a040" }}>
          ⚠️ {(research.found || []).filter((_, i) => !checks[i]).length} field(s) unchecked — will appear on next page for correction.
        </div>
      )}
    </>
  );

  const preboardingBanner = (icon, title, subtitle) => (
    <div style={{ padding: "12px 16px", background: "#F3F0FF", border: "1px solid #DDD6FE", borderRadius: 10, marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#7C3AED" }}>{title}</div>
        <div style={{ fontSize: 12, color: "#7C3AED", opacity: 0.8, marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>
        🔒 Analyst View
      </div>
    </div>
  );

  // Kept for reference — replaced by unified dossier view (June 2026).
  // No longer routed; pre-boarding goes Company → Research → Dossier.
  // eslint-disable-next-line no-unused-vars
  const renderPreboardingConfirm = () => (
    <div>
      <div style={card}>
        {preboardingBanner("🔍", "Pre-boarding Intelligence Review", "Review what we found. Uncheck anything that needs further investigation or clarification.")}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#7C3AED,#6D28D9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🔍</div>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{research.companyName || companyName} {jurisdictionBadge}{entityBadge}</h2>
            <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>
              {sortedFound.length} fields pre-filled · {docCount} from documents · {tier1Count} from official sources
            </p>
          </div>
        </div>
      </div>

      {renderConfirmFields()}

      <button
        onClick={() => { scrollAndSetStep(STEPS.fillGaps); setError(""); }}
        style={{ width: "100%", padding: "14px 0", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", marginTop: 24 }}
      >
        Review Gaps →
      </button>
    </div>
  );

  // Gap fields grouped by section, in the same order onboarding uses.
  const getGapSections = () =>
    gapSectionOrder()
      .filter((key) => key !== "documents")
      .map((key) => {
        const fields = getCombinedGaps().filter((g) => g.section === key).filter(dependsOnSatisfied);
        if (fields.length === 0) return null;
        const cfg = sectionConfig[key] || {};
        return { name: key, label: cfg.title || humaniseSection(key), fields };
      })
      .filter(Boolean);

  // Gap fields the analyst is still requesting (not excluded). Used in dossier.
  const getIncludedGapFields = () =>
    getCombinedGaps()
      .filter((g) => g.section !== "documents")
      .filter(dependsOnSatisfied)
      .filter((g) => !excludedGapFields.has(g.field))
      .map((g) => g.field);

  // Single gap field input — reuses the exact StableInput the onboarding fill
  // gaps step renders (label + input).
  const renderGapField = (field) => (
    <StableInput
      id={field.field}
      label={field.label}
      type={field.inputType}
      value={gapRef.current[field.field] || ""}
      onUpdate={updateGap}
      required={field.required}
      options={field.options}
      placeholder={field.placeholder || ("Enter " + String(field.label || "").toLowerCase())}
    />
  );

  const renderCustomQuestion = (question) => (
    <div
      key={question.id}
      style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12, padding: "12px 14px", background: "#F3F0FF", border: "1px solid #DDD6FE", borderRadius: 8 }}
    >
      <input type="checkbox" checked readOnly style={{ width: 16, height: 16, marginTop: 3, flexShrink: 0, accentColor: "#7C3AED" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#7C3AED" }}>{question.question}</span>
          {question.required && <span style={{ fontSize: 11, color: C.error }}>*</span>}
          <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.3px" }}>Custom</span>
        </div>
        <div style={{ fontSize: 11, color: "#7C3AED", opacity: 0.7 }}>
          Answer type: {question.fieldType}
          {question.options?.length > 0 && ` · Options: ${question.options.join(", ")}`}
        </div>
      </div>
      <button
        onClick={() => setCustomQuestions((prev) => prev.filter((q) => q.id !== question.id))}
        style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px", flexShrink: 0 }}
        title="Remove question"
      >
        ×
      </button>
    </div>
  );

  const renderAskMorePanel = (sectionName) => (
    <div style={{ marginTop: 12, padding: "16px", background: "#F3F0FF", border: "1.5px solid #7C3AED", borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED", marginBottom: 12 }}>
        Add a custom question to this section
      </div>

      <div style={{ marginBottom: 10 }}>
        <StableInput
          id={`pb_q_text_${sectionName}`}
          label="Question *"
          type="text"
          value={newQuestion.text}
          onUpdate={(_, v) => setNewQuestion((prev) => ({ ...prev, text: v }))}
          placeholder="e.g. Please provide your primary banking relationship"
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#7C3AED", marginBottom: 4 }}>Answer type</label>
        <select
          value={newQuestion.fieldType}
          onChange={(e) => setNewQuestion((prev) => ({ ...prev, fieldType: e.target.value }))}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #DDD6FE", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", cursor: "pointer" }}
        >
          <option value="text">Text (free form)</option>
          <option value="yesno">Yes / No</option>
          <option value="date">Date</option>
          <option value="number">Number</option>
          <option value="select">Select (multiple choice)</option>
          <option value="textarea">Long text</option>
        </select>
      </div>

      {newQuestion.fieldType === "select" && (
        <div style={{ marginBottom: 10 }}>
          <StableInput
            id={`pb_q_opts_${sectionName}`}
            label="Options (comma separated)"
            type="text"
            value={newQuestion.options}
            onUpdate={(_, v) => setNewQuestion((prev) => ({ ...prev, options: v }))}
            placeholder="Option 1, Option 2, Option 3"
          />
        </div>
      )}

      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}
        onClick={() => setNewQuestion((prev) => ({ ...prev, required: !prev.required }))}
      >
        <input type="checkbox" checked={newQuestion.required} onChange={() => {}} style={{ accentColor: "#7C3AED", width: 14, height: 14 }} />
        <span style={{ fontSize: 12, color: "#7C3AED", fontWeight: 500 }}>Required field</span>
      </div>

      <button
        onClick={() => {
          if (!newQuestion.text.trim()) return;
          const question = {
            id: Math.random().toString(36).slice(2, 10),
            section: sectionName,
            question: newQuestion.text.trim(),
            fieldType: newQuestion.fieldType,
            required: newQuestion.required,
            options: newQuestion.fieldType === "select"
              ? newQuestion.options.split(",").map((o) => o.trim()).filter(Boolean)
              : [],
            addedAt: new Date().toISOString(),
            source: "analyst",
          };
          setCustomQuestions((prev) => [...prev, question]);
          setNewQuestion({ text: "", fieldType: "text", required: true, options: "" });
          setAskMoreOpenSection(null);
        }}
        disabled={!newQuestion.text.trim()}
        style={{ padding: "9px 20px", background: newQuestion.text.trim() ? "#7C3AED" : C.border, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: newQuestion.text.trim() ? "pointer" : "not-allowed" }}
      >
        Add question
      </button>
    </div>
  );

  const renderAskMoreButton = (sectionName) => {
    const isOpen = askMoreOpenSection === sectionName;
    return (
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => setAskMoreOpenSection(isOpen ? null : sectionName)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "transparent", color: "#7C3AED", border: "1.5px dashed #7C3AED", borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s" }}
        >
          <span>{isOpen ? "✕" : "+"}</span>
          {isOpen ? "Cancel" : "Ask for more information"}
        </button>
        {isOpen && renderAskMorePanel(sectionName)}
      </div>
    );
  };

  const renderPreboardingGapSections = () => {
    const sections = getGapSections();
    if (sections.length === 0) {
      return <div style={{ padding: "16px", color: C.textMuted, fontSize: 13 }}>No outstanding gaps — every required field was found.</div>;
    }
    return sections.map((section) => {
      const selectedCount = section.fields.filter((f) => !excludedGapFields.has(f.field)).length;
      return (
        <div key={section.name} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid #DDD6FE", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{section.label || section.name}</span>
            <span style={{ fontSize: 10, color: "#7C3AED", opacity: 0.6, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {selectedCount} of {section.fields.length} selected
            </span>
          </div>

          {section.fields.map((field) => {
            const isExcluded = excludedGapFields.has(field.field);
            return (
              <div key={field.field} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12, opacity: isExcluded ? 0.45 : 1, transition: "opacity 0.15s" }}>
                <input
                  type="checkbox"
                  checked={!isExcluded}
                  onChange={() => {
                    setExcludedGapFields((prev) => {
                      const next = new Set(prev);
                      if (next.has(field.field)) next.delete(field.field);
                      else next.add(field.field);
                      return next;
                    });
                  }}
                  style={{ width: 16, height: 16, marginTop: 3, flexShrink: 0, accentColor: "#7C3AED", cursor: "pointer" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ pointerEvents: isExcluded ? "none" : "auto" }}>
                    {renderGapField(field)}
                  </div>
                  {isExcluded && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 11, fontWeight: 600, color: C.textMuted, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 99, padding: "2px 8px" }}>
                      ✕ Not requesting
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {customQuestions.filter((q) => q.section === section.name).map((q) => renderCustomQuestion(q))}

          {renderAskMoreButton(section.name)}
        </div>
      );
    });
  };

  // Kept for reference — replaced by unified dossier view (June 2026).
  // No longer routed; exclude checkboxes + ask-for-more now live inline in the
  // Customer Request section of renderDossierView().
  // eslint-disable-next-line no-unused-vars
  const renderPreboardingFillGaps = () => (
    <div>
      <div style={card}>
        {preboardingBanner("📋", "Gap Analysis — What We Still Need", "Check the fields you want to request from the customer. Uncheck to exclude. Add custom questions using the button below each section.")}
      </div>

      <div style={card}>
        {renderPreboardingGapSections()}
      </div>

      <button
        onClick={() => saveDossier()}
        style={{ width: "100%", padding: "14px 0", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", marginTop: 24 }}
      >
        Generate Customer Request →
      </button>
    </div>
  );

  // ─── Pre-boarding dossier (Part 7) ───────────────────────────────────────

  // Resolve a field id → human label from the active schema.
  const getFieldLabel = (fieldId) => {
    if (!fieldId) return fieldId;
    const allFields = [
      ...((activeSchema && activeSchema.researchFields) || []),
      ...((activeSchema && activeSchema.gapFields) || []),
    ];
    const def = allFields.find((f) => f.field === fieldId || f.id === fieldId);
    return (def && def.label) || fieldId;
  };

  // The company identity object used across the dossier.
  const dossierCompany = () => ({
    name: research?.companyName || companyName,
    code: countryCode,
    countryName: countryObj ? countryObj.name : countryCode,
  });

  // Gap field objects the analyst is still requesting (not excluded).
  const includedGapFieldObjs = () =>
    getCombinedGaps()
      .filter((g) => g.section !== "documents")
      .filter(dependsOnSatisfied)
      .filter((g) => !excludedGapFields.has(g.field));

  // Every candidate gap field (excluded or not) — the interactive Customer
  // Request list in the dossier renders all of these so the analyst can toggle
  // exclusions in place.
  const allRequestableGapFields = () =>
    getCombinedGaps()
      .filter((g) => g.section !== "documents")
      .filter(dependsOnSatisfied);

  // Manual upload for registry documents that are behind a captcha and cannot
  // be retrieved automatically. The analyst downloads the document by hand from
  // the registry, then uploads it here to bring it back into the dossier.
  // Registry docs live in `selfSourceResults.results` (no stable id field), so
  // we key by array index.
  async function handleManualDocumentUpload(event, idx) {
    const file = event.target.files[0];
    if (!file) return;

    // Reset the input up-front (before the await) so the same file can be
    // re-selected after a Remove and we don't touch a reused event later.
    event.target.value = "";

    // PR-034 — upload to Vercel Blob immediately and persist the permanent URL
    // rather than an ephemeral browser blob: URL (which does not survive a page
    // reload). The ephemeral URL is kept only as a local fallback for preview if
    // the upload fails.
    const localUrl = URL.createObjectURL(file);
    let blobUrl = null;
    // Store path within the Blob store, returned since the private-write fix.
    // Persisted alongside the URL (raw_research JSONB — no migration) because
    // signed-URL retrieval is keyed by pathname and addRandomSuffix makes it
    // unreconstructable. Null for uploads made before that change.
    let blobPathname = null;
    let uploadFailed = false;
    let filename = file.name;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/upload-document", { method: "POST", body: fd });
      if (!resp.ok) throw new Error("Upload failed: " + resp.status);
      const data = await resp.json();
      if (!data.blobUrl) throw new Error(data.error || "No blobUrl returned");
      blobUrl = data.blobUrl;
      blobPathname = data.pathname || null;
      filename = data.filename || file.name;
    } catch (err) {
      // Fall back to the ephemeral URL + a flag so the UI can warn rather than
      // silently lose the file.
      uploadFailed = true;
    }

    setSelfSourceResults((prev) => {
      if (!prev) return prev;
      const results = (prev.results || []).map((doc, i) =>
        i === idx
          ? {
              ...doc,
              status: "manually_uploaded",
              manualUploadFile: file,
              manualUploadName: filename,
              // Permanent Vercel Blob URL on success; ephemeral fallback on
              // failure (uploadFailed flags the UI to warn).
              manualUploadUrl: blobUrl || localUrl,
              manualUploadBlobUrl: blobUrl,
              manualUploadPathname: blobPathname,
              manuallyUploaded: true,
              uploadFailed,
              manualUploadAt: new Date().toISOString(),
            }
          : doc
      );
      return { ...prev, results };
    });
  }

  function handleManualDocumentRemove(idx) {
    setSelfSourceResults((prev) => {
      if (!prev) return prev;
      const results = (prev.results || []).map((doc, i) =>
        i === idx
          ? {
              ...doc,
              // captchaBlocked stays true, so the "Behind captcha" UI re-appears.
              status: "manual_retrieval_required",
              manualUploadFile: null,
              manualUploadName: null,
              manualUploadUrl: null,
              manualUploadAt: null,
            }
          : doc
      );
      return { ...prev, results };
    });
  }

  // PR-034 / PR-044 — Authority-to-act upload. Upload to Vercel Blob on file
  // selection and store the permanent URL rather than holding the raw File (an
  // ephemeral, non-persistable reference) in session state. A failed upload
  // still stores the file metadata with uploadFailed:true so the analyst is
  // alerted, but the customer is never blocked from continuing the journey.
  async function handleAuthorityToActUpload(file) {
    if (!file) return;
    let blobUrl = null;
    let uploadFailed = false;
    let filename = file.name;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/upload-document", { method: "POST", body: fd });
      if (!resp.ok) throw new Error("Upload failed: " + resp.status);
      const data = await resp.json();
      if (!data.blobUrl) throw new Error(data.error || "No blobUrl returned");
      blobUrl = data.blobUrl;
      filename = data.filename || file.name;
    } catch (err) {
      uploadFailed = true;
    }
    // Keep .name/.size so the DocumentUploadCard renders the uploaded state and
    // the gate (truthy = satisfied) still passes even when the upload failed.
    setAuthorityToActFile({ name: filename, size: file.size, filename, blobUrl, uploadFailed });
  }

  // PR-072 — Applicant-page Signatory ID upload. Mirrors
  // handleAuthorityToActUpload exactly (session-hold via /api/upload-document,
  // keep .name/.size so truthy = gate satisfied even on upload failure). This is
  // a SEPARATE slot from the Required Docs Signatory ID upload — they do not
  // cross-satisfy. "One-upload-satisfies-both" is a possible later enhancement.
  async function handleSignatoryIdUpload(file) {
    if (!file) return;
    let blobUrl = null;
    let uploadFailed = false;
    let filename = file.name;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/upload-document", { method: "POST", body: fd });
      if (!resp.ok) throw new Error("Upload failed: " + resp.status);
      const data = await resp.json();
      if (!data.blobUrl) throw new Error(data.error || "No blobUrl returned");
      blobUrl = data.blobUrl;
      filename = data.filename || file.name;
    } catch (err) {
      uploadFailed = true;
    }
    setSignatoryIdFile({ name: filename, size: file.size, filename, blobUrl, uploadFailed });
  }

  const buildDossierPayload = () => {
    const found = research?.found || [];
    const mapItem = (r) => ({
      fieldId: r.field,
      field: r.field,
      label: getFieldLabel(r.field),
      value: r.value,
      source: r.source,
      sourceUrl: r.sourceUrl,
      sourceTier: r.sourceTier,
    });
    const verifiedData = found.filter((r) => r.verificationStatus === "verified").map(mapItem);
    const probableData = found.filter((r) => r.verificationStatus === "probable").map(mapItem);
    const indicativeData = found.filter((r) => r.verificationStatus === "indicative").map(mapItem);

    const stakeholderData = {};
    found.filter((r) => isStakeholderField(r.field)).forEach((r) => {
      stakeholderData[r.field] = r.stakeholders || [];
    });

    const costSummary = buildCostSummary(costTracker, dossierCompany(), entityType, ownershipType, coverage || null);

    // Registry documents the analyst manually uploaded (captcha-blocked docs
    // that couldn't be auto-sourced). Fold them into required_documents.
    // TODO(PR-034 — Vercel Blob): when blob storage is built, upload
    // `manualUploadFile` to Vercel Blob *here* and persist the permanent
    // `blobUrl` instead of the ephemeral `manualUploadUrl` (a browser-memory
    // blob: URL that does not survive a page reload).
    const manuallyUploadedDocs = (selfSourceResults?.results || [])
      .filter((d) => d.status === "manually_uploaded")
      .map((d) => {
        // Drop the non-serializable File object before persisting.
        const rest = { ...d };
        delete rest.manualUploadFile;
        return {
          ...rest,
          status: "manually_uploaded",
          filename: d.manualUploadName,
          sourceUrl: d.manualUploadUrl || null,
          manuallyUploaded: true,
          uploadedAt: d.manualUploadAt,
        };
      });

    // Registration number carried onto the dossier for slice 2's confirmation
    // gate. Provenance distinguishes a customer-typed number (trusted) from a
    // system-retrieved one (shown for verification), and is taken from the
    // EXPLICIT `regNumberSource` flag — not inferred from the string — so a
    // number restored from a loaded dossier (source null) is never re-persisted
    // as "customer". A system-retrieved number, when present, already lives in
    // the research output as the `registration_number` found field, so slice 2
    // can reconcile the two.
    const trimmedRegNumber = regNumber.trim();
    const registrationNumber = trimmedRegNumber || null;
    const registrationNumberSource =
      trimmedRegNumber && regNumberSource === "customer" ? "customer" : null;

    return {
      tenantId,
      company: dossierCompany(),
      entityType,
      ownershipType,
      // Top-level for in-session reads (slice 2 gate). Also folded into
      // rawResearch below so it survives a reload via the existing raw_research
      // JSONB column without a schema migration.
      registrationNumber,
      registrationNumberSource,
      coverage,
      includedFields: getIncludedGapFields(),
      excludedFields: Array.from(excludedGapFields),
      customQuestions,
      verifiedData,
      probableData,
      indicativeData,
      stakeholders: stakeholderData,
      requiredDocuments: [...(docSearchResults?.documents || []), ...manuallyUploadedDocs],
      costSummary,
      // Bug 2 — fold ephemeral self-source results (incl. results[].files[]) into
      // the persisted rawResearch so the registry section + "Sourced automatically"
      // banners survive dossier → onboarding. Uses the existing raw_research JSONB
      // column — no new column, no migration.
      // PR-071 — also fold amendment-document uploads (permanent Vercel Blob
      // URLs from /api/upload-document) into rawResearch so they survive the
      // dossier round-trip. Reuses the raw_research JSONB column — no migration.
      // PR-043 — also fold docSearchResults (annual report / Wolfsberg internet
      // research docs) into rawResearch so the unified Documents Sourced panel
      // still shows them after a dossier → onboarding reload. Mirrors the
      // selfSourceResults persistence above; reuses the raw_research JSONB column.
      rawResearch: { found: research?.found || [], timestamp: researchTimestamp, registrationNumber, registrationNumberSource, selfSourceResults, amendmentUploads, docSearchResults },
      // Self-serve re-research audit data: who triggered the search that produced
      // this dossier, and the carried search-attempt count (migration 008).
      seededBy,
      searchAttempts: seededBy === "customer" ? Math.max(1, searchAttempts) : 1,
    };
  };

  const saveDossier = async () => {
    setDossierSaving(true);
    const payload = buildDossierPayload();
    // eslint-disable-next-line no-console
    console.log("PRE_BOARDING_DOSSIER", JSON.stringify(payload, null, 2));

    let savedId = null;
    try {
      const response = await fetch("/api/save-dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (result.dossierId) {
        savedId = result.dossierId;
        setDossierId(result.dossierId);
        setDossierSaved(true);
        // eslint-disable-next-line no-console
        console.log(`[Dossier] ✅ Saved: ${result.dossierId}`);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[Dossier] ⚠ Save failed:", result.warning);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Dossier] ❌", err);
    }

    setDossierSaving(false);
    setShowDossierView(true);

    trackEvent("dossier_generated", {
      dossierId: savedId,
      companyName: dossierCompany().name,
      verifiedFields: coverage?.verifiedFields || 0,
      totalToRequest: includedGapFieldObjs().length + customQuestions.length,
      customQuestionsAdded: customQuestions.length,
      excludedFields: excludedGapFields.size || 0,
      costUsd: payload.costSummary?.totals?.totalCostUsd || null,
    });
  };

  // Interactive Customer Request — each gap field carries an exclude checkbox
  // (strike-through + "✕ Excluded" badge when off), custom questions can be
  // removed, and "Ask for more" adds analyst questions inline. `allFields` is
  // the full candidate list (excluded or not); the live count reflects only
  // active (non-excluded) fields plus custom questions.
  const renderCustomerRequestSection = (allFields, qs) => {
    if (allFields.length === 0 && qs.length === 0) {
      return (
        <div style={{ padding: "16px", background: C.successBg, border: `1px solid ${C.successBorder}`, borderRadius: 10, marginBottom: 16, fontSize: 13, color: C.success, fontWeight: 600 }}>
          ✅ No fields to request — all information was collected automatically.
        </div>
      );
    }
    const activeRequestCount =
      allFields.filter((f) => !excludedGapFields.has(f.field)).length + qs.length;
    return (
      <div style={{ marginBottom: 16, borderRadius: 10, border: "1px solid #DDD6FE", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: "#F3F0FF", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#7C3AED" }}>📋 Customer Request</span>
            <span style={{ fontSize: 12, color: "#7C3AED", opacity: 0.7, marginLeft: 8 }}>
              {activeRequestCount} question{activeRequestCount !== 1 ? "s" : ""} will be sent to the customer
            </span>
          </div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          {allFields.map((field, i) => {
            const isExcluded = excludedGapFields.has(field.field);
            return (
              <div
                key={field.field}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: i < allFields.length - 1 || qs.length > 0 ? "1px solid #EDE9FE" : "none",
                  opacity: isExcluded ? 0.4 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {/* Exclude checkbox */}
                <input
                  type="checkbox"
                  checked={!isExcluded}
                  onChange={() => {
                    setExcludedGapFields((prev) => {
                      const next = new Set(prev);
                      if (next.has(field.field)) next.delete(field.field);
                      else next.add(field.field);
                      return next;
                    });
                  }}
                  style={{ width: 15, height: 15, accentColor: "#7C3AED", cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: isExcluded ? C.textMuted : C.text, flex: 1, textDecoration: isExcluded ? "line-through" : "none" }}>
                  {field.label}
                </span>
                {field.required && !isExcluded && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.error, flexShrink: 0 }}>Required</span>
                )}
                {isExcluded && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 99, padding: "1px 6px", flexShrink: 0 }}>
                    ✕ Excluded
                  </span>
                )}
              </div>
            );
          })}
          {qs.map((q, i) => (
            <div
              key={q.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < qs.length - 1 ? "1px solid #EDE9FE" : "none" }}
            >
              <input type="checkbox" checked readOnly style={{ width: 15, height: 15, accentColor: "#7C3AED", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#4C1D95", flex: 1, fontWeight: 500 }}>{q.question}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "2px 6px", flexShrink: 0 }}>Custom</span>
              {/* Remove button */}
              <button
                onClick={() => setCustomQuestions((prev) => prev.filter((cq) => cq.id !== q.id))}
                style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16, padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                title="Remove question"
              >
                ×
              </button>
            </div>
          ))}
          {/* Ask for more — inline in dossier. Section "customer_request" is the
              bucket for all questions added from the dossier view. */}
          <div style={{ marginTop: 12 }}>
            {renderAskMoreButton("customer_request")}
          </div>
        </div>
      </div>
    );
  };

  const renderDossierStakeholders = (stakeholderResults) => (
    <div style={{ marginBottom: 16, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", background: C.surfaceAlt, fontSize: 14, fontWeight: 700, color: C.text }}>👥 Stakeholders Found</div>
      <div style={{ padding: "12px 16px" }}>
        {stakeholderResults.map((result) => {
          const realStakeholders = (result.stakeholders || []).filter((s) => !isRegistryExemptionNotice(s));
          if (realStakeholders.length === 0) return null;
          const fieldId = result.field;
          const isUBO = String(fieldId).includes("ubo") || String(fieldId).includes("beneficial");
          return (
            <div key={fieldId} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6 }}>
                {isUBO ? "Beneficial Owners" : "Directors / Officers"}
              </div>
              {realStakeholders.map((s) => {
                const positions = (s.positions || []).filter((p) => p && p.title);
                // Detail chips mirroring the Fill Gaps stakeholder card: role,
                // shareholding, nationality, DOB, positions, PEP status. Only
                // render what the registry actually returned.
                const details = s.is_company
                  ? [
                      s.role,
                      s.share_percentage != null ? `${formatShareholding(s.share_percentage)} shareholding` : null,
                      s.business_registration_number ? `Reg: ${s.business_registration_number}` : null,
                      s.registered_country ? `Registered in ${s.registered_country}` : null,
                      ...positions.map((p) => p.start_date ? `${p.title} (since ${p.start_date})` : p.title),
                    ].filter(Boolean)
                  : [
                      s.role,
                      s.share_percentage != null ? `${formatShareholding(s.share_percentage)} shareholding` : null,
                      s.nationality ? `Nationality: ${s.nationality}` : null,
                      formatDOBForDisplay(s.date_of_birth) || s.date_of_birth ? `DOB: ${formatDOBForDisplay(s.date_of_birth) || s.date_of_birth}` : null,
                      s.residential_country ? `Residence: ${s.residential_country}` : null,
                      s.is_pep === true ? "⚑ PEP" : s.is_pep === false ? "PEP: No" : null,
                    ].filter(Boolean);
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ marginTop: 1 }}>{s.is_company ? "🏢" : "👤"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.full_name}</span>
                      {s.sharePercentageWarning && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: "#92400E",
                          background: "#FEF3C7", border: "1px solid #FCD34D",
                          borderRadius: 4, padding: "1px 6px", marginLeft: 6,
                        }}>
                          ⚠ Verify band
                        </span>
                      )}
                      {details.length > 0 && (
                        <div style={{ fontSize: 12, color: C.textSec, marginTop: 3, lineHeight: 1.5 }}>
                          {details.join(" · ")}
                        </div>
                      )}
                      {s.is_pep === true && s.pep_details && (
                        <div style={{ fontSize: 11, color: C.warning, marginTop: 2 }}>{s.pep_details}</div>
                      )}
                    </div>
                    {s.source && <span style={{ fontSize: 11, color: C.success, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>✓ {s.source}</span>}
                  </div>
                );
              })}
            </div>
          );
        }).filter(Boolean)}
      </div>
    </div>
  );

  const renderDossierDocuments = () => {
    const docs = (docSearchResults?.documents || []).filter((d) => d.status === "downloaded" || d.status === "url_found");
    // Registry documents retrieved by the self-source agent (Companies House /
    // ACRA / etc.) — these were previously only shown on the Documents step.
    const registryDocs = (selfSourceResults?.results || []).filter(
      (r) => r.status === "retrieved" || r.status === "retrieved_unverified" || r.manualReviewFlag || r.status === "manual_retrieval_required"
    );
    if (docs.length === 0 && registryDocs.length === 0) return null;
    return (
      <div style={{ marginBottom: 16, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.surfaceAlt, fontSize: 14, fontWeight: 700, color: C.text }}>📄 Documents Sourced</div>
        <div style={{ padding: "12px 16px" }}>
          {docs.map((doc, i) => (
            <div key={doc.type || i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: (i < docs.length - 1 || registryDocs.length > 0) ? `1px solid ${C.border}` : "none" }}>
              <span>{doc.type === "wolfsberg_questionnaire" ? "📋" : "📊"}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{doc.label || doc.type}</span>
                {doc.year && <span style={{ fontSize: 12, color: C.textSec, marginLeft: 8 }}>{doc.year}</span>}
              </div>
              {doc.sourceUrl && (
                <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.niumBlue, fontWeight: 600, textDecoration: "none" }}>View →</a>
              )}
            </div>
          ))}
          {registryDocs.map((item, i) => {
            const url = item.searchUrl || item.sourceUrl;
            const retrieved = item.status === "retrieved" || item.status === "retrieved_unverified";
            const ts = formatFetchedAt(item.retrievedAt);
            const hasSnapshot = Array.isArray(item.files) && item.files.length > 0;
            return (
              <div key={`reg-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: i < registryDocs.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <span style={{ marginTop: 1 }}>🏛️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.localEquivalent || item.requirement}</span>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {item.sourceLabel || item.requirement}
                    {!retrieved && <span style={{ color: C.warning, fontWeight: 600 }}> · ⚠ manual retrieval required</span>}
                    {ts && <span> · 🕒 {ts}</span>}
                    {hasSnapshot && retrieved && <span> · 📸 snapshot captured</span>}
                  </div>
                </div>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.niumBlue, fontWeight: 600, textDecoration: "none", flexShrink: 0 }}>View →</a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDossierView = () => {
    const found = research?.found || [];
    const verifiedItems = found.filter((r) => r.verificationStatus === "verified");
    const probableItems = found.filter((r) => r.verificationStatus === "probable");
    const indicativeItems = found.filter((r) => r.verificationStatus === "indicative");
    const includedFields = includedGapFieldObjs();
    const allGapFields = allRequestableGapFields();
    const stakeholderResults = found.filter((r) => isStakeholderField(r.field) && r.stakeholders?.length > 0);
    const company = dossierCompany();

    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 20px 60px", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: C.text }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", background: "#F3F0FF", border: "1px solid #DDD6FE", borderRadius: 12, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>🔍</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.8px" }}>Intelligence Dossier</span>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#4C1D95", margin: "0 0 4px 0" }}>{company.name}</h1>
              <div style={{ fontSize: 13, color: "#7C3AED", opacity: 0.8 }}>
                {company.countryName}
                {entityType && ` · ${entityType}`}
                {ownershipType && ` · ${(OWNERSHIP_TYPE_LIBRARY.find((o) => o.id === ownershipType)?.label || ownershipType)}`}
              </div>
              <div style={{ fontSize: 11, color: "#7C3AED", opacity: 0.6, marginTop: 4 }}>
                {dossierId && `ID: ${String(dossierId).slice(0, 8)}…`}
              </div>
            </div>
            {/* Save state — the dossier auto-saves on research complete, so by
                the time the analyst lands here it is normally already saved.
                After adjusting exclusions / questions, "Update" re-saves with
                the current state. */}
            <div style={{ flexShrink: 0 }}>
              {dossierSaving && (
                <span style={{ fontSize: 12, color: "#7C3AED", fontStyle: "italic" }}>
                  Saving dossier…
                </span>
              )}

              {!dossierSaving && dossierSaved && dossierId && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", border: "1px solid #DDD6FE", borderRadius: 99, padding: "3px 10px" }}>
                    ✓ Dossier Saved
                  </span>
                  <button
                    onClick={() => {
                      setDossierSaved(false);
                      setDossierId(null);
                      saveDossier();
                    }}
                    disabled={dossierSaving}
                    style={{ fontSize: 11, color: "#7C3AED", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}
                  >
                    Update
                  </button>
                </div>
              )}

              {!dossierSaving && !dossierSaved && (
                <button
                  onClick={() => saveDossier()}
                  style={{ padding: "8px 16px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
                >
                  💾 Save Dossier
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Coverage summary */}
        {coverage && (
          <div style={{ display: "flex", gap: 0, marginBottom: 24, borderRadius: 10, border: "1px solid #DDD6FE", overflow: "hidden" }}>
            {[
              { count: coverage.verifiedFields || 0, label: "Verified", bg: C.successBg, color: C.success, border: C.successBorder },
              { count: coverage.probableFields || 0, label: "Probable", bg: C.warningBg, color: C.warning, border: C.warningBorder },
              { count: coverage.indicativeFields || 0, label: "Indicative", bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA" },
              { count: includedFields.length + customQuestions.length, label: "To Request", bg: "#F3F0FF", color: "#7C3AED", border: "#DDD6FE" },
            ].map((tile, i) => (
              <div key={i} style={{ flex: 1, padding: "14px 12px", background: tile.bg, borderRight: i < 3 ? `1px solid ${tile.border}` : "none", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: tile.color, lineHeight: 1 }}>{tile.count}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: tile.color, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{tile.label}</div>
              </div>
            ))}
          </div>
        )}

        <DossierSection title="✅ Verified" subtitle={`${verifiedItems.length} fields from official sources`} items={verifiedItems} bg={C.successBg} borderColor={C.successBorder} color={C.success} getLabel={getFieldLabel} fallbackTs={researchTimestamp} />
        {probableItems.length > 0 && <DossierSection title="~ Probable" subtitle={`${probableItems.length} fields from company sources`} items={probableItems} bg={C.warningBg} borderColor={C.warningBorder} color={C.warning} getLabel={getFieldLabel} fallbackTs={researchTimestamp} />}
        {indicativeItems.length > 0 && <DossierSection title="⚠ Indicative" subtitle={`${indicativeItems.length} fields from unverified sources`} items={indicativeItems} bg="#FFF7ED" borderColor="#FED7AA" color="#C2410C" getLabel={getFieldLabel} fallbackTs={researchTimestamp} />}

        {renderCustomerRequestSection(allGapFields, customQuestions)}
        {stakeholderResults.length > 0 && renderDossierStakeholders(stakeholderResults)}
        {renderDossierDocuments()}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <button
              onClick={async () => {
                // The dossier is the source of truth: always fetch fresh from the
                // DB and reconstruct full research state (raw_research.found,
                // schema, coverage, stakeholders) rather than relying on in-memory
                // state — whether Preview is clicked immediately or hours later.
                // loadDossierAndStartOnboarding handles agentType/step/navigation.
                if (!dossierId) {
                  // eslint-disable-next-line no-console
                  console.warn("[Preview] No dossierId — cannot load from DB");
                  return;
                }
                await loadDossierAndStartOnboarding(dossierId, tenantId);
                trackEvent("preboarding_to_onboarding", {
                  dossierId,
                  via: "preview_button",
                  companyName: company.name,
                  includedFields: includedFields.length,
                  customQuestions: customQuestions.length,
                });
              }}
              style={{
                padding: '10px 20px',
                background: '#fff',
                color: '#1a3a4a',
                border: '2px dashed #1a3a4a',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: 0.85,
              }}
            >
              🧪 Preview Customer Onboarding
            </button>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              See exactly what your customer will see
            </div>
          </div>
          <button
            onClick={() => setShowInviteScreen(true)}
            style={{
              padding: '10px 20px',
              background: '#1a3a4a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            ✉ Invite Customer to Onboard
          </button>
          <button
            onClick={() => {
              // Start a genuinely fresh dossier. Clearing research is essential:
              // the auto-save effect watches research?.found, so leaving it
              // populated would immediately re-save and bounce back here.
              // (preboardingUnlocked is left intact — no re-prompting the gate.)
              setShowDossierView(false);
              setDossierId(null);
              setDossierSaved(false);
              setResearch(null);
              setActiveSchema(null);
              setCoverage(null);
              setExcludedGapFields(new Set());
              setCustomQuestions([]);
              setAskMoreOpenSection(null);
              gapRef.current = {};
              setFormVersion((v) => v + 1);
              setCompanyName("");
              setEntityType("");
              setOwnershipType("");
              setCountryCode("");
              setError("");
              setStep(0);
              trackEvent("preboarding_new_dossier", { previousDossierId: dossierId });
            }}
            style={{ padding: "14px 24px", background: "transparent", color: "#7C3AED", border: "1.5px solid #7C3AED", borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}
          >
            + New Dossier
          </button>
        </div>
      </div>
    );
  };

  function renderInviteScreen() {
    const companyDisplayName = research?.companyName || companyName || 'the company';

    function generateLink() {
      const base = window.location.origin;
      // Preferred: a dossier-backed link. `?dossierId=&journey=customer` lands
      // the customer on the standalone Applicant page; the mount effect fetches
      // the dossier server-side (api/get-dossier) and pre-loads company context +
      // research, so this works cross-device (unlike the legacy ?ref snapshot).
      if (dossierId) {
        return `${base}/?tenant=${tenantId}&dossierId=${dossierId}&journey=customer`;
      }
      // Fallback (no saved dossier yet): the legacy `?ref=<token>` link, which
      // rehydrates from a same-browser localStorage snapshot taken at send time.
      const token = btoa(`${companyDisplayName}-${Date.now()}`).replace(/=/g, '');
      return `${base}/?ref=${token}`;
    }

    // Sends the invite for real via /api/invite (Resend). The server generates
    // and persists the authoritative token/link; we fall back to a locally
    // generated link only if the request fails, so the success screen always
    // has a value to show.
    async function handleSendInvite() {
      if (!inviteEmail || !inviteContactName) return;
      let link = generateLink();
      try {
        const resp = await fetch('/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: inviteEmail,
            contactName: inviteContactName,
            companyName: companyDisplayName,
            origin: window.location.origin,
          }),
        });
        const data = await resp.json();
        // Keep the dossier-backed link when we have one; only adopt the
        // server-issued ?ref link in the legacy (no-dossier) fallback path.
        if (!dossierId && data && data.link) link = data.link;
        console.log('Invite dispatched:', { ...data, email: inviteEmail, contactName: inviteContactName });
      } catch (err) {
        console.warn('Invite send failed, using local link:', err);
      }

      // Snapshot the dossier under the link's token so that opening the invite
      // link (`?ref=<token>`) rehydrates the populated Confirm page — the same
      // view "Preview Customer Onboarding" shows. Keyed by the FINAL token
      // (server-issued if available, else the local one) so it matches the
      // link that actually went out. See the mount effect that reads this.
      const finalToken = (link.split('ref=')[1] || '').split('&')[0];
      if (finalToken) {
        try {
          localStorage.setItem('nium_invite_' + finalToken, JSON.stringify({
            research,
            activeSchema,
            coverage,
            fieldMetadata,
            checks,
            companyName,
            countryCode,
            entityType,
            ownershipType,
            journeyType: journeyType || 'ai_only',
          }));
        } catch (e) {
          console.warn('Could not snapshot dossier for invite link:', e && e.message);
        }
      }

      setInviteLink(link);
      setInviteSent(true);
    }

    const emailBody = `Dear ${inviteContactName || '[Contact Name]'},

Thank you for your interest in Nium. We have begun reviewing your application for ${companyDisplayName} and are ready to proceed with the next step.

Please complete your onboarding by clicking the link below:

${inviteLink || '[Onboarding link will appear here]'}

This link is unique to your application. Once you click it, you will be guided through a short onboarding form. The process typically takes 10–15 minutes.

If you have any questions, please do not hesitate to reach out to your Nium contact.

Best regards,
Nium Onboarding Team`;

    const stepLabels = ['Company Input', 'Research', 'Dossier Review', 'Invite Customer'];

    if (inviteSent) {
      return (
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32, fontSize: 13 }}>
            {stepLabels.map((s, i) => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                  background: '#1a3a4a', color: '#fff'
                }}>✓</span>
                <span style={{ color: i === 3 ? '#1a3a4a' : '#1a3a4a70', fontWeight: i === 3 ? 600 : 400 }}>{s}</span>
                {i < 3 && <span style={{ color: '#ccc' }}>›</span>}
              </span>
            ))}
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
              Invite sent to {inviteContactName}
            </div>
            <div style={{ fontSize: 14, color: '#166534' }}>
              An onboarding invitation has been dispatched to <strong>{inviteEmail}</strong>.
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Onboarding link
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <code style={{
                flex: 1, fontSize: 12, color: '#1a3a4a', wordBreak: 'break-all',
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px'
              }}>
                {inviteLink}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                style={{
                  padding: '8px 14px', background: '#1a3a4a', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap'
                }}
              >
                Copy link
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => {
                setInviteSent(false);
                setInviteEmail('');
                setInviteContactName('');
                setInviteLink('');
              }}
              style={{
                padding: '10px 20px', background: '#fff', color: '#1a3a4a',
                border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer'
              }}
            >
              Send another invite
            </button>
            <button
              onClick={() => setShowInviteScreen(false)}
              style={{
                padding: '10px 20px', background: '#f1f5f9', color: '#1a3a4a',
                border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer'
              }}
            >
              ← Back to dossier
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32, fontSize: 13 }}>
          {stepLabels.map((s, i) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                background: i <= 3 ? '#1a3a4a' : '#e0e0e0',
                color: i <= 3 ? '#fff' : '#999'
              }}>{i < 3 ? '✓' : i + 1}</span>
              <span style={{ color: i === 3 ? '#1a3a4a' : '#1a3a4a70', fontWeight: i === 3 ? 600 : 400 }}>{s}</span>
              {i < 3 && <span style={{ color: '#ccc' }}>›</span>}
            </span>
          ))}
        </div>

        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a3a4a', margin: '0 0 8px' }}>
            Invite customer to onboard
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
            The dossier for <strong>{companyDisplayName}</strong> is ready.
            Send a personalised onboarding link to the customer contact.
          </p>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Contact name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={inviteContactName}
              onChange={e => setInviteContactName(e.target.value)}
              placeholder="e.g. Sarah Chen"
              style={{
                width: '100%', padding: '10px 14px', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 14, color: '#1a3a4a', boxSizing: 'border-box', outline: 'none'
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Customer email address <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="e.g. sarah@company.com"
              style={{
                width: '100%', padding: '10px 14px', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 14, color: '#1a3a4a', boxSizing: 'border-box', outline: 'none'
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
            Email preview
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
              <strong>To:</strong> {inviteEmail || '[customer email]'}
              &nbsp;·&nbsp;
              <strong>Subject:</strong> Your Nium onboarding is ready — {companyDisplayName}
            </div>
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
              <pre style={{
                fontSize: 13, color: '#374151', lineHeight: 1.7,
                margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit'
              }}>
                {emailBody}
              </pre>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={() => setShowInviteScreen(false)}
            style={{
              padding: '10px 20px', background: '#fff', color: '#1a3a4a',
              border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer'
            }}
          >
            ← Back to dossier
          </button>
          <button
            onClick={handleSendInvite}
            disabled={!inviteEmail || !inviteContactName}
            style={{
              padding: '10px 24px',
              background: (!inviteEmail || !inviteContactName) ? '#9ca3af' : '#1a3a4a',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: (!inviteEmail || !inviteContactName) ? 'not-allowed' : 'pointer'
            }}
          >
            ✉ Send invite
          </button>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            Customer receives a unique onboarding link
          </span>
        </div>
      </div>
    );
  }

  // Agent routing — order matters. The existing onboarding flow (the main
  // return below) is reached only when agentType === "onboarding".

  // Check URL for preboarding param
  const preboardingParam =
    new URLSearchParams(
      window.location.search
    ).get("preboarding");

  // Hidden for stakeholder review weekend
  // Restore by re-adding:
  // if (agentType === null) {
  //   return renderLandingPage();
  // }
  if (agentType === null) {
    if (preboardingParam === "1") {
      // Pre-boarding accessed via
      // hidden URL — set agent type
      // and show password gate
      // Do this once on mount
      setAgentType("preboarding");
      return null;
    } else {
      // Everyone else goes straight
      // to onboarding — no landing page
      setAgentType("onboarding");
      return null;
    }
  }
  if (agentType === "preboarding" && !preboardingUnlocked) {
    return renderPreboardingGate();
  }
  // Invite screen is the 4th pre-boarding screen — takes priority over the
  // dossier view when showInviteScreen is set.
  if (agentType === "preboarding" && preboardingUnlocked && showInviteScreen) {
    return renderInviteScreen();
  }
  // Dossier view is the final pre-boarding screen — takes priority over the
  // confirm/fill-gaps render below when showDossierView is set.
  if (agentType === "preboarding" && preboardingUnlocked && showDossierView) {
    return renderDossierView();
  }
  // Pre-boarding (unlocked) and onboarding share the main render below. The
  // pre-boarding flow swaps in its own Confirm / Fill Gaps presentation
  // (gated by agentType) and uses the purple step indicator.

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: "#1a3a4a" }}>
      {inPreview && (
        <PreviewBanner
          missing={previewMissing}
          timestamp={previewTimestamp}
        />
      )}
      {demoMode && <DemoBanner offsetTop={inPreview ? 40 : 0} />}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: `${(inPreview ? 40 : 0) + (demoMode ? 32 : 0) + 24}px 16px 60px` }}>

        <div style={{ textAlign: "center", marginBottom: 8 }}>
          {companyLogo_ ? (
            <img
              src={companyLogo_}
              alt={companyName_ || ""}
              style={{ height: 32, maxWidth: 140, objectFit: "contain", display: "block", margin: "0 auto 6px" }}
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: 9, margin: "0 auto 6px",
              background: "linear-gradient(135deg,#1a3a4a,#4a9e8e)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 18, fontWeight: 800,
            }}>
              {(companyName_ || "N").trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: agentType === "preboarding" ? "#7C3AED" : "#4a9e8e", marginBottom: 4 }}>{companyName_} {agentType === "preboarding" ? "Pre-boarding" : "Compliance"}</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{agentType === "preboarding" ? "Pre-boarding Agent" : "KYC Onboarding Agent"}</h1>
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 0" }}>{agentType === "preboarding" ? "Intelligence-led due diligence — build the entity dossier and customer request before contact" : "AI-powered multi-jurisdiction company research and data collection"}</p>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {(() => {
            const pb = agentType === "preboarding";
            // Pre-boarding is a 3-screen flow: Company → Research → Dossier.
            // Active step maps: input(step 0)→Company, research(step 1)→Research,
            // showDossierView→Dossier (covers the confirm-step window while the
            // dossier auto-saves).
            const pbActive = showDossierView ? 2 : (step >= 1 ? 1 : 0);
            let names = pb ? ["Company", "Research", "Dossier"] : stepNames;
            let activeIdx = pb ? pbActive : step;
            // Dossier/invite journey: the customer landed via link, so Company &
            // Research (and Documents, on that journey) were done before they
            // arrived. Hide every pre-Applicant pill and renumber the rest 1–N.
            // DISPLAY ONLY — `step`/STEPS routing is untouched; we just slice the
            // labels and re-base the active index by the same offset so Applicant
            // reads as 1 of 5 here while staying 3 of 7 on the KYC/lookup journey.
            // Skipped for preboarding (analyst flow) and once a dispute reset
            // clears landedViaLink (→ back to the full 7).
            if (!pb && landedViaLink && step >= STEPS.applicant) {
              const hidden = STEPS.applicant; // count of pre-Applicant steps
              names = stepNames.slice(hidden);
              activeIdx = step - hidden;
            }
            const doneBg = pb ? "#7C3AED" : "#4a9e8e";
            const activeBg = pb ? "#6D28D9" : "#1a3a4a";
            const ring = pb ? "0 0 0 3px rgba(124,58,237,0.2)" : "0 0 0 3px rgba(74,158,142,0.2)";
            return names.map((s, i, arr) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i < activeIdx ? doneBg : i === activeIdx ? activeBg : "#e0e4e8", color: i <= activeIdx ? "#fff" : "#999", boxShadow: i === activeIdx ? ring : "none" }}>{i + 1}</div>
                <span style={{ fontSize: 11, fontWeight: i === activeIdx ? 700 : 400, color: i <= activeIdx ? "#1a3a4a" : "#aaa" }}>{s}</span>
                {i < arr.length - 1 && <div style={{ width: 14, height: 2, background: i < activeIdx ? doneBg : "#e0e4e8" }} />}
              </div>
            ));
          })()}
        </div>

        {step === STEPS.input && !journeyOpen && (
          <div style={card}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Company Lookup</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 20px" }}>Enter the company name and country. The agent will use <strong>jurisdiction-specific requirements</strong> (UK or SG/default) to drive the research and gap collection.</p>
            <StableInput id="companyName" label="Company Legal Name" type="text" value={companyName} onUpdate={(_, v) => setCompanyName(v)} required placeholder="e.g. Tesco PLC, DBS Group Holdings" />
            {/* Optional registration / company number. When supplied it's used as
                the primary search key to pinpoint the exact company; blank = the
                same name-based search as before (slice 1). */}
            <StableInput id="regNumber" label="Registration / Company number (optional)" type="text" value={regNumber} onUpdate={(_, v) => { setRegNumber(v); setRegNumberSource(v.trim() ? "customer" : null); }} placeholder="e.g. 00445790 — the official company / registration number" />
            <p style={{ fontSize: 11, color: "#1a3a4a80", margin: "-8px 0 16px", lineHeight: 1.4 }}>
              Optional. If you know the company's official registration number, we'll use it to pinpoint the exact company and sharpen the research. Leave it blank to search by name.
            </p>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="entity-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Entity Type <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="entity-type"
                value={entityType}
                onChange={(v) => { setEntityType(v); setOwnershipType(""); }}
                placeholder="Select or type entity type…"
                options={activeEntityTypes.map(e => ({
                  value: e.id,
                  label: `${e.icon ? e.icon + " " : ""}${e.label || e.id}`,
                  description: e.description || undefined,
                }))}
              />
            </div>
            {/* Ownership Type is always visible; its options are populated from
                the selected entity type. Until an entity type is chosen it shows
                disabled with a guiding placeholder. */}
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="ownership-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                Ownership Type <span style={{ color: C.error }}>*</span>
              </label>
              <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
                How is this company owned and structured?
              </p>
              <SearchableSelect
                id="ownership-type"
                value={ownershipType}
                onChange={setOwnershipType}
                disabled={!entityType}
                placeholder={entityType ? "Select ownership type…" : "Select an entity type first…"}
                options={entityType ? getOwnershipTypeOptions(entityType, tenantConfig) : []}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="country-reg" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Registered Country <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="country-reg"
                value={countryCode}
                onChange={setCountryCode}
                placeholder="Select or type country…"
                options={COUNTRIES.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              />
            </div>
            {countryCode && (() => {
              // Resolve the licence from the tenant's configured licences,
              // not the hardcoded UK/SG fallback. If tenantConfig is missing
              // (offline fallback) fall back to the old hardcoded helper.
              const resolved = tenantConfig ? pickLicence(countryCode, tenantConfig) : null;
              const primary = tenantConfig ? (tenantConfig.licences || []).find(l => l.isPrimary) || (tenantConfig.licences || [])[0] : null;
              const isLicensedHere = !!resolved && Array.isArray(resolved.countriesCovered) && resolved.countriesCovered.includes(countryCode);
              const licenceLabel = resolved
                ? `${resolved.jurisdictionCode === "GB" ? "🇬🇧 " : resolved.jurisdictionCode === "SG" ? "🇸🇬 " : ""}${resolved.jurisdictionName || resolved.id}${resolved.regulatoryAuthority ? ` (${resolved.regulatoryAuthority})` : ""}${!isLicensedHere ? " — default for non-licensed markets" : ""}`
                : (getApplicableLicence(countryCode) === "GB" ? "🇬🇧 United Kingdom (FCA)" : "🇸🇬 Singapore (MAS) — default for non-licensed markets");
              const isFiFlow = entityType === "FI" || entityType === "Platform";
              const routesNote = entityType === "Platform" || entityType === "Direct"
                ? ` (${entityType} routes to ${isFiFlow ? "FI" : "Corporate"} schema)`
                : "";
              const primaryName = primary?.jurisdictionName || "the default licence";
              return (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: isLicensedHere ? "#f0f3f8" : "#fff8ed", fontSize: 12, marginBottom: 14, borderLeft: isLicensedHere ? "3px solid #1a3a4a" : "3px solid #e0a040" }}>
                  <div style={{ marginBottom: 4 }}><strong>🌍 Researching in:</strong> {countryObj?.name} ({countryCode})</div>
                  <div><strong>📋 Applicable licence:</strong> {licenceLabel}</div>
                  {entityType && (
                    <div style={{ marginTop: 4 }}><strong>📑 Form set:</strong> {isFiFlow ? "FI version" : "Corporate version"}{routesNote}</div>
                  )}
                  {!isLicensedHere && <div style={{ marginTop: 4, fontStyle: "italic", color: "#9d6500" }}>{companyName_} has no licence in {countryObj?.name}, so this customer is onboarded under {primaryName}. Public records will be searched in {countryObj?.name}, but {primaryName} requirements apply.</div>}
                </div>
              );
            })()}
            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}
            {/* Research cache override. Cache-first by default (saves API cost on
                repeat searches); tick to force a live re-fetch. See
                lib/researchCache.js + api/research.js. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#64748b' }}>
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={e => setForceRefresh(e.target.checked)}
                  style={{ width: 15, height: 15, cursor: 'pointer' }}
                />
                🔄 Force re-fetch (ignore cache)
              </label>
              {!forceRefresh && (
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  Cache saves API costs — only override for demos or stale data
                </span>
              )}
              {forceRefresh && (
                <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                  ⚠ Live API call — this will cost tokens
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {SHOW_TEST_TOOLS && <Btn onClick={doDummyResearch} variant="secondary">🧪 Dummy Research (skip API)</Btn>}
              <Btn
                disabled={!companyName.trim() || !countryCode || !entityType || !ownershipType}
                onClick={() => {
                  if (!companyName.trim()) { setError("Please enter a company name."); return; }
                  if (!entityType) { setError("Please select an entity type."); return; }
                  if (!ownershipType) { setError("Please select an ownership type."); return; }
                  if (!countryCode) { setError("Please select a country."); return; }
                  setError("");
                  // Wrong-TYPE re-derive: skip the search journey entirely — keep
                  // the existing research and re-resolve from the corrected type.
                  if (pendingReseedMode === "re_derive") { applyReDerive(); return; }
                  setSelectedJourneyCard(null);
                  setManualOpened(false);
                  // Both the onboarding AND pre-boarding flows now show the
                  // journey-selection page ("How would you like to complete your
                  // application?"). Pre-boarding previously skipped straight to
                  // AI research; it now offers the same options so the analyst
                  // can demo every journey. The pre-boarding auto-save effect
                  // still folds the result into the dossier once research runs,
                  // so any AI journey still lands on the Dossier view.
                  setJourneyOpen(true);
                }} variant="primary">Continue →</Btn>
            </div>
          </div>
        )}

        {step === STEPS.input && journeyOpen && (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>How would you like to complete your application?</h2>
                <p style={{ fontSize: 13, color: "#1a3a4a80", margin: "0 0 18px" }}>Choose the option that works best for you. You can always go back and change this.</p>
              </div>
              {SHOW_TEST_TOOLS && (demoToggleVisible || TEST_FLAG) && (
                <div style={{ flexShrink: 0 }}>
                  <DemoToggle on={demoMode} onChange={setDemoMode} />
                </div>
              )}
            </div>

            {/* Two-retry cap notices: legal-name tip on the second attempt, and
                the lockout-to-manual message once searches are used up. */}
            {(() => {
              const cap = evaluateSearchCap(searchAttempts);
              if (cap.locked) {
                return (
                  <div data-testid="search-locked-banner" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#b91c1c", marginBottom: 14 }}>
                    {CONTACT_ADMIN_MSG}
                  </div>
                );
              }
              if (cap.isSecondAttempt) {
                return (
                  <div data-testid="legal-name-alert" style={{ background: "#fff8ed", border: "1px solid #fcd9a8", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#9d6500", marginBottom: 14 }}>
                    <strong>Tip:</strong> {LEGAL_NAME_ALERT}
                  </div>
                );
              }
              return null;
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
              {/* Card A */}
              {(() => {
                const sel = selectedJourneyCard === "A";
                const locked = evaluateSearchCap(searchAttempts).locked;
                return (
                  <div
                    onClick={() => { if (locked) { setError(CONTACT_ADMIN_MSG); return; } setSelectedJourneyCard("A"); setError(""); }}
                    style={{
                      position: "relative", padding: "18px 16px", borderRadius: 12, cursor: locked ? "not-allowed" : "pointer",
                      background: sel ? "#f0f9f6" : "#fafcfb",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.18)"}`,
                      boxShadow: sel ? "0 6px 18px rgba(26,58,74,0.12)" : "none",
                      opacity: locked ? 0.45 : 1,
                    }}
                  >
                    <span style={{ position: "absolute", top: 10, right: 10, background: "#4a9e8e", color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase" }}>Recommended</span>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔍📄</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload documents &amp; let AI fill the rest</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Upload any documents you have — we extract data from them instantly. For anything we can't find in your documents, our AI searches public registries and web sources.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>Fastest · Most accurate · Lowest effort</div>
                  </div>
                );
              })()}

              {/* Card B */}
              {(() => {
                const sel = selectedJourneyCard === "B";
                const locked = evaluateSearchCap(searchAttempts).locked;
                return (
                  <div
                    onClick={() => { if (locked) { setError(CONTACT_ADMIN_MSG); return; } setSelectedJourneyCard("B"); setError(""); }}
                    style={{
                      padding: "18px 16px", borderRadius: 12, cursor: locked ? "not-allowed" : "pointer",
                      background: sel ? "#f0f3f8" : "#fafcfb",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.12)"}`,
                      opacity: locked ? 0.45 : 1,
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Let AI research your company</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>No documents needed. Our AI searches Companies House, regulatory registers, annual reports and other public sources to pre-fill your application.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>~30 seconds · No uploads needed</div>
                  </div>
                );
              })()}

              {/* Card C */}
              {(() => {
                const sel = selectedJourneyCard === "C";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("C"); setError(""); }}
                    style={{
                      padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#f5f5f5" : "#f8f8f8",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.1)"}`,
                      opacity: 0.92,
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>✏️</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>I'll complete the form myself</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Skip the AI research and fill everything manually using your own records. You'll be redirected to our standard application form.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a4a90" }}>Full control · No AI · ~15 minutes</div>
                  </div>
                );
              })()}

              {/* Card D — Nium API Lookup. TEST MODE ONLY: visible when demoMode
                  is on OR ?test=1 is in the URL. Pulls verified registry data
                  straight from the Nium eKYB API (the KYC Lookup Agent) instead
                  of AI research, then flows into the same Confirm step. Clicking
                  starts the lookup immediately (no Continue needed). */}
              {(demoMode || new URLSearchParams(window.location.search).get("test") === "1") && (() => {
                const sel = selectedJourneyCard === "nium_api";
                return (
                  <div
                    onClick={() => {
                      // Two-retry cap: the Nium API lookup is a search option, so
                      // it's blocked once the customer has used their searches.
                      if (evaluateSearchCap(searchAttempts).locked) { setError(CONTACT_ADMIN_MSG); return; }
                      // The Nium KYB sandbox only holds one fixture (the STAR
                      // FINANCE PRIVATE LIMITED / SG record), so the lookup ALWAYS
                      // returns that sample data regardless of what was entered.
                      // When the tester actually picked that fixture the result
                      // matches their selection, so stay silent; for any other
                      // selection, show a one-time informational notice that the
                      // next page is sample (not real) data — then continue either
                      // way (no need to go back/edit).
                      const isFixtureSelection =
                        companyName.trim().toLowerCase().includes("star finance") &&
                        countryCode === "SG";
                      if (!isFixtureSelection) {
                        window.alert(
                          "🔗 Nium API Lookup — Test Environment\n\n" +
                          "This sandbox has limited data. The next screen will show " +
                          "sample data for \"STAR FINANCE PRIVATE LIMITED\" — not live " +
                          "data for the company you entered.\n\n" +
                          "Click OK to continue with the demo."
                        );
                      }
                      setSelectedJourneyCard("nium_api");
                      setJourneyType("nium_api");
                      startNiumApiLookup();
                    }}
                    style={{
                      position: "relative", padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#ECFEFF" : "#fafdfe",
                      border: `2px solid ${sel ? "#0891B2" : C.border}`,
                      boxShadow: sel ? "0 6px 18px rgba(8,145,178,0.12)" : "none",
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔗</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>Nium API Lookup</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>
                      Pull verified registry data directly from Nium's KYB infrastructure. Fastest and most accurate for supported markets.
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#0891B2", background: "#ECFEFF", border: "1px solid #A5F3FC", borderRadius: 99, padding: "2px 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Test Mode Only
                    </span>
                  </div>
                );
              })()}

              {/* Card E — Max Prefill. Runs every available source at once for
                  the highest possible pre-fill. The dedicated pipeline is TBD
                  (wired next); for now selecting it routes through standard AI
                  research so both the onboarding and pre-boarding flows demo end
                  to end. Always visible (prod + test versions of this page). */}
              {(() => {
                const sel = selectedJourneyCard === "E";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("E"); setError(""); }}
                    style={{
                      position: "relative", padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#F5F3FF" : "#fbfaff",
                      border: `2px solid ${sel ? "#7C3AED" : "rgba(124,58,237,0.22)"}`,
                      boxShadow: sel ? "0 6px 18px rgba(124,58,237,0.12)" : "none",
                    }}
                  >
                    <span style={{ position: "absolute", top: 10, right: 10, background: "#7C3AED", color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase" }}>New</span>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🚀</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Run for max prefill</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Pull from every available source at once — uploaded documents, public registries, web research and Nium's KYB data — to pre-fill as much of your application as possible.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#7C3AED" }}>Most comprehensive · Highest coverage</div>
                  </div>
                );
              })()}
            </div>

            {/* Registration number + Companies House "Find from name" resolver.
                Hidden for now (SHOW_NIUM_REG_PANEL=false) while the CH API key is
                sorted out; the Nium journey uses a fixed preprod reg number
                meanwhile. Code kept wired so flipping the flag restores it. */}
            {SHOW_NIUM_REG_PANEL && (demoMode || new URLSearchParams(window.location.search).get("test") === "1") && (
              <div style={{ marginBottom: 14, padding: "12px 14px", background: "#ECFEFF", border: "1px solid #A5F3FC", borderRadius: 10 }}>
                <label htmlFor="niumRegNumber" style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#0E7490", marginBottom: 4 }}>
                  🔗 Registration Number <span style={{ fontWeight: 500, color: "#0891B2" }}>— required for Nium API Lookup</span>
                </label>
                <p style={{ fontSize: 11, color: "#0891B2", margin: "0 0 8px", lineHeight: 1.4 }}>
                  The Nium KYB registry searches by registration number (a name-only search isn't supported). Type it, or look it up from the company name (UK only). <em>Preprod test value: 00445790 (GB).</em>
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <input
                    id="niumRegNumber"
                    type="text"
                    value={niumRegNumber}
                    onChange={(e) => setNiumRegNumber(e.target.value)}
                    placeholder="e.g. 00445790"
                    style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1.5px solid #A5F3FC", fontSize: 14, fontFamily: "inherit", color: "#0E7490", background: "#fff" }}
                  />
                  <button
                    type="button"
                    onClick={findNiumRegNumber}
                    disabled={niumSearchLoading || !companyName.trim()}
                    style={{ flexShrink: 0, padding: "0 14px", borderRadius: 8, border: "none", background: niumSearchLoading || !companyName.trim() ? "#A5F3FC" : "#0891B2", color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: niumSearchLoading || !companyName.trim() ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                  >
                    {niumSearchLoading ? "Searching…" : "🔍 Find from name"}
                  </button>
                </div>

                {niumSearchError && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "6px 10px" }}>
                    {niumSearchError}
                  </div>
                )}

                {niumSearchResults && niumSearchResults.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#0E7490", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>
                      {niumSearchResults.length} match{niumSearchResults.length !== 1 ? "es" : ""} — top one filled in, pick another if needed:
                    </div>
                    {niumSearchResults.map((m) => {
                      const picked = m.registrationNumber === niumRegNumber;
                      return (
                        <div
                          key={m.registrationNumber}
                          onClick={() => setNiumRegNumber(m.registrationNumber)}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", marginBottom: 4, borderRadius: 6, cursor: "pointer", background: picked ? "#CFFAFE" : "#fff", border: `1px solid ${picked ? "#0891B2" : "#A5F3FC"}` }}
                        >
                          <span style={{ fontSize: 12, flexShrink: 0 }}>{picked ? "✓" : "○"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#0E7490" }}>{m.name}</div>
                            <div style={{ fontSize: 10, color: "#0891B2" }}>
                              {m.registrationNumber}{m.status ? ` · ${m.status}` : ""}{m.address ? ` · ${m.address}` : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {manualOpened && (
              <div style={{ marginTop: 4, marginBottom: 12, padding: "10px 14px", background: "#f0f3f8", borderRadius: 8, fontSize: 12, color: "#1a3a4a", borderLeft: "3px solid #1a3a4a" }}>
                Opening the manual form in a new tab… You can also continue with AI assistance above.
              </div>
            )}

            {demoMode && (
              <div style={{ marginBottom: 12, padding: "10px 14px", background: "#FEF3C7", borderRadius: 8, fontSize: 12, color: "#92400E", borderLeft: "3px solid #FCD34D" }}>
                Demo mode active — using sample data. Document extraction and web research are simulated.
              </div>
            )}

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="secondary" onClick={() => { setJourneyOpen(false); setManualOpened(false); setError(""); }}>← Back</Btn>
              <Btn variant="primary" onClick={proceedFromJourney}>Continue →</Btn>
            </div>
          </div>
        )}

        {isAiDocs && step === STEPS.documents && (() => {
          const docs = docTypesForEntity(entityType, tenantConfig);
          const uploadedCount = docs.reduce((n, d) => n + (uploadedDocs[d.key] ? 1 : 0), 0);
          // Section A (Document Intelligence) — auto-sourced documents from
          // the doc search agent. Only usable docs render as cards.
          const foundDocs = (docSearchResults?.documents || [])
            .filter(d => d.status === "downloaded" || d.status === "url_found");
          const sectionAVisible = docSearchLoading || !!docSearchError ||
            (docSearchResults !== null && docSearchResults.documents.length > 0);
          // Unified loading: hold ALL results until BOTH agents finish, then
          // reveal together. Message cycles via the effect above.
          const isLoading = docSearchLoading || selfSourceLoading;
          const currentMessage = DOC_LOADER_MSGS[docLoaderIdx % DOC_LOADER_MSGS.length];

          // ── Section B: flag (but do not hide) documents already auto-sourced
          // in Section A. Only count docs the agent actually has (downloaded or
          // url_found); a failed search still asks the customer to provide it.
          const autoSourcedDocTypes = new Set(
            (docSearchResults?.documents || [])
              .filter(d => d.status === "downloaded" || d.status === "url_found")
              .map(d => d.type)
          );
          // Map doc-search agent type IDs → the DOC_TYPES `key` values used by
          // Section B (Wolfsberg = "wolfsberg", Annual Report = "annualReport"),
          // plus a range of aliases so the match is robust to either source.
          const docTypeMapping = {
            wolfsberg_questionnaire: [
              "doc_wolfsberg", "wolfsberg", "wolfsberg_questionnaire", "cbddq", "fccq",
            ],
            annual_report: [
              "doc_annual", "annual_report", "annual_report_accounts",
              "audited_financial_statements", "audited_accounts", "annualReport",
            ],
          };
          function isAutoSourced(docId, docType) {
            for (const [agentType, mappedIds] of Object.entries(docTypeMapping)) {
              if (autoSourcedDocTypes.has(agentType)) {
                if (mappedIds.includes(docId) || mappedIds.includes(docType)) {
                  return true;
                }
              }
            }
            return false;
          }

          // PR-043 — unified "Documents Sourced" list. Merge three origins into
          // one deduped, labelled, sorted array so manual uploads and the annual
          // report sit in the same panel as the automated registry docs:
          //   • registry  — selfSourceResults.results, status "retrieved"
          //   • manual    — selfSourceResults.results, status "manually_uploaded"
          //                 (carries a permanent blobUrl from PR-034)
          //   • research  — docSearchResults.documents (annual report / Wolfsberg)
          const SOURCE_LABELS = {
            registry: "Retrieved from registry",
            research: "Retrieved automatically",
            manual: "Uploaded manually",
          };
          const normDocType = (s) =>
            String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

          const registryEntries = (selfSourceResults?.results || []).map((item, i) => {
            const uploaded = item.status === "manually_uploaded";
            const captcha = !!item.captchaBlocked && !uploaded;
            const manualReview =
              item.manualReviewFlag || item.status === "manual_retrieval_required";
            const failed = item.status === "fetch_failed";
            const retrieved =
              item.status === "retrieved" || item.status === "retrieved_unverified";
            // Permanent blob URL for manual uploads (null when the upload failed);
            // automated registry docs link to the registry page instead.
            //
            // Blobs are written PRIVATE, so a manual upload can no longer be an
            // <a href> straight at the blob — a private blob is not fetchable by
            // URL. Route it through /api/get-document, which reads it with the
            // store token and streams the bytes back. Registry docs are ordinary
            // public web pages and are linked directly, unchanged.
            const blobUrl = item.manualUploadBlobUrl || null;
            const viewUrl = uploaded
              ? (item.uploadFailed || !blobUrl
                  ? null
                  : `/api/get-document?url=${encodeURIComponent(blobUrl)}`)
              : (item.searchUrl || item.sourceUrl || null);
            let host = "";
            try {
              const u = item.searchUrl || item.sourceUrl;
              host = u ? new URL(u).hostname.replace(/^www\./, "") : "";
            } catch (_) { host = ""; }
            return {
              kind: "registry",
              registryIndex: i,
              docType: normDocType(item.requirement),
              name: item.localEquivalent || item.requirement,
              subLabel: item.requirement,
              host,
              origin: uploaded ? "manual" : "registry",
              sourceLabel: uploaded
                ? SOURCE_LABELS.manual
                : (retrieved ? SOURCE_LABELS.registry : null),
              viewUrl,
              uploadFailed: !!item.uploadFailed,
              captcha,
              manualReview,
              failed,
              retrieved,
              uploaded,
              manualUploadName: item.manualUploadName || null,
              openUrl: item.searchUrl || item.sourceUrl || null,
              timestamp: item.manualUploadAt || item.retrievedAt || selfSourceResults?.searchedAt || "",
            };
          });

          const researchEntries = (docSearchResults?.documents || [])
            .filter((d) => d.status === "downloaded" || d.status === "url_found")
            .map((doc) => ({
              kind: "research",
              docType: normDocType(doc.type),
              name: doc.label,
              subLabel: doc.sourceLabel,
              origin: "research",
              sourceLabel: SOURCE_LABELS.research,
              viewUrl: doc.sourceUrl || null,
              docObj: doc,
              year: doc.year,
              confidence: doc.confidence,
              status: doc.status,
              timestamp: docSearchResults?.searchedAt || "",
            }));

          // Dedup by document type — prefer an automated entry (registry/research)
          // over a manual upload of the same type; show the manual upload only as
          // a fallback. Empty doc types are never collapsed together.
          const isAuto = (e) => e.origin !== "manual";
          const byType = new Map();
          [...registryEntries, ...researchEntries].forEach((e) => {
            const key = e.docType || `__${e.kind}_${e.registryIndex ?? e.name}`;
            const existing = byType.get(key);
            if (!existing || (isAuto(e) && !isAuto(existing))) byType.set(key, e);
          });
          // Sort: automated (registry/research) first, manual uploads last; within
          // each group newest first by timestamp.
          const mergedSourcedDocs = Array.from(byType.values()).sort((a, b) => {
            const am = a.origin === "manual" ? 1 : 0;
            const bm = b.origin === "manual" ? 1 : 0;
            if (am !== bm) return am - bm;
            return String(b.timestamp).localeCompare(String(a.timestamp));
          });

          return (
            <div>
              <div style={card}>
                <style>{`@keyframes kspin { to { transform: rotate(360deg); } }`}</style>

                {/* Testing-mode toggle — demo data vs real agent call. Hidden once
                    the real agents have been triggered (test/demo only). */}
                {(demoMode || SHOW_TEST_TOOLS) && !hasRunRealAgent && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 16,
                    padding: "8px 12px",
                    background: C.surfaceAlt,
                    borderRadius: 8,
                    border: `1px dashed ${C.border}`,
                  }}>
                    <span style={{ fontSize: 12, color: C.textMuted }}>
                      🧪 Testing mode:
                    </span>
                    <button
                      onClick={() => {
                        setDocSearchResults(
                          buildDemoDocSearchResults(companyName, ownershipType, entityType)
                        );
                        setDocSearchError(null);
                        setDocSearchLoading(false);
                      }}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        background: "transparent",
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: C.text,
                      }}
                    >
                      Use demo data
                    </button>
                    <button
                      onClick={() => {
                        // Test/demo only: trigger BOTH real agents in parallel and
                        // hide this toggle. The unified loading panel (isLoading)
                        // shows while they run; real results replace the dummy ones.
                        setHasRunRealAgent(true);
                        runRealDocSearch();
                        runRealSelfSource();
                      }}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        background: C.niumBlue,
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      Run real agent
                    </button>
                  </div>
                )}

                {/* Unified loading panel — held until BOTH agents finish, then
                    all results + uploads reveal together below. */}
                {isLoading && (
                  <div style={{ textAlign: "center", padding: "40px 20px" }}>
                    <div style={{ fontSize: 24, marginBottom: 16 }}>⏳</div>
                    <p style={{ fontWeight: 500 }}>{currentMessage}</p>
                    <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
                      This takes about 30–40 seconds
                    </p>
                  </div>
                )}

                {/* Everything below is held back until both agents complete. */}
                {!isLoading && (<>

                {/* Empty state — both agents done, nothing found anywhere. */}
                {foundDocs.length === 0 && !(selfSourceResults?.results?.length > 0) && (
                  <div style={{
                    padding: "16px", background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`, borderRadius: 10,
                    marginBottom: 20, fontSize: 13, color: C.warning,
                  }}>
                    No documents could be retrieved automatically. Please upload the required documents below.
                  </div>
                )}

                {/* Test/demo-only diagnostic — surfaces a swallowed registry-agent
                    API error (e.g. billing/credits) so it isn't hidden as "manual
                    retrieval". NEVER shown in production (gated on test/demo). */}
                {(demoMode || SHOW_TEST_TOOLS) && selfSourceDiag && (
                  <div style={{
                    padding: "12px 16px", background: "#fff1f0", border: "1px solid #ffa39e",
                    borderRadius: 10, marginBottom: 20, fontSize: 12, color: "#a8071a",
                  }}>
                    <strong>🧪 Test diagnostic — registry agent AI call failed:</strong>
                    <div style={{ marginTop: 4, fontFamily: "monospace", wordBreak: "break-word", lineHeight: 1.4 }}>
                      {selfSourceDiag}
                    </div>
                    <div style={{ marginTop: 6, color: "#a8071a99" }}>
                      Items below fell back to manual retrieval because the AI call didn't run — not because the documents are missing.
                    </div>
                  </div>
                )}

                {/* Section A error — subtle, never blocks progress */}
                {docSearchError && (
                  <div style={{
                    padding: "12px 16px",
                    background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`,
                    borderRadius: 10,
                    marginBottom: 20,
                    fontSize: 13,
                    color: C.warning,
                  }}>
                    ⚠ Could not automatically source documents for {companyName}. Please upload documents below.
                  </div>
                )}

                {/* Registry self-source error — subtle, never blocks progress */}
                {selfSourceError && (
                  <div style={{
                    padding: "12px 16px",
                    background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`,
                    borderRadius: 10,
                    marginBottom: 20,
                    fontSize: 13,
                    color: C.warning,
                  }}>
                    ⚠ Could not retrieve registry documents: {selfSourceError}
                  </div>
                )}

                {/* PR-043 — unified Documents Sourced panel: automated registry
                    docs, internet-research docs (annual report / Wolfsberg) and
                    manual uploads, deduped by type and labelled by origin. */}
                {!isLoading && mergedSourcedDocs.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: C.textMuted,
                      textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 12,
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <span>📁 Documents Sourced</span>
                      {docSearchResults?.isDemo && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: C.textMuted,
                          background: C.surfaceAlt, border: `1px solid ${C.border}`,
                          borderRadius: 99, padding: "2px 8px",
                        }}>DEMO DATA</span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
                      Documents gathered for <strong>{companyName}</strong> — from official
                      registries, public sources, and your manual uploads.
                    </p>

                    {mergedSourcedDocs.map((e) => {
                      const accepted = e.kind === "research" && acceptedDocTypes.has(e.docObj.type);
                      const positive = e.uploaded || e.retrieved || e.kind === "research";
                      const labelStyle = e.origin === "research"
                        ? { bg: C.surfaceAlt, fg: C.niumBlue }
                        : { bg: C.successBg, fg: C.success };
                      const icon = e.kind === "research"
                        ? (e.docObj.type === "wolfsberg_questionnaire" ? "📋" : "📊")
                        : "🏛️";
                      return (
                        <div key={`${e.kind}-${e.registryIndex ?? e.docType}-${e.name}`} style={{
                          display: "flex", alignItems: "flex-start", gap: 12,
                          padding: "14px 16px",
                          background: positive && !e.uploadFailed ? C.successBg : "#fff",
                          border: `1.5px solid ${positive && !e.uploadFailed ? C.successBorder : C.border}`,
                          borderRadius: 10, marginBottom: 8,
                        }}>
                          <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>{icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                              {e.name}
                              {e.year && (
                                <span style={{ fontSize: 12, fontWeight: 400, color: C.textMuted, marginLeft: 8 }}>{e.year}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                              {e.subLabel}{e.host ? ` · ${e.host}` : ""}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {e.sourceLabel && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: labelStyle.bg, color: labelStyle.fg,
                                }}>{e.sourceLabel}</span>
                              )}
                              {e.kind === "research" && e.confidence && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: e.confidence === "high" ? C.successBg : C.warningBg,
                                  color: e.confidence === "high" ? C.success : C.warning,
                                  border: `1px solid ${e.confidence === "high" ? C.successBorder : C.warningBorder}`,
                                }}>{e.confidence === "high" ? "✓ High confidence" : "~ Medium confidence"}</span>
                              )}
                              {e.captcha && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: C.warningBg, color: C.warning,
                                }}>🔒 Behind captcha</span>
                              )}
                              {!e.uploaded && !e.captcha && e.manualReview && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: C.warningBg, color: C.warning,
                                }}>⚠ Manual retrieval</span>
                              )}
                              {e.failed && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                  background: C.surfaceAlt, color: C.textMuted,
                                }}>✗ Not found</span>
                              )}
                            </div>

                            {/* View link — /api/get-document for manual uploads (the
                                blob is private and streamed back by the server),
                                registry/source URL for automated docs. Hidden when a
                                manual upload failed (blobUrl null / uploadFailed). */}
                            {e.viewUrl && (
                              <a href={e.viewUrl} target="_blank" rel="noopener noreferrer" style={{
                                display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12,
                                color: C.niumBlue, fontWeight: 600, textDecoration: "none", marginTop: 6, padding: "4px 0",
                              }}>
                                <span style={{ fontSize: 14 }}>{e.origin === "manual" ? "📄" : "🔗"}</span>
                                View →
                              </a>
                            )}

                            {/* Manual upload failed — warn but never block the journey. */}
                            {e.uploaded && e.uploadFailed && (
                              <div style={{ marginTop: 6, fontSize: 12, color: C.warning }}>
                                ⚠ Upload could not be stored permanently — please re-upload before submitting.
                              </div>
                            )}

                            {/* Manually-uploaded doc — filename + remove. */}
                            {e.uploaded && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, color: e.uploadFailed ? C.warning : C.success }}>
                                <span>{e.uploadFailed ? "⚠" : "✓"}</span>
                                <span style={{ fontWeight: 600 }}>{e.manualUploadName}</span>
                                <span onClick={() => handleManualDocumentRemove(e.registryIndex)} style={{
                                  cursor: "pointer", color: C.textSec, fontSize: 11, textDecoration: "underline",
                                }}>Remove</span>
                              </div>
                            )}

                            {/* Captcha-blocked registry doc — offer manual download + upload. */}
                            {e.captcha && (
                              <div style={{ marginTop: 6 }}>
                                <div style={{ fontSize: 12, color: C.warning, marginBottom: 6 }}>
                                  🔒 Behind captcha — cannot be retrieved automatically
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  {e.openUrl && (
                                    <a href={e.openUrl} target="_blank" rel="noopener noreferrer" style={{
                                      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12,
                                      padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                                      background: C.surface, color: C.niumBlue, fontWeight: 600, textDecoration: "none",
                                    }}>
                                      <span style={{ fontSize: 14 }}>🔗</span>
                                      Open registry →
                                    </a>
                                  )}
                                  <input type="file" id={`upload-registry-${e.registryIndex}`}
                                    accept=".pdf,.png,.jpg,.jpeg" style={{ display: "none" }}
                                    onChange={(ev) => handleManualDocumentUpload(ev, e.registryIndex)} />
                                  <button onClick={() => document.getElementById(`upload-registry-${e.registryIndex}`).click()} style={{
                                    fontSize: 12, padding: "4px 10px", borderRadius: 6,
                                    border: `1px solid ${C.border}`, background: C.surface,
                                    color: C.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                                  }}>↑ Upload document</button>
                                </div>
                              </div>
                            )}

                            {/* Registry snapshot-evidence note (automated retrieval). */}
                            {e.retrieved && !e.uploaded && (
                              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                                📸 Snapshot captured as evidence
                              </div>
                            )}
                          </div>

                          {/* Research docs — accept-to-extract toggle (unchanged behaviour). */}
                          {e.kind === "research" && (
                            <div style={{ flexShrink: 0 }}>
                              {accepted ? (
                                <button onClick={() => setAcceptedDocTypes(prev => { const n = new Set(prev); n.delete(e.docObj.type); return n; })} style={{
                                  padding: "7px 14px", background: C.success, color: "#fff", border: "none",
                                  borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                                  display: "flex", alignItems: "center", gap: 4,
                                }}>✓ Using this</button>
                              ) : (
                                <button onClick={() => setAcceptedDocTypes(prev => new Set([...prev, e.docObj.type]))} style={{
                                  padding: "7px 14px", background: "transparent", color: C.niumBlue,
                                  border: `1.5px solid ${C.niumBlue}`, borderRadius: 8, fontSize: 12, fontWeight: 600,
                                  fontFamily: "inherit", cursor: "pointer",
                                }}>Use this document</button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Search details — collapsible diagnostic table (doc-search agent). */}
                {docSearchResults?.summaryTable?.length > 0 && (
                  <details style={{ marginTop: -8, marginBottom: 24 }}>
                    <summary style={{
                      fontSize: 12, color: C.textMuted, cursor: "pointer", userSelect: "none",
                      listStyle: "none", display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <span>▾</span>
                      <span>View search details</span>
                    </summary>
                    <div style={{ marginTop: 10, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr>
                            {Object.keys(docSearchResults.summaryTable[0] || {}).map(col => (
                              <th key={col} style={{
                                padding: "6px 10px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                                textAlign: "left", fontWeight: 700, color: C.textMuted, whiteSpace: "nowrap",
                              }}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {docSearchResults.summaryTable.map((row, i) => (
                            <tr key={i}>
                              {Object.entries(row).map(([col, val], j) => (
                                <td key={j} style={{
                                  padding: "6px 10px", border: `1px solid ${C.border}`, color: C.text,
                                  maxWidth: col === "Notes" ? 300 : 200,
                                  whiteSpace: col === "Notes" ? "normal" : "nowrap",
                                  overflow: col === "Notes" ? "visible" : "hidden",
                                  textOverflow: col === "Notes" ? "unset" : "ellipsis",
                                  wordBreak: col === "Notes" ? "break-word" : "normal",
                                  fontSize: 11, verticalAlign: "top",
                                }}>{String(val)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                {/* Section divider between A (found) and B (uploads) */}
                {sectionAVisible && (
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.8px",
                    marginBottom: 12,
                    marginTop: 4,
                    paddingTop: 20,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    📤 Documents we need from you
                  </div>
                )}

                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Upload your documents</h2>
                <p style={{ fontSize: 13, color: "#1a3a4a90", margin: "0 0 18px", lineHeight: 1.5 }}>
                  All documents are optional. Upload as many or as few as you have available. The more you provide, the less you'll need to fill in manually.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                  {docs.map(d => {
                    const file = uploadedDocs[d.key];
                    const inputId = `upload-${d.key}`;
                    return (
                      <div key={d.key} style={{
                        padding: "14px 14px", borderRadius: 12,
                        background: file ? "#f0f9f6" : "#fafcfb",
                        border: file ? "2px solid #4a9e8e" : "2px dashed rgba(26,58,74,0.18)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <div style={{ fontSize: 20 }}>{d.icon}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{d.label}</div>
                          {d.badge && (
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 999, background: d.badge.color, color: "#fff", textTransform: "uppercase" }}>{d.badge.text}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 10 }}>{d.helper}</div>
                        {isAutoSourced(d.key, d.key) && (
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginBottom: 6,
                            padding: "6px 10px",
                            background: C.successBg,
                            border: `1px solid ${C.successBorder}`,
                            borderRadius: 6,
                            fontSize: 12,
                            color: C.success,
                          }}>
                            <span>✓</span>
                            <span>
                              We sourced this automatically — upload here only if you prefer to provide your own version.
                            </span>
                          </div>
                        )}
                        {file ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid rgba(74,158,142,0.25)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ color: "#1a6b56", fontWeight: 700, fontSize: 14 }}>✓</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                                <div style={{ fontSize: 10, color: "#1a3a4a70" }}>{(file.size / 1024).toFixed(0)} KB</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={removeDocFile(d.key)}
                              title="Remove"
                              style={{ background: "transparent", border: "none", color: "#1a3a4a", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}
                            >×</button>
                          </div>
                        ) : (
                          <label htmlFor={inputId} style={{ display: "block", padding: "12px 10px", textAlign: "center", borderRadius: 8, background: "#fff", border: "1.5px dashed rgba(26,58,74,0.22)", cursor: "pointer", fontSize: 12, color: "#1a3a4a90" }}>
                            Click to upload or drag and drop
                            <div style={{ fontSize: 10, color: "#1a3a4a60", marginTop: 4 }}>{d.accepts}</div>
                          </label>
                        )}
                        <input
                          id={inputId}
                          type="file"
                          accept={d.accept}
                          onChange={handleDocFile(d.key)}
                          style={{ display: "none" }}
                        />
                      </div>
                    );
                  })}
                </div>

                {error && <div style={{ marginTop: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}

                <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: uploadedCount > 0 ? "#f0f9f6" : "#fafcfb", color: uploadedCount > 0 ? "#1a6b56" : "#1a3a4a70", fontSize: 12, fontWeight: 600 }}>
                  {uploadedCount > 0
                    ? `${uploadedCount} document${uploadedCount === 1 ? "" : "s"} ready to upload`
                    : "No documents selected — AI will use web search only"}
                </div>
                </>)}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <Btn variant="secondary" onClick={() => { setError(""); setJourneyOpen(true); scrollAndSetStep(STEPS.input); }}>← Back</Btn>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Test/demo only: continue with synthesised data instead of
                      the real research + self-source agents, so the rest of the
                      flow can be exercised without spending on live API calls.
                      Mirrors the dummy path the journey-selection page uses
                      (proceedFromDocuments → doDummyResearch in demo mode). */}
                  {(demoMode || SHOW_TEST_TOOLS) && (
                    <button
                      onClick={() => { setError(""); doDummyResearch("ai_documents"); }}
                      title="Skip the real search — fills the rest of the flow with demo data at no cost"
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "10px 16px",
                        background: "transparent",
                        border: `1px dashed ${C.border}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: C.text,
                        whiteSpace: "nowrap",
                      }}
                    >
                      🧪 Dummy search (no cost)
                    </button>
                  )}
                  <Btn variant="primary" onClick={proceedFromDocuments}>Continue →</Btn>
                </div>
              </div>
            </div>
          );
        })()}

        {step === STEPS.research && (
          <div style={{ ...card, textAlign: "center", padding: "56px 28px" }}>
            <div style={{ position: "relative", width: 130, height: 130, margin: "0 auto 28px" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  border: "2px solid rgba(74,158,142,0.55)",
                  animation: `kpulse 2.4s ease-out ${i * 0.8}s infinite`,
                }} />
              ))}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, animation: "kbob 2.6s ease-in-out infinite" }}>🔍</div>
            </div>

            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Researching {companyName}... {jurisdictionBadge}{entityBadge}
            </div>
            {loaderPhase > 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0B3D91", marginBottom: 6 }}>
                {loaderPhase === 1 ? "Phase 1 of 2 — Documents" : "Phase 2 of 2 — Web research"}
              </div>
            )}
            <div style={{ fontSize: 13, color: "#4a9e8e", fontStyle: "italic", marginBottom: researchStatus ? 6 : 22, minHeight: 18 }}>
              {loaderMsgs[Math.min(loaderIdx, loaderMsgs.length - 1)]}
            </div>
            {researchStatus && (
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0B3D91", marginBottom: 22 }}>
                🔎 {researchStatus}
              </div>
            )}

            <div style={{ width: "100%", maxWidth: 420, height: 6, background: "rgba(74,158,142,0.12)", borderRadius: 3, overflow: "hidden", margin: "0 auto 18px" }}>
              <div style={{
                width: `${((loaderIdx + 1) / loaderMsgs.length) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg,#4a9e8e,#1a3a4a)",
                transition: "width 0.6s ease",
              }} />
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 7, flexWrap: "wrap" }}>
              {loaderMsgs.map((_, i) => (
                <div key={i} style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: i <= loaderIdx ? "#4a9e8e" : "rgba(26,58,74,0.15)",
                  transition: "background 0.3s",
                  boxShadow: i === loaderIdx ? "0 0 0 3px rgba(74,158,142,0.25)" : "none",
                }} />
              ))}
            </div>

            <style>{`
              @keyframes kpulse {
                0%   { transform: scale(0.55); opacity: 1;   border-color: rgba(74,158,142,0.7); }
                100% { transform: scale(1.45); opacity: 0;   border-color: rgba(74,158,142,0); }
              }
              @keyframes kbob {
                0%, 100% { transform: translateY(0); }
                50%      { transform: translateY(-6px); }
              }
            `}</style>
          </div>
        )}

        {step === STEPS.applicant && agentType !== "preboarding" && renderApplicantPage()}

        {step === STEPS.confirm && research && agentType !== "preboarding" && (
          <ConfirmStep
            research={research}
            companyName={companyName}
            coverage={coverage}
            ownershipType={ownershipType}
            journeyType={journeyType}
            servedFromCache={servedFromCache}
            cachedAt={cachedAt}
            checks={checks}
            confirmCounts={confirmCounts}
            confirmDocs={confirmDocs}
            amendmentUploads={amendmentUploads}
            uploadingDocKey={uploadingDocKey}
            onAmendmentUpload={handleAmendmentUpload}
            onAmendmentRemove={handleAmendmentRemove}
            blockers={confirmBlockers}
            blockerMessage={confirmBlockerMessage}
            isPubliclyListedOverride={isPubliclyListedOverride}
            setIsPubliclyListedOverride={setIsPubliclyListedOverride}
            sortedFound={sortedFound}
            stakeholderFound={stakeholderFound}
            regularFound={regularFound}
            docCount={docCount}
            tier1Count={tier1Count}
            tier2Count={tier2Count}
            tier3Count={tier3Count}
            prefill={prefill}
            jurisdictionBadge={jurisdictionBadge}
            entityBadge={entityBadge}
            cardStyle={card}
            STEPS={STEPS}
            stepsFor={stepsFor}
            setStep={setStep}
            setCompanyName={setCompanyName}
            setJourneyOpen={setJourneyOpen}
            setSelectedJourneyCard={setSelectedJourneyCard}
            setJourneyType={setJourneyType}
            setError={setError}
            scrollAndSetStep={scrollAndSetStep}
            renderStakeholderConfirmSection={renderStakeholderConfirmSection}
            renderUnifiedFoundTable={renderUnifiedFoundTable}
            renderAddPerson={renderAddPerson}
          />
        )}

        {/* Pre-boarding Confirm — Kept for reference — replaced by unified
            dossier view (June 2026). No longer routed: pre-boarding goes
            Company → Research → Dossier (auto-saved on research complete). */}
        {/* {step === STEPS.confirm && research && agentType === "preboarding" && renderPreboardingConfirm()} */}

        {/* Pre-boarding: brief "building dossier" state covering the short
            window between research completing and the auto-saved Dossier View
            rendering (saveDossier flips showDossierView → true). */}
        {agentType === "preboarding" && research && !showDossierView && step >= STEPS.confirm && (
          <div style={{ ...card, textAlign: "center", padding: "48px 28px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#4C1D95" }}>Building intelligence dossier…</div>
            <div style={{ fontSize: 13, color: "#7C3AED", opacity: 0.8, marginTop: 6 }}>Compiling findings and saving.</div>
          </div>
        )}

        {step === STEPS.fillGaps && research && activeSchema && agentType !== "preboarding" && (
          <div>
            <AmendmentDocuments
              submissionId={dossierId || onboardingSubmissionId}
              initialUploads={amendmentUploads}
              onUploadsChange={setAmendmentUploads}
              extraDocuments={docsNeededFrom(dialogueStateRef.current)}
            />
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e0a040,#d09030)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📝</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Additional Information Required {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>{getCombinedGaps().filter(g => g.section !== "documents").length} fields need your input</p>
                </div>
                {SHOW_TEST_TOOLS && (
                  <button
                    type="button"
                    onClick={fillTestData}
                    title="Testing only — fills all visible fields with sample data"
                    style={{
                      marginLeft: "auto", flexShrink: 0,
                      padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                      background: "transparent", color: "#4a9e8e",
                      border: "2px dashed #4a9e8e",
                    }}
                  >
                    ✨ Fill with test data
                  </button>
                )}
              </div>
            </div>

            {stakeholderErrors.length > 0 && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
                padding: "14px 16px", marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
                  Please fix the following before continuing:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {stakeholderErrors.map((msg, i) => (
                    <li key={i} style={{ fontSize: 12, color: "#dc2626", marginBottom: 3 }}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 1. Corrections required + 2. Missing gap fields — corrections
                come first inside gapSectionOrder(), then missing fields. */}
            {gapSectionOrder().filter(s => s !== "applicant").map(s => renderGapSection(s))}

            {/* 3. Stakeholder forms — only people who need customer input
                (private directors/UBOs, or listed-company >= 25% UBOs). */}
            {hasStakeholderForms && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>👥</span>
                <span>People — additional details needed</span>
              </div>
            )}
            {stakeholderFormNodes}

            {/* 4. Verified stakeholder summary — read-only reference, last. */}
            {hasStakeholderSummary && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>✅</span>
                <span>Verified information — for reference</span>
              </div>
            )}
            {stakeholderSummaryNodes}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.confirm)}>← Back to Review</Btn>
              <Btn variant="primary" onClick={() => {
                const stkErrors = validateStakeholders();
                if (stkErrors.length > 0) {
                  setStakeholderErrors(stkErrors);
                  setError("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  return;
                }
                if (allGapsFilled()) {
                  setStakeholderErrors([]);
                  scrollAndSetStep(STEPS.documentRequirements);
                  setError("");
                } else {
                  setError("Please fill all required fields.");
                }
              }}>Continue to Documents →</Btn>
            </div>
            {error && step === STEPS.fillGaps && <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}
          </div>
        )}

        {/* Pre-boarding Fill Gaps — Kept for reference — replaced by unified
            dossier view (June 2026). Exclude checkboxes + ask-for-more now live
            inline in the Customer Request section of renderDossierView(). */}
        {/* {step === STEPS.fillGaps && research && activeSchema && agentType === "preboarding" && renderPreboardingFillGaps()} */}

        {/* DRS — dynamic document-requirements step (Step 2 of the CDD brief),
            placed after Fill Gaps so classifiers + research are settled. */}
        {step === STEPS.documentRequirements && (
          <div>
            <div style={card}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>📄 Required Documents</h2>
              <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 4px" }}>
                Based on the company's country, entity and ownership type, here's exactly what we need.
              </p>
            </div>
            <div style={card}>
              {(() => {
                const entLabel = (activeEntityTypes.find(e => e.id === entityType)?.label) || entityType;
                const drsStep1Data = {
                  companyName: research?.companyName || companyName,
                  incorporationCountry: countryObj ? countryObj.name : countryCode,
                  entityType: entLabel,
                  ownershipType: OWNERSHIP_ID_TO_DRS[ownershipType] || ownershipType,
                };
                return (
                  <Step2DynamicForm
                    step1Data={drsStep1Data}
                    researchData={research}
                    docSearchResults={docSearchResults}
                    selfSourceResults={selfSourceResults}
                    onComplete={(data) => {
                      setDrsSubmitted(data.submittedRequirements || []);
                      setDrsFlags(data.flags || {});
                      setDrsGapsCleared(false);
                      scrollAndSetStep(STEPS.declare);
                    }}
                  />
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.fillGaps)}>← Back to Fill Gaps</Btn>
            </div>
          </div>
        )}

        {/* DRS pre-declaration gap gate (Step 5 of the CDD brief). Blocks the
            declaration until every mandatory document is on file. */}
        {step === STEPS.declare && !done && !drsGapsCleared && (
          <div>
            <div style={card}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>✅ Final document check</h2>
              {(() => {
                const entLabel = (activeEntityTypes.find(e => e.id === entityType)?.label) || entityType;
                const drsStep1Data = {
                  companyName: research?.companyName || companyName,
                  incorporationCountry: countryObj ? countryObj.name : countryCode,
                  entityType: entLabel,
                  ownershipType: OWNERSHIP_ID_TO_DRS[ownershipType] || ownershipType,
                };
                return (
                  <Step5Recompute
                    step1Data={drsStep1Data}
                    sector={null}
                    submittedRequirements={drsSubmitted}
                    extraFlags={{}}
                    onGapsClear={() => setDrsGapsCleared(true)}
                    onRequestDocument={() => scrollAndSetStep(STEPS.documentRequirements)}
                  />
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.documentRequirements)}>← Back to Documents</Btn>
            </div>
          </div>
        )}

        {step === STEPS.declare && !done && drsGapsCleared && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#1a3a4a,#2d5a6e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📜</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Applicant Declaration {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>Review and confirm</p>
                </div>
              </div>
              <div style={{ background: "#fafcfb", borderRadius: 10, padding: 18, border: "1px solid rgba(26,58,74,0.08)", marginBottom: 18 }}>
                <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                  I, <strong>{gapRef.current.applicantFirstName || "___"} {gapRef.current.applicantLastName || "___"}</strong>, hereby declare that:
                </p>
                <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, margin: "10px 0 0" }}>
                  <li>All information provided is true, complete, and accurate to the best of my knowledge.</li>
                  <li>I am authorised to submit this on behalf of <strong>{research?.companyName || companyName}</strong>.</li>
                  <li>Providing false information may result in rejection and legal consequences.</li>
                  <li>I consent to verification through third-party and regulatory databases.</li>
                  <li>I will notify of any material changes promptly.</li>
                </ul>
              </div>
              <div onClick={() => setDeclared(!declared)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 14, background: declared ? "#f0f9f6" : "#f8f8f8", borderRadius: 8, cursor: "pointer", marginBottom: 18, border: declared ? "1.5px solid #4a9e8e" : "1.5px solid #ddd" }}>
                <input type="checkbox" checked={declared} readOnly style={{ width: 18, height: 18, marginTop: 1, accentColor: "#4a9e8e", cursor: "pointer" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>I confirm I have read, understood, and agree to the above declaration.</span>
              </div>
              <div style={{ background: "#f3f5f8", borderRadius: 8, padding: 14 }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, margin: "0 0 8px", color: "#1a3a4a80", letterSpacing: "0.1em", textTransform: "uppercase" }}>Device Information (Auto-captured)</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[["IP Address", device.ipAddress], ["Platform", device.platform], ["Timezone", device.timezone], ["Screen", device.screenRes], ["Language", device.language], ["Capture Time", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"]].map(([k, v]) => (
                    <div key={k} style={{ fontSize: 11, color: "#1a3a4a90" }}><span style={{ fontWeight: 600 }}>{k}:</span> {v || "..."}</div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#1a3a4a50", marginTop: 6, borderTop: "1px solid rgba(26,58,74,0.06)", paddingTop: 5, wordBreak: "break-all" }}>
                  User Agent: {(device.userAgent || "").slice(0, 120)}
                </div>
              </div>
            </div>
            {inPreview && (
              <div style={{
                padding: "12px 16px",
                background: "#EFF6FF",
                border: "1px solid #BFDBFE",
                borderRadius: 8,
                fontSize: 13, color: "#1E40AF",
                marginBottom: 16,
                display: "flex", gap: 8, alignItems: "flex-start",
              }}>
                <span>ℹ</span>
                <span>Submission is disabled in preview mode. Publish your configuration to enable the live form.</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.fillGaps)}>← Back</Btn>
              <Btn
                variant="green"
                onClick={inPreview ? undefined : submitApplication}
                disabled={!declared || inPreview}
              >
                ✓ Submit Application
              </Btn>
            </div>
          </div>
        )}

        {done && (
          <div style={{ ...card, textAlign: "center", padding: "44px 28px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 18px", boxShadow: "0 6px 20px rgba(74,158,142,0.3)" }}>✓</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 6px" }}>Application Submitted {jurisdictionBadge}{entityBadge}</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 22px" }}>KYC onboarding for <strong>{research?.companyName || companyName}</strong> submitted successfully.</p>
            <div style={{ background: "#f5f7fa", borderRadius: 10, padding: 18, textAlign: "left", maxWidth: 480, margin: "0 auto 22px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a4a80", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Submission Summary</div>
              {(() => {
                const docKeys = docTypesForEntity(entityType, tenantConfig).filter(d => uploadedDocs[d.key]).map(d => d.label);
                const docExtractedCount = (research?.found || []).filter(i => i.sourceTier === "document").length;
                const tier1 = (research?.found || []).filter(i => i.sourceTier === "tier1").length;
                const tier2 = (research?.found || []).filter(i => i.sourceTier === "tier2").length;
                const accepted = (research?.found || []).filter((_, i) => checks[i]).length;
                const rejected = (research?.found || []).filter((_, i) => !checks[i]).length;
                const rows = [
                  ["Company", research?.companyName || companyName],
                  ["Journey", journeyType === "ai_documents" ? "AI + Documents" : "AI Research Only"],
                  ["Jurisdiction", activeSchema?.region === "UK" ? "United Kingdom" : "Singapore / Default"],
                  ["From documents", docExtractedCount + " fields"],
                  ["From official sources", tier1 + " fields"],
                  ["From unverified sources", tier2 + " fields"],
                  ["Accepted on Confirm", accepted + " · " + rejected + " corrected"],
                  ...(docKeys.length > 0 ? [["Documents uploaded", docKeys.join(", ")]] : []),
                  ["Manual fields", Object.keys(gapRef.current).length + " provided"],
                  ["Applicant", (gapRef.current.applicantFirstName || "") + " " + (gapRef.current.applicantLastName || "")],
                  ["Declared at", submitTs.replace("T", " ").slice(0, 19) + " UTC"],
                  ["IP Address", device.ipAddress],
                ];
                return rows.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(26,58,74,0.04)", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: "#1a3a4a90" }}>{v}</span>
                  </div>
                ));
              })()}
            </div>
            <Btn variant="secondary" onClick={() => { setCompanyName(""); setCountryCode(""); setEntityType(""); setOwnershipType(""); setDone(false); setSubmitTs(""); resetAll(); }}>Start New Application</Btn>
          </div>
        )}

        <footer style={{
          textAlign: "center", marginTop: 40, paddingTop: 18,
          borderTop: "1px solid rgba(26,58,74,0.08)",
          fontSize: 11, color: "#1a3a4a70",
        }}>
          © {new Date().getFullYear()} {companyName_}
          {tenantConfig?.company?.privacyPolicyUrl && (
            <>
              {" · "}
              <a
                href={tenantConfig.company.privacyPolicyUrl}
                target="_blank" rel="noopener noreferrer"
                style={{ color: "#1a3a4a", textDecoration: "underline" }}
              >Privacy Policy</a>
            </>
          )}
          {tenantConfig?.company?.primaryContactEmail && (
            <>
              {" · "}
              <a
                href={`mailto:${tenantConfig.company.primaryContactEmail}`}
                style={{ color: "#1a3a4a", textDecoration: "underline" }}
              >Contact</a>
            </>
          )}
          {(() => {
            // Tiny config/version readout for dev or ?debug=true. Helps confirm
            // during testing which config version is live and which schema cell
            // was resolved. Production users never see it.
            const isDev = process.env.NODE_ENV === "development";
            let isDebug = false;
            try {
              isDebug = new URLSearchParams(window.location.search).get("debug") === "true";
            } catch (_) { /* noop */ }
            if (!isDev && !isDebug) return null;
            const cellKey = activeSchema && entityType && activeSchema.licenceId
              ? `${entityType}:${activeSchema.licenceId}`
              : "(no schema active)";
            return (
              <div style={{ marginTop: 8, fontSize: 10, color: "#1a3a4a55", fontFamily: "monospace" }}>
                Config v{tenantConfig?._version ?? "?"} · Tenant: {tenantId} · Schema: {cellKey}
              </div>
            );
          })()}
        </footer>

      </div>
    </div>
  );
}
