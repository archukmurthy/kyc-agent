import React, { useEffect, useState } from "react";
import { activePocCaseId, clearActivePocCase, hydrateBrowserFromPocCase, loadPocCase, rememberActivePocCase } from "./pocCaseClient";
import { currentCustomerSession } from "../auth/customerSession";
import { forgetLegacyBrowserCopies } from "./browserStore";

// A customer's session names their case; otherwise the case this browser was last on.
const caseToRestore = () => currentCustomerSession()?.caseId || activePocCaseId();

export default function DurablePocCaseBoundary({ children }) {
  const [state, setState] = useState(() => caseToRestore() ? { status: "LOADING" } : { status: "READY" });
  useEffect(() => {
    // Earlier versions kept the case, names included, in the browser (UBO-22).
    forgetLegacyBrowserCopies();
    const caseId = caseToRestore();
    if (!caseId) { setState({ status: "READY" }); return undefined; }
    const controller = new AbortController();
    loadPocCase(caseId, (url, options) => window.fetch(url, { ...options, signal: controller.signal }))
      .then((record) => {
        hydrateBrowserFromPocCase(record);
        rememberActivePocCase(caseId);
        setState({ status: "READY", caseId });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "ERROR", caseId, code: error.code, message: error.message });
      });
    return () => controller.abort();
  }, []);
  if (state.status === "LOADING") return <main className="ubo-demo-main ubo-demo-empty"><span>Restoring case</span><h1>Loading your saved ownership review…</h1><p>The server is restoring the latest submitted case state.</p></main>;
  // Not found means not in the workspace this sign-in belongs to. Usually the
  // same browser was signed in as the customer to open their link, then used
  // for the analyst's case (live end-to-end check, 2026-10-08) - say so.
  if (state.status === "ERROR" && state.code === "case_not_found") return <main className="ubo-demo-main ubo-demo-empty"><span>Case unavailable</span><h1>This case is not in the account you are signed in to</h1><p>Cases belong to the workspace that created them. If you signed in as the customer in this browser to open their link, sign out and sign back in as the analyst.</p><button type="button" className="ubo-demo-primary" onClick={() => { clearActivePocCase(); window.Clerk?.signOut?.({ redirectUrl: "/ubo-demo/" }); }}>Sign out</button> <a href="/ubo-demo/" onClick={() => clearActivePocCase()}>Start a new case</a></main>;
  if (state.status === "ERROR") return <main className="ubo-demo-main ubo-demo-empty"><span>Case unavailable</span><h1>We could not restore this saved case</h1><p>{state.message}</p><a href="/ubo-demo/" onClick={() => clearActivePocCase()}>Start a new case</a></main>;
  return children;
}
