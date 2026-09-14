# RescuerMap

Wildfire evacuation-zone dashboard for California (demo region: Santa Cruz Mountains).
Next.js 16 app with a Leaflet/CARTO map, NASA FIRMS hotspots, Open-Meteo wind, OSRM routing,
Groq-written multilingual alerts, and Supabase storage.

## Setup

1. `npm install`
2. `.env.local`:
   ```
   FIRMS_MAP_KEY=
   GROQ_API_KEY=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   # optional: SUPABASE_SERVICE_ROLE_KEY=, GROQ_MODEL=
   ```
3. Supabase: open the project dashboard → SQL Editor → paste `supabase/schema.sql` → Run.
   Until that is done the app runs on `lib/seed.ts` and keeps edits in memory
   (the header badge shows "Seed data" instead of "Supabase").
4. `npm run dev` → http://localhost:3000

## API

All external calls go through these server routes.

| Route | Purpose |
| --- | --- |
| `GET /api/zones` | Zones scored by threat (fires + wind), sorted highest first |
| `PATCH /api/zones/:id` | `{ status }` — change a zone's evacuation status |
| `GET /api/fires?bbox=` | FIRMS VIIRS hotspots (last 2 days) |
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
