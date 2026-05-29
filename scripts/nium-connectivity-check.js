/* Throwaway connectivity probe for a Nium API URL.
 * Loads .env.local manually (no dotenv dependency) and sends a GET to the URL
 * under test with the configured x-api-key header so we exercise reachability +
 * TLS + auth. The client-hash in the URL is a placeholder, so no real
 * (chargeable) lookup is performed. */
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const API_KEY = process.env.NIUM_API_KEY;
const url =
  "https://caas.preprod.nium.com/onboarding/api/v5/client/abc/corporate/publicDetails?type=PUBLIC_COMPANY&businessRegistrationNumber=GB123454643&registeredCountry=SG&region=GB";

console.log("Endpoint :", url);
console.log("API key  :", API_KEY ? `present (…${API_KEY.slice(-4)})` : "MISSING");

(async () => {
  const started = Date.now();
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-key": API_KEY,
      },
    });
    const ms = Date.now() - started;
    const text = await r.text();
    console.log(`\nHTTP ${r.status} ${r.statusText}  (${ms} ms)`);
    console.log("Body     :", text.slice(0, 1200));
  } catch (err) {
    const ms = Date.now() - started;
    console.log(`\nNETWORK ERROR after ${ms} ms`);
    console.log("Name     :", err.name);
    console.log("Message  :", err.message);
    if (err.cause) console.log("Cause    :", err.cause.code || err.cause.message || err.cause);
  }
})();
