import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import './policySimulator.css';

const FIRM_TYPES = ['Authorised EMI', 'Small EMI', 'Authorised PI', 'Small PI'];
const CUSTOMER_TYPES = [
  'UK Private Limited Companies',
  'UK Public Limited Companies',
  'UK Limited Liability Partnerships',
  'UK Partnerships',
  'Sole Traders',
  'Trusts',
  'Charities / Non-profit organisations',
  'Financial Institutions',
  'Payment Institutions / EMIs',
  'Marketplaces / Platforms',
  'Crypto-asset businesses',
];
const GEOGRAPHIES = ['UK incorporated entities only', 'UK + EEA', 'Global (all jurisdictions)'];
const PRODUCTS = [
  'E-money accounts',
  'Domestic payments (GBP)',
  'International payments / cross-border transfers',
  'Foreign exchange (FX)',
  'Debit / prepaid cards',
  'Acquiring / merchant services',
  'Virtual IBANs',
  'Open banking / account information services',
];
const VENDORS = [
  'Companies House API (UK registry)',
  'Didit (identity verification)',
  'ComplyCube (identity + document verification)',
  'Manual document review only',
  'Other',
];
const RISK_FIELDS = [
  {
    key: 'highRiskIndustries',
    label: 'High-risk industries (gambling, crypto, adult content)',
    options: ['Decline all', 'EDD permitted', 'Case by case'],
  },
  {
    key: 'pepAppetite',
    label: 'PEP appetite',
    options: ['Decline all PEPs', 'Domestic PEPs with EDD', 'All PEPs with EDD'],
  },
  {
    key: 'complexOwnership',
    label: 'Complex / multi-layered ownership structures',
    options: ['Decline', 'EDD permitted'],
  },
  {
    key: 'fatfCallForAction',
    label: 'FATF Call-for-Action jurisdictions',
    options: ['Prohibited', 'Prohibited with exceptions', 'EDD required'],
  },
  {
    key: 'fatfIncreasedMonitoring',
    label: 'FATF Increased-Monitoring jurisdictions',
    options: ['EDD required', 'Refer to MLRO', 'Standard CDD'],
  },
];

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function createInitialForm() {
  return {
    firmType: '',
    customerTypes: [],
    geography: '',
    products: [],
    highRiskIndustries: '',
    pepAppetite: '',
    complexOwnership: '',
    fatfCallForAction: '',
    fatfIncreasedMonitoring: '',
    vendors: [],
    otherVendor: '',
    policyName: 'KYB Policy',
    version: 'v1.0',
    effectiveDate: today(),
  };
}

export function buildUserMessage(form) {
  const lines = (items) => items.map((item) => `- ${item}`).join('\n');
  const vendors = form.vendors.map((vendor) =>
    vendor === 'Other' ? `Other: ${form.otherVendor.trim()}` : vendor,
  );
  return `Generate a KYB Policy document for the following configuration:

FIRM DETAILS
- Firm type: ${form.firmType}
- Regulator: Financial Conduct Authority (FCA)
- Jurisdiction: United Kingdom

CUSTOMERS IN SCOPE
${lines(form.customerTypes)}

CUSTOMER GEOGRAPHY
- ${form.geography}

PRODUCTS AND SERVICES IN SCOPE
${lines(form.products)}

RISK APPETITE
- High-risk industries: ${form.highRiskIndustries}
- PEP appetite: ${form.pepAppetite}
- Complex ownership structures: ${form.complexOwnership}
- FATF Call-for-Action jurisdictions: ${form.fatfCallForAction}
- FATF Increased-Monitoring jurisdictions: ${form.fatfIncreasedMonitoring}

VERIFICATION VENDORS
${lines(vendors)}

DOCUMENT METADATA
- Policy name: ${form.policyName.trim()}
- Version: ${form.version.trim()}
- Effective date: ${form.effectiveDate}

Configuration fidelity requirements:
- Apply every selected customer type, product, geography, risk appetite, and vendor materially.
- Omit controls that relate only to unselected optional customer or product types unless legally mandatory.
- Treat configured decline or prohibited appetites as hard customer-acceptance stops.

Generate the complete KYB Policy document now, following all rules in your instructions.`;
}

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em',
];

export function sanitizePolicyHtml(html) {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: [] });
}

function Section({ number, title, description, children }) {
  return (
    <fieldset className="border-b border-slate-200 px-6 py-7 last:border-b-0 sm:px-9">
      <legend className="sr-only">{title}</legend>
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
          {number}
        </span>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </fieldset>
  );
}

function SelectField({ label, value, options, onChange, required = true }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label} {required && <span className="text-red-700" aria-hidden="true">*</span>}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
      >
        <option value="">Select an option</option>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function CheckboxGroup({ label, options, selected, onToggle, onToggleAll }) {
  const selectAllRef = useRef(null);
  const allSelected = selected.length === options.length;
  const partlySelected = selected.length > 0 && !allSelected;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partlySelected;
  }, [partlySelected]);
  return (
    <div>
      <p className="mb-3 text-sm font-medium text-slate-700">
        {label} <span className="text-red-700" aria-hidden="true">*</span>
      </p>
      <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 hover:border-slate-500">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          aria-label={`Select all ${label.toLowerCase()}`}
          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
        />
        <span>Select all</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-700 hover:border-slate-400">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => onToggle(option)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input readOnly value={value} className="mt-2 block w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2.5 text-slate-600" />
    </label>
  );
}

function FormView({ form, setForm, onGenerate, error }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggle = (key, value) => setForm((current) => ({
    ...current,
    [key]: current[key].includes(value)
      ? current[key].filter((item) => item !== value)
      : [...current[key], value],
    ...(key === 'vendors' && value === 'Other' && current[key].includes(value) ? { otherVendor: '' } : {}),
  }));
  const toggleAll = (key, options) => setForm((current) => {
    const clear = current[key].length === options.length;
    return {
      ...current,
      [key]: clear ? [] : [...options],
      ...(key === 'vendors' && clear ? { otherVendor: '' } : {}),
    };
  });
  const valid = useMemo(() => {
    const riskComplete = RISK_FIELDS.every(({ key }) => form[key]);
    const otherComplete = !form.vendors.includes('Other') || form.otherVendor.trim();
    return Boolean(
      form.firmType && form.geography && riskComplete && form.customerTypes.length &&
      form.products.length && form.vendors.length && otherComplete && form.policyName.trim() &&
      form.version.trim() && form.effectiveDate,
    );
  }, [form]);

  return (
    <form onSubmit={(event) => { event.preventDefault(); if (valid) onGenerate(); }} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {error && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-4 text-sm text-red-800 sm:px-9">
          <strong>Policy generation failed.</strong> {error}
        </div>
      )}
      <Section number="1" title="Firm details">
        <SelectField label="Firm type" value={form.firmType} options={FIRM_TYPES} onChange={(value) => update('firmType', value)} />
        <div className="grid gap-5 sm:grid-cols-2">
          <ReadOnlyField label="Regulator" value="Financial Conduct Authority (FCA)" />
          <ReadOnlyField label="Jurisdiction" value="United Kingdom" />
        </div>
      </Section>
      <Section number="2" title="Customer types in scope" description="Select all customer types to include.">
        <CheckboxGroup label="Customer types" options={CUSTOMER_TYPES} selected={form.customerTypes} onToggle={(value) => toggle('customerTypes', value)} onToggleAll={() => toggleAll('customerTypes', CUSTOMER_TYPES)} />
      </Section>
      <Section number="3" title="Customer geography">
        <SelectField label="Geographic scope" value={form.geography} options={GEOGRAPHIES} onChange={(value) => update('geography', value)} />
      </Section>
      <Section number="4" title="Products & services" description="Select all products and services to include.">
        <CheckboxGroup label="Products and services" options={PRODUCTS} selected={form.products} onToggle={(value) => toggle('products', value)} onToggleAll={() => toggleAll('products', PRODUCTS)} />
      </Section>
      <Section number="5" title="Risk appetite">
        {RISK_FIELDS.map((field) => (
          <SelectField key={field.key} label={field.label} value={form[field.key]} options={field.options} onChange={(value) => update(field.key, value)} />
        ))}
      </Section>
      <Section number="6" title="Verification vendors" description="Select all verification sources to reference.">
        <CheckboxGroup label="Verification vendors" options={VENDORS} selected={form.vendors} onToggle={(value) => toggle('vendors', value)} onToggleAll={() => toggleAll('vendors', VENDORS)} />
        {form.vendors.includes('Other') && (
          <label className="block text-sm font-medium text-slate-700">
            Other vendor <span className="text-red-700" aria-hidden="true">*</span>
            <input
              value={form.otherVendor}
              onChange={(event) => update('otherVendor', event.target.value)}
              required
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
            />
          </label>
        )}
      </Section>
      <Section number="7" title="Output preferences">
        <label className="block text-sm font-medium text-slate-700">
          Policy document name <span className="text-red-700" aria-hidden="true">*</span>
          <input value={form.policyName} onChange={(event) => update('policyName', event.target.value)} required className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200" />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Version number <span className="text-red-700" aria-hidden="true">*</span>
            <input value={form.version} onChange={(event) => update('version', event.target.value)} required className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Effective date <span className="text-red-700" aria-hidden="true">*</span>
            <input type="date" value={form.effectiveDate} onChange={(event) => update('effectiveDate', event.target.value)} required className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200" />
          </label>
        </div>
        <label className="flex items-center gap-3 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <input type="checkbox" checked disabled readOnly className="h-4 w-4 rounded border-amber-400 text-amber-700" />
          Include the mandatory AI and legal-advice disclaimer
        </label>
      </Section>
      <div className="bg-slate-50 px-6 py-6 sm:px-9">
        <button type="submit" disabled={!valid} className="w-full rounded-md bg-slate-900 px-5 py-3 font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          Generate Policy
        </button>
        <p className="mt-3 text-center text-xs text-slate-500">Required fields are marked with an asterisk.</p>
      </div>
    </form>
  );
}

function LoadingView() {
  return (
    <div role="status" className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white px-8 py-16 text-center shadow-sm">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      <h2 className="mt-6 text-xl font-semibold text-slate-900">Generating your KYB Policy document...</h2>
      <p className="mt-2 text-sm text-slate-500">This usually takes 20–30 seconds.</p>
    </div>
  );
}

const DISCLAIMER = "This document was generated by an AI policy simulator for discussion purposes only. It does not constitute legal or regulatory advice. The firm's MLRO is responsible for reviewing, adapting, and approving any policy before adoption. Anthropic's Claude API was used to generate this output.";

function OutputView({ policyHtml, policyName, onStartAgain }) {
  const [copyStatus, setCopyStatus] = useState('');
  async function copyPolicy() {
    const documentText = new DOMParser().parseFromString(policyHtml, 'text/html').body.textContent.trim();
    const text = `${DISCLAIMER}\n\n${documentText}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopyStatus('Policy copied to clipboard.');
    } catch {
      setCopyStatus('Clipboard access was blocked. Select and copy the policy text manually.');
    }
  }
  function downloadPolicy() {
    const safeName = policyName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'KYB-Policy';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KYB Policy</title><style>body{max-width:800px;margin:48px auto;padding:0 24px;color:#334155;font:15px/1.7 Arial,sans-serif}h1,h2,h3,strong{color:#0f172a}h2{margin-top:36px;border-bottom:1px solid #cbd5e1;padding-bottom:8px}h3{margin-top:24px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{border:1px solid #cbd5e1;padding:10px;text-align:left;vertical-align:top}th{background:#f1f5f9}.disclaimer{margin-bottom:36px;border:1px solid #fcd34d;background:#fffbeb;padding:16px;color:#78350f}</style></head><body><aside class="disclaimer"><strong>Important disclaimer</strong><br>${DISCLAIMER}</aside><main>${policyHtml}</main></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-12 sm:py-12">
        <aside aria-label="Mandatory disclaimer" className="mb-9 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
          <strong className="block">Important disclaimer</strong>
          {DISCLAIMER}
        </aside>
        <article
          className="text-[15px] leading-7 text-slate-700 [&_em]:text-slate-600 [&_h1]:mb-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-slate-950 [&_h2]:mb-4 [&_h2]:mt-10 [&_h2]:border-b [&_h2]:border-slate-200 [&_h2]:pb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:mb-3 [&_h3]:mt-7 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900 [&_li]:mb-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_strong]:font-semibold [&_strong]:text-slate-900 [&_table]:my-7 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-3 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-slate-900 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6"
          dangerouslySetInnerHTML={{ __html: policyHtml }}
        />
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button onClick={copyPolicy} className="rounded-md border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-800 shadow-sm hover:bg-slate-50">Copy to clipboard</button>
        <button onClick={downloadPolicy} className="rounded-md border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-800 shadow-sm hover:bg-slate-50">Download policy</button>
        <button onClick={onStartAgain} className="rounded-md bg-slate-900 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-slate-700">Start again</button>
      </div>
      {copyStatus && <p role="status" className="mt-3 text-right text-sm text-slate-600">{copyStatus}</p>}
    </div>
  );
}

export default function PolicySimulator() {
  const [view, setView] = useState('form');
  const [form, setForm] = useState(createInitialForm);
  const [policyHtml, setPolicyHtml] = useState('');
  const [error, setError] = useState('');

  async function generatePolicy() {
    if (view === 'loading') return;
    setError('');
    setView('loading');
    try {
      const response = await fetch('/api/generate-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildUserMessage(form) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Claude could not generate the policy.');
      const sanitized = sanitizePolicyHtml(payload.policyHtml || '');
      if (!/<(?:h1|h2|p|ul|ol|table)\b/i.test(sanitized)) throw new Error('Claude returned an unexpected policy format.');
      setPolicyHtml(sanitized);
      setView('output');
    } catch (requestError) {
      setError(requestError.message || 'Policy generation failed. Please try again.');
      setView('form');
    }
  }

  function startAgain() {
    setForm(createInitialForm());
    setPolicyHtml('');
    setError('');
    setView('form');
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  return (
    <main className="policy-simulator-root min-h-screen bg-slate-50 px-4 py-10 sm:px-6 sm:py-14">
      <div className={view === 'output' ? 'mx-auto max-w-5xl' : 'mx-auto max-w-3xl'}>
        <header className="mb-9">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">UK financial crime compliance</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">UK KYB Policy Simulator</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">Configure a discussion-ready KYB policy for a UK payment or e-money institution. This simulator is not legal or regulatory advice.</p>
        </header>
        {view === 'form' && <FormView form={form} setForm={setForm} onGenerate={generatePolicy} error={error} />}
        {view === 'loading' && <LoadingView />}
        {view === 'output' && <OutputView policyHtml={policyHtml} policyName={form.policyName} onStartAgain={startAgain} />}
      </div>
    </main>
  );
}
