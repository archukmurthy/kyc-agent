import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PolicySimulator, { buildUserMessage, createInitialForm, sanitizePolicyHtml } from './PolicySimulator';

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
  jest.restoreAllMocks();
  delete global.fetch;
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

describe('policy configuration', () => {
  it('keeps generation disabled until required configuration is complete', () => {
    render(<PolicySimulator />);
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeDisabled();
    const disclaimer = screen.getByLabelText(/Include the mandatory/);
    expect(disclaimer).toBeChecked();
    expect(disclaimer).toBeDisabled();
    completeForm();
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeEnabled();
  });

  it('shows and requires the conditional Other vendor field', () => {
    render(<PolicySimulator />);
    fireEvent.click(screen.getByLabelText('Other'));
    expect(screen.getByLabelText(/Other vendor/)).toBeRequired();
    fireEvent.click(screen.getByLabelText('Other'));
    expect(screen.queryByLabelText(/Other vendor/)).not.toBeInTheDocument();
  });

  it('selects and clears complete checkbox groups', () => {
    render(<PolicySimulator />);
    const selectAllCustomers = screen.getByLabelText('Select all customer types');
    fireEvent.click(screen.getByLabelText('UK Private Limited Companies'));
    expect(selectAllCustomers.indeterminate).toBe(true);
    fireEvent.click(selectAllCustomers);
    expect(screen.getByLabelText('Crypto-asset businesses')).toBeChecked();
    expect(selectAllCustomers).toBeChecked();
    fireEvent.click(selectAllCustomers);
    expect(screen.getByLabelText('UK Private Limited Companies')).not.toBeChecked();
    expect(selectAllCustomers).not.toBeChecked();
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
    global.fetch = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const writeText = jest.fn().mockResolvedValue(undefined);
    const createObjectURL = jest.fn().mockReturnValue('blob:policy');
    const revokeObjectURL = jest.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    let downloadName = '';
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { downloadName = this.download; });
    Object.assign(navigator, { clipboard: { writeText } });
    window.scrollTo = jest.fn();
    render(<PolicySimulator />);
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
    fireEvent.click(screen.getByRole('button', { name: 'Download policy' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadName).toBe('KYB-Policy.html');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:policy');
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeDisabled();
    expect(screen.getByLabelText(/Firm type/)).toHaveValue('');
  });

  it('returns to a usable form when the API fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'API unavailable.' }) });
    render(<PolicySimulator />);
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Policy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable.');
    expect(screen.getByRole('button', { name: 'Generate Policy' })).toBeEnabled();
  });

  it('removes all non-allow-listed HTML and attributes', () => {
    expect(sanitizePolicyHtml('<h1 onclick="bad()">Safe</h1><a href="x">link</a><img src=x>')).toBe('<h1>Safe</h1>link');
  });
});
