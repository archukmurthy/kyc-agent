import React, { useEffect, useState } from "react";
import { activePocCaseId, clearActivePocCase, hydrateBrowserFromPocCase, loadPocCase, rememberActivePocCase } from "./pocCaseClient";

export default function DurablePocCaseBoundary({ children }) {
  const [state, setState] = useState(() => activePocCaseId() ? { status: "LOADING" } : { status: "READY" });
  useEffect(() => {
    const caseId = activePocCaseId();
    if (!caseId) { setState({ status: "READY" }); return undefined; }
    const controller = new AbortController();
    loadPocCase(caseId, (url, options) => window.fetch(url, { ...options, signal: controller.signal }))
      .then((record) => {
        hydrateBrowserFromPocCase(record);
        rememberActivePocCase(caseId);
        setState({ status: "READY", caseId });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "ERROR", caseId, message: error.message });
      });
    return () => controller.abort();
  }, []);
  if (state.status === "LOADING") return <main className="ubo-demo-main ubo-demo-empty"><span>Restoring case</span><h1>Loading your saved ownership review…</h1><p>The server is restoring the latest submitted case state.</p></main>;
  if (state.status === "ERROR") return <main className="ubo-demo-main ubo-demo-empty"><span>Case unavailable</span><h1>We could not restore this saved case</h1><p>{state.message}</p><a href="/ubo-demo/" onClick={() => clearActivePocCase()}>Start a new case</a></main>;
  return children;
}
