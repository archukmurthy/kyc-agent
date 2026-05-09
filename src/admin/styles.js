// Shared inline-style tokens for the admin UI. Matches the customer app's
// visual language (the same teal/navy palette) but adds a niumBlue sidebar
// for admin chrome.

export const tokens = {
  niumBlue: "#0B3D91",
  navy: "#1a3a4a",
  teal: "#4a9e8e",
  amber: "#e0a040",
  bgLight: "#f4f8f7",
  bgPanel: "#ffffff",
  border: "rgba(26,58,74,0.12)",
  borderStrong: "rgba(26,58,74,0.2)",
  textMuted: "#1a3a4a80",
  danger: "#dc2626",
};

export const card = {
  background: "rgba(255,255,255,0.95)",
  borderRadius: 14,
  border: "1px solid rgba(26,58,74,0.06)",
  boxShadow: "0 4px 20px rgba(26,58,74,0.05)",
  padding: "24px 28px",
  marginBottom: 16,
};

export const inputBase = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1.5px solid rgba(26,58,74,0.14)",
  fontSize: 14,
  fontFamily: "inherit",
  color: tokens.navy,
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
};

export const label = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: tokens.navy,
  marginBottom: 5,
};

export const btnPrimary = {
  padding: "10px 22px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  border: "none",
  background: tokens.navy,
  color: "#fff",
};

export const btnSecondary = {
  padding: "10px 22px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  background: "transparent",
  color: tokens.navy,
  border: `2px solid ${tokens.navy}`,
};

export const btnGreen = {
  ...btnPrimary,
  background: tokens.teal,
};

export const btnDanger = {
  ...btnPrimary,
  background: "#fff",
  color: tokens.danger,
  border: `1.5px solid ${tokens.danger}`,
};

export const pill = (bg, color) => ({
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 20,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.05em",
  background: bg,
  color: color,
});

export const sectionTitle = {
  fontSize: 18,
  fontWeight: 700,
  margin: "0 0 4px",
  color: tokens.navy,
};

export const sectionSub = {
  fontSize: 13,
  color: tokens.textMuted,
  margin: "0 0 18px",
};
