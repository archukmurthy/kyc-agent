// Sends a customer onboarding invitation email and persists the invite token.
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
// THE LINK: this endpoint only ever emails a dossier-backed link
// (?dossierId=<id>&journey=customer), which the customer's mount resolves via
// api/get-dossier — that works cross-device. The legacy ?ref=<token> link only
// ever hydrated from the analyst's own browser localStorage, so it's no longer
// generated here. A dossierId is therefore REQUIRED (see the 400 below); the
// client (InviteScreen.jsx) gates the Send action on having one.
//
// Env vars:
//   RESEND_API_KEY    — Resend API key. Without it, email is simulated.
//   INVITE_FROM_EMAIL — From header, e.g. "Nium Onboarding <onboarding@nium.com>".
//                       Defaults to Resend's shared test sender.

const crypto = require("crypto");
const store = require("../lib/storage.js");

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

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
let _deps = { store, sendEmail };

// Resolve the server's own origin from request headers — NOT from the request
// body. body.origin is attacker-controlled (any value the caller's JS sets);
// the Host header (and x-forwarded-*, which Vercel's edge sets from the real
// incoming request) is what the server was actually reached on, so it's the
// only trustworthy anchor for the same-origin check below.
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

// Does `link` point at our own origin and carry this EXACT dossierId + tenant
// (not just a substring match — a prefix-colliding id like
// "dossierId=dossier-1337" would pass an `includes()` check against
// "dossier-1"). Used to decide whether the client-built link is safe to embed
// in the outbound email, or whether to fall back to the server-reconstructed
// link instead. A malformed `link` (not a parseable URL) is treated as
// invalid, same as any other mismatch.
function isValidDossierLink(link, baseOrigin, dossierId, tenantId) {
  if (typeof link !== "string" || !link) return false;
  let url;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return (
    url.origin === baseOrigin &&
    url.searchParams.get("dossierId") === String(dossierId) &&
    url.searchParams.get("tenant") === String(tenantId)
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, contactName, companyName, origin, dossierId, tenantId, link: clientLink } =
    req.body || {};

  if (!email || !contactName) {
    return res.status(400).json({ error: "Missing email or contactName" });
  }
  // No saved dossier → no working link to email. The client gates Send on
  // this too, but the server never trusts the client alone.
  if (!dossierId || !tenantId) {
    return res
      .status(400)
      .json({ error: "Missing dossierId or tenantId — save the dossier before inviting" });
  }

  // Unique, unguessable invite record key. Persisted so a future onboarding
  // route can resolve the invite back to this company/contact/dossier.
  const token = crypto.randomBytes(18).toString("base64url");
  const baseOrigin = resolveOrigin(req, origin);
  const serverLink = `${baseOrigin}/?tenant=${encodeURIComponent(tenantId)}&dossierId=${encodeURIComponent(dossierId)}&journey=customer`;

  // Prefer the client-built link — it's what's already shown on screen, so
  // keeping it avoids drift — but never trust it blindly. It must resolve to
  // our own origin and carry this dossierId, or we fall back to the
  // server-reconstructed link instead of embedding an attacker-controlled URL.
  let link = serverLink;
  if (clientLink !== undefined && clientLink !== serverLink) {
    if (isValidDossierLink(clientLink, baseOrigin, dossierId, tenantId)) {
      link = clientLink;
    } else {
      console.warn(
        "[invite] rejected client-supplied link (origin/dossierId mismatch); using server-reconstructed link"
      );
    }
  }

  const inviteRecord = {
    token,
    email,
    contactName,
    companyName: companyName || null,
    dossierId,
    tenantId,
    link,
    createdAt: new Date().toISOString(),
    status: "invited",
  };

  // Persist the invite. A storage failure must not block the email or the
  // analyst flow — log and continue (mirrors save-dossier's "always succeed").
  try {
    await _deps.store.set(`invite:${token}`, inviteRecord, { ttlSeconds: TOKEN_TTL_SECONDS });
  } catch (e) {
    console.warn("invite persist failed:", e && e.message);
  }

  const subject = `Your Nium onboarding is ready${companyName ? ` — ${companyName}` : ""}`;
  const text = `Dear ${contactName},

Thank you for your interest in Nium. We have begun reviewing your application${companyName ? ` for ${companyName}` : ""} and are ready to proceed with the next step.

Please complete your onboarding by clicking the link below:

${link}

This link is unique to your application. Once you click it, you will be guided through a short onboarding form. The process typically takes 10–15 minutes.

If you have any questions, please do not hesitate to reach out to your Nium contact.

Best regards,
Nium Onboarding Team`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL || "Nium Onboarding <onboarding@resend.dev>";

  // No provider configured → simulate. The demo still shows the success screen
  // and a real, persisted link, but no mail actually leaves the building.
  if (!apiKey) {
    return res.status(200).json({
      sent: false,
      simulated: true,
      reason: "RESEND_API_KEY not configured",
      token,
      dossierId,
      link,
    });
  }

  try {
    const { ok, data } = await _deps.sendEmail({ apiKey, from, to: email, subject, text });
    if (!ok) {
      return res.status(502).json({
        sent: false,
        simulated: false,
        error: "Email provider error",
        details: data,
        token,
        dossierId,
        link,
      });
    }
    return res.status(200).json({
      sent: true,
      simulated: false,
      providerId: data && data.id,
      token,
      dossierId,
      link,
    });
  } catch (err) {
    return res.status(502).json({
      sent: false,
      simulated: false,
      error: "Email send failed",
      message: err.message,
      token,
      dossierId,
      link,
    });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
