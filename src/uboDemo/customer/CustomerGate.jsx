import React, { useEffect, useRef, useState } from "react";
import { hadCustomerVisit, leaveCustomerSession, onCustomerSessionEnded, openCustomerLink, rememberCustomerVisit, resumeCustomerSession } from "../../auth/customerSession";

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
 *
 * The link is read once, when the page first draws, and checked once: React
 * runs a page's start-up twice in development, and the first run removing the
 * link left the second thinking there was none - so the wrong person was shown
 * the staff preview instead of being told (found in the browser test).
 */
export default function CustomerGate({ children, fallback }) {
  const [state, setState] = useState({ phase: "checking" });
  const [link] = useState(() => new URL(window.location.href).searchParams.get("link"));
  const check = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (link) {
        const url = new URL(window.location.href);
        if (url.searchParams.has("link")) {
          url.searchParams.delete("link");
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        }
        if (!check.current) check.current = openCustomerLink(link);
        const opened = await check.current;
        if (!active) return;
        setState(opened.ok ? { phase: "customer" } : { phase: "refused", error: opened.payload?.error, message: opened.payload?.message });
        return;
      }
      const resumed = await resumeCustomerSession();
      // A session left in this browser for a different case (someone opened a
      // customer link here earlier) is not this visit's: the address names the
      // case being opened - an analyst's "customer view" of a new case. Leave
      // it rather than show, and write to, the other customer's review.
      const named = new URL(window.location.href).searchParams.get("case");
      if (resumed.ok && named && named !== resumed.payload?.caseId) {
        await leaveCustomerSession();
        if (active) setState({ phase: "not-customer" });
        return;
      }
      // A session this tab held and the server now refuses - its link was
      // replaced or withdrawn, or a lapsed sign-in cleared its cookie - is a
      // customer to be told so, not an analyst for the staff gate.
      const ended = !resumed.ok && (resumed.payload?.error === "customer_session_invalid" || hadCustomerVisit());
      if (active) setState({ phase: resumed.ok ? "customer" : ended ? "ended" : "not-customer" });
    })().catch(() => { if (active) setState({ phase: "not-customer" }); });
    return () => { active = false; };
  }, [link]);

  useEffect(() => {
    if (state.phase !== "customer") return undefined;
    rememberCustomerVisit();
    // Refused while the page is open: a save, an upload or the page's own
    // periodic check was turned away because the session ended.
    return onCustomerSessionEnded(() => setState({ phase: "ended" }));
  }, [state.phase]);

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
  if (state.phase === "ended") {
    return (
      <main className="ubo-demo-main ubo-demo-empty">
        <span>Link no longer active</span>
        <h1>This link has been replaced or has ended</h1>
        <p>Ask the person who sent it for a new link. If you were signed out, open the link you were sent again. Your answers so far are saved.</p>
      </main>
    );
  }
  if (state.phase === "customer") return children;
  return fallback ? fallback(children) : children;
}
