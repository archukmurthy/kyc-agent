require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function checkEvents() {
  const sql = neon(process.env.DATABASE_URL);

  // Events in last 24 hours
  const events = await sql`
    SELECT
      event_type,
      event_data,
      tenant_id,
      occurred_at
    FROM session_timeline
    WHERE occurred_at > NOW() - INTERVAL '24 hours'
    ORDER BY occurred_at DESC
    LIMIT 50
  `;

  console.log("=== Events (last 24 hours) ===\n");

  if (events.length === 0) {
    console.log("No events found.");
    return;
  }

  events.forEach((e) => {
    console.log(
      `[${new Date(e.occurred_at).toLocaleTimeString()}] ` +
        `${e.event_type.padEnd(35)} ` +
        `tenant: ${e.tenant_id || "—"}`
    );
    if (e.event_data && Object.keys(e.event_data).length) {
      const data = { ...e.event_data };
      const inline = [
        data.companyName,
        data.agentType,
        data.fieldsFound !== undefined ? `${data.fieldsFound} fields` : null,
        data.fillRate !== undefined
          ? `${Math.round((data.fillRate || 0) * 100)}% fill rate`
          : null,
        data.totalCostUsd !== undefined
          ? `$${(data.totalCostUsd || 0).toFixed(5)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

      if (inline) {
        console.log(`  → ${inline}`);
      }
    }
  });

  console.log(`\nTotal: ${events.length} events`);

  // Summary by event type
  const summary = events.reduce((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {});

  console.log("\n=== Summary ===");
  Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type.padEnd(35)} ${count}x`);
    });
}

checkEvents().catch(console.error);
