import React, { useState } from "react";
import { clerkAuthHeaders } from "../auth/clerkFetch";
import { CUSTOMER_DEMO_START_PATH } from "./customer/customerRoute";

/**
 * The analyst sends the customer a link to this one case
 * (docs/ubo/CUSTOMER-LINK-PLAN.md). The link works only for the email address
 * entered here - the customer proves it with a code Clerk emails them - lasts
 * 30 days, and can be withdrawn. It is shown to be copied and sent by the
 * analyst; nothing is emailed from here.
 *
 * `prepare` saves the case and refuses while research could still change who
 * needs identity verification - the same check the hand-off makes.
 */
async function post(body) {
  const response = await fetch("/api/ubo-customer-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await clerkAuthHeaders()) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "The customer link could not be made.");
  return payload;
}

export function customerLinkUrl(token, origin = window.location.origin) {
  return `${origin}${CUSTOMER_DEMO_START_PATH}?link=${encodeURIComponent(token)}`;
}

export default function CustomerLinkPanel({ caseId, prepare }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const create = async (event) => {
    event.preventDefault();
    setState({ kind: "pending" });
    setCopied(false);
    try {
      if (prepare) await prepare();
      const made = await post({ action: "create", caseId, email });
      setState({ kind: "made", url: customerLinkUrl(made.token), expiresAt: made.expiresAt, email });
    } catch (cause) {
      setState({ kind: "error", message: cause.message });
    }
  };

  const withdraw = async () => {
    try {
      await post({ action: "revoke", caseId });
      setState({ kind: "withdrawn" });
    } catch (cause) {
      setState({ kind: "error", message: cause.message });
    }
  };

  return (
    <section className="ubo-demo-customer-link" aria-label="Send the customer a link">
      <h2>Send the customer their link</h2>
      <p>Only the address you enter can open it - they confirm it with a code we email them. It lasts 30 days, and you can withdraw it.</p>
      <form onSubmit={create}>
        <label htmlFor="ubo-customer-link-email">Customer's email address</label>
        <input id="ubo-customer-link-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <button type="submit" className="ubo-demo-secondary" disabled={state.kind === "pending"}>
          {state.kind === "pending" ? "Making link…" : "Create customer link"}
        </button>
      </form>
      {state.kind === "made" && (
        <div role="status">
          <p>Only <strong>{state.email}</strong> can open this link, until {new Date(state.expiresAt).toLocaleDateString()}. Copy it and send it to them.</p>
          <input readOnly aria-label="Customer link" value={state.url} onFocus={(event) => event.target.select()} />
          <button type="button" className="ubo-demo-secondary" onClick={async () => { await navigator.clipboard?.writeText(state.url); setCopied(true); }}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="ubo-demo-secondary" onClick={withdraw}>Withdraw every link for this case</button>
        </div>
      )}
      {state.kind === "withdrawn" && <p role="status">Every link for this case has been withdrawn. The customer's open session has ended too.</p>}
      {state.kind === "error" && <p role="alert">{state.message}</p>}
    </section>
  );
}
