import { CUSTOMER_DEMO_START_PATH } from "./customer/customerRoute";

export const CUSTOMER_HANDOFF_CONTRACT = "ubo-demo-customer-handoff-v1";
export const CUSTOMER_HANDOFF_READY = "ubo-demo-customer-handoff-ready-v1";
export const CUSTOMER_HANDOFF_DELIVERY = "ubo-demo-customer-handoff-delivery-v1";
export const CUSTOMER_HANDOFF_ACCEPTED = "ubo-demo-customer-handoff-accepted-v1";

// The engine can record hundreds or thousands of equivalent calculation
// routes for a dense control graph. The aggregate result and every graph
// relationship are durable; this ceiling applies only to the expanded,
// analyst-facing route examples carried through the browser save request.
// Keeping the total counts makes truncation explicit on restore.
export const MAX_DURABLE_PATHS_PER_BASIS = 256;

function withoutKeys(value, keys) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !omitted.has(key)));
}

function compactPath(path = {}) {
  return {
    pathId: path.pathId,
    state: path.state,
    relationshipIds: path.relationshipIds || [],
    contribution: path.contribution || null,
    // The referenced relationships already contain type, measurement and
    // endpoints. Persist their IDs rather than copying the same rich objects
    // into every combinatorial attribution chain.
    majorityStepRelationshipIds: (path.majoritySteps || []).map(({ relationshipId }) => relationshipId).filter(Boolean),
  };
}

function compactQualificationBasis(basis = {}) {
  const orderedPaths = basis.orderedPathReferences || [];
  const attributionChains = basis.attributionChains || [];
  return {
    basisId: basis.basisId,
    personEntityId: basis.personEntityId,
    route: basis.route,
    condition: basis.condition || null,
    dimension: basis.dimension,
    assessmentState: basis.assessmentState,
    method: basis.method,
    policyId: basis.policyId,
    policyVersion: basis.policyVersion,
    threshold: basis.threshold || null,
    recordedCalculation: basis.recordedCalculation ? {
      value: basis.recordedCalculation.value || null,
      cycles: (basis.recordedCalculation.cycles || []).map(({ cycleId }) => ({ cycleId })),
    } : null,
    aggregatedTargetRightValue: basis.aggregatedTargetRightValue || null,
    orderedPathReferences: orderedPaths.slice(0, MAX_DURABLE_PATHS_PER_BASIS).map(compactPath),
    attributionChains: attributionChains.slice(0, MAX_DURABLE_PATHS_PER_BASIS).map(compactPath),
    pathInventory: {
      orderedPathCount: orderedPaths.length,
      attributionChainCount: attributionChains.length,
      persistedOrderedPathCount: Math.min(orderedPaths.length, MAX_DURABLE_PATHS_PER_BASIS),
      persistedAttributionChainCount: Math.min(attributionChains.length, MAX_DURABLE_PATHS_PER_BASIS),
      truncated: orderedPaths.length > MAX_DURABLE_PATHS_PER_BASIS || attributionChains.length > MAX_DURABLE_PATHS_PER_BASIS,
    },
    reviewDependencies: basis.reviewDependencies || [],
    governance: basis.governance ? { requiredSignoffIds: basis.governance.requiredSignoffIds || [] } : null,
  };
}

function compactQualification(assessment = {}) {
  return {
    personEntityId: assessment.personEntityId,
    routeStatus: assessment.routeStatus,
    assessedRoutes: assessment.assessedRoutes || [],
    unassessedRoutes: assessment.unassessedRoutes || [],
  };
}

export function compactResearchResultForTransfer(researchResult) {
  if (!researchResult?.view?.graph) return researchResult;
  const view = researchResult.view;
  const graph = view.graph;
  const qualificationBases = (view.qualificationBases || graph.qualificationBasisRecords || []).map(compactQualificationBasis);
  const qualifications = (view.qualifications || graph.personQualificationAssessments || []).map(compactQualification);
  const viewFields = withoutKeys(view, ["snapshot", "qualificationBases", "qualifications", "graph"]);
  const graphFields = withoutKeys(graph, [
    "qualificationBasisRecords", "personQualificationAssessments", "companyAttributionAssessments",
    "llpAttributionAssessments", "layerClosureAssessments", "percentageEvidenceAssessments", "nodes",
  ]);
  const compactGraph = {
    ...graphFields,
    nodes: (graph.nodes || []).map((node) => withoutKeys(node, ["qualificationAssessment"])),
    qualificationBasisRecords: qualificationBases,
    personQualificationAssessments: qualifications,
  };
  return {
    ...researchResult,
    view: { ...viewFields, graph: compactGraph, qualificationBases, qualifications },
  };
}

export function resolveCustomerDemoUrl(location = window.location, configuredUrl = process.env.REACT_APP_UBO_CUSTOMER_DEMO_URL) {
  if (configuredUrl) return new URL(configuredUrl, location.origin);
  return new URL(CUSTOMER_DEMO_START_PATH, location.origin);
}

export function buildCustomerHandoff({ draft, demoCase, researchResult }, now = () => new Date().toISOString()) {
  if (!demoCase?.demoCaseId || !demoCase?.company?.legalName || !researchResult) {
    throw new TypeError("A completed demo case and research result are required for the customer handoff.");
  }
  return {
    contractVersion: CUSTOMER_HANDOFF_CONTRACT,
    createdAt: now(),
    draft,
    demoCase,
    researchResult: compactResearchResultForTransfer(researchResult),
  };
}

export function openCustomerViewHandoff(payload, {
  windowRef = window,
  configuredUrl = process.env.REACT_APP_UBO_CUSTOMER_DEMO_URL,
  timeoutMs = 10000,
  // A window opened at the click itself. Opened only after the case is saved,
  // the browser no longer counts it as the click's and may block it.
  openedWindow = null,
} = {}) {
  const target = resolveCustomerDemoUrl(windowRef.location, configuredUrl);
  if (!target) {
    return Promise.reject(new Error("The customer demo URL is not configured for this deployment."));
  }
  target.searchParams.set("handoff", CUSTOMER_HANDOFF_CONTRACT);
  target.searchParams.set("handoffOrigin", windowRef.location.origin);
  target.searchParams.set("case", payload.demoCase.demoCaseId);
  return new Promise((resolve, reject) => {
    let customerWindow;
    let timer;
    const finish = (error) => {
      windowRef.clearTimeout(timer);
      windowRef.removeEventListener("message", receive);
      if (error) reject(error); else resolve(target.href);
    };
    const receive = (event) => {
      if (event.origin !== target.origin || event.source !== customerWindow) return;
      if (event.data?.type === CUSTOMER_HANDOFF_READY) {
        customerWindow.postMessage({ type: CUSTOMER_HANDOFF_DELIVERY, payload }, target.origin);
      } else if (event.data?.type === CUSTOMER_HANDOFF_ACCEPTED
        && event.data?.contractVersion === CUSTOMER_HANDOFF_CONTRACT) finish();
    };
    windowRef.addEventListener("message", receive);
    if (openedWindow && !openedWindow.closed) {
      customerWindow = openedWindow;
      customerWindow.location.href = target.href;
    } else customerWindow = windowRef.open(target.href, "ubo-demo-customer-view");
    if (!customerWindow) {
      finish(new Error("The browser blocked the customer view. Allow pop-ups and try again."));
      return;
    }
    timer = windowRef.setTimeout(() => finish(new Error("The customer view opened but did not accept this case. Check that the customer demo is running and try again.")), timeoutMs);
  });
}

export function listenForCustomerHandoff(onHandoff, { windowRef = window } = {}) {
  const parameters = new URLSearchParams(windowRef.location.search);
  const sourceOrigin = parameters.get("handoffOrigin");
  if (parameters.get("handoff") !== CUSTOMER_HANDOFF_CONTRACT || !sourceOrigin || !windowRef.opener) return () => {};
  let trustedOrigin;
  try { trustedOrigin = new URL(sourceOrigin).origin; } catch (_) { return () => {}; }

  const receive = (event) => {
    if (event.origin !== trustedOrigin || event.source !== windowRef.opener || event.data?.type !== CUSTOMER_HANDOFF_DELIVERY) return;
    const delivered = event.data.payload;
    if (delivered?.contractVersion !== CUSTOMER_HANDOFF_CONTRACT || !delivered?.demoCase?.demoCaseId || !Array.isArray(delivered?.researchResult?.candidateSources)) return;
    onHandoff(delivered);
    windowRef.opener.postMessage({ type: CUSTOMER_HANDOFF_ACCEPTED, contractVersion: CUSTOMER_HANDOFF_CONTRACT }, trustedOrigin);
  };
  windowRef.addEventListener("message", receive);
  windowRef.opener.postMessage({ type: CUSTOMER_HANDOFF_READY, contractVersion: CUSTOMER_HANDOFF_CONTRACT }, trustedOrigin);
  return () => windowRef.removeEventListener("message", receive);
}
