-- RescuerMap schema. Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  population integer not null default 0,
  status text not null default 'normal'
    check (status in ('normal', 'advisory', 'warning', 'order', 'repopulation')),
  geom jsonb not null, -- GeoJSON Polygon
  updated_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones(id) on delete cascade,
  zone_code text not null,
  status text not null,
  messages jsonb not null, -- { "en": "...", "es": "..." }
  created_at timestamptz not null default now()
);

-- Field reports, posted by the mobile app.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('fire', 'smoke', 'blocked_road', 'needs_help', 'other')),
  message text not null default '',
  lat double precision not null,
  lng double precision not null,
  reporter text,
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists alerts_created_at_idx on public.alerts (created_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists zones_touch on public.zones;
create trigger zones_touch before update on public.zones
  for each row execute function public.touch_updated_at();

-- Row Level Security. The app talks to Supabase from server routes with the anon key, so
-- these policies are deliberately open for the hackathon demo. Tighten before real use
-- (e.g. add SUPABASE_SERVICE_ROLE_KEY to .env.local and drop the write policies).
alter table public.zones enable row level security;
alter table public.alerts enable row level security;
alter table public.reports enable row level security;

drop policy if exists "zones read" on public.zones;
drop policy if exists "zones update" on public.zones;
drop policy if exists "alerts read" on public.alerts;
drop policy if exists "alerts insert" on public.alerts;
drop policy if exists "reports read" on public.reports;
drop policy if exists "reports insert" on public.reports;

create policy "zones read" on public.zones for select using (true);
create policy "zones update" on public.zones for update using (true) with check (true);
create policy "alerts read" on public.alerts for select using (true);
create policy "alerts insert" on public.alerts for insert with check (true);
create policy "reports read" on public.reports for select using (true);
create policy "reports insert" on public.reports for insert with check (true);

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
