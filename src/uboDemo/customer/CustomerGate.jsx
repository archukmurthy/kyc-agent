import React, { useEffect, useState } from "react";
import { openCustomerLink, resumeCustomerSession } from "../../auth/customerSession";

/**
 * In front of the customer screens (docs/ubo/CUSTOMER-LINK-PLAN.md).
 *
 *   arriving with ?link=...   exchange it for a session for that one case -
 *                              the person must be signed in with the address
 *                              the link was sent to (the server checks)
 *   a session already open     resume it (full page loads forget memory)
 *   neither                    not a customer: an analyst trying the customer
 *                              view, who goes through `fallback` (the trial
 *                              gate), exactly as before
 *
 * The link is taken off the address bar once used, so it is not left in the
 * browser's history or shown to anyone looking at the screen.
 */
export default function CustomerGate({ children, fallback }) {
  const [state, setState] = useState({ phase: "checking" });

  useEffect(() => {
    let active = true;
    (async () => {
      const url = new URL(window.location.href);
      const link = url.searchParams.get("link");
      if (link) {
        url.searchParams.delete("link");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        const opened = await openCustomerLink(link);
        if (!active) return;
        setState(opened.ok ? { phase: "customer" } : { phase: "refused", error: opened.payload?.error, message: opened.payload?.message });
        return;
      }
      const resumed = await resumeCustomerSession();
      if (active) setState({ phase: resumed.ok ? "customer" : "not-customer" });
    })().catch(() => { if (active) setState({ phase: "not-customer" }); });
    return () => { active = false; };
  }, []);

  if (state.phase === "checking") {
    return <main className="ubo-demo-main ubo-demo-empty"><span>Opening</span><h1>Opening your ownership review…</h1></main>;
  }
  if (state.phase === "refused") {
    return (
      <main className="ubo-demo-main ubo-demo-empty">
        <span>Link not accepted</span>
        <h1>{state.error === "wrong_recipient" ? "This link was sent to a different email address" : "This link cannot be opened"}</h1>
        <p>{state.message || "Ask the person who sent it for a new link."}</p>
      </main>
    );
  }
  if (state.phase === "customer") return children;
  return fallback ? fallback(children) : children;
}
