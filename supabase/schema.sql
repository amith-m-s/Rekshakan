-- RescuerMap schema. Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. See docs/SETUP.md.
--
-- Access model:
--   * The server (Next.js API routes) writes with the SECRET / service_role key, which bypasses RLS.
--   * The public (publishable / anon) key, which ships to browsers and the mobile app, can only READ
--     zones, alerts and reports. It is used for realtime updates on the dashboard.

-- Demo zones the dashboard can edit. Live statewide zones come from Cal OES and are not stored here.
create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  population integer,
  status text not null default 'normal',
  geom jsonb not null, -- GeoJSON Polygon or MultiPolygon
  updated_at timestamptz not null default now()
);

alter table public.zones drop constraint if exists zones_status_check;
alter table public.zones add constraint zones_status_check
  check (status in ('normal', 'advisory', 'warning', 'order', 'shelter', 'repopulation'));

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  zone_id text not null, -- a zones.id uuid, or "caloes-<ZONE_ID>" for live statewide zones
  zone_code text not null,
  status text not null,
  messages jsonb not null, -- { "en": "...", "es": "..." }
  created_at timestamptz not null default now()
);

-- Field reports, posted by the mobile app through POST /api/reports.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('fire', 'smoke', 'blocked_road', 'needs_help', 'other')),
  message text not null default '',
  lat double precision not null,
  lng double precision not null,
  reporter text,
  created_at timestamptz not null default now()
);

-- Rate-limit ledger for POST /api/reports. Holds a salted hash of the client IP, never the IP.
-- Kept out of `reports` so the hash is never exposed to the public key or realtime.
create table if not exists public.report_rate (
  id bigint generated always as identity primary key,
  client_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists alerts_created_at_idx on public.alerts (created_at desc);
create index if not exists report_rate_client_idx on public.report_rate (client_hash, created_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists zones_touch on public.zones;
create trigger zones_touch before update on public.zones
  for each row execute function public.touch_updated_at();

-- Row Level Security: read-only for the public key. No policies on report_rate = no public access.
alter table public.zones enable row level security;
alter table public.alerts enable row level security;
alter table public.reports enable row level security;
alter table public.report_rate enable row level security;

-- Remove the open write policies from earlier versions of this file.
drop policy if exists "zones update" on public.zones;
drop policy if exists "alerts insert" on public.alerts;
drop policy if exists "reports insert" on public.reports;

drop policy if exists "zones read" on public.zones;
drop policy if exists "alerts read" on public.alerts;
drop policy if exists "reports read" on public.reports;
create policy "zones read" on public.zones for select using (true);
create policy "alerts read" on public.alerts for select using (true);
create policy "reports read" on public.reports for select using (true);

-- Realtime: broadcast row changes on these tables to subscribed dashboards.
do $$
declare t text;
begin
  foreach t in array array['zones', 'alerts', 'reports'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Demo zones around the Santa Cruz Mountains (same as lib/seed.ts).
insert into public.zones (code, name, population, status, geom) values
  ('SCZ-E014', 'Boulder Creek', 3200, 'warning',
   '{"type":"Polygon","coordinates":[[[-122.135,37.115],[-122.105,37.115],[-122.105,37.138],[-122.135,37.138],[-122.135,37.115]]]}'),
  ('SCZ-E021', 'Felton', 2100, 'advisory',
   '{"type":"Polygon","coordinates":[[[-122.085,37.04],[-122.06,37.04],[-122.06,37.062],[-122.085,37.062],[-122.085,37.04]]]}'),
  ('SCZ-E030', 'Scotts Valley', 4700, 'normal',
   '{"type":"Polygon","coordinates":[[[-122.03,37.035],[-122.0,37.035],[-122.0,37.065],[-122.03,37.065],[-122.03,37.035]]]}'),
  ('SCZ-E042', 'Ben Lomond', 1600, 'normal',
   '{"type":"Polygon","coordinates":[[[-122.105,37.075],[-122.075,37.075],[-122.075,37.1],[-122.105,37.1],[-122.105,37.075]]]}'),
  ('SCZ-E055', 'Zayante', 900, 'advisory',
   '{"type":"Polygon","coordinates":[[[-122.06,37.08],[-122.035,37.08],[-122.035,37.105],[-122.06,37.105],[-122.06,37.08]]]}')
on conflict (code) do nothing;
