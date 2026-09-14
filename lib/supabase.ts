import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

// Server-side client. With SUPABASE_SERVICE_ROLE_KEY (the secret key) it can read and write.
// With only the public key it can read, and writes fail on RLS so lib/data.ts falls back to memory.
// Returns null if Supabase isn't configured at all.
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}
