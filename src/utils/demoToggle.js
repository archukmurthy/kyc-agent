// Visibility gate for the demo toggle — hidden on production end-customer URLs.
// Surfaces only with ?demo=true in the URL or on localhost. Not on ?tenant=:
// every real customer URL carries it now that tenant resolution is strict.
export function isDemoToggleVisible({ search, hostname } = {}) {
  try {
    if (new URLSearchParams(search || "").get("demo") === "true") return true;
  } catch (_) { /* ignore */ }
  return hostname === "localhost" || hostname === "127.0.0.1";
}
