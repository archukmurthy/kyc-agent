const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../../api/generate-policy.js');
const { extractPolicyHtml } = handler;

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) { this.payload = JSON.parse(payload); },
  };
}

afterEach(() => {
  delete global.fetch;
  delete process.env.ANTHROPIC_API_KEY;
});

describe('policy API', () => {
  it('rejects unsupported methods and missing configuration', async () => {
    const methodResponse = response();
    await handler({ method: 'GET' }, methodResponse);
    assert.equal(methodResponse.statusCode, 405);
    const bodyResponse = response();
    await handler({ method: 'POST', body: {} }, bodyResponse);
    assert.equal(bodyResponse.statusCode, 400);
  });

  it('keeps the key server-side and sends system and user prompts separately', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-secret';
    const calls = [];
    const apiFetch = async (...args) => {
      calls.push(args);
      return {
        ok: true,
        json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '<h1>Policy</h1><p>Body</p><p>End of Policy</p>' }] }),
      };
    };
    global.fetch = apiFetch;
    const res = response();
    await handler({ method: 'POST', body: { prompt: 'Configured user prompt' } }, res);
    assert.equal(res.statusCode, 200);
    const [, request] = calls[0];
    const body = JSON.parse(request.body);
    assert.equal(request.headers['x-api-key'], 'test-secret');
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.equal(body.max_tokens, 8000);
    assert.match(body.system, /REGULATORY ACCURACY/);
    assert.match(body.system, /Do not renumber fixed sections 12–15/);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Configured user prompt' }]);
  });

  it('rejects empty or malformed model output', () => {
    assert.throws(() => extractPolicyHtml({ content: [{ type: 'text', text: 'plain text' }] }), /unexpected policy format/);
    assert.throws(() => extractPolicyHtml({ content: [{ type: 'text', text: '<h1>Partial policy</h1>' }] }), /incomplete policy/);
    assert.throws(() => extractPolicyHtml({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '<h1>Partial</h1>' }] }), /output limit/);
  });
});
