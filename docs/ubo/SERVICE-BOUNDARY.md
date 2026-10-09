# The UBO service boundary - what a host system calls, and what it must bring

The product owner, 2026-09-21: *"UBO is just another microservice I should be
able to call from my main code, otherwise there is no link, focus on
standalone."*

That settles the direction of every dependency: **the host calls UBO; UBO knows
nothing about the host.** No reference field pointing at platform data, no
import running the other way, no shared table. This document writes down what
that service actually offers today, so "call it from my main code" is a thing
somebody can do rather than a thing we agree with.

Read from the code on 2026-09-22 (`ubo-control/index.js`,
`ubo-control/composition/createUboControl.js`,
`ubo-control/application/createUboDecisionApplication.js`). Where this document
and the code disagree, the code is right and this file is a bug.

## The shape

`ubo-control/` is a **library with no I/O**. It does not open a socket, read a
file, write a row, or know who is signed in. Everything it needs arrives as an
argument; everything it produces is returned. That is what makes it a service
you can call rather than a system you have to host - and it is why the module
has no persistence, no auth and no audit inside it. Those are the host's, by
design, not by omission.

`ubo-control/index.js` is the only public entry. Nothing outside the module
imports a path inside it - that rule is in `CLAUDE.md` and it is what keeps this
boundary real.

## Two things to build, and they are separate

### 1. `createUboControl({ discoveryService, extractionService, policyPack })`

Gathers facts about who owns a company. It performs no research itself: the
caller supplies the two services that do, and this validates both sides of every
exchange.

| Operation | You pass | You get back |
| --- | --- | --- |
| `discover(request)` | a discovery request (subject company, the information needed, a `requestId`) | a capability result: candidate facts, evidence references, an outcome state |
| `extract(request)` | an extraction request (a document to read) | the same shape of capability result |
| `policyIdentity` | - | which policy pack this instance is running |

Both operations validate the request before calling your service and validate
the result after - including that the result carries the `requestId` you sent.
A service that answers a different question than it was asked is rejected rather
than trusted.

**What the host must provide:**

- `discoveryService` - an object with `discover(request)`. Ours is
  `integrations/ubo-control/legacy-discovery`, which reaches Companies House and
  a web-research agent.
- `extractionService` - an object with `extract(request)`. Ours is
  `integrations/ubo-control/evidence-platform-extraction`.
- `policyPack` - the rules that define an ownership threshold and what a
  complete answer looks like. Loaded and hash-checked by the module.

Configuration is explicit and fails loudly: a missing or malformed service
throws `MISSING_DISCOVERY_SERVICE` / `INVALID_DISCOVERY_SERVICE` at construction
rather than at the first request.

### 2. `createUboDecisionApplication({ policyPack, contractVersion })`

Turns facts into a decision, and it is a **pure state machine**. Each operation
takes the current case state and returns the next one; nothing is stored between
calls. The host keeps the state and hands it back.

| Operation | You pass | You get back |
| --- | --- | --- |
| `intake(request)` | the current case state plus a capability result from step 1 | the next case state |
| `applyDecisions(request)` | the case state plus an analyst's resolutions | the next case state |
| `applyCustomerInput(request)` | the case state plus what the customer answered (v2 and v3 only) | the next case state |
| `evaluate(request)` | the case state | a **decision snapshot** - the answer, plus the graph, journey and readiness projections |

Three contract versions exist: `v1` (`intake`, `applyDecisions`, `evaluate`),
`v2` adds `applyCustomerInput`, and `v3` is the current one. The version is
named at construction and every request carries it, so a caller cannot be
upgraded by accident.

## The decision snapshot, and why the host's job is easy

`evaluate` returns an immutable, deep-frozen snapshot whose id **is** the hash of
its content, chained to the previous one. Two consequences worth knowing before
designing storage:

- **Storing it is enough.** Every projection - the ownership graph, the journey,
  the policy readiness - is a pure function of the snapshot. Nothing needs to be
  stored twice, and nothing can drift.
- **It cannot be edited.** A correction produces a new snapshot pointing at the
  old one. That is the audit trail, and it exists whether or not anybody builds
  an audit feature.

## What the host owns - every single one of these

The module deliberately has none of them, so a host that forgets one has a gap,
not a bug in UBO:

1. **Who is calling, and what they may see.** Ours: `lib/routeAuth.js`,
   `lib/userAccess.js`.
2. **Storage.** Case state between calls, snapshots, uploaded documents. This is
   the piece that does not exist yet - `docs/ubo/SCHEMA-PROPOSAL.md`.
3. **Money.** The module will call whatever service you hand it, as often as you
   ask. Rate limits and spend ceilings are the host's: `lib/rateLimit.js`,
   `lib/spendCap.js`.
4. **Retention.** Seven years, nothing hard-deleted: `lib/uboRetention.js`.
5. **Observability.** The module throws typed errors with codes; turning those
   into something findable at 9pm is the host's: `lib/requestLog.js`.
6. **Jobs.** Discovery takes minutes. Running it in the background, retrying it
   safely, showing somebody a queue - all the host's. This is row 16 and it
   needs the schema.

## Calling it over HTTP rather than in-process

Today the host calls the module in-process, through
`api/ubo-discovery.js`. Her sentence - *"a microservice I should be able to call
from my main code"* - reads as in-process too: a package with a clean surface,
not a separate deployment.

Worth being explicit about, because it is a decision and not an obvious one.
Nothing in the module prevents putting it behind HTTP later: it takes data and
returns data, and every request and result is validated. What would need
designing at that point is where the case state lives between calls, which is
the schema question again.

**Open question for the product owner:** in-process package, or a deployed
service with its own URL? Nothing built so far depends on the answer, and the
answer changes what the schema is for.

**Settled 2026-09-25, and it is the half that mattered more.** Whichever way that
question goes, UBO keeps its OWN tables and refers to Evidence and IDV by plain
text it never follows - see section 0 of `docs/ubo/SCHEMA-PROPOSAL.md`. Code
separates by deleting a file; a database does not, so the data boundary is the
one that decides whether this module can be sold on its own.
