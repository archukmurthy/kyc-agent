/**
 * ClerkGate - the login wall in front of the UBO surfaces.
 *
 * Wraps a screen so only a signed-in user sees it. Two deliberate properties:
 *
 * 1. It is INERT without a key. When REACT_APP_CLERK_PUBLISHABLE_KEY is unset
 *    the children render exactly as before, so the demo keeps working for
 *    anyone running this repo without a Clerk account. Setting the key is what
 *    turns the login on - the same switch the server uses with
 *    CLERK_SECRET_KEY.
 *
 * 2. It renders the sign-in form in place rather than redirecting. The app has
 *    no router; a redirect would need routes that do not exist.
 */
import React, { useEffect } from "react";
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";
import { leaveCustomerSession } from "./customerSession";

/** Signed out - by Clerk's own menu, an expired sign-in, or any sign-out
 *  button: a customer session cookie left in this browser goes too, so the
 *  next person to sign in here never picks up somebody's review (review,
 *  2026-10-09). The cookie cannot be seen from a script, so it is asked for
 *  once per signed-out page. */
function ForgetCustomerSession() {
  useEffect(() => {
    try { leaveCustomerSession(); } catch (_) { /* No network: nothing to forget. */ }
  }, []);
  return null;
}

const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY || "";

/** The page being guarded, so sign-in returns to it rather than to whatever
 *  Clerk has configured as the application home. */
function currentUrl() {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

export function isClerkEnabled() {
  // A branch-scoped UBO Preview may deliberately use the server's fixed demo
  // tenant instead of Clerk. Even if a shared Preview key exists, this explicit
  // browser flag keeps that one build on the matching demo path. The server
  // independently refuses the fallback outside VERCEL_ENV=preview.
  return Boolean(PUBLISHABLE_KEY) && process.env.REACT_APP_UBO_PREVIEW_DEMO_MODE !== "true";
}

export default function ClerkGate({ children }) {
  if (!isClerkEnabled()) return children;

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <SignedIn>
        <div style={{ position: "absolute", top: 12, right: 16, zIndex: 50 }}>
          <UserButton afterSignOutUrl={window.location.pathname} />
        </div>
        {children}
      </SignedIn>
      <SignedOut>
        <ForgetCustomerSession />
        <div style={{ display: "flex", justifyContent: "center", padding: "48px 16px" }}>
          {/* Come back to the page the person was trying to reach. Without
              these, Clerk sends them to its configured home URL, which on a
              development instance defaults to localhost:3000 - somebody else's
              app if you happen to be running two. */}
          <SignIn
            routing="virtual"
            forceRedirectUrl={currentUrl()}
            signUpForceRedirectUrl={currentUrl()}
          />
        </div>
      </SignedOut>
    </ClerkProvider>
  );
}
