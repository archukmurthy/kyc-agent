"use strict";

// Thin wrapper over the official ComplyCube SDK for the two calls we need:
// create a person client, then run an extensive AML screening check against it.
// Server-side only - the API key never reaches the browser. A real ComplyCube
// instance can be swapped for a stub in tests via deps.client.
const { ComplyCube } = require("@complycube/api");
const { randomUUID } = require("node:crypto");
const { screeningConfig, assertKeyMatchesMode } = require("./config");
const { toComplyCubeNationality } = require("./iso3to2");

const SCREENING_CHECK_TYPE = "extensive_screening_check";

function realClient() {
  const cfg = screeningConfig();
  assertKeyMatchesMode(cfg);
  return new ComplyCube({ apiKey: cfg.apiKey });
}

// ComplyCube requires an email on a person; screening never uses it, so fall
// back to a unique, format-valid placeholder when the applicant email is unknown.
function personEmail(person) {
  return person.email || `screening+${randomUUID()}@idv.invalid`;
}

// DEMO-ONLY sandbox affordance: force a ComplyCube "attention"/hit outcome so a
// demo can show the in-review path. Sandbox-only trigger word for last name.
// Gated on BOTH screeningConfig().mode === "test" AND the env flag below - if
// mode is "live" this is ALWAYS ignored, no matter the flag. This can never
// alter a live screening: it only changes the name string sent to ComplyCube
// for matching, never the applicant's stored/verified identity.
function demoForceHitEnabled() {
  const v = String(process.env.SCREENING_DEMO_FORCE_HIT || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

async function createClient(person, deps = {}) {
  if (!person || !person.firstName || !person.lastName) {
    throw new Error("createClient: person firstName and lastName are required");
  }
  const demoHit = screeningConfig().mode === "test" && demoForceHitEnabled();
  const cc = deps.client || realClient();
  // Didit returns nationality as ISO-3 (e.g. "POL"); ComplyCube requires ISO-2
  // and 400s on anything else - normalize and only send it when it's a code
  // ComplyCube actually accepts, otherwise omit it rather than fail the call.
  const nationality = toComplyCubeNationality(person.nationality);
  return cc.client.create({
    type: "person",
    email: personEmail(person),
    personDetails: {
      firstName: person.firstName,
      lastName: demoHit ? "attention" : person.lastName,
      ...(person.dob ? { dob: person.dob } : {}),
      ...(nationality ? { nationality } : {}),
    },
  });
}

async function createScreeningCheck(clientId, deps = {}) {
  if (!clientId) throw new Error("createScreeningCheck: clientId is required");
  const cc = deps.client || realClient();
  return cc.check.create(clientId, { type: SCREENING_CHECK_TYPE });
}

async function getCheck(checkId, deps = {}) {
  if (!checkId) throw new Error("getCheck: checkId is required");
  const cc = deps.client || realClient();
  return cc.check.get(checkId);
}

module.exports = { createClient, createScreeningCheck, getCheck, SCREENING_CHECK_TYPE };
