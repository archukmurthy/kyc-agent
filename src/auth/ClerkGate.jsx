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
import React from "react";
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";

const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY || "";

export function isClerkEnabled() {
  return Boolean(PUBLISHABLE_KEY);
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
        <div style={{ display: "flex", justifyContent: "center", padding: "48px 16px" }}>
          <SignIn routing="virtual" />
        </div>
      </SignedOut>
    </ClerkProvider>
  );
}
