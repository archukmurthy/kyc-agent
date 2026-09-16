export const CUSTOMER_HANDOFF_CONTRACT = "ubo-demo-customer-handoff-v1";
export const CUSTOMER_HANDOFF_READY = "ubo-demo-customer-handoff-ready-v1";
export const CUSTOMER_HANDOFF_DELIVERY = "ubo-demo-customer-handoff-delivery-v1";
export const CUSTOMER_HANDOFF_ACCEPTED = "ubo-demo-customer-handoff-accepted-v1";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function resolveCustomerDemoUrl(location = window.location, configuredUrl = process.env.REACT_APP_UBO_CUSTOMER_DEMO_URL) {
  if (configuredUrl) return new URL(configuredUrl, location.origin);
  if (LOCAL_HOSTS.has(location.hostname)) return new URL(`${location.protocol}//${location.hostname}:3002/ubo-demo/`);
  return null;
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
    researchResult,
  };
}

export function openCustomerViewHandoff(payload, {
  windowRef = window,
  configuredUrl = process.env.REACT_APP_UBO_CUSTOMER_DEMO_URL,
  timeoutMs = 10000,
} = {}) {
  const target = resolveCustomerDemoUrl(windowRef.location, configuredUrl);
  if (!target) {
    return Promise.reject(new Error("The customer demo URL is not configured for this deployment."));
  }
  target.searchParams.set("handoff", CUSTOMER_HANDOFF_CONTRACT);
  target.searchParams.set("handoffOrigin", windowRef.location.origin);
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
    customerWindow = windowRef.open(target.href, "ubo-demo-customer-view");
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
