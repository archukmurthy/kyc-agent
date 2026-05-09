import React from "react";
import ReactDOM from "react-dom/client";
import KYCAgent from "./App";
import AdminApp from "./admin/AdminApp";

const path = window.location.pathname;
const root = ReactDOM.createRoot(document.getElementById("root"));

let tree;
if (path === "/admin" || path.startsWith("/admin/")) {
  tree = <AdminApp />;
} else if (path === "/preview" || path.startsWith("/preview/")) {
  // Preview mode loads the customer flow with the unsaved admin config
  // pulled from sessionStorage. The flag tells App to source config from
  // sessionStorage rather than /api/config and to render a banner.
  tree = <KYCAgent previewMode />;
} else {
  tree = <KYCAgent />;
}

root.render(<React.StrictMode>{tree}</React.StrictMode>);
