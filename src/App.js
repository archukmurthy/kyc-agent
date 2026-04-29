import { useState, useEffect, useCallback, useRef } from "react";

/* ═══════════════════════════════════════════
   COUNTRY LIST
   ═══════════════════════════════════════════ */
const COUNTRIES = [
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
  { code: "LK", name: "Sri Lanka" },
];

// Markets where Nium holds a licence. Country of registration matching one of these
// uses that market's schema. Otherwise the Singapore licence applies as default.
const LICENSED_MARKETS = ["GB"];

/* ═══════════════════════════════════════════
   JURISDICTION SCHEMAS
   ═══════════════════════════════════════════ */
const UK_SCHEMA = {
  label: "United Kingdom",
  region: "UK",
  researchFields: [
    { field: "businessType", label: "Business Type" },
    { field: "businessRegistrationNumber", label: "Companies House Number" },
    { field: "registeredDate", label: "Date of Incorporation" },
    { field: "registeredCountry", label: "Registered Country" },
    { field: "tradeName", label: "Trade Name" },
    { field: "website", label: "Website" },
    { field: "addressLine1", label: "Registered Address Line 1" },
    { field: "addressLine2", label: "Registered Address Line 2" },
    { field: "city", label: "City" },
    { field: "state", label: "County / State" },
    { field: "postcode", label: "Postcode" },
    { field: "country", label: "Address Country" },
    { field: "sicCode", label: "SIC Code" },
    { field: "annualRevenue", label: "Annual Revenue" },
    { field: "employees", label: "Number of Employees" },
    { field: "stockListing", label: "Stock Exchange Listing" },
    { field: "leiNumber", label: "LEI Number" },
    { field: "countriesOfOperation", label: "Countries of Operation" },
    { field: "isMultiLayered", label: "Multi-layered Corporate Structure" },
    { field: "uboAnalysis", label: "UBO / Ownership Analysis" },
    { field: "directors", label: "Key Directors (with nationality)" },
    { field: "companySecretary", label: "Company Secretary" },
    { field: "isPEP", label: "PEP Status of Directors" },
  ],
  gapFields: [
    { field: "applicantFirstName", label: "Applicant First Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantLastName", label: "Applicant Last Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantEmail", label: "Applicant Email", inputType: "email", required: true, section: "applicant" },
    { field: "applicantMobile", label: "Applicant Mobile", inputType: "tel", required: true, section: "applicant" },
    { field: "applicantMobileCountryCode", label: "Mobile Country Code", inputType: "text", required: true, section: "applicant" },
    { field: "applicantDateOfBirth", label: "Applicant Date of Birth", inputType: "date", required: true, section: "applicant" },
    { field: "applicantNationality", label: "Applicant Nationality (2-letter code)", inputType: "text", required: true, section: "applicant" },
    { field: "applicantBirthCountry", label: "Applicant Birth Country", inputType: "text", required: true, section: "applicant" },
    { field: "applicantIsPEP", label: "Is Applicant a PEP?", inputType: "select", required: true, section: "applicant", options: ["Yes", "No"] },
    { field: "creditMonthlyVolume", label: "Expected Monthly Credit Volume (GBP)", inputType: "select", required: true, section: "account", options: ["Under 10,000", "10,000 - 50,000", "50,000 - 250,000", "250,000 - 1,000,000", "1,000,000 - 5,000,000", "Over 5,000,000"] },
    { field: "creditTopCountries", label: "Top Credit Transaction Countries", inputType: "text", required: true, section: "account" },
    { field: "debitMonthlyVolume", label: "Expected Monthly Debit Volume (GBP)", inputType: "select", required: true, section: "account", options: ["Under 10,000", "10,000 - 50,000", "50,000 - 250,000", "250,000 - 1,000,000", "1,000,000 - 5,000,000", "Over 5,000,000"] },
    { field: "debitTopCountries", label: "Top Debit Transaction Countries", inputType: "text", required: true, section: "account" },
    { field: "intendedUses", label: "Intended Use of Account", inputType: "textarea", required: true, section: "account" },
    { field: "sourceOfFunds", label: "Source of Funds", inputType: "textarea", required: false, section: "account" },
    { field: "bankAccountName", label: "Bank Account Name", inputType: "text", required: true, section: "bank" },
    { field: "bankAccountNumber", label: "Bank Account Number", inputType: "text", required: true, section: "bank" },
    { field: "bankName", label: "Bank Name", inputType: "text", required: true, section: "bank" },
    { field: "bankSortCode", label: "Sort Code", inputType: "text", required: true, section: "bank" },
    { field: "bankCurrency", label: "Account Currency", inputType: "text", required: true, section: "bank" },
    { field: "bankCountry", label: "Bank Country", inputType: "text", required: true, section: "bank" },
  ]
};

const SG_SCHEMA = {
  label: "Singapore / Default",
  region: "SG",
  researchFields: [
    { field: "businessType", label: "Business Type (ACRA entity type)" },
    { field: "businessRegistrationNumber", label: "UEN / Registration Number" },
    { field: "registeredDate", label: "Date of Incorporation" },
    { field: "registeredCountry", label: "Registered Country" },
    { field: "tradeName", label: "Trade Name" },
    { field: "formerName", label: "Former Name (if any)" },
    { field: "website", label: "Website" },
    { field: "addressLine1", label: "Registered Address Line 1" },
    { field: "addressLine2", label: "Registered Address Line 2" },
    { field: "city", label: "City" },
    { field: "state", label: "State" },
    { field: "postcode", label: "Postcode" },
    { field: "country", label: "Address Country" },
    { field: "sicCode", label: "SSIC / Industry Code" },
    { field: "annualRevenue", label: "Annual Revenue / Turnover" },
    { field: "employees", label: "Number of Employees" },
    { field: "stockListing", label: "Stock Exchange Listing" },
    { field: "leiNumber", label: "LEI Number" },
    { field: "countriesOfOperation", label: "Operating Countries" },
    { field: "industryCodes", label: "Industry Sector Codes" },
    { field: "industryDescription", label: "Business Description" },
    { field: "isMultiLayered", label: "Multi-layered Corporate Structure" },
    { field: "uboAnalysis", label: "UBO / Ownership Analysis" },
    { field: "directors", label: "Key Directors / Officers" },
    { field: "companySecretary", label: "Company Secretary" },
    { field: "listedExchange", label: "Listed Exchange (if public)" },
  ],
  gapFields: [
    { field: "applicantFirstName", label: "Applicant First Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantLastName", label: "Applicant Last Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantEmail", label: "Applicant Email", inputType: "email", required: true, section: "applicant" },
    { field: "applicantMobile", label: "Applicant Mobile", inputType: "tel", required: true, section: "applicant" },
    { field: "applicantMobileCountryCode", label: "Mobile Country Code", inputType: "text", required: true, section: "applicant" },
    { field: "applicantDateOfBirth", label: "Applicant Date of Birth", inputType: "date", required: true, section: "applicant" },
    { field: "applicantNationality", label: "Applicant Nationality (2-letter code)", inputType: "text", required: true, section: "applicant" },
    { field: "applicantSharePercentage", label: "Applicant Share % (if UBO)", inputType: "text", required: false, section: "applicant" },
    { field: "applicantPosition", label: "Applicant Position Title", inputType: "select", required: true, section: "applicant", options: ["Director", "UBO", "Authorised Representative", "Partner", "Trustee", "Signatory", "Other"] },
    { field: "natureOperatingCountries", label: "Operating Countries (comma-separated ISO codes)", inputType: "text", required: true, section: "nature" },
    { field: "natureIndustryCodes", label: "Industry Sector Codes (e.g. IS131, IS145)", inputType: "text", required: true, section: "nature" },
    { field: "natureIndustryDescription", label: "Business Description (2-3 sentences)", inputType: "textarea", required: false, section: "nature" },
    { field: "sizeTotalEmployees", label: "Total Employees (range)", inputType: "select", required: true, section: "nature", options: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"] },
    { field: "sizeAnnualTurnover", label: "Annual Turnover (range)", inputType: "select", required: true, section: "nature", options: ["Under 100K", "100K - 500K", "500K - 1M", "1M - 5M", "5M - 25M", "25M - 100M", "Over 100M"] },
    { field: "creditMonthlyVolume", label: "Expected Monthly Credit Volume", inputType: "select", required: true, section: "account", options: ["Under 10,000", "10,000 - 50,000", "50,000 - 250,000", "250,000 - 1,000,000", "1,000,000 - 5,000,000", "Over 5,000,000"] },
    { field: "creditMonthlyTransactions", label: "Expected Monthly Credit Transactions", inputType: "select", required: true, section: "account", options: ["1-10", "11-50", "51-200", "201-500", "500+"] },
    { field: "creditAvgValue", label: "Average Credit Transaction Value", inputType: "select", required: true, section: "account", options: ["Under 1,000", "1,000 - 5,000", "5,000 - 25,000", "25,000 - 100,000", "Over 100,000"] },
    { field: "creditTopCountries", label: "Top Credit Countries (ISO codes)", inputType: "text", required: true, section: "account" },
    { field: "debitMonthlyVolume", label: "Expected Monthly Debit Volume", inputType: "select", required: true, section: "account", options: ["Under 10,000", "10,000 - 50,000", "50,000 - 250,000", "250,000 - 1,000,000", "1,000,000 - 5,000,000", "Over 5,000,000"] },
    { field: "debitMonthlyTransactions", label: "Expected Monthly Debit Transactions", inputType: "select", required: true, section: "account", options: ["1-10", "11-50", "51-200", "201-500", "500+"] },
    { field: "debitAvgValue", label: "Average Debit Transaction Value", inputType: "select", required: true, section: "account", options: ["Under 1,000", "1,000 - 5,000", "5,000 - 25,000", "25,000 - 100,000", "Over 100,000"] },
    { field: "debitTopCountries", label: "Top Debit Countries (ISO codes)", inputType: "text", required: true, section: "account" },
    { field: "intendedUses", label: "Intended Use of Account", inputType: "textarea", required: true, section: "account" },
    { field: "sourceOfFunds", label: "Source of Funds", inputType: "textarea", required: false, section: "account" },
    { field: "bankAccountName", label: "Bank Account Name", inputType: "text", required: true, section: "bank" },
    { field: "bankAccountNumber", label: "Bank Account Number", inputType: "text", required: true, section: "bank" },
    { field: "bankName", label: "Bank Name", inputType: "text", required: true, section: "bank" },
    { field: "bankCountry", label: "Bank Country", inputType: "text", required: true, section: "bank" },
    { field: "bankCurrency", label: "Account Currency", inputType: "text", required: true, section: "bank" },
    { field: "bankRoutingType", label: "Routing Code Type (e.g. SWIFT, IFSC)", inputType: "text", required: true, section: "bank" },
    { field: "bankRoutingValue", label: "Routing Code Value", inputType: "text", required: true, section: "bank" },
  ]
};

const getSchema = (code) => LICENSED_MARKETS.includes(code) && code === "GB" ? UK_SCHEMA : SG_SCHEMA;
const getApplicableLicence = (code) => LICENSED_MARKETS.includes(code) ? code : "SG";

const buildPrompt = (name, country, schema) => {
  const fieldList = schema.researchFields.map(f => `    {"field": "${f.field}", "label": "${f.label}", "value": "...", "source": "..."}`).join(",\n");
  const gapList = schema.gapFields.map(f => {
    let obj = `{"field": "${f.field}", "label": "${f.label}", "reason": "Not publicly available", "inputType": "${f.inputType}", "required": ${f.required}, "section": "${f.section}"`;
    if (f.options) obj += `, "options": ${JSON.stringify(f.options)}`;
    obj += "}";
    return "    " + obj;
  }).join(",\n");

  return `You are a KYC research agent for ${schema.label} jurisdiction. Research "${name}" registered in "${country}" using web search. Return ONLY valid JSON (no markdown, no backticks, no preamble).

{
  "companyName": "Official registered name",
  "jurisdiction": "${schema.region}",
  "found": [
${fieldList}
  ],
  "gaps": [
${gapList}
  ]
}

RULES:
- Only include a field in "found" if you have ACTUAL data. Remove fields with empty/unknown values.
- Be specific with sources: "Companies House", "ACRA", "SEC EDGAR", "Wikipedia", "Annual Report", "Corporate Website", etc.
- The "gaps" array must ALWAYS include ALL fields exactly as listed above.
- Return ONLY the raw JSON object.`;
};

const LOADER_MSGS = ["Searching company registries...", "Checking regulatory databases...", "Extracting director information...", "Analysing ownership structure...", "Compiling financial data...", "Identifying jurisdiction-specific gaps...", "Building onboarding form...", "Almost done..."];

function StableInput({ id, label, type, value, onUpdate, required, options, placeholder }) {
  const ref = useRef(null);
  const [local, setLocal] = useState(value || "");
  useEffect(() => { setLocal(value || ""); }, [value]);
  const handleChange = useCallback((e) => { const v = e.target.value; setLocal(v); onUpdate(id, v); }, [id, onUpdate]);
  const sty = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", outline: "none", boxSizing: "border-box" };
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      {type === "select" ? (
        <select ref={ref} value={local} onChange={handleChange} style={{ ...sty, cursor: "pointer" }}>
          <option value="">Select...</option>
          {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea ref={ref} value={local} onChange={handleChange} placeholder={placeholder} rows={3} style={{ ...sty, resize: "vertical" }} />
      ) : (
        <input ref={ref} type={type || "text"} value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
      )}
    </div>
  );
}

export default function KYCAgent() {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [research, setResearch] = useState(null);
  const [checks, setChecks] = useState({});
  const gapRef = useRef({});
  const [declared, setDeclared] = useState(false);
  const [done, setDone] = useState(false);
  const [device, setDevice] = useState({});
  const [loaderIdx, setLoaderIdx] = useState(0);
  const [submitTs, setSubmitTs] = useState("");
  const [activeSchema, setActiveSchema] = useState(null);

  useEffect(() => { if (!loading) return; const t = setInterval(() => setLoaderIdx(i => (i + 1) % LOADER_MSGS.length), 2500); return () => clearInterval(t); }, [loading]);

  useEffect(() => {
    const fetchIP = async () => { try { const r = await fetch("https://api.ipify.org?format=json"); const d = await r.json(); return d.ip; } catch { return "Could not detect"; } };
    fetchIP().then(ip => setDevice({ ipAddress: ip, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, screenRes: window.screen.width + "x" + window.screen.height, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }, []);

  const countryObj = COUNTRIES.find(c => c.code === countryCode);
  const updateGap = useCallback((field, value) => { gapRef.current[field] = value; }, []);

  const getCombinedGaps = () => {
    if (!research || !activeSchema) return [];
    const apiGaps = research.gaps || activeSchema.gapFields;
    const unchecked = (research.found || []).filter((_, i) => !checks[i]).map(item => ({
      field: "corrected_" + item.field, label: item.label + " (correction needed)",
      reason: "Original: " + item.value, inputType: "text", required: true, section: "corrections"
    }));
    return [...unchecked, ...apiGaps];
  };

  const allGapsFilled = () => getCombinedGaps().filter(g => g.required).every(g => { const v = gapRef.current[g.field]; return v && String(v).trim().length > 0; });

  const doResearch = async () => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    const schema = getSchema(countryCode);
    setActiveSchema(schema);
    setLoading(true); setStep(1); setLoaderIdx(0);
    try {
      // ═══ CALLING OUR BACKEND PROXY, NOT CLAUDE DIRECTLY ═══
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(companyName, countryObj ? countryObj.name : countryCode, schema)
        })
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      let text = "";
      for (const block of (data.content || [])) { if (block.type === "text" && block.text) text += block.text; }
      text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const si = text.indexOf("{"); const ei = text.lastIndexOf("}");
      if (si === -1 || ei === -1) throw new Error("No JSON found in response");
      const parsed = JSON.parse(text.slice(si, ei + 1));
      setResearch(parsed);
      const c = {}; (parsed.found || []).forEach((_, i) => { c[i] = true; }); setChecks(c);
      gapRef.current = {};
      setStep(2);
    } catch (err) { setError("Research failed: " + err.message); setStep(0); }
    finally { setLoading(false); }
  };

  const card = { background: "rgba(255,255,255,0.95)", borderRadius: 14, border: "1px solid rgba(26,58,74,0.06)", boxShadow: "0 4px 20px rgba(26,58,74,0.05)", padding: "24px 28px", marginBottom: 16 };
  const Btn = ({ children, onClick, variant, disabled }) => {
    const base = { padding: "12px 26px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.4 : 1, border: "none" };
    const v = { primary: { ...base, background: "#1a3a4a", color: "#fff" }, secondary: { ...base, background: "transparent", color: "#1a3a4a", border: "2px solid #1a3a4a" }, green: { ...base, background: "#4a9e8e", color: "#fff" } };
    return <button style={v[variant] || v.primary} onClick={disabled ? undefined : onClick}>{children}</button>;
  };

  const stepNames = ["Input", "Research", "Confirm", "Fill Gaps", "Declare"];
  const sectionConfig = {
    corrections: { title: "Corrections Required", icon: "🔄", sub: "You unchecked these fields — please provide correct values", twoCol: true },
    applicant: { title: "Applicant Details", icon: "👤", sub: "Person authorised to submit this application", twoCol: true },
    nature: { title: "Nature & Size of Business", icon: "🏢", sub: "Business activity and size details", twoCol: true },
    account: { title: "Expected Account Usage", icon: "💰", sub: "Transaction volumes, purpose, and source of funds", twoCol: false },
    bank: { title: "Bank Account Details", icon: "🏦", sub: "Settlement account for transactions", twoCol: true },
  };

  const renderGapSection = (sectionKey) => {
    const items = getCombinedGaps().filter(g => g.section === sectionKey);
    if (items.length === 0) return null;
    const cfg = sectionConfig[sectionKey] || { title: sectionKey, icon: "📋", sub: "", twoCol: false };
    return (
      <div style={card} key={sectionKey}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{cfg.icon} {cfg.title}</h3>
        <p style={{ fontSize: 12, color: "#1a3a4a60", margin: "0 0 14px" }}>{cfg.sub}</p>
        <div style={cfg.twoCol ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" } : {}}>
          {items.map(g => <StableInput key={g.field} id={g.field} label={g.label} type={g.inputType} value={gapRef.current[g.field] || ""} onUpdate={updateGap} required={g.required} options={g.options} placeholder={"Enter " + g.label.toLowerCase()} />)}
        </div>
      </div>
    );
  };

  const jurisdictionBadge = activeSchema ? (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: activeSchema.region === "UK" ? "#1a3a4a" : "#4a9e8e", color: "#fff", marginLeft: 8 }}>
      {activeSchema.region === "UK" ? "🇬🇧 UK Licence" : "🇸🇬 SG Licence"}
    </span>
  ) : null;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: "#1a3a4a" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "24px 16px 60px" }}>

        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#4a9e8e", marginBottom: 4 }}>Nium Compliance</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>KYC Onboarding Agent</h1>
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 0" }}>AI-powered multi-jurisdiction company research and data collection</p>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {stepNames.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i < step ? "#4a9e8e" : i === step ? "#1a3a4a" : "#e0e4e8", color: i <= step ? "#fff" : "#999", boxShadow: i === step ? "0 0 0 3px rgba(74,158,142,0.2)" : "none" }}>{i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: i === step ? 700 : 400, color: i <= step ? "#1a3a4a" : "#aaa" }}>{s}</span>
              {i < 4 && <div style={{ width: 14, height: 2, background: i < step ? "#4a9e8e" : "#e0e4e8" }} />}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div style={card}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Company Lookup</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 20px" }}>Enter the company name and country. The agent will use <strong>jurisdiction-specific requirements</strong> (UK or SG/default) to drive the research and gap collection.</p>
            <StableInput id="companyName" label="Company Legal Name" type="text" value={companyName} onUpdate={(_, v) => setCompanyName(v)} required placeholder="e.g. Tesco PLC, DBS Group Holdings" />
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Registered Country <span style={{ color: "#d44" }}>*</span></label>
              <select value={countryCode} onChange={e => setCountryCode(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", cursor: "pointer", boxSizing: "border-box" }}>
                <option value="">Select country...</option>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            {countryCode && (() => {
              const lic = getApplicableLicence(countryCode);
              const isLicensed = LICENSED_MARKETS.includes(countryCode);
              return (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: isLicensed ? "#f0f3f8" : "#fff8ed", fontSize: 12, marginBottom: 14, borderLeft: isLicensed ? "3px solid #1a3a4a" : "3px solid #e0a040" }}>
                  <div style={{ marginBottom: 4 }}><strong>🌍 Researching in:</strong> {countryObj?.name} ({countryCode})</div>
                  <div><strong>📋 Applicable licence:</strong> {lic === "GB" ? "🇬🇧 United Kingdom (FCA)" : "🇸🇬 Singapore (MAS) — default for non-licensed markets"}</div>
                  {!isLicensed && <div style={{ marginTop: 4, fontStyle: "italic", color: "#9d6500" }}>Nium has no licence in {countryObj?.name}, so this customer is onboarded under the Singapore licence. Public records will be searched in {countryObj?.name}, but SG requirements apply.</div>}
                </div>
              );
            })()}
            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Btn onClick={doResearch} variant="primary">🔍 Research Company</Btn>
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ ...card, textAlign: "center", padding: "60px 28px" }}>
            <div style={{ position: "relative", width: 70, height: 70, margin: "0 auto 24px" }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid rgba(74,158,142,0.15)", borderTopColor: "#4a9e8e", animation: "kspin 1s linear infinite" }} />
              <div style={{ position: "absolute", inset: 10, borderRadius: "50%", border: "3px solid rgba(26,58,74,0.08)", borderBottomColor: "#1a3a4a", animation: "kspin 1.6s linear infinite reverse" }} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🔍</div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Researching {companyName}... {jurisdictionBadge}</div>
            <div style={{ fontSize: 13, color: "#4a9e8e", fontStyle: "italic" }}>{LOADER_MSGS[loaderIdx]}</div>
            <style>{`@keyframes kspin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {step === 2 && research && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✅</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{research.companyName || companyName} {jurisdictionBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>{(research.found || []).length} fields found · {(research.gaps || activeSchema.gapFields || []).length} gaps identified</p>
                </div>
              </div>
              <div style={{ background: "#f0f9f6", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#1a6b56", borderLeft: "4px solid #4a9e8e" }}>
                Review the information below. <strong>Uncheck any incorrect field</strong> — it will appear on the next page for correction.
              </div>
            </div>
            <div style={card}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px" }}>Pre-filled from Public Sources</h3>
              <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.5fr 1fr", gap: 8, padding: "8px 10px", background: "#1a3a4a", borderRadius: "8px 8px 0 0" }}>
                {["✓", "FIELD", "VALUE", "SOURCE"].map(h => <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{h}</span>)}
              </div>
              {(research.found || []).map((item, i) => (
                <div key={item.field + i} style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.5fr 1fr", gap: 8, padding: "9px 10px", background: i % 2 === 0 ? "#fafcfb" : "#fff", borderBottom: "1px solid rgba(26,58,74,0.04)", opacity: checks[i] ? 1 : 0.3 }}>
                  <input type="checkbox" checked={!!checks[i]} onChange={() => setChecks(p => ({ ...p, [i]: !p[i] }))} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#4a9e8e" }} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontSize: 11, wordBreak: "break-word" }}>{item.value}</span>
                  <span style={{ fontSize: 10, color: "#4a9e8e", fontStyle: "italic" }}>{item.source}</span>
                </div>
              ))}
              {(research.found || []).filter((_, i) => !checks[i]).length > 0 && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "#fff8ed", borderRadius: 6, fontSize: 12, color: "#b07d10", borderLeft: "3px solid #e0a040" }}>
                  ⚠️ {(research.found || []).filter((_, i) => !checks[i]).length} field(s) unchecked — will appear on next page for correction.
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => { setStep(0); setResearch(null); setActiveSchema(null); }}>← Start Over</Btn>
              <Btn variant="green" onClick={() => { gapRef.current = {}; setStep(3); setError(""); }}>Confirm and Continue →</Btn>
            </div>
          </div>
        )}

        {step === 3 && research && activeSchema && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e0a040,#d09030)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📝</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Additional Information Required {jurisdictionBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>{getCombinedGaps().length} fields need your input</p>
                </div>
              </div>
            </div>
            {["corrections", "applicant", "nature", "account", "bank"].map(s => renderGapSection(s))}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => setStep(2)}>← Back to Review</Btn>
              <Btn variant="primary" onClick={() => { if (allGapsFilled()) { setStep(4); setError(""); } else setError("Please fill all required fields."); }}>Continue to Declaration →</Btn>
            </div>
            {error && step === 3 && <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}
          </div>
        )}

        {step === 4 && !done && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#1a3a4a,#2d5a6e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📜</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Applicant Declaration {jurisdictionBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>Review and confirm</p>
                </div>
              </div>
              <div style={{ background: "#fafcfb", borderRadius: 10, padding: 18, border: "1px solid rgba(26,58,74,0.08)", marginBottom: 18 }}>
                <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                  I, <strong>{gapRef.current.applicantFirstName || "___"} {gapRef.current.applicantLastName || "___"}</strong>, hereby declare that:
                </p>
                <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, margin: "10px 0 0" }}>
                  <li>All information provided is true, complete, and accurate to the best of my knowledge.</li>
                  <li>I am authorised to submit this on behalf of <strong>{research?.companyName || companyName}</strong>.</li>
                  <li>Providing false information may result in rejection and legal consequences.</li>
                  <li>I consent to verification through third-party and regulatory databases.</li>
                  <li>I will notify of any material changes promptly.</li>
                </ul>
              </div>
              <div onClick={() => setDeclared(!declared)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 14, background: declared ? "#f0f9f6" : "#f8f8f8", borderRadius: 8, cursor: "pointer", marginBottom: 18, border: declared ? "1.5px solid #4a9e8e" : "1.5px solid #ddd" }}>
                <input type="checkbox" checked={declared} readOnly style={{ width: 18, height: 18, marginTop: 1, accentColor: "#4a9e8e", cursor: "pointer" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>I confirm I have read, understood, and agree to the above declaration.</span>
              </div>
              <div style={{ background: "#f3f5f8", borderRadius: 8, padding: 14 }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, margin: "0 0 8px", color: "#1a3a4a80", letterSpacing: "0.1em", textTransform: "uppercase" }}>Device Information (Auto-captured)</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[["IP Address", device.ipAddress], ["Platform", device.platform], ["Timezone", device.timezone], ["Screen", device.screenRes], ["Language", device.language], ["Capture Time", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"]].map(([k, v]) => (
                    <div key={k} style={{ fontSize: 11, color: "#1a3a4a90" }}><span style={{ fontWeight: 600 }}>{k}:</span> {v || "..."}</div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#1a3a4a50", marginTop: 6, borderTop: "1px solid rgba(26,58,74,0.06)", paddingTop: 5, wordBreak: "break-all" }}>
                  User Agent: {(device.userAgent || "").slice(0, 120)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => setStep(3)}>← Back</Btn>
              <Btn variant="green" onClick={() => { setSubmitTs(new Date().toISOString()); setDone(true); }} disabled={!declared}>✓ Submit Application</Btn>
            </div>
          </div>
        )}

        {done && (
          <div style={{ ...card, textAlign: "center", padding: "44px 28px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 18px", boxShadow: "0 6px 20px rgba(74,158,142,0.3)" }}>✓</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 6px" }}>Application Submitted {jurisdictionBadge}</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 22px" }}>KYC onboarding for <strong>{research?.companyName || companyName}</strong> submitted successfully.</p>
            <div style={{ background: "#f5f7fa", borderRadius: 10, padding: 18, textAlign: "left", maxWidth: 480, margin: "0 auto 22px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a4a80", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Submission Summary</div>
              {[
                ["Company", research?.companyName || companyName],
                ["Jurisdiction", activeSchema?.region === "UK" ? "United Kingdom" : "Singapore / Default"],
                ["Pre-filled", (research?.found || []).filter((_, i) => checks[i]).length + " confirmed"],
                ["Corrected", (research?.found || []).filter((_, i) => !checks[i]).length + " manually fixed"],
                ["Manual fields", Object.keys(gapRef.current).length + " provided"],
                ["Applicant", (gapRef.current.applicantFirstName || "") + " " + (gapRef.current.applicantLastName || "")],
                ["Declared at", submitTs.replace("T", " ").slice(0, 19) + " UTC"],
                ["IP Address", device.ipAddress],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(26,58,74,0.04)", fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: "#1a3a4a90" }}>{v}</span>
                </div>
              ))}
            </div>
            <Btn variant="secondary" onClick={() => { setStep(0); setCompanyName(""); setCountryCode(""); setResearch(null); setChecks({}); gapRef.current = {}; setDeclared(false); setDone(false); setError(""); setActiveSchema(null); }}>Start New Application</Btn>
          </div>
        )}

      </div>
    </div>
  );
}
