import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { extractPolicyHtml } from './generate-policy.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) { this.payload = JSON.parse(payload); },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe('policy API', () => {
  it('rejects unsupported methods and missing configuration', async () => {
    const methodResponse = response();
    await handler({ method: 'GET' }, methodResponse);
    expect(methodResponse.statusCode).toBe(405);
    const bodyResponse = response();
    await handler({ method: 'POST', body: {} }, bodyResponse);
    expect(bodyResponse.statusCode).toBe(400);
  });

  it('keeps the key server-side and sends system and user prompts separately', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-secret';
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '<h1>Policy</h1><p>Body</p><p>End of Policy</p>' }] }),
    });
    vi.stubGlobal('fetch', apiFetch);
    const res = response();
    await handler({ method: 'POST', body: { prompt: 'Configured user prompt' } }, res);
    expect(res.statusCode).toBe(200);
    const [, request] = apiFetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(request.headers['x-api-key']).toBe('test-secret');
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(8000);
    expect(body.system).toContain('REGULATORY ACCURACY');
    expect(body.system).toContain('Do not renumber fixed sections 12–15');
    expect(body.messages).toEqual([{ role: 'user', content: 'Configured user prompt' }]);
  });

  it('rejects empty or malformed model output', () => {
    expect(() => extractPolicyHtml({ content: [{ type: 'text', text: 'plain text' }] })).toThrow(/unexpected policy format/);
    expect(() => extractPolicyHtml({ content: [{ type: 'text', text: '<h1>Partial policy</h1>' }] })).toThrow(/incomplete policy/);
    expect(() => extractPolicyHtml({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '<h1>Partial</h1>' }] })).toThrow(/output limit/);
  });
});
