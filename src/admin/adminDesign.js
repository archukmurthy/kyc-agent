// Design tokens for the Session-A admin platform (AdminRoot / AdminDashboard /
// AdminWizard and steps). Re-exports the legacy admin palette from styles.js so
// the two share a single source of truth and adds tokens specific to the
// dashboard + wizard UI (status badges, quick-action cards, wizard cards).

import { tokens as legacyTokens } from "./styles";

export const adminColors = {
  // Shared brand palette
  ...legacyTokens,
  niumBlue: legacyTokens.niumBlue,
  navy: legacyTokens.navy,
  teal: legacyTokens.teal,
  amber: legacyTokens.amber,
  danger: legacyTokens.danger,
  text: legacyTokens.navy,
  textMuted: legacyTokens.textMuted,
  border: "#E2E0D9",
  borderStrong: legacyTokens.borderStrong,

  // Admin sidebar (used by mini-wizards / future Session B nav)
  sidebarBg: "#0B3D91",
  sidebarText: "#FFFFFF",
  sidebarTextMuted: "rgba(255,255,255,0.6)",
  sidebarActiveBg: "#FFFFFF",
  sidebarActiveText: "#0B3D91",

  // Status indicators
  statusComplete: "#2E7D32",
  statusCompleteBg: "#E8F5E9",
  statusIncomplete: "#B45309",
  statusIncompleteBg: "#FFFBEB",
  statusEmpty: "#9C9A94",
  statusEmptyBg: "#F2F1ED",

  // Wizard
  wizardBg: "#F7F6F2",
  wizardCardBg: "#FFFFFF",

  // Dashboard
  dashboardBg: "#F0EEF8",
  quickActionBg: "#FFFFFF",
  quickActionHover: "#F7F6F2",
  quickActionBorder: "#E2E0D9",
};

export const adminStyles = {
  pageWrapper: {
    minHeight: "100vh",
    background: adminColors.dashboardBg,
    fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
    color: adminColors.text,
  },

  pageInner: {
    maxWidth: 1080,
    margin: "0 auto",
    padding: "32px 28px 64px",
  },

  wizardWrapper: {
    minHeight: "100vh",
    background: adminColors.wizardBg,
    fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
    color: adminColors.text,
    display: "flex",
    flexDirection: "column",
  },

  wizardCard: {
    background: adminColors.wizardCardBg,
    borderRadius: 12,
    border: `1px solid ${adminColors.border}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.06)",
    padding: 32,
    maxWidth: 720,
    margin: "0 auto",
  },

  quickActionCard: {
    background: adminColors.quickActionBg,
    borderRadius: 12,
    border: `1px solid ${adminColors.quickActionBorder}`,
    padding: 20,
    cursor: "pointer",
    transition: "transform .15s, box-shadow .15s, background .15s",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    textAlign: "left",
    width: "100%",
    fontFamily: "inherit",
  },

  statusBadge: (status) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 12px",
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 600,
    background:
      status === "complete"
        ? adminColors.statusCompleteBg
        : status === "incomplete"
        ? adminColors.statusIncompleteBg
        : adminColors.statusEmptyBg,
    color:
      status === "complete"
        ? adminColors.statusComplete
        : status === "incomplete"
        ? adminColors.statusIncomplete
        : adminColors.statusEmpty,
    border: "1px solid transparent",
  }),

  btnPrimary: {
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    border: "none",
    background: adminColors.niumBlue,
    color: "#fff",
  },

  btnSecondary: {
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    background: "#fff",
    color: adminColors.niumBlue,
    border: `1.5px solid ${adminColors.niumBlue}`,
  },

  btnGhost: {
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    background: "transparent",
    color: adminColors.text,
    border: "1px solid transparent",
  },

  input: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: `1.5px solid ${adminColors.borderStrong}`,
    fontSize: 14,
    fontFamily: "inherit",
    color: adminColors.text,
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
  },

  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: adminColors.text,
    marginBottom: 6,
  },

  helper: {
    fontSize: 12,
    color: adminColors.textMuted,
    marginTop: 4,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    margin: "0 0 4px",
    color: adminColors.text,
  },

  sectionSub: {
    fontSize: 13,
    color: adminColors.textMuted,
    margin: "0 0 16px",
  },
};

export default adminColors;
