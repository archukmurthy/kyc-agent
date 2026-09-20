"use strict";

function value(field, extractedValue, rawRepresentation) {
  return { schemaFieldId: field, extractedValue, confidence: 100, rawRepresentation };
}

function extractProfile(data) {
  const a = data.registered_office_address || {};
  return [
    value("business_name", data.company_name, "company_name"),
    value("registration_number", data.company_number, "company_number"),
    value("incorporation_date", data.date_of_creation, "date_of_creation"),
    value("business_type", data.type, "type"),
    value("registered_address_line1", a.address_line_1, "registered_office_address.address_line_1"),
    value("registered_address_line2", a.address_line_2, "registered_office_address.address_line_2"),
    value("registered_address_city", a.locality, "registered_office_address.locality"),
    value("registered_address_state", a.region, "registered_office_address.region"),
    value("registered_address_postcode", a.postal_code, "registered_office_address.postal_code"),
    value("registered_address_country", a.country || "GB", "registered_office_address.country"),
  ].filter((item) => item.extractedValue !== undefined && item.extractedValue !== null && item.extractedValue !== "");
}

function extractOfficers(data) {
  return (data.items || []).map((officer, index) => value("director_names", {
    name: officer.name || null,
    role: officer.officer_role || null,
    appointedOn: officer.appointed_on || null,
    resignedOn: officer.resigned_on || null,
    status: officer.resigned_on ? "resigned" : "current",
  }, `items[${index}]`));
}

function ownershipBand(natures = []) {
  const code = natures.find((item) => /(?:ownership-of-shares|voting-rights)-(25-to-50|50-to-75|75-to-100)-percent/.test(item));
  if (!code) return null;
  const match = code.match(/(25-to-50|50-to-75|75-to-100)-percent/)[1];
  const [minimum, maximum] = match.split("-to-").map(Number);
  return { minimumExclusive: minimum, maximumInclusive: maximum, sourceCode: code };
}

function extractPsc(data) {
  return (data.items || []).flatMap((psc, index) => {
    const source = `items[${index}]`;
    const facts = [value("ubo_parent_company", {
      name: psc.name || null,
      kind: psc.kind || null,
      ceasedOn: psc.ceased_on || null,
      notifiedOn: psc.notified_on || null,
      naturesOfControl: psc.natures_of_control || [],
    }, source)];
    const band = ownershipBand(psc.natures_of_control || []);
    if (band) facts.push(value("ubo_share_percentage", band, `${source}.natures_of_control`));
    return facts;
  });
}

module.exports = { extractProfile, extractOfficers, extractPsc, ownershipBand };
