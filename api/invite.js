// Sends a customer onboarding invitation email and persists the invite record.
//
// CommonJS (module.exports), not `export default`, so src/setupProxy.js can
// require() it for local `npm start` (mirrors api/save-dossier.js, api/submit.js).
//
// Email delivery uses the Resend REST API (https://resend.com) via fetch — no
// new npm dependency, same pattern as api/research.js calling Anthropic. When
// RESEND_API_KEY is absent (e.g. local dev with nothing provisioned) the
// endpoint still succeeds but reports { sent: false, simulated: true } so the
// analyst-facing flow degrades gracefully instead of erroring.
//
// ANALYST-ONLY, SERVER-BUILT LINK: only a caller holding the analyst
// credential (lib/dossierAccess.js) may invite. The dossier must already
// exist in that analyst's tenant. The server mints a signed, expiring,
// revocable customer token (lib/dossierToken.js#mint) and builds the ONLY
// link ever emailed — a body-supplied tenantId or link is never trusted or
// used. The link carries `?dossierToken=<token>`, never a raw dossierId, so a
// forwarded or leaked link cannot be used to enumerate dossiers, and the
// tenant can revoke every outstanding copy via api/revoke-dossier-token.js.
//
// Env vars:
//   RESEND_API_KEY       — Resend API key. Without it, email is simulated.
//   INVITE_FROM_EMAIL    — From header, e.g. "Acme Onboarding <onboarding@acme.com>".
//                          Defaults to Resend's shared test sender, brand-named
//                          from the tenant's own config (see brandName below).
//   DOSSIER_TOKEN_SECRET — required to mint a customer link (lib/dossierToken.js).

const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const store = require("../lib/storage.js");
const dossierAccess = require("../lib/dossierAccess");
const dossierToken = require("../lib/dossierToken");
const { readConfigForTenant } = require("./config");

const INVITE_RECORD_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Real Resend call, isolated behind the deps seam below so tests can
// substitute a fake sender without touching the network.
async function sendEmail({ apiKey, from, to, subject, text }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  const data = await r.json();
  return { ok: r.ok, data };
}

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { store, sendEmail, readConfigForTenant, neon, access: dossierAccess, dossierToken };

// Resolve the server's own origin from request headers — NOT from the request
// body. body.origin is attacker-controlled (any value the caller's JS sets);
// the Host header (and x-forwarded-*, which Vercel's edge sets from the real
// incoming request) is what the server was actually reached on, so it's the
// only trustworthy anchor for the link we build.
function resolveOrigin(req, bodyOrigin) {
  const headers = req.headers || {};
  const host = headers["x-forwarded-host"] || headers.host;
  if (host) {
    const proto = String(headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    return `${proto}://${host}`.replace(/\/+$/, "");
  }
  // No Host header at all (shouldn't happen over real HTTP) — fall back to
  // whatever the client claims, else the known prod default.
  return (bodyOrigin || "").replace(/\/+$/, "") || "https://kyc-agent-deploy.vercel.app";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  if (actor.kind !== "analyst") {
    return res.status(403).json({ error: "forbidden" });
  }
  const tenantId = actor.tenantId;

  const { email, contactName, companyName, origin, dossierId } = req.body || {};
  if (!email || !contactName) {
    return res.status(400).json({ error: "Missing email or contactName" });
  }
  if (!dossierId) {
    return res.status(400).json({ error: "Missing dossierId — save the dossier before inviting" });
  }

  if (!process.env.DOSSIER_TOKEN_SECRET) {
    console.error("[invite] DOSSIER_TOKEN_SECRET is not configured");
    return res.status(500).json({ error: "not_configured" });
  }

  // The dossier must exist in the ANALYST's tenant before we issue a link to
  // it — this is a security check (it stops an analyst minting a working
  // token for another tenant's dossier, or for an id that doesn't exist), so
  // unlike save-dossier/search-attempt it is never skipped when DATABASE_URL
  // is unset; an unreachable DB fails the request rather than silently
  // skipping the ownership check.
  if (!process.env.DATABASE_URL) {
    console.error("[invite] DATABASE_URL is not configured");
    return res.status(500).json({ error: "not_configured" });
  }

  let found;
  try {
    const sql = _deps.neon(process.env.DATABASE_URL);
    found = await sql`
      SELECT id FROM entity_dossiers
      WHERE id = ${dossierId} AND tenant_id = ${tenantId} AND status != 'deleted'
      LIMIT 1
    `;
  } catch (err) {
    console.error("[invite] dossier lookup failed", err);
    return res.status(500).json({ error: "lookup_failed" });
  }
  if (!found.length) return res.status(404).json({ error: "dossier_not_found" });

  // Postgres's uuid type matches an uppercase/braced/hyphenless spelling to
  // the same row as its canonical lowercase form. Minting with the caller's
  // spelling would embed an id in the token that api/get-dossier's
  // canReadDossier — which compares against the canonical stored id — later
  // refuses. Use the row's own id from here on, not the caller-typed one.
  const canonicalDossierId = String(found[0].id);

  const token = _deps.dossierToken.mint({ dossierId: canonicalDossierId, tenantId });
  const baseOrigin = resolveOrigin(req, origin);
  // The server builds the only link. A client-supplied link is never used.
  const link = `${baseOrigin}/?tenant=${encodeURIComponent(tenantId)}&dossierToken=${encodeURIComponent(token)}&journey=customer`;

  // Persist WHO was invited to WHAT — never the link or the token, which are
  // bearer credentials and have no business sitting in a KV record.
  const inviteId = crypto.randomBytes(18).toString("base64url");
  const inviteRecord = {
    inviteId,
    email,
    contactName,
    companyName: companyName || null,
    dossierId: canonicalDossierId,
    tenantId,
    createdAt: new Date().toISOString(),
    status: "invited",
  };
  try {
    await _deps.store.set(`invite:${inviteId}`, inviteRecord, { ttlSeconds: INVITE_RECORD_TTL_SECONDS });
  } catch (e) {
    console.warn("invite persist failed:", e && e.message);
  }

  // Brand comes from the tenant's own configuration. It used to be hardcoded,
  // so every tenant's customers received a Nium-branded email.
  let brandName = tenantId;
  try {
    const cfg = await _deps.readConfigForTenant(tenantId);
    const configured = cfg && cfg.company && cfg.company.name;
    if (typeof configured === "string" && configured.trim()) brandName = configured.trim();
  } catch (_) { /* fall back to the tenant id */ }

  const subject = `Your ${brandName} onboarding is ready${companyName ? ` — ${companyName}` : ""}`;
  const text = `Dear ${contactName},

Thank you for your interest in ${brandName}. We have begun reviewing your application${companyName ? ` for ${companyName}` : ""} and are ready to proceed with the next step.

Please complete your onboarding by clicking the link below:

${link}

This link is unique to your application. Once you click it, you will be guided through a short onboarding form. The process typically takes 10–15 minutes.

If you have any questions, please do not hesitate to reach out to your ${brandName} contact.

Best regards,
${brandName} Onboarding Team`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL || `${brandName} Onboarding <onboarding@resend.dev>`;

  // No provider configured → simulate. The demo still shows the success screen
  // and a real, persisted link, but no mail actually leaves the building.
  if (!apiKey) {
    return res.status(200).json({
      sent: false,
      simulated: true,
      reason: "RESEND_API_KEY not configured",
      inviteId,
      dossierId: canonicalDossierId,
      link,
      subject,
      body: text,
    });
  }

  try {
    const { ok, data } = await _deps.sendEmail({ apiKey, from, to: email, subject, text });
    if (!ok) {
      // The raw provider response can carry account/config details — log it
      // server-side only, never in the client response.
      console.error("[invite] email provider error:", data);
      return res.status(502).json({
        sent: false,
        simulated: false,
        error: "email_send_failed",
        inviteId,
        dossierId: canonicalDossierId,
        link,
        subject,
        body: text,
      });
    }
    return res.status(200).json({
      sent: true,
      simulated: false,
      providerId: data && data.id,
      inviteId,
      dossierId: canonicalDossierId,
      link,
      subject,
      body: text,
    });
  } catch (err) {
    console.error("[invite] email send failed:", err.message);
    return res.status(502).json({
      sent: false,
      simulated: false,
      error: "email_send_failed",
      inviteId,
      dossierId: canonicalDossierId,
      link,
      subject,
      body: text,
    });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
