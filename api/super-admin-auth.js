// Super admin password gate. Single shared password (SUPER_ADMIN_PASSWORD)
// for the /super-admin route. Separate from per-tenant ADMIN_PASSWORD so a
// leaked client password can never escalate to platform-wide tenant
// management.

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
    const expected = process.env.SUPER_ADMIN_PASSWORD;
    if (!expected) {
      return res.status(500).json({
        success: false,
        error: "SUPER_ADMIN_PASSWORD not configured on server",
      });
    }
    const body = await readBody(req);
    const provided = body && typeof body.password === "string" ? body.password : "";
    if (provided === expected) {
      return res.status(200).json({ success: true, token: expected });
    }
    return res.status(401).json({ success: false, error: "Incorrect password" });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error", message: err.message });
  }
};
