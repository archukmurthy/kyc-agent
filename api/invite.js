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
// Env vars:
//   RESEND_API_KEY    — Resend API key. Without it, email is simulated.
//   INVITE_FROM_EMAIL — From header, e.g. "Demo Onboarding <onboarding@demo.com>".
//                       Defaults to Resend's shared test sender.

const crypto = require("crypto");
const store = require("../lib/storage.js");

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, contactName, companyName, origin } = req.body || {};

  if (!email || !contactName) {
    return res.status(400).json({ error: "Missing email or contactName" });
  }

  // Unique, unguessable invite token. Persisted so a future onboarding route
  // (PR-029) can resolve ?ref=<token> back to this company/contact.
  const token = crypto.randomBytes(18).toString("base64url");
  const baseOrigin =
    (origin || "").replace(/\/+$/, "") || "https://kyc-agent-deploy.vercel.app";
  const link = `${baseOrigin}/?ref=${token}`;

  const inviteRecord = {
    token,
    email,
    contactName,
    companyName: companyName || null,
    link,
    createdAt: new Date().toISOString(),
    status: "invited",
  };

  // Persist the invite. A storage failure must not block the email or the
  // analyst flow — log and continue (mirrors save-dossier's "always succeed").
  try {
    await store.set(`invite:${token}`, inviteRecord, { ttlSeconds: TOKEN_TTL_SECONDS });
  } catch (e) {
    console.warn("invite persist failed:", e && e.message);
  }

  const subject = `Your Demo onboarding is ready${companyName ? ` — ${companyName}` : ""}`;
  const text = `Dear ${contactName},

Thank you for your interest in Demo. We have begun reviewing your application${companyName ? ` for ${companyName}` : ""} and are ready to proceed with the next step.

Please complete your onboarding by clicking the link below:

${link}

This link is unique to your application. Once you click it, you will be guided through a short onboarding form. The process typically takes 10–15 minutes.

If you have any questions, please do not hesitate to reach out to your Demo contact.

Best regards,
Demo Onboarding Team`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL || "Demo Onboarding <onboarding@resend.dev>";

  // No provider configured → simulate. The demo still shows the success screen
  // and a real, persisted link, but no mail actually leaves the building.
  if (!apiKey) {
    return res.status(200).json({
      sent: false,
      simulated: true,
      reason: "RESEND_API_KEY not configured",
      token,
      link,
    });
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: [email], subject, text }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({
        sent: false,
        simulated: false,
        error: "Email provider error",
        details: data,
        token,
        link,
      });
    }
    return res.status(200).json({
      sent: true,
      simulated: false,
      providerId: data && data.id,
      token,
      link,
    });
  } catch (err) {
    return res.status(502).json({
      sent: false,
      simulated: false,
      error: "Email send failed",
      message: err.message,
      token,
      link,
    });
  }
};
