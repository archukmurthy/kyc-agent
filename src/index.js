import React from "react";
import ReactDOM from "react-dom/client";
import KYCAgent from "./App";
import AdminRoot from "./admin/AdminRoot";
import SuperAdminRoot from "./superadmin/SuperAdminRoot";
import ChangeIntelligenceRoot from "./components/changeIntelligenceDashboard/ChangeIntelligenceRoot";
import PolicySimulator from "./policySimulator/PolicySimulator";
import UboDemoRoot from "./uboDemo/UboDemoRoot";
import { isUboDemoPath } from "./uboDemo/demoRoute";
import CustomerOwnershipChartPage from "./uboDemo/customer/CustomerOwnershipChartPage";
import CustomerCompanyPage from "./uboDemo/customer/CustomerCompanyPage";
import { isCustomerCompanyPath, isCustomerOwnershipChartPath } from "./uboDemo/customer/customerRoute";
import ClerkGate from "./auth/ClerkGate";
import TrialGate from "./trials/TrialGate";
import TrialAdmin from "./trials/TrialAdmin";
import PeopleAdmin from "./people/PeopleAdmin";

// One codebase, two products. A deployment built with REACT_APP_PRODUCT_MODE=ubo
// shows the ownership review module and nothing else. The server refuses the
// rest as well (middleware.js) - this half only stops the screens rendering.
const UBO_ONLY = (process.env.REACT_APP_PRODUCT_MODE || "platform").toLowerCase() === "ubo";

const path = window.location.pathname;
const search = new URLSearchParams(window.location.search);
// Pre-boarding has its own path (/preboarding?tenant=<id>), mirroring /admin.
// The legacy ?preboarding=1 param is still recognised so old bookmarks work;
// App.js redirects those to the new path.
const isPreboardingPath = path === "/preboarding" || path.startsWith("/preboarding/");
const isPreboarding = isPreboardingPath || search.get("preboarding") === "1";
const root = ReactDOM.createRoot(document.getElementById("root"));

// Tab title reflects which surface is open. Tenant Admin never carries the
// tenant name (it's the same label for Barclays, HSBC, or any tenant), and any
// screen outside the three labelled surfaces falls back to the bare product
// name with no separator rather than guessing at a label.
let tree;
let title = "KYC Onboarding Agent";
const isPolicySimulator = path === "/policy-simulator" || path.startsWith("/policy-simulator/");
document.body.classList.toggle("policy-simulator-page", isPolicySimulator);

// The UBO surfaces sit behind a Clerk login. ClerkGate is inert until
// REACT_APP_CLERK_PUBLISHABLE_KEY is set, so these render unchanged until the
// keys land - the same switch the API uses with CLERK_SECRET_KEY.
if (path === "/ubo-trials" || path.startsWith("/ubo-trials/")) {
  // Owner-only screen for creating trial links. Hiding it is convenience; the
  // check that matters is in api/ubo-invite.js, on every call.
  tree = <ClerkGate><TrialAdmin /></ClerkGate>;
  title = "Trial invitations | Ownership review";
} else if (path === "/ubo-people" || path.startsWith("/ubo-people/")) {
  // Owners and admins manage who works here. Hiding it from an analyst is
  // convenience; the check that matters is in api/ubo-people.js, on every call.
  tree = <ClerkGate><PeopleAdmin /></ClerkGate>;
  title = "People | Ownership review";
} else if (isCustomerOwnershipChartPath(path)) {
  tree = <ClerkGate><TrialGate><CustomerOwnershipChartPage /></TrialGate></ClerkGate>;
  title = "Upload ownership chart | Ownership review demo";
} else if (isCustomerCompanyPath(path)) {
  tree = <ClerkGate><TrialGate><CustomerCompanyPage /></TrialGate></ClerkGate>;
  title = "Company details | Ownership review demo";
} else if (isUboDemoPath(path)) {
  tree = <ClerkGate><TrialGate><UboDemoRoot /></TrialGate></ClerkGate>;
  title = "Ownership review demo";
} else if (UBO_ONLY) {
  // Anything outside the UBO surfaces simply does not exist here. Deliberately
  // plain: a page that says "this is disabled in this deployment" tells a
  // stranger what else to go looking for.
  tree = (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: "64px 24px", textAlign: "center", color: "#57606a" }}>
      <h1 style={{ fontSize: 20, color: "#24292f" }}>Page not found</h1>
      <p>
        <a href="/ubo-demo" style={{ color: "#1a3a4a" }}>Go to the ownership review</a>
      </p>
    </div>
  );
  title = "Not found";
} else if (isPolicySimulator) {
  tree = <PolicySimulator />;
  title = "UK KYB Policy Simulator";
} else if (path === "/super-admin" || path.startsWith("/super-admin/")) {
  tree = <SuperAdminRoot />;
  title = "KYC Onboarding Agent | Super Admin";
} else if (path === "/insights" || path.startsWith("/insights/")) {
  // Internal, read-only Change Intelligence dashboard (gated by the admin token).
  // Not one of the three labelled surfaces — bare product name.
  tree = <ChangeIntelligenceRoot />;
  title = "KYC Onboarding Agent";
} else if (path === "/admin" || path.startsWith("/admin/")) {
  tree = <AdminRoot />;
  title = "KYC Onboarding Agent | Tenant Admin";
} else if (isPreboardingPath) {
  tree = <KYCAgent preboarding />;
  title = "KYC Onboarding Agent | Pre-boarding";
} else if (path === "/preview" || path.startsWith("/preview/")) {
  // Preview mode loads the customer flow with the unsaved admin config
  // pulled from sessionStorage. The flag tells App to source config from
  // sessionStorage rather than /api/config and to render a banner.
  tree = <KYCAgent previewMode preboarding={isPreboarding} />;
  title = isPreboarding
    ? "KYC Onboarding Agent | Pre-boarding"
    : "KYC Onboarding Agent";
} else {
  // Customer-facing onboarding flow lives here; the legacy ?preboarding=1
  // link also lands here just long enough for App.js's redirect effect to
  // send it to /preboarding.
  tree = <KYCAgent />;
  title = isPreboarding
    ? "KYC Onboarding Agent | Pre-boarding"
    : "KYC Onboarding Agent";
}

document.title = title;
root.render(<React.StrictMode>{tree}</React.StrictMode>);
