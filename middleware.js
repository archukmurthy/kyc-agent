/**
 * One guard in front of every request.
 *
 * A deployment with PRODUCT_MODE=ubo serves the ownership review module and
 * nothing else. Hiding screens in the browser stops nobody - anyone can type
 * /admin, or post to an API route directly - so the refusal happens here,
 * before any handler runs.
 *
 * The lists below are duplicated from lib/productMode.js because this file runs
 * on the Edge runtime and cannot require a CommonJS module. A rule-test asserts
 * the two copies match, so the duplication cannot drift unnoticed.
 */

const UBO_PATHS = [
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
];

const ALWAYS = ["/static", "/favicon", "/manifest", "/robots", "/asset-manifest", "/index.html", "/__clerk"];

export const config = {
  // Everything except Vercel's own internals.
  matcher: ["/((?!_next|_vercel).*)"],
};

export default function middleware(request) {
  if ((process.env.PRODUCT_MODE || "platform").toLowerCase() !== "ubo") return undefined;

  const { pathname } = new URL(request.url);
  if (pathname === "/") return undefined;
  if (ALWAYS.some((prefix) => pathname.startsWith(prefix))) return undefined;
  if (UBO_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return undefined;

  // Deliberately a plain 404 with no explanation. A deployment that says "this
  // exists but is disabled here" tells a stranger what else to look for.
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
