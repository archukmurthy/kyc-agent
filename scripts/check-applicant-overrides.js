require('dotenv').config({
  path: '.env.local'
})
const { neon } = require(
  '@neondatabase/serverless'
)

async function check() {
  const sql = neon(process.env.DATABASE_URL)

  // All applicant overrides in last 7 days
  const overrides = await sql`
    SELECT
      st.occurred_at,
      st.session_id,
      st.event_data->>'fieldLabel'
        AS field,
      st.event_data->>'agentValue'
        AS agent_said,
      st.event_data->>'customerValue'
        AS customer_said,
      st.event_data->>'source'
        AS source,
      c.legal_name AS company
    FROM session_timeline st
    LEFT JOIN onboarding_sessions os
      ON os.id::text = st.session_id::text
    LEFT JOIN clients c
      ON c.id = os.client_id
    WHERE st.event_type =
      'applicant_field_overridden'
    AND st.occurred_at >
      NOW() - INTERVAL '7 days'
    ORDER BY st.occurred_at DESC
    LIMIT 50
  `

  if (!overrides.length) {
    console.log('No applicant overrides in last 7 days.')
    return
  }

  console.log(
    '=== Applicant field overrides ' +
    '(last 7 days) ===\n'
  )
  overrides.forEach(r => {
    console.log(
      `[${new Date(r.occurred_at)
        .toLocaleString()}] ` +
      `${r.company || 'Unknown company'}`
    )
    console.log(
      `  ${r.field}: ` +
      `"${r.agent_said}" → ` +
      `"${r.customer_said}" ` +
      `(source: ${r.source || '—'})`
    )
    console.log()
  })

  console.log(`Total: ${overrides.length}`)
}

check().catch(console.error)
