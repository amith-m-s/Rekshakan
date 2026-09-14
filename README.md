# RescuerMap

Wildfire evacuation dashboard for California.
Next.js 16 app with a Leaflet/CARTO map, live Cal OES evacuation zones, statewide NASA FIRMS
hotspots, per-zone Open-Meteo wind, OSRM routing, Groq-written multilingual alerts, and Supabase storage.

## Data

- **Live zones** come from the [Cal OES evacuation aggregation layer](https://data.ca.gov/dataset/california-evacuation-aggregation-layer)
  (public, no key). It only contains zones under an active order or warning, has no population, and is
  read-only here: status is set by the counties.
- **Demo zones** (Santa Cruz Mountains) live in the Supabase `zones` table, or `lib/seed.ts` until the
  schema is run. Their status can be edited from the dashboard.
- **Threat score** = 0.6 × proximity to the nearest hotspot (within 20 km) + 0.3 × wind alignment × proximity
  + 0.1 × population share (demo zones only).

## Setup

Full step-by-step guide (keys, Supabase schema, Vercel deploy, checks): **[docs/SETUP.md](docs/SETUP.md)**.

Quick version:

1. `npm install`
2. Fill `.env.local`: `FIRMS_MAP_KEY`, `GROQ_API_KEY`, `NEXT_PUBLIC_CARTO_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `DASHBOARD_PASSWORD`.
3. Run `supabase/schema.sql` in the Supabase SQL Editor. Until then the app uses `lib/seed.ts` and keeps
   edits in memory (header badge "Seed data").
4. `npm run build && npx next start` → http://localhost:3000

## API

All external calls go through these server routes.

| Route | Purpose |
| --- | --- |
| `GET /api/zones` | Live + demo zones scored by threat (fires + per-zone wind), sorted highest first |
| `PATCH /api/zones/:id` | `{ status }` — change a demo zone's status (409 for live zones) |
| `GET /api/fires?bbox=` | FIRMS VIIRS hotspots (last 2 days, defaults to all of California) |
| `GET /api/weather?lat=&lng=` | Open-Meteo current wind |
| `GET /api/geocode?q=` | Nominatim lookup → `{ lat, lon }` |
| `GET /api/route?from=lng,lat&to=lng,lat` | OSRM driving route → GeoJSON LineString |
| `POST /api/alert` | `{ zone, status, langs }` → alert text keyed by language; logged when `zone.id` is set |
| `GET /api/alert` | Recently issued alerts |
| `GET /api/reports` | Field reports |
| `POST /api/reports` | `{ kind, message, lat, lng, reporter? }` — for the mobile app; lat/lng must be in California. `kind`: fire, smoke, blocked_road, needs_help, other |

## Layout

- `app/api/*` — route handlers
- `components/Dashboard.tsx`, `components/ZoneMap.tsx` — UI (map is client-only)
- `lib/data.ts` — Supabase queries with seed/in-memory fallback
- `lib/sources.ts` — FIRMS / Open-Meteo fetchers
- `lib/threat.ts` — threat scoring
- `supabase/schema.sql` — tables, RLS policies, demo zones
