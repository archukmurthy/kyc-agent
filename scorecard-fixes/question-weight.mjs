// benchmark/question-weight.mjs
// -----------------------------------------------------------------------------
// Computes "questions avoided" at the DATA-POINT level rather than the
// schema-field level. A `directors` field that returns 15 people with name,
// role, nationality, DOB and residential country is ~75 data points an analyst
// would otherwise type — not 1.
//
// Confidence treatment (agreed):
//   - verified + probable  -> counted as AVOIDED   (analyst spared entirely)
//   - indicative           -> counted as PREDRAFTED (analyst still verifies)
//   Reported as two separate numbers, never collapsed.
//
// Two modes, sharing one core:
//   (a) retroactive  — weight derived purely from what's present in `found`,
//                      so it recomputes over already-stored pilot output with
//                      no schema change.
//   (b) schema-driven — optional per-field overrides (weightKeys / fixedWeight)
//                      from the field schema, used for new runs where the schema
//                      knows the canonical attribute set. Falls back to (a) when
//                      no override is present.
// -----------------------------------------------------------------------------

// Stakeholder attributes that correspond to an actual form field an analyst
// would type. Plumbing keys (id, source, sourceTier, sourceUrl, fetchedAt,
// customer_confirmed, etc.) are deliberately excluded.
export const STAKEHOLDER_FORM_ATTRS = [
  "full_name",
  "role",
  "share_percentage",
  "nationality",
  "date_of_birth",
  "residential_country",
  "id_type",
  "id_number",
  "is_pep",
];

// Address sub-fields are already split in the data; each non-empty one is a box.
// (Used only when an address arrives as a single object rather than pre-split
// fields. In the current pipeline addresses already arrive pre-split, so each
// counts as its own scalar found-field and needs no special handling — this is
// here for the schema-driven path and future-proofing.)
const ADDRESS_SUBFIELDS = [
  "line1", "line2", "city", "state", "postcode", "country",
];

const isEmpty = (v) =>
  v === null || v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

// Count populated, analyst-meaningful attributes on one stakeholder object,
// restricted to `attrs` (schema override) or STAKEHOLDER_FORM_ATTRS (default).
function stakeholderWeight(stakeholder, attrs = STAKEHOLDER_FORM_ATTRS) {
  if (!stakeholder || typeof stakeholder !== "object") return 0;
  let w = 0;
  for (const key of attrs) {
    if (!isEmpty(stakeholder[key])) w += 1;
  }
  return w;
}

// Weight of a single `found` field = how many data points it actually yields.
//   - has stakeholders[] -> sum of per-stakeholder form attributes
//   - value is an array of objects -> same treatment as stakeholders
//   - value is an address object -> count non-empty sub-fields
//   - otherwise scalar -> 1 (if non-empty)
// `fieldSchema` (optional, mode b) may carry:
//   - fixedWeight: number   (use this weight regardless)
//   - weightKeys:  string[] (attribute set to count for stakeholder rows)
export function fieldWeight(foundField, fieldSchema = null) {
  if (!foundField) return 0;

  // (b) explicit fixed weight from schema
  if (fieldSchema && Number.isFinite(fieldSchema.fixedWeight)) {
    return isEmpty(foundField.value) ? 0 : fieldSchema.fixedWeight;
  }

  const attrs =
    (fieldSchema && Array.isArray(fieldSchema.weightKeys) && fieldSchema.weightKeys) ||
    STAKEHOLDER_FORM_ATTRS;

  // Stakeholder-bearing field (directors, ubo_parent_company, etc.)
  if (Array.isArray(foundField.stakeholders) && foundField.stakeholders.length) {
    return foundField.stakeholders.reduce((s, p) => s + stakeholderWeight(p, attrs), 0);
  }

  const val = foundField.value;

  // Array of person/entity objects without a stakeholders[] mirror
  if (Array.isArray(val) && val.length && typeof val[0] === "object") {
    return val.reduce((s, p) => s + stakeholderWeight(p, attrs), 0);
  }

  // Address-shaped object
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const sub = ADDRESS_SUBFIELDS.filter((k) => !isEmpty(val[k]));
    if (sub.length) return sub.length;
    // generic object: count non-empty leaf values
    const leaves = Object.values(val).filter((x) => !isEmpty(x));
    return leaves.length || 1;
  }

  // Scalar
  return isEmpty(val) ? 0 : 1;
}

// Main entry. Returns { avoided, predrafted, total } in DATA POINTS.
//   avoided    = weight of verified + probable fields
//   predrafted = weight of indicative fields
// `schemaByField` (optional, mode b): { [fieldKey]: { fixedWeight?, weightKeys? } }
export function questionsAvoided(found, schemaByField = null) {
  let avoided = 0;
  let predrafted = 0;
  for (const f of found || []) {
    const fs = schemaByField ? schemaByField[f.field] : null;
    const w = fieldWeight(f, fs);
    const status = f.verificationStatus;
    if (status === "verified" || status === "probable") {
      avoided += w;
    } else if (status === "indicative") {
      predrafted += w;
    } else {
      // unknown status -> treat conservatively as predrafted
      predrafted += w;
    }
  }
  return { avoided, predrafted, total: avoided + predrafted };
}
