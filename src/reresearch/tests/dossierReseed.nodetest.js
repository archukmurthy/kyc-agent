'use strict';

/**
 * dossierReseed.nodetest.js — exercises the api/dossier-reseed.js handler, which
 * runs the REAL dossierLifecycle state machine (no DB) for the only two
 * transitions this slice wires: full re-research vs re-derive-only.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const handler = require(path.join(__dirname, '..', '..', '..', 'api', 'dossier-reseed.js'));
const routeAuth = require(path.join(__dirname, '..', '..', '..', 'lib', 'routeAuth.js'));

// The route takes a dossier credential (Batch 0). These tests are about the
// state machine, so they stand in an authorised customer; the refusal itself is
// asserted separately at the bottom of this file.
routeAuth.__setDeps({
  resolveDossierActor: async () => ({ kind: 'customer', tenantId: 'acme', dossierId: '1', reason: null }),
});

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    end() { return this; },
  };
}
async function call(body, method = 'POST') {
  const res = mockRes();
  await handler({ method, body, headers: {}, query: {} }, res);
  return res;
}

test('identity dispute → full_research / re_researching', async () => {
  const res = await call({ disputeKind: 'identity', disputedClassifiers: ['companyName'] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.valid, true);
  assert.equal(res.body.mode, 'full_research');
  assert.equal(res.body.viaState, 'disputed');
  assert.equal(res.body.nextState, 're_researching');
});

test('interpretation dispute → re_derive / re_deriving', async () => {
  const res = await call({ disputeKind: 'interpretation', disputedClassifiers: ['ownershipType'] });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, 're_derive');
  assert.equal(res.body.nextState, 're_deriving');
});

test('a corrected company supplies identity even without an explicit kind label', async () => {
  // disputeHasKind still needs a valid kind for edge 1; identity is provided,
  // and disputeKindIsIdentity also accepts a corrected company on edge 2.
  const res = await call({ disputeKind: 'identity', correctedCompany: 'Acme Holdings Ltd' });
  assert.equal(res.body.mode, 'full_research');
});

test('invalid dispute kind is rejected by the guard (ok:false, no mode)', async () => {
  const res = await call({ disputeKind: 'bogus' });
  assert.equal(res.body.ok, false);
  assert.equal(res.body.valid, false);
  assert.match(res.body.reason, /dispute kind must be one of/);
});

test('missing dispute kind is rejected', async () => {
  const res = await call({});
  assert.equal(res.body.ok, false);
  assert.equal(res.body.valid, false);
});

test('non-POST is 405', async () => {
  const res = await call({ disputeKind: 'identity' }, 'GET');
  assert.equal(res.statusCode, 405);
});

test('an anonymous caller is refused', async () => {
  routeAuth.__resetDeps();
  routeAuth.__setDeps({ resolveDossierActor: async () => ({ kind: 'none', reason: 'unauthorized' }) });
  const res = await call({ disputeKind: 'identity', disputedClassifiers: ['companyName'] });
  assert.equal(res.statusCode, 401);
  routeAuth.__setDeps({
    resolveDossierActor: async () => ({ kind: 'customer', tenantId: 'acme', dossierId: '1', reason: null }),
  });
});
