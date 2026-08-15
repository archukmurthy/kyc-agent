# Evidence Platform — Current Build Brief

# Stage A0 — Platform Boundary and Evidence Lab Foundation

## Objective

Establish the initial Evidence Platform implementation boundary without implementing the substantive Evidence lifecycle yet.

This phase creates the place in which subsequent Evidence Platform capabilities will be built and tested.

## Authorized Scope

Inspect the existing repository conventions and establish an Evidence Platform structure consistent with them.

The conceptual boundary should accommodate capabilities equivalent to:

```text
evidence/
    domain
    acquisition
    assets
    provenance
    extraction
    requirements
    matching
    ledger
    packaging
```

Do not mechanically create empty directories merely to mirror this example.

Use repository conventions and create only scaffolding that has immediate purpose.

Establish a server-side Evidence Platform module/service boundary.

Establish the minimal route/API boundary needed for Evidence Lab health/status interaction.

Create an internal Evidence Lab shell/test harness that is isolated from the existing customer onboarding journey.

The Evidence Lab does not need substantive Evidence functionality yet.

It should prove:

* the Evidence module can be invoked;
* the Evidence Lab can communicate with it;
* the new boundary is independently testable;
* existing application behavior remains unchanged.

Add appropriate tests for the new boundary.

Document the resulting module/API/test structure.

## Evidence Lab

The Evidence Lab is an internal development and validation surface.

It is not customer-facing product functionality.

At this stage it may be minimal.

Do not build a polished UI.

Do not implement the full lifecycle.

Its purpose is to become the controlled harness through which later Stage A capabilities are exercised.

## Explicitly Not Authorized

Do not yet implement:

* canonical Evidence Asset persistence;
* Evidence Requirement persistence;
* acquisition workflows;
* browser/regulator capture;
* Blob evidence storage;
* extraction;
* observations;
* facts/assertions;
* matching;
* requirement satisfaction;
* Evidence Ledger;
* Evidence Packages;
* DRS integration;
* existing upload migration;
* KYC integration;
* Pre-boarding integration;
* UBO integration;
* legacy migration;
* production feature flags unless technically necessary merely to keep the internal harness inaccessible.

Do not modify existing database tables.

Do not create speculative Evidence database schema during A0.

## Existing Application Protection

Existing KYC and Pre-boarding behavior must remain unchanged.

Avoid modifying existing high-coupling application files unless absolutely necessary to expose the internal Evidence Lab.

If such a modification is required, minimize it and explain why.

Prefer an isolated development/internal route.

## Architecture Questions

If implementation of A0 exposes decisions that would prematurely constrain:

* Case identity;
* Evidence Asset identity;
* tenancy;
* authorization;
* database schema;
* Evidence lifecycle;
* producer contracts;
* deployment topology;

do not invent those decisions simply to complete scaffolding.

Surface them for Architecture Authority.

## Completion Criteria

A0 is complete when:

1. the Evidence Platform has a clear bounded code location;
2. the Evidence Platform has a minimal callable server-side boundary;
3. an internal Evidence Lab/test harness can call that boundary;
4. automated tests demonstrate the boundary works;
5. existing KYC/Pre-boarding tests and behavior remain intact;
6. no substantive Evidence domain semantics have been invented prematurely;
7. the implementation provides a clean location for Stage A1.
