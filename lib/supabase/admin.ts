import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS.
// ONLY use in server-side API routes that have no user session (e.g. the WhatsApp webhook).
// Never expose to the browser.

// Importing this from a client component pulls it into the browser bundle,
// where SUPABASE_SERVICE_ROLE_KEY is undefined (no NEXT_PUBLIC_ prefix, so Next
// never inlines it — the key itself is NOT leaked). What you get instead is an
// opaque "Invalid supabaseKey" crash and a page that will not load, with
// nothing pointing at the real cause: some shared lib grew a server-only import
// and a client component was already importing it.
//
// This turns that into a sentence. If you hit it, split the module: pure logic
// and types in one file the browser may import, database calls in another.
if (typeof window !== 'undefined') {
  throw new Error(
    'lib/supabase/admin is SERVER-ONLY but was imported into client code. ' +
    'Something in this import chain reached a browser bundle — split the shared ' +
    'module so database access lives in a server-only file (see lib/audiences/' +
    'intervals.ts vs intervals-query.ts).'
  )
}
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
