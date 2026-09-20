export const DEMO_START_PATH = "/ubo-demo/";
export const DEMO_RESEARCH_PATH = "/ubo-demo/research";

export function isUboDemoPath(pathname) {
  return pathname === "/ubo-demo" || pathname.startsWith("/ubo-demo/");
}

export function isDemoResearchPath(pathname) {
  return pathname === DEMO_RESEARCH_PATH || pathname === `${DEMO_RESEARCH_PATH}/`;
}

export function navigateDemo(pathname, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, "", pathname);
  else window.history.pushState({}, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
