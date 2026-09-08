"use strict";

// Thin wrapper over the official ComplyCube SDK for the two calls we need:
// create a person client, then run an extensive AML screening check against it.
// Server-side only — the API key never reaches the browser. A real ComplyCube
// instance can be swapped for a stub in tests via deps.client.
const { ComplyCube } = require("@complycube/api");
const { randomUUID } = require("node:crypto");
const { screeningConfig, assertKeyMatchesMode } = require("./config");

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

async function createClient(person, deps = {}) {
  if (!person || !person.firstName || !person.lastName) {
    throw new Error("createClient: person firstName and lastName are required");
  }
  const cc = deps.client || realClient();
  return cc.client.create({
    type: "person",
    email: personEmail(person),
    personDetails: {
      firstName: person.firstName,
      lastName: person.lastName,
      ...(person.dob ? { dob: person.dob } : {}),
      ...(person.nationality ? { nationality: person.nationality } : {}),
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
