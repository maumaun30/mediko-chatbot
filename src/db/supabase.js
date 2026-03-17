import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars')
}

// Warn loudly if someone accidentally pasted the anon key.
// The service_role JWT has { "role": "service_role" } in its payload.
// The anon key has { "role": "anon" }.
try {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString())
  if (payload.role !== 'service_role') {
    console.warn(
      '\n⚠️  SUPABASE_SERVICE_KEY appears to be the ANON key (role="' + payload.role + '").' +
      '\n   RLS will block INSERT/UPDATE. Use the service_role key from:' +
      '\n   Supabase Dashboard → Project Settings → API → service_role secret\n'
    )
  }
} catch {
  // JWT parse failed — not a blocker, just skip the check
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false }
})
