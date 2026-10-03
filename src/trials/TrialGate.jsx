/**
 * TrialGate - what happens between signing in and seeing the UBO screens.
 *
 * Sits inside ClerkGate, so by the time it runs the person is signed in. Its
 * job is the next question: may they use this, and for how long?
 *
 *   arriving with ?invite=CODE   redeem it, then show the product
 *   already redeemed            show the product, with days remaining
 *   signed in, no invite        "you need an invitation" - not a sign-up form
 *   trial over or budget gone   show the product read-only, explain why
 *
 * Deliberately fails towards showing the product: if the status call itself
 * breaks, the screens still render. The server refuses anything that matters,
 * so a broken status check should not become an outage.
 */
import React, { useCallback, useEffect, useState } from "react";
import { redeemInvite, trialStatus } from "./trialApi";
import { isClerkEnabled } from "../auth/ClerkGate";

const BOX = {
  maxWidth: 560,
  margin: "64px auto",
  padding: "28px 32px",
  border: "1px solid #d8dee4",
  borderRadius: 10,
  fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
  lineHeight: 1.55,
};

function inviteCodeFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("invite") || "";
}

/** Strips ?invite= once used, so the code does not sit in the address bar,
 *  get bookmarked, or travel in a referrer header. */
function clearInviteFromUrl() {
  if (typeof window === "undefined" || !window.history) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

function daysLeft(endsAt) {
  const ms = Date.parse(endsAt) - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function TrialGate({ children }) {
  const [state, setState] = useState({ phase: "checking" });

  const load = useCallback(async () => {
    const code = inviteCodeFromUrl();
    try {
      if (code) {
        await redeemInvite(code);
        clearInviteFromUrl();
      }
      const status = await trialStatus();
      setState({ phase: status.inTrial ? "in" : "no-access", status });
    } catch (error) {
      if (error.code === "invite_full" || error.code === "invite_revoked" || error.code === "invite_invalid" || error.code === "already_in_trial") {
        setState({ phase: "bad-invite", reason: error.code });
        return;
      }
      // Anything else: let them through. The server still refuses what matters.
      setState({ phase: "in", status: null, degraded: true });
    }
  }, []);

  useEffect(() => {
    if (!isClerkEnabled()) {
      setState({ phase: "in", status: null });
      return;
    }
    load();
  }, [load]);

  if (state.phase === "checking") {
    return <div style={BOX}>Checking your access…</div>;
  }

  if (state.phase === "no-access") {
    return (
      <div style={BOX}>
        <h2 style={{ marginTop: 0 }}>You need an invitation</h2>
        <p>
          This is a private trial of the ownership review module. Your account exists, but it has not been
          added to a trial yet.
        </p>
        <p style={{ color: "#57606a" }}>
          If you were sent a link, open that link rather than this page - the invitation travels with it.
        </p>
      </div>
    );
  }

  if (state.phase === "bad-invite" && state.reason === "already_in_trial") {
    // Signing out comes back here with the invitation still in the address,
    // so the next sign-in uses it.
    const signOut = () => {
      try { window.Clerk?.signOut({ redirectUrl: window.location.href }); } catch (_) { /* Nothing to sign out of. */ }
    };
    return (
      <div style={BOX}>
        <h2 style={{ marginTop: 0 }}>This invitation cannot be used</h2>
        <p>This sign-in already belongs to another trial, sign out and sign in with a different email address.</p>
        <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/ubo-demo/">Go to your current trial</a>
          <button type="button" onClick={signOut}>Sign out</button>
        </p>
      </div>
    );
  }

  if (state.phase === "bad-invite") {
    const message = {
      invite_full: "That invitation has already been used by the maximum number of people.",
      invite_revoked: "That invitation has been withdrawn.",
      invite_invalid: "That invitation code was not recognised.",
    }[state.reason];
    return (
      <div style={BOX}>
        <h2 style={{ marginTop: 0 }}>This invitation cannot be used</h2>
        <p>{message}</p>
        <p style={{ color: "#57606a" }}>Ask whoever sent it for a new link.</p>
      </div>
    );
  }

  const status = state.status;
  const expired = status && status.readOnly;

  return (
    <>
      {status && status.inTrial ? (
        <div
          style={{
            padding: "8px 16px",
            background: expired ? "#fff4e5" : "#eef6ff",
            borderBottom: "1px solid #d8dee4",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            fontSize: 13,
          }}
        >
          {status.unmetered ? (
            <span>Owner account - your paid AI steps are not counted against this trial.</span>
          ) : expired ? (
            <span>
              <strong>Your trial has ended.</strong> Your work is still here and can be viewed, but new research is
              switched off. Get in touch to continue.
            </span>
          ) : (
            <span>
              Trial - {daysLeft(status.trialEndsAt)} day{daysLeft(status.trialEndsAt) === 1 ? "" : "s"} remaining
              {typeof status.budgetLeft === "number" ? `, ${status.budgetLeft} paid AI step${status.budgetLeft === 1 ? "" : "s"} left (research runs and document readings)` : ""}.
            </span>
          )}
        </div>
      ) : null}
      {children}
    </>
  );
}
