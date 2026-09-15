import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The Vercel Supabase integration and newer Supabase projects use different variable names for the
// same values, so accept each alias. Read at call time so runtime env changes apply.
export function supabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    publicKey:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  };
}

let client: SupabaseClient | null | undefined;

// Server-side client. With the secret (service role) key it can read and write.
// With only the public key it can read, and writes fail on RLS so lib/data.ts falls back to memory.
// Returns null if Supabase isn't configured at all.
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const { url, publicKey, secretKey } = supabaseEnv();
  const key = secretKey || publicKey;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}
