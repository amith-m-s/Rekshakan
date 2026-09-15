# RescuerMap

Wildfire evacuation dashboard for California.
Next.js 16 app with a Leaflet/CARTO map, live Cal OES evacuation zones, statewide NASA FIRMS
hotspots, per-zone Open-Meteo wind, OSRM routing, Groq-written multilingual alerts, and Supabase storage.

The repository now ships as one connected product with two free web processes: the repository-root Next.js
statewide intelligence dashboard and the Express rescue-operations service in [`backend/`](./backend). Each UI
links to the other, and the dashboard reports live health from the rescue API. Both are described by the
repository-root [`render.yaml`](./render.yaml).

## RescuerMap backend (`backend/`)

The production-style hackathon backend and its local testing console live in
[`backend/`](./backend). It provides authentication and RBAC, incidents,
locations, alerts, help requests, responder matching, validated rescue
assignments, shelters, escalation recommendations, audit timelines, analytics,
Socket.IO events, mock external-data providers, and a wildfire simulator.

```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed
npm start
```

Open the local test console at [http://localhost:4000](http://localhost:4000)
or the API documentation at [http://localhost:4000/docs](http://localhost:4000/docs).
See [`backend/README.md`](./backend/README.md) for demo credentials and complete
usage instructions.

## Data

- **Live zones** come from the [Cal OES evacuation aggregation layer](https://data.ca.gov/dataset/california-evacuation-aggregation-layer)
  (public, no key). It only contains zones under an active order or warning, has no population, and is
  read-only here: status is set by the counties.
- **Demo zones** (Santa Cruz Mountains) live in the Supabase `zones` table, or `lib/seed.ts` until the
  schema is run. Their status can be edited from the dashboard.
- **Threat score** = 0.6 × proximity to the nearest hotspot (within 20 km) + 0.3 × wind alignment × proximity
  + 0.1 × population share (demo zones only).

## Setup

**Run the entire system (local and deployed, demo day, troubleshooting): [docs/RUNBOOK.md](docs/RUNBOOK.md).**

Full step-by-step guide (keys, Supabase schema, deployment, checks): **[docs/SETUP.md](docs/SETUP.md)**.
Phone app that sends spoofed-location field reports, and the dashboard's reaction to them:
**[docs/MOBILE.md](docs/MOBILE.md)**.
Hosting the connected dashboard and Express backend on Render: **[docs/RENDER.md](docs/RENDER.md)**.
Simulating phones from the laptop instead of a real app (`npm run simulate`): **[docs/SIMULATOR.md](docs/SIMULATOR.md)**.

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
