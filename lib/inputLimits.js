// Shared text-field validation for endpoints that interpolate request body
// strings into a Claude agent prompt (doc-search, self-source, ubo-discovery).
// An unbounded or non-string value is a prompt-injection / cost-blowup vector,
// so every such field is checked BEFORE the rate limiter and before any
// agent work starts. Fields absent from the body are left to each handler's
// own required-field check; this only bounds what's actually present.
//
// CommonJS so api/ handlers can require it.

// limits: { fieldName: maxLength }
// Returns { ok: true } or { ok: false, field } — never truncates.
function checkTextFields(body, limits) {
  const b = body && typeof body === "object" ? body : {};
  for (const field of Object.keys(limits)) {
    const value = b[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.length > limits[field]) {
      return { ok: false, field };
    }
  }
  return { ok: true };
}

module.exports = { checkTextFields };
