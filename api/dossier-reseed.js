// State-machine bridge for self-serve re-research: runs ONLY the two dossier
// lifecycle transitions this slice needs and tells the client which mode to use.
//
//   READY --CORE_CLASSIFIER_DISPUTED--> DISPUTED --RESEED_FULL_RESEARCH----> RE_RESEARCHING   (identity / wrong company)
//   READY --CORE_CLASSIFIER_DISPUTED--> DISPUTED --RESEED_DERIVATIONS_ONLY--> RE_DERIVING      (interpretation / wrong type)
//
// The dossierLifecycle machine is plain CommonJS at the repo root and is
// DESIGNED to be required by api/ (see dossierLifecycle/states.js header). The
// React bundle can't import it (CRA ModuleScopePlugin forbids importing outside
// src/), so this thin route is the bridge: App.js POSTs the dispute, the real
// machine validates the two edges, and the route returns the resulting mode.
//
// Pure w.r.t. the database — it runs the state machine and returns a decision;
// it writes nothing. seeded_by:customer is stamped at dossier SAVE time
// (api/save-dossier.js), and the dispute itself is audited as a change_event by
// the caller. "Nothing more of dossierLifecycle" is wired than these two edges.
//
// CommonJS (module.exports), mirroring the other api/ handlers.

const { transition } = require("../dossierLifecycle/transition");
const { STATES, EVENTS, DISPUTE_KIND } = require("../dossierLifecycle/states");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const disputeKind = body.disputeKind; // 'identity' | 'interpretation'
  const disputedClassifiers = Array.isArray(body.disputedClassifiers) && body.disputedClassifiers.length
    ? body.disputedClassifiers
    : ["companyName"]; // a dispute always implicates at least one classifier

  const context = {
    disputedClassifiers,
    disputeKind,
    correctedCompany: body.correctedCompany || null,
    correctedCountry: body.correctedCountry || null,
  };

  // Edge 1: ready → disputed (guard: disputeHasKind).
  const toDisputed = transition(STATES.READY, EVENTS.CORE_CLASSIFIER_DISPUTED, context);
  if (!toDisputed.valid) {
    return res.status(200).json({ ok: false, valid: false, reason: toDisputed.reason });
  }

  // Edge 2: disputed → re_researching (identity) | re_deriving (interpretation).
  const reseedEvent =
    disputeKind === DISPUTE_KIND.IDENTITY
      ? EVENTS.RESEED_FULL_RESEARCH
      : EVENTS.RESEED_DERIVATIONS_ONLY;
  const toReseed = transition(toDisputed.nextState, reseedEvent, context);
  if (!toReseed.valid) {
    return res.status(200).json({ ok: false, valid: false, reason: toReseed.reason });
  }

  // Mode the client acts on: full AI re-research (discard) vs re-derive (keep).
  const mode = toReseed.nextState === STATES.RE_RESEARCHING ? "full_research" : "re_derive";

  return res.status(200).json({
    ok: true,
    valid: true,
    mode,
    fromState: STATES.READY,
    viaState: toDisputed.nextState, // 'disputed'
    nextState: toReseed.nextState, // 're_researching' | 're_deriving'
    reason: null,
  });
};
