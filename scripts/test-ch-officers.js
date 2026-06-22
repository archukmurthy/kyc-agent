// Manual smoke test for the Companies House Officers Layer 1 source.
// Run: node scripts/test-ch-officers.js
require("dotenv").config({ path: ".env.local" });

const { getActiveOfficers } = require("../agents/registries/companiesHouseOfficers");

async function test() {
  console.log("Testing Companies House Officers API...");
  console.log("Key present:", !!process.env.COMPANIES_HOUSE_API_KEY);

  // Test with Tesco PLC (the "1 director" bug company).
  console.log("\nFetching officers for Tesco PLC...");
  const officers = await getActiveOfficers({ companyName: "TESCO PLC" });

  if (!officers) {
    console.error("FAILED — returned null (API key invalid or network error)");
    process.exitCode = 1;
    return;
  }

  console.log("SUCCESS — " + officers.length + " active officers found:");
  officers.forEach((o) => {
    console.log(
      "  - " +
        o.full_name +
        " (" + o.role + ")" +
        (o.nationality ? " · " + o.nationality : "") +
        (o.date_of_birth ? " · born " + o.date_of_birth : "")
    );
  });
}

test().catch(console.error);
