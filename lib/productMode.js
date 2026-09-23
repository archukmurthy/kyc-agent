// Which product is this deployment?
//
// One codebase, two products. A deployment with PRODUCT_MODE=ubo serves the
// ownership review module and nothing else: the platform's admin, pre-boarding,
// super-admin and onboarding surfaces are not found, in the browser AND on the
// server.
//
// Honest about what this is: the platform code is still in the bundle, it is
// simply unreachable. For trials and early customers that is normal. A customer
// with a security review would want a build that does not contain it at all,
// which is a larger job (see docs/BACKLOG.md).
//
// The allow-list is duplicated in middleware.js, which runs on the Edge runtime
// and cannot require this file. A rule-test asserts the two lists match, so the
// duplication cannot drift.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const UBO_PATHS = Object.freeze([
  "/ubo-demo",
  "/ubo-trials",
  "/api/ubo-discovery",
  "/api/ubo-demo-customer-ownership-chart",
  "/api/ubo-demo-entity-resolution",
  "/api/ubo-invite",
  "/api/ubo-people",
  "/api/health",
  "/api/sign-out",
  "/api/company-search",
  "/api/document-requirements",
  "/api/track-event",
  "/api/upload-document",
  "/api/get-document",
]);

// Served in every mode: the app shell, its assets, and Clerk's own routes.
const ALWAYS = Object.freeze(["/static", "/favicon", "/manifest", "/robots", "/asset-manifest", "/index.html", "/__clerk"]);

function mode() {
  return (process.env.PRODUCT_MODE || "platform").toLowerCase();
}

function isUboOnly() {
  return mode() === "ubo";
}

/** Is this path served in the current mode? */
function isPathAllowed(pathname) {
  if (!isUboOnly()) return true;
  const path = String(pathname || "/");
  if (path === "/" || path === "") return true; // the shell decides what to show
  if (ALWAYS.some((prefix) => path.startsWith(prefix))) return true;
  return UBO_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
}

/** Refuses a request that this deployment does not serve. Returns true when it
 *  has answered, so a handler can `if (refuseIfHidden(req, res)) return;`. */
function refuseIfHidden(req, res) {
  const path = (req && (req.path || (req.url || "").split("?")[0])) || "";
  if (isPathAllowed(path)) return false;
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(404).json({ error: "not_found" });
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  }
  return true;
}

module.exports = { mode, isUboOnly, isPathAllowed, refuseIfHidden, UBO_PATHS, ALWAYS };
