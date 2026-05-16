// Country list used by the admin UI for jurisdiction and country-coverage
// selectors. Mirrors the COUNTRIES list in src/App.js — keep in sync if you
// add markets there.
export const COUNTRIES = [
  { code: "GB", name: "United Kingdom" },
  { code: "SG", name: "Singapore" },
  { code: "US", name: "United States" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "NL", name: "Netherlands" },
  { code: "LT", name: "Lithuania" },
  { code: "JP", name: "Japan" },
  { code: "HK", name: "Hong Kong" },
  { code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "IE", name: "Ireland" },
  { code: "IN", name: "India" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "PH", name: "Philippines" },
  { code: "KR", name: "South Korea" },
  { code: "CN", name: "China" },
  { code: "TW", name: "Taiwan" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "EG", name: "Egypt" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "CH", name: "Switzerland" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "PL", name: "Poland" },
  { code: "TR", name: "Turkey" },
  { code: "IL", name: "Israel" },
  { code: "NZ", name: "New Zealand" },
  { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" },
  { code: "LK", name: "Sri Lanka" },
  { code: "AM", name: "Armenia" },
];

// A few flag emojis for known jurisdictions. Falls back to a generic globe.
const FLAGS = {
  GB: "🇬🇧", SG: "🇸🇬", US: "🇺🇸", AU: "🇦🇺", CA: "🇨🇦", NL: "🇳🇱", LT: "🇱🇹", JP: "🇯🇵",
  HK: "🇭🇰", MY: "🇲🇾", ID: "🇮🇩", DE: "🇩🇪", FR: "🇫🇷", IE: "🇮🇪", IN: "🇮🇳", TH: "🇹🇭",
  VN: "🇻🇳", PH: "🇵🇭", KR: "🇰🇷", CN: "🇨🇳", TW: "🇹🇼", AE: "🇦🇪", SA: "🇸🇦", ZA: "🇿🇦",
  NG: "🇳🇬", KE: "🇰🇪", EG: "🇪🇬", BR: "🇧🇷", MX: "🇲🇽", AR: "🇦🇷", CL: "🇨🇱", CO: "🇨🇴",
  ES: "🇪🇸", IT: "🇮🇹", CH: "🇨🇭", SE: "🇸🇪", NO: "🇳🇴", DK: "🇩🇰", PL: "🇵🇱", TR: "🇹🇷",
  IL: "🇮🇱", NZ: "🇳🇿", PK: "🇵🇰", BD: "🇧🇩", LK: "🇱🇰", AM: "🇦🇲",
};

export function flagFor(code) {
  return FLAGS[code] || "🌐";
}

export function countryName(code) {
  return COUNTRIES.find((c) => c.code === code)?.name || code;
}
