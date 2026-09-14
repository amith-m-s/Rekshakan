# RescuerMap backend

Single-process disaster assistance coordination backend for the hackathon MVP. It covers authenticated resident, responder, coordinator and admin workflows; deterministic severity, request priority, matching and escalation engines; human-authorized assignments/escalations; proximity alerts; shelters; community reports; abuse flags; audit timelines; analytics; real-time events; and a provider-backed wildfire simulator.

The backend returns operational coordinates to a role-based web console. Its command centre renders OpenStreetMap tiles, a request-risk heatmap, incident/alert radii, responders, shelters, help requests and reports with Leaflet. If remote map assets are unavailable, it automatically retains a local SVG operational map instead of displaying a blank panel.

## Render deployment

The repository-root `render.yaml` defines a free Node web service rooted at `backend/`, an HTTP health check and Node 24. Import the repository as a Render Blueprint and deploy `feature/rescuermap-backend-v2` (or merge it into `main` first). The startup command applies migrations automatically and seeds fictional demo records only when the database has no users.

The free Render filesystem is ephemeral, so simulated requests and workflow changes can reset after a restart or redeploy. Startup recreates the demo dataset automatically, which is suitable for evaluation but not durable real-world storage. For persistent or horizontally scalable production data, migrate the persistence layer to a hosted PostgreSQL service. After Render assigns the final hostname, update `CORS_ORIGINS` if the service name or custom domain differs from `https://rescuermap.onrender.com`.

## Quick start

Requires Node.js 24. The repository includes `.nvmrc` pinned to the verified runtime.

```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed
npm start
```

If Node reports that `better_sqlite3.node` was compiled for a different
`NODE_MODULE_VERSION`, two different Node installations have used the same
`node_modules` directory. Select Node 24 (`nvm use`, if applicable), then run:

```bash
npm run rebuild:sqlite
```

The native module will be rebuilt for the active Node executable.

`npm start` runs the compiled application produced by `npm run migrate`/`npm run seed`. During development, use `npm run dev`. Run `npm test` for the engine and complete workflow test suite. The SQLite database defaults to `backend/data/rescuermap.db`.

- API base: `http://localhost:4000/api`
- Local test UI: `http://localhost:4000`
- Health: `GET http://localhost:4000/api/health`
- Interactive OpenAPI: `http://localhost:4000/docs`

Set a strong `JWT_SECRET` outside development. `CORS_ORIGINS` is a comma-separated allowlist. See [.env.example](./.env.example) for all settings.

## Demo accounts

All seeded accounts use password `Demo123!`.

| Role | Email |
|---|---|
| Admin | `admin@rescuermap.local` |
| Coordinator | `coordinator@rescuermap.local` |
| Resident | `resident@rescuermap.local` |
| Responder | `responder@rescuermap.local` |

These are fictional local demo identities. Responder verification is mocked; the system stores no government ID or SSN.

The local test UI supports demo-role login, incident monitoring, simulator controls,
help-request creation, matching, assignments, workflow transitions, safe check-in,
audit history, and Socket.IO live refresh. It is an offline-friendly engineering
console for exercising the backend, not the final production mobile experience.

## Architecture

- `src/routes`: REST transport, validation and RBAC
- `src/services`: severity, priority, matching, assignments, alerts, escalation, audit and simulator logic
- `src/integrations/providers`: provider contracts, resilient cache wrapper, mock adapters, and optional FIRMS/Open-Meteo/OSRM/Nominatim/Groq adapters
- `src/db`: SQLite schema, indexes and connection
- `src/middleware`: JWT authorization, role checks, rate limiting integration and sanitized errors
- `src/sockets`: represented by the Socket.IO bootstrap and runtime emitter
- `src/seed`: repeatable fictional demo dataset

All important workflow changes append an `audit_logs` row. There is intentionally no API to edit/delete audit rows. Ordered migrations are recorded in `schema_migrations`, and SQLite WAL mode keeps the single-node MVP responsive. Help creation never waits for an external provider.

Exact user location is private: users may read their own location, coordinators/admins may access operational location history, and responders only see the precise help request assigned to them. Location sharing and freshness state are stored explicitly.

## Key API groups

Routes are under `/api`: `auth`, `users`, `incidents`, `locations`, `alerts`, `help-requests`, `safe-checkins`, `responders`, `matches`, `assignments`, `shelters`, `reports`, `escalations`, `fraud`, `audit`, `analytics`, `admin/dashboard`, `providers/status`, `simulator`, and `health`.

API responses consistently use `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`. Send JWTs as `Authorization: Bearer <token>`. `clientRequestId` makes resident help submissions idempotent across retries.

Assignment transitions are validated. The normal path is `ASSIGNED → ACCEPTED → EN_ROUTE → ARRIVED → ASSISTING → EVACUATED → SHELTER_CHECKIN → SAFE → CLOSED`; rejection, failure, cancellation and coordinator reassignment are also supported.

Escalations remain `PENDING_AUTHORIZATION` until a coordinator/admin explicitly approves them. Nothing in this backend autonomously dispatches police, fire, EMS, military or a government agency.

## Simulator

Login as coordinator/admin, then:

```bash
curl -X POST http://localhost:4000/api/simulator/start \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"latitude":12.9716,"longitude":77.5946,"severity":60,"responders":4,"reports":3}'

curl -X POST http://localhost:4000/api/simulator/control \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"GENERATE_HELP_REQUESTS","count":4}'

curl -X POST http://localhost:4000/api/simulator/control \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"TRIGGER_CRITICAL_STATE"}'
```

Supported actions: `PAUSE`, `RESUME`, `RESET`, `INCREASE_SPREAD`, `INCREASE_SEVERITY`, `GENERATE_REPORTS`, `GENERATE_HELP_REQUESTS`, `GENERATE_RESPONDERS`, and `TRIGGER_CRITICAL_STATE`. Simulator records use the same incident, help, severity, alert, matching and audit paths as operational records and remain marked `SIMULATED`.

## Real-time client

Connect Socket.IO to port 4000 with `{ auth: { token } }`. Coordinators/admins may emit `join:incident` with an incident ID. Server events:

- `help_request.created`, `assignment.created`, `assignment.status_changed`
- `responder.status_changed`, `responder.location_updated`
- `incident.severity_changed`, `notification.created`
- `person.safe`, `shelter.status_changed`, `escalation.created`
- `simulator.started`, `simulator.updated`

Clients should refetch current REST state after reconnect; socket events are a live-update channel, not the source of truth. Operational events are sent only to coordinator/admin role rooms and directly involved user rooms. Precise request and responder locations are never broadcast to every authenticated socket.

## Data integrations

Mock providers remain the default. Set `PROVIDER_MODE=real` to enable the implemented NASA FIRMS, Open-Meteo, OSRM, Nominatim and Groq adapters in `src/integrations/providers/real.ts`. Configure `NASA_API_KEY`, a policy-compliant `NOMINATIM_USER_AGENT`, and `GROQ_API_KEY` as needed.

Every provider response includes its source, observation time, expiry and `stale` flag. Provider calls use a timeout and an in-process last-known-good cache; failures return cached data marked stale when available and otherwise produce a sanitized `503` without interrupting core rescue operations. AI output is always marked as a draft requiring coordinator approval. The simulator uses its own always-available provider even when real integrations fail.
