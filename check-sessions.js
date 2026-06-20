require('dotenv').config({ path: '.env.local' })
const { neon } = require('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

async function check() {

  // 1. Total row count + min/max completed_at
  const stats = await sql`
    SELECT
      COUNT(*)::int                         AS total_rows,
      COUNT(completed_at)::int              AS rows_with_completed_at,
      MIN(completed_at)                     AS earliest_completed,
      MAX(completed_at)                     AS latest_completed
    FROM onboarding_sessions
  `
  console.log('=== onboarding_sessions overview ===')
  console.log(JSON.stringify(stats, null, 2))

  // 2. Most recent 10 sessions regardless of time window
  const recent = await sql`
    SELECT
      os.id,
      os.completed_at,
      os.source,
      os.status,
      os.schema_key,
      os.ownership_type,
      os.journey_type,
      os.total_tokens,
      os.cost_usd,
      os.fields_prefilled,
      os.fill_rate,
      c.legal_name,
      c.country_code,
      c.entity_type
    FROM onboarding_sessions os
    LEFT JOIN clients c
      ON os.client_id = c.id
    ORDER BY os.completed_at DESC NULLS LAST
    LIMIT 10
  `
  console.log('\n=== Most recent 10 sessions (any time) ===')
  console.log(JSON.stringify(recent, null, 2))
  console.log(`\nReturned: ${recent.length}`)
}

check().catch(console.error)
