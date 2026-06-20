require('dotenv').config({ path: '.env.local' })
const { neon } = require('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

async function check() {
  // Pull captured IP (+ timezone) from the declaration block of every session
  const rows = await sql`
    SELECT
      os.id,
      os.completed_at,
      os.source,
      c.legal_name,
      c.country_code,
      os.raw_result -> 'declaration' ->> 'ipAddress' AS ip_address,
      os.raw_result -> 'declaration' ->> 'timezone'  AS timezone
    FROM onboarding_sessions os
    LEFT JOIN clients c ON os.client_id = c.id
    WHERE os.raw_result -> 'declaration' ->> 'ipAddress' IS NOT NULL
    ORDER BY os.completed_at DESC
  `
  console.log('=== Captured declaration IPs ===')
  console.log(JSON.stringify(rows, null, 2))
  console.log(`\nSessions with an IP: ${rows.length}`)

  // Geolocate the distinct, valid IPs via ip-api.com (free, no key)
  const distinct = [...new Set(
    rows.map(r => r.ip_address).filter(ip => ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip))
  )]
  console.log(`\n=== Geolocating ${distinct.length} distinct IP(s) ===`)
  const geo = {}
  for (const ip of distinct) {
    try {
      const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,query`)
      const d = await r.json()
      geo[ip] = d
      console.log(`${ip} -> ${d.countryCode} (${d.country}), ${d.city || ''} ${d.regionName || ''} | ISP: ${d.isp || ''}`)
    } catch (e) {
      geo[ip] = { error: e.message }
      console.log(`${ip} -> lookup failed: ${e.message}`)
    }
  }

  // Flag anything not GB
  const nonUK = rows.filter(r => {
    const g = geo[r.ip_address]
    return g && g.countryCode && g.countryCode !== 'GB'
  })
  console.log('\n=== Sessions whose IP is OUTSIDE the UK ===')
  if (nonUK.length === 0) {
    console.log('None — every geolocatable IP resolves to GB (or could not be geolocated).')
  } else {
    nonUK.forEach(r => {
      const g = geo[r.ip_address]
      console.log(`- ${r.completed_at} | ${r.legal_name} (${r.country_code}) | IP ${r.ip_address} -> ${g.countryCode} (${g.country}), ${g.city || ''} | declared TZ: ${r.timezone}`)
    })
  }
}

check().catch(console.error)
