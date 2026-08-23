import React from "react";
import ReactDOM from "react-dom/client";
import KYCAgent from "./App";
import AdminRoot from "./admin/AdminRoot";
import SuperAdminRoot from "./superadmin/SuperAdminRoot";
import ChangeIntelligenceRoot from "./components/changeIntelligenceDashboard/ChangeIntelligenceRoot";
import PolicySimulator from "./policySimulator/PolicySimulator";

const path = window.location.pathname;
// Pre-boarding agent vs. the plain customer onboarding flow is distinguished by
// the ?preboarding=1 query param, not the path — both render <KYCAgent/>.
const isPreboarding =
  new URLSearchParams(window.location.search).get("preboarding") === "1";
const root = ReactDOM.createRoot(document.getElementById("root"));

// Tab title reflects which surface is open. Tenant Admin never carries the
// tenant name (it's the same label for Barclays, HSBC, or any tenant), and any
// screen outside the three labelled surfaces falls back to the bare product
// name with no separator rather than guessing at a label.
let tree;
let title = "KYC Onboarding Agent";
const isPolicySimulator = path === "/policy-simulator" || path.startsWith("/policy-simulator/");
document.body.classList.toggle("policy-simulator-page", isPolicySimulator);

if (isPolicySimulator) {
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
} else if (path === "/preview" || path.startsWith("/preview/")) {
  // Preview mode loads the customer flow with the unsaved admin config
  // pulled from sessionStorage. The flag tells App to source config from
  // sessionStorage rather than /api/config and to render a banner.
  tree = <KYCAgent previewMode />;
  title = isPreboarding
    ? "KYC Onboarding Agent | Pre-boarding"
    : "KYC Onboarding Agent";
} else {
  // Customer-facing onboarding flow and the pre-boarding agent both live here.
  // Pre-boarding (?preboarding=1) is labelled; the plain customer onboarding
  // flow carries no separator.
  tree = <KYCAgent />;
  title = isPreboarding
    ? "KYC Onboarding Agent | Pre-boarding"
    : "KYC Onboarding Agent";
}

document.title = title;
root.render(<React.StrictMode>{tree}</React.StrictMode>);
