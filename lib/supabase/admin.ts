import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS.
// ONLY use in server-side API routes that have no user session (e.g. the WhatsApp webhook).
// Never expose to the browser.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
