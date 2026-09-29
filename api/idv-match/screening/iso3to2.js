"use strict";

// ISO 3166-1 alpha-3 -> alpha-2. Didit returns nationality/issuing state as
// 3-letter codes (e.g. "POL"); ComplyCube's personDetails.nationality requires
// 2-letter codes. toAlpha2 converts a 3-letter code, passes a 2-letter code
// through unchanged, and returns the original input for anything unknown (the
// caller guards against unknown values before sending to ComplyCube).
// Recovered from the deleted lib/didit/iso3to2.js (commit 7b786bf) — the new
// bands screening flow needs the same conversion the old spike had.
const ISO3_TO_2 = {
  AFG: "AF", ALA: "AX", ALB: "AL", DZA: "DZ", ASM: "AS", AND: "AD", AGO: "AO",
  AIA: "AI", ATA: "AQ", ATG: "AG", ARG: "AR", ARM: "AM", ABW: "AW", AUS: "AU",
  AUT: "AT", AZE: "AZ", BHS: "BS", BHR: "BH", BGD: "BD", BRB: "BB", BLR: "BY",
  BEL: "BE", BLZ: "BZ", BEN: "BJ", BMU: "BM", BTN: "BT", BOL: "BO", BES: "BQ",
  BIH: "BA", BWA: "BW", BVT: "BV", BRA: "BR", IOT: "IO", BRN: "BN", BGR: "BG",
  BFA: "BF", BDI: "BI", CPV: "CV", KHM: "KH", CMR: "CM", CAN: "CA", CYM: "KY",
  CAF: "CF", TCD: "TD", CHL: "CL", CHN: "CN", CXR: "CX", CCK: "CC", COL: "CO",
  COM: "KM", COG: "CG", COD: "CD", COK: "CK", CRI: "CR", CIV: "CI", HRV: "HR",
  CUB: "CU", CUW: "CW", CYP: "CY", CZE: "CZ", DNK: "DK", DJI: "DJ", DMA: "DM",
  DOM: "DO", ECU: "EC", EGY: "EG", SLV: "SV", GNQ: "GQ", ERI: "ER", EST: "EE",
  SWZ: "SZ", ETH: "ET", FLK: "FK", FRO: "FO", FJI: "FJ", FIN: "FI", FRA: "FR",
  GUF: "GF", PYF: "PF", ATF: "TF", GAB: "GA", GMB: "GM", GEO: "GE", DEU: "DE",
  GHA: "GH", GIB: "GI", GRC: "GR", GRL: "GL", GRD: "GD", GLP: "GP", GUM: "GU",
  GTM: "GT", GGY: "GG", GIN: "GN", GNB: "GW", GUY: "GY", HTI: "HT", HMD: "HM",
  VAT: "VA", HND: "HN", HKG: "HK", HUN: "HU", ISL: "IS", IND: "IN", IDN: "ID",
  IRN: "IR", IRQ: "IQ", IRL: "IE", IMN: "IM", ISR: "IL", ITA: "IT", JAM: "JM",
  JPN: "JP", JEY: "JE", JOR: "JO", KAZ: "KZ", KEN: "KE", KIR: "KI", PRK: "KP",
  KOR: "KR", KWT: "KW", KGZ: "KG", LAO: "LA", LVA: "LV", LBN: "LB", LSO: "LS",
  LBR: "LR", LBY: "LY", LIE: "LI", LTU: "LT", LUX: "LU", MAC: "MO", MDG: "MG",
  MWI: "MW", MYS: "MY", MDV: "MV", MLI: "ML", MLT: "MT", MHL: "MH", MTQ: "MQ",
  MRT: "MR", MUS: "MU", MYT: "YT", MEX: "MX", FSM: "FM", MDA: "MD", MCO: "MC",
  MNG: "MN", MNE: "ME", MSR: "MS", MAR: "MA", MOZ: "MZ", MMR: "MM", NAM: "NA",
  NRU: "NR", NPL: "NP", NLD: "NL", NCL: "NC", NZL: "NZ", NIC: "NI", NER: "NE",
  NGA: "NG", NIU: "NU", NFK: "NF", MKD: "MK", MNP: "MP", NOR: "NO", OMN: "OM",
  PAK: "PK", PLW: "PW", PSE: "PS", PAN: "PA", PNG: "PG", PRY: "PY", PER: "PE",
  PHL: "PH", PCN: "PN", POL: "PL", PRT: "PT", PRI: "PR", QAT: "QA", REU: "RE",
  ROU: "RO", RUS: "RU", RWA: "RW", BLM: "BL", SHN: "SH", KNA: "KN", LCA: "LC",
  MAF: "MF", SPM: "PM", VCT: "VC", WSM: "WS", SMR: "SM", STP: "ST", SAU: "SA",
  SEN: "SN", SRB: "RS", SYC: "SC", SLE: "SL", SGP: "SG", SXM: "SX", SVK: "SK",
  SVN: "SI", SLB: "SB", SOM: "SO", ZAF: "ZA", SGS: "GS", SSD: "SS", ESP: "ES",
  LKA: "LK", SDN: "SD", SUR: "SR", SJM: "SJ", SWE: "SE", CHE: "CH", SYR: "SY",
  TWN: "TW", TJK: "TJ", TZA: "TZ", THA: "TH", TLS: "TL", TGO: "TG", TKL: "TK",
  TON: "TO", TTO: "TT", TUN: "TN", TUR: "TR", TKM: "TM", TCA: "TC", TUV: "TV",
  UGA: "UG", UKR: "UA", ARE: "AE", GBR: "GB", USA: "US", UMI: "UM", URY: "UY",
  UZB: "UZ", VUT: "VU", VEN: "VE", VNM: "VN", VGB: "VG", VIR: "VI", WLF: "WF",
  ESH: "EH", YEM: "YE", ZMB: "ZM", ZWE: "ZW",
};

function toAlpha2(code) {
  if (!code) return code;
  const up = String(code).trim().toUpperCase();
  if (up.length === 2) return up;
  return ISO3_TO_2[up] || code;
}

// ComplyCube's accepted personDetails.nationality values (from its 400 error on
// an unrecognized code). toComplyCubeNationality is the single gate a caller
// uses before sending a nationality to ComplyCube: it converts ISO-3 -> ISO-2
// (or passes an ISO-2 through) and returns null for anything ComplyCube won't
// accept, so an invalid/unmapped code is omitted rather than sent and rejected.
const COMPLYCUBE_ALLOWED_ALPHA2 = new Set([
  "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BA", "BW", "BV", "BR", "IO",
  "BN", "BG", "BF", "BI", "BQ", "KH", "CM", "CA", "CV", "KY", "CF", "TD", "CL", "CN", "CX", "CC",
  "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CY", "CZ", "DK", "DJ", "DM", "DO", "EC",
  "EG", "SV", "GQ", "ER", "EE", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF", "GA", "GM",
  "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY", "HT", "HM",
  "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM", "JP", "JE",
  "JO", "KZ", "KE", "KI", "KR", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY", "LI", "LT", "LU",
  "MO", "MK", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX", "FM", "MD",
  "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "AN", "NC", "NZ", "NI", "NE",
  "NG", "NU", "NF", "MP", "NO", "OM", "PL", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PN",
  "PT", "PR", "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC", "WS", "SM",
  "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SK", "SI", "SB", "SO", "ZA", "GS", "ES", "LK", "SD",
  "SR", "SJ", "SZ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO", "TT", "TN",
  "TR", "TM", "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU", "VE", "VN", "VG",
  "VI", "WF", "EH", "XK", "YE", "ZM", "ZW", "KP", "SS", "CW",
]);

function toComplyCubeNationality(code) {
  const alpha2 = toAlpha2(code);
  if (!alpha2 || alpha2.length !== 2) return null;
  const up = alpha2.toUpperCase();
  return COMPLYCUBE_ALLOWED_ALPHA2.has(up) ? up : null;
}

module.exports = { toAlpha2, ISO3_TO_2, COMPLYCUBE_ALLOWED_ALPHA2, toComplyCubeNationality };
