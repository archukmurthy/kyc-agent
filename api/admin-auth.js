// Admin password gate. Returns the password back as the "token" on success;
// the admin UI sends it as Authorization: Bearer <token> on subsequent
// /api/config POSTs. This is intentionally minimal — single shared password,
// no sessions — and is sufficient for the internal admin UI.

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      return res.status(500).json({ success: false, error: "ADMIN_PASSWORD not configured on server" });
    }
    const body = await readBody(req);
    const provided = body && typeof body.password === "string" ? body.password : "";
    if (provided === expected) {
      return res.status(200).json({ success: true, token: expected });
    }
    return res.status(401).json({ success: false });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error", message: err.message });
  }
};
