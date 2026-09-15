import { getSupabase, supabaseEnv } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Deployment diagnostics. Reports which variables are set (never their values), which Supabase project
// is connected, and whether each table is reachable. Behind DASHBOARD_PASSWORD (see proxy.ts).

const VARS = [
  'FIRMS_MAP_KEY',
  'GROQ_API_KEY',
  'NEXT_PUBLIC_CARTO_KEY',
  'DASHBOARD_PASSWORD',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
];

export async function GET() {
  const env = Object.fromEntries(VARS.map(name => [name, Boolean(process.env[name])]));
  const { url, publicKey, secretKey } = supabaseEnv();

  // In the browser bundle only NEXT_PUBLIC_* values exist, and only if set when the app was built.
  const browserRealtimeConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );

  const tables: Record<string, string> = {};
  const sb = getSupabase();
  if (sb) {
    await Promise.all(
      ['zones', 'alerts', 'reports', 'report_rate'].map(async table => {
        const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
        tables[table] = error ? `error: ${error.message || error.code || 'unknown'}` : `ok (${count ?? 0} rows)`;
      })
    );
  }

  return Response.json({
    env,
    supabase: {
      projectHost: url ? new URL(url).host : null,
      serverKey: secretKey ? 'secret' : publicKey ? 'public (writes will fail)' : 'none',
      browserRealtimeConfigured,
      tables,
    },
    hints: [
      !url && 'No Supabase URL: set NEXT_PUBLIC_SUPABASE_URL.',
      !secretKey && 'No secret key: set SUPABASE_SERVICE_ROLE_KEY so saves persist.',
      !browserRealtimeConfigured &&
        'Realtime needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY set, then a redeploy (they are baked in at build time).',
      Object.values(tables).some(t => t.includes('schema cache') || t.includes('does not exist')) &&
        `Tables missing in ${url ? new URL(url).host : 'the project'}: run supabase/schema.sql in that project's SQL Editor.`,
    ].filter(Boolean),
  });
}
