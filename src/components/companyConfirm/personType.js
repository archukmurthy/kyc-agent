/**
 * personType.js — the ASSUMED person-type interface for CD-03, plus its stub.
 *
 * CD-03's document rule is keyed off PERSON TYPE, not the attribute corrected.
 * Commit 6 is the CONSUMER of that type: it reads `person.isDirector` /
 * `person.isUBO` and the CD-03 rules run live on them. The PRODUCER of those
 * flags — real director/UBO classification, ownership resolution, the
 * pseudo-UBO case — is the deferred UBO discovery / evidence stream
 * (PR-032 / PR-042 / PR-046) and is explicitly out of scope here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STUB: person-type classification is the deferred UBO discovery stream
 * (PR-032/042/046). Defaults to UBO (over-collect = safe failure).
 * Replace when real classification lands.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Resolution order, most trustworthy first:
 *   1. 'flags'          — the person object carries explicit isDirector/isUBO
 *                         booleans. This is the real interface; when the
 *                         classifier lands it populates these and the stub
 *                         below stops being consulted.
 *   2. 'field-inferred' — STUB TIER. Inferred from the research field the
 *                         person was found under (the same signal the existing
 *                         UI already uses via isUboLikeField to decide EDD
 *                         forms). Good enough to tell a directors list from a
 *                         UBO list; CANNOT see a person who is BOTH, which is
 *                         exactly why the real classifier is still needed.
 *   3. 'stub-default'   — STUB TIER. Nothing to go on → UBO. Chosen so the
 *                         failure direction is over-collection (asking for a
 *                         document that wasn't strictly required) rather than
 *                         under-collection (missing a required UBO document,
 *                         which is a real compliance defect).
 *
 * DUAL-ROLE AND PSEUDO-UBO ARE NOT DERIVABLE HERE. A person in both the
 * directors and the UBO list is two separate stakeholder objects with two
 * different sh_ ids and no identity link; and no seniority ranking exists to
 * find the "most senior director". Those cases are UNDECIDED by design — see
 * PERSON_TYPE.PSEUDO_UBO, which nothing in this module ever returns.
 */

export const PERSON_TYPE = {
  DIRECTOR: "director",
  UBO: "ubo",
  // Never produced by resolvePersonType — reserved so the engine has a rule to
  // record UNDECIDED against once real ownership data can identify the case.
  PSEUDO_UBO: "pseudo_ubo",
};

/** CD-03's person attributes. The composite fieldId's third segment. */
export const PERSON_ATTRIBUTE = {
  NAME: "name",
  DOB: "dob",
  NATIONALITY: "nationality",
  COUNTRY_OF_BIRTH: "country_of_birth",
  RESIDENTIAL_ADDRESS: "residential_address",
  PEP: "pep",
  OWNERSHIP_PCT: "ownership_pct",
  ROLE: "role",
  REMOVAL: "removal",
  // Commit 7 — the customer adding a person the research missed. Kept as their
  // own attributes rather than reusing the correction attributes so the audit
  // trail names the rule that actually fired: an analyst reading
  // PERSON-DOB-UBO on a person who was ADDED would be misled.
  ADDED: "added",           // the list document proving the person belongs
  ADDED_POI: "added_poi",   // the added person's own identity evidence
  ADDED_POA: "added_poa",   // the added person's own address evidence
};

/** Maps the stakeholder card's field keys onto CD-03 attributes. */
export const ATTRIBUTE_BY_FIELD_KEY = {
  full_name: PERSON_ATTRIBUTE.NAME,
  date_of_birth: PERSON_ATTRIBUTE.DOB,
  nationality: PERSON_ATTRIBUTE.NATIONALITY,
  country_of_birth: PERSON_ATTRIBUTE.COUNTRY_OF_BIRTH,
  residential_country: PERSON_ATTRIBUTE.RESIDENTIAL_ADDRESS,
  is_pep: PERSON_ATTRIBUTE.PEP,
  share_percentage: PERSON_ATTRIBUTE.OWNERSHIP_PCT,
  role: PERSON_ATTRIBUTE.ROLE,
  positions: PERSON_ATTRIBUTE.ROLE,
};

const uboLikeField = (fieldId) => {
  const f = String(fieldId || "").toLowerCase();
  return f.includes("ubo") || f.includes("beneficial") || f.includes("sharehold");
};
const directorLikeField = (fieldId) => {
  const f = String(fieldId || "").toLowerCase();
  return f.includes("director") || f.includes("officer") || f.includes("signator");
};

/**
 * @returns {{isDirector: boolean, isUBO: boolean, personType: string, source: string, isStub: boolean}}
 */
export function resolvePersonType(person = {}, fieldId = "") {
  // 1. The real interface.
  if (typeof person.isDirector === "boolean" || typeof person.isUBO === "boolean") {
    const isDirector = person.isDirector === true;
    const isUBO = person.isUBO === true;
    return {
      isDirector,
      isUBO,
      // A dual-role person is UBO-typed for document purposes: CD-03 gives
      // director-also-UBO the same POI/POA treatment as a plain UBO.
      personType: isUBO ? PERSON_TYPE.UBO : PERSON_TYPE.DIRECTOR,
      source: "flags",
      isStub: false,
    };
  }

  // 2. STUB TIER — infer from the list the person was found under.
  if (uboLikeField(fieldId)) {
    return { isDirector: false, isUBO: true, personType: PERSON_TYPE.UBO, source: "field-inferred", isStub: true };
  }
  if (directorLikeField(fieldId)) {
    return { isDirector: true, isUBO: false, personType: PERSON_TYPE.DIRECTOR, source: "field-inferred", isStub: true };
  }

  // 3. STUB TIER — nothing to go on. Over-collect rather than under-collect.
  return { isDirector: false, isUBO: true, personType: PERSON_TYPE.UBO, source: "stub-default", isStub: true };
}

/**
 * The composite change_events.field_id (Investigation C):
 *   `<personType>::<stakeholderId>::<attribute>`
 * field_id is an opaque TEXT key everywhere downstream — buildChangeEvent
 * passes it through, writeEvent only checks presence, and
 * deriveAmendmentDocuments maps on it — so each person-attribute is
 * independently addressable and supersedes independently.
 */
export function personFieldId(personType, stakeholderId, attribute) {
  return `${personType}::${stakeholderId}::${attribute}`;
}

/** Inverse, for reading an event back. Returns null for a company-level id. */
export function parsePersonFieldId(fieldId) {
  const parts = String(fieldId || "").split("::");
  if (parts.length !== 3) return null;
  return { personType: parts[0], stakeholderId: parts[1], attribute: parts[2] };
}

/** CD-03's shared "the list document" rule, keyed off person type. */
export function listDocumentFor(personType) {
  return personType === PERSON_TYPE.DIRECTOR ? "List of Directors" : "Ownership Chart";
}

export default resolvePersonType;
