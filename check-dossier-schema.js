require('dotenv').config({ path: '.env.local' })
const { neon } = require('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

async function check() {
  const cols = await sql`
    SELECT column_name, data_type,
           is_nullable
    FROM information_schema.columns
    WHERE table_name = 'entity_dossiers'
    ORDER BY ordinal_position
  `
  console.log('entity_dossiers columns:')
  console.log(JSON.stringify(cols, null, 2))

  // Also check if table exists at all
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `
  console.log('All tables:')
  tables.forEach(t =>
    console.log(' ', t.table_name)
  )
}

check().catch(console.error)
