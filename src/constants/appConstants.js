// Maps this app's ownership-type IDs to the key strings the DRS engine's
// normaliseEntityType() recognises (it keys off labels like "Public Listed
// Company" / "LLP", not our IDs). Unmapped IDs fall through to the engine's
// safe "Privately owned" default. entityType is passed separately as the
// entity LABEL (e.g. "Financial Institution") so the engine's FI/sector/
// Wolfsberg detection works.
export const OWNERSHIP_ID_TO_DRS = {
  public_listed: "Public Listed Company",
  public_unlisted: "Private Limited",
  private_limited: "Private Limited",
  llp: "LLP",
  general_partnership: "Partnership",
  sole_trader: "Sole Trader",
  trust: "Trust",
  government: "State Owned",
  central_bank: "State Owned",
  charity: "Private Limited",
  foundation: "Private Limited",
  cooperative: "Private Limited",
  branch: "Private Limited",
  spv: "Private Limited",
  holding_company: "Private Limited",
  joint_venture: "Private Limited",
  correspondent_bank: "Public Listed Company",
  payment_institution: "Private Limited",
  investment_fund: "Private Limited",
  insurance_company: "Private Limited",
  other: "Private Limited",
};

/* ═══════════════════════════════════════════
   APP-LEVEL CONSTANTS
   Edit here when product config changes.
   ═══════════════════════════════════════════ */
// Testing-only affordances (Dummy Research, Demo mode, Fill with test data,
// Upload-all). Shown automatically in local dev (`npm start`), and on the
// deployed/production site ONLY when the URL carries ?test=1 — so normal
// customers never see them, but you can enable them on Vercel for QA by
// visiting e.g. https://kyc-agent-deploy.vercel.app/?test=1
export const TEST_FLAG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("test") === "1";
export const SHOW_TEST_TOOLS = process.env.NODE_ENV !== "production" || TEST_FLAG;

export const MANUAL_FORM_URL = "https://example.com/apply";
// TODO: replace with actual product form URL

export const CACHE_STALE_DAYS = 90;
// Number of days before cached research is considered stale (used by Session 2 cache layer)

/* ═══════════════════════════════════════════
   COUNTRY LIST
   ═══════════════════════════════════════════ */
export const COUNTRIES = [
  { code: "GB", name: "United Kingdom" },{ code: "SG", name: "Singapore" },
  { code: "US", name: "United States" },{ code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },{ code: "NL", name: "Netherlands" },
  { code: "LT", name: "Lithuania" },{ code: "JP", name: "Japan" },
  { code: "HK", name: "Hong Kong" },{ code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },{ code: "DE", name: "Germany" },
  { code: "FR", name: "France" },{ code: "IE", name: "Ireland" },
  { code: "IN", name: "India" },{ code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },{ code: "PH", name: "Philippines" },
  { code: "KR", name: "South Korea" },{ code: "CN", name: "China" },
  { code: "TW", name: "Taiwan" },{ code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },{ code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },{ code: "KE", name: "Kenya" },
  { code: "EG", name: "Egypt" },{ code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },{ code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },{ code: "CO", name: "Colombia" },
  { code: "ES", name: "Spain" },{ code: "IT", name: "Italy" },
  { code: "CH", name: "Switzerland" },{ code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },{ code: "DK", name: "Denmark" },
  { code: "PL", name: "Poland" },{ code: "TR", name: "Turkey" },
  { code: "IL", name: "Israel" },{ code: "NZ", name: "New Zealand" },
  { code: "PK", name: "Pakistan" },{ code: "BD", name: "Bangladesh" },
  { code: "LK", name: "Sri Lanka" },{ code: "AM", name: "Armenia" },
];
