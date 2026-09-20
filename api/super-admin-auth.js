// Super admin password gate. Single shared password (SUPER_ADMIN_PASSWORD)
// for the /super-admin route. Separate from per-tenant ADMIN_PASSWORD so a
// leaked client password can never escalate to platform-wide tenant
// management.

const { applyCors } = require("../lib/routeAuth");
const loginThrottle = require("../lib/loginThrottle");
const { clientIp } = require("../lib/rateLimit");

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
  if (applyCors(req, res)) return undefined;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // AUTH-1: one shared platform password is the single most valuable thing
    // to guess in this product, and nothing slowed guessing down.
    const who = { account: "super-admin", ip: clientIp(req) };
    const locked = await loginThrottle.check(who);
    if (locked.blocked) return loginThrottle.sendLocked(res, locked);

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
      await loginThrottle.recordSuccess(who);
    return res.status(200).json({ success: true, token: expected });
    }
    await loginThrottle.recordFailure(who);
    return res.status(401).json({ success: false, error: "Incorrect password" });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error", message: err.message });
  }
};
