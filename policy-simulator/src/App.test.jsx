import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { buildUserMessage, createInitialForm, sanitizePolicyHtml } from './App.jsx';

function completeForm() {
  fireEvent.change(screen.getByLabelText(/Firm type/), { target: { value: 'Authorised EMI' } });
  fireEvent.click(screen.getByLabelText('UK Private Limited Companies'));
  fireEvent.change(screen.getByLabelText(/Geographic scope/), { target: { value: 'Global (all jurisdictions)' } });
  fireEvent.click(screen.getByLabelText('Foreign exchange (FX)'));
  fireEvent.change(screen.getByLabelText(/High-risk industries/), { target: { value: 'Decline all' } });
  fireEvent.change(screen.getByLabelText(/PEP appetite/), { target: { value: 'Domestic PEPs with EDD' } });
  fireEvent.change(screen.getByLabelText(/Complex \/ multi-layered/), { target: { value: 'EDD permitted' } });
  fireEvent.change(screen.getByLabelText(/FATF Call-for-Action/), { target: { value: 'Prohibited' } });
  fireEvent.change(screen.getByLabelText(/FATF Increased-Monitoring/), { target: { value: 'EDD required' } });
  fireEvent.click(screen.getByLabelText('Companies House API (UK registry)'));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('policy configuration', () => {
  it('keeps generation disabled until required configuration is complete', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeDisabled();
    const disclaimer = screen.getByLabelText(/Include the mandatory/);
    expect(disclaimer).toBeChecked();
    expect(disclaimer).toBeDisabled();
    completeForm();
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeEnabled();
  });

  it('shows and requires the conditional Other vendor field', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Other'));
    expect(screen.getByLabelText(/Other vendor/)).toBeRequired();
    fireEvent.click(screen.getByLabelText('Other'));
    expect(screen.queryByLabelText(/Other vendor/)).not.toBeInTheDocument();
  });

  it('serializes selected configuration and omits unselected options', () => {
    const form = createInitialForm();
    Object.assign(form, {
      firmType: 'Authorised EMI',
      customerTypes: ['Trusts'],
      geography: 'Global (all jurisdictions)',
      products: ['International payments / cross-border transfers'],
      highRiskIndustries: 'Decline all',
      pepAppetite: 'Domestic PEPs with EDD',
      complexOwnership: 'EDD permitted',
      fatfCallForAction: 'Prohibited',
      fatfIncreasedMonitoring: 'EDD required',
      vendors: ['Other'],
      otherVendor: 'Verified Vendor',
    });
    const prompt = buildUserMessage(form);
    expect(prompt).toContain('- Trusts');
    expect(prompt).toContain('- Global (all jurisdictions)');
    expect(prompt).toContain('- Other: Verified Vendor');
    expect(prompt).not.toContain('Marketplaces / Platforms');
  });
});

describe('generation and output', () => {
  it('shows loading, sanitizes output, copies text, and resets', async () => {
    let resolveFetch;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.stubGlobal('scrollTo', vi.fn());
    render(<App />);
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Policy' }));
    expect(screen.getByText('Generating your KYB Policy document...')).toBeInTheDocument();
    resolveFetch({
      ok: true,
      json: async () => ({ policyHtml: '<h1>Configured Policy</h1><script>alert(1)</script><p>Required control.</p>' }),
    });
    expect(await screen.findByRole('heading', { name: 'Configured Policy' })).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
    const disclaimer = screen.getByLabelText('Mandatory disclaimer');
    const policy = screen.getByRole('article');
    expect(disclaimer.compareDocumentPosition(policy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Required control.')));
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeDisabled();
    expect(screen.getByLabelText(/Firm type/)).toHaveValue('');
  });

  it('returns to a usable form when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'API unavailable.' }) }));
    render(<App />);
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Policy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable.');
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeEnabled();
  });

  it('removes all non-allow-listed HTML and attributes', () => {
    expect(sanitizePolicyHtml('<h1 onclick="bad()">Safe</h1><a href="x">link</a><img src=x>')).toBe('<h1>Safe</h1>link');
  });
});
