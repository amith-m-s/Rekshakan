# RescuerMap runbook: running the entire system

One place for everything: what the pieces are, one-time setup, running it all on a laptop, the deployed system
on Render, demo day, shipping changes, and fixing problems. Detailed guides are linked where they go deeper.

All commands are **PowerShell**, run from the repository root unless a step says `cd backend`.

---

## 0. The system at a glance

```
                    ┌──────────────────────────────┐        ┌───────────────────────────────┐
  Browser  ────────▶│  Statewide dashboard         │ health │  Rescue operations API        │◀──── Browser
  (responders)      │  Next.js, repo root          │───────▶│  + role-based console         │     (coordinators,
                    │  :3000  /  dashboard-rset    │  link  │  Express, backend/            │      residents,
                    └──────┬──────────┬────────────┘        │  :4000  /  rescuermap-rset    │      responders)
                           │          │                     └──────────────┬────────────────┘
          reports, alerts, │          │ Cal OES zones, FIRMS fires,        │ SQLite
          demo zones,      │          │ Open-Meteo wind, OSRM routes,      │ (demo data, resets on
          realtime         ▼          ▼ Nominatim, Groq alerts, CARTO map  ▼  Render free tier)
                    ┌────────────┐  ┌──────────────────────┐
                    │  Supabase  │  │ External data APIs   │
                    └────────────┘  └──────────────────────┘
                           ▲
                           │ POST /api/reports (spoofed CA locations), GET /api/alert
                    ┌──────┴───────────────────────┐
                    │  Phone simulator (laptop)    │
                    │  simulator/  :4545           │
                    └──────────────────────────────┘
```

| Component | Code | Local URL | Deployed URL | Data |
| --- | --- | --- | --- | --- |
| **Statewide dashboard**: zones, fires, threat ranking, routes, alerts, field reports | repo root (Next.js 16) | <http://localhost:3000> | <https://rescuermap-dashboard-rset.onrender.com> | Supabase |
| **Rescue operations API + console**: logins, incidents, help requests, matching, assignments, simulator | `backend/` (Express 5, Node 24) | <http://localhost:4000> (console `/`, API docs `/docs`) | <https://rescuermap-rset.onrender.com> | SQLite |
| **Supabase**: demo zones, alerts, field reports, realtime | `supabase/schema.sql` | shared | project `cknzwibzpeakxrpvffmc` | Postgres |
| **Phone simulator**: virtual smartphones sending reports | `simulator/` | <http://localhost:4545> | runs on the laptop | memory |

> **Local and deployed dashboards share the same Supabase project.** Anything you create locally (reports, alerts,
> demo zone status) also appears on the deployed dashboard. Clean up test rows in Supabase → Table Editor.

**Other deployments that exist (not part of the current setup):**

- A **Vercel** project (a friend's account), created before the team moved both apps to Render.
- A Render Blueprint **`rescuermap`** with service **`rescuermap-backend`**, built from the now-merged
  `feature/dashboard-supabase` branch.

Both still work but aren't maintained by `render.yaml` on `main`. To avoid confusion, pick the `-rset` services
as the official ones, and suspend or delete the others (Render → service → Settings → Suspend/Delete; Vercel →
project → Settings → Delete). Deleting is permanent, so agree with the team first.

---

## 1. One-time setup (per laptop)

### 1.1 Tools

| Tool | Version | Check | Get it |
| --- | --- | --- | --- |
| Node.js | **24.x** (backend requires `>=24 <25`) | `node -v` | <https://nodejs.org> (LTS 24) or `nvm-windows` |
| npm | comes with Node | `npm -v` | — |
| Git | any recent | `git --version` | <https://git-scm.com> |

### 1.2 Get the code

```powershell
git clone https://github.com/amith-m-s/Rekshakan.git
cd Rekshakan
```

Already cloned? Update:

```powershell
git switch main
git pull
```

### 1.3 Install dependencies

```powershell
npm ci                      # dashboard (repo root)
cd backend; npm ci; cd ..   # rescue API
```

The simulator has no dependencies.

If the backend later fails with `better_sqlite3.node was compiled against a different Node.js version`, run
`cd backend; npm run rebuild:sqlite`.

### 1.4 Environment files

None of these are in git. Get secret values from the teammate who owns them **through a password manager or a
private message**, never in a shared doc, issue, or AI chat. If a key is ever pasted somewhere public, rotate it.

**a) Dashboard: `.env.local` (repo root)**

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `FIRMS_MAP_KEY` | yes | <https://firms.modaps.eosdis.nasa.gov/api/map_key/> |
| `GROQ_API_KEY` | yes (alerts) | <https://console.groq.com/keys> |
| `NEXT_PUBLIC_CARTO_KEY` | yes (map tiles) | CARTO basemaps key |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Project Settings → API Keys (Project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase → API Keys → **Publishable** key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (saving) | Supabase → API Keys → **Secret** key. Server only, never `NEXT_PUBLIC_` |
| `RESCUERMAP_API_URL` | no | Rescue API for the server-side health check (default `http://localhost:4000`) |
| `NEXT_PUBLIC_RESCUERMAP_API_URL` | no | Rescue API for the "Open console" link (default `http://localhost:4000`) |
| `DASHBOARD_PASSWORD` | no | Password prompt for the dashboard (see 3.3 before using on Render) |
| `REPORTS_PER_MINUTE` / `REPORTS_PER_HOUR` | no | Report rate limits per client (defaults 20 / 300) |

A `VERCEL_OIDC_TOKEN` line may exist from `vercel env pull`; it's harmless and can be deleted.

**b) Rescue API: `backend/.env`**

```powershell
Copy-Item backend\.env.example backend\.env
```

The defaults work locally (port 4000, SQLite in `backend/data/`, simulated providers, CORS for
`localhost:3000`). Set `JWT_SECRET` to any 32+ character random string.

**c) Phone simulator: `simulator/.env`**

```powershell
Copy-Item simulator\example.env simulator\.env
```

Default `TARGET_URL=http://localhost:3000` is right for local runs.

### 1.5 Supabase schema

Already applied to project `cknzwibzpeakxrpvffmc` (tables `zones`, `alerts`, `reports`, `report_rate`, with
realtime). Only for a **new** Supabase project: SQL Editor → paste `supabase/schema.sql` → Run
([SETUP.md Part 2](SETUP.md#part-2-supabase)).

### 1.6 Access you need for deploying

- **GitHub:** push access to `amith-m-s/Rekshakan` (or open pull requests from a fork).
- **Render:** membership in the workspace that owns `rescuermap-rset` and `rescuermap-dashboard-rset`.
- **Supabase:** access to project `cknzwibzpeakxrpvffmc`.

---

## 2. Run everything locally

Use **three PowerShell windows**. The laptop is short on memory, so these steps use production builds (lighter
than `npm run dev`). Start them in this order.

### 2.1 Window 1: rescue API (port 4000)

```powershell
cd backend
npm run build           # compile TypeScript → dist/
npm run seed:if-empty   # first run: creates demo accounts and incident; later runs: skipped
npm start
```

Ready when you see a log line containing `"server_started"` and `"port":4000`.

Check:

- <http://localhost:4000/api/health> → `"service":"up"`
- <http://localhost:4000> → rescue console. Log in with a demo account (password `Demo123!`):
  `coordinator@rescuermap.local`, `admin@…`, `resident@…`, `responder@…`
- <http://localhost:4000/docs> → API documentation

To reset the rescue data: stop it, delete `backend\data\`, run `npm run seed:if-empty` again.
For live-reload while editing backend code, use `npm run dev` instead of build + start.

### 2.2 Window 2: dashboard (port 3000)

From the repo root:

```powershell
npm run build   # next build --webpack; takes a minute or two
npm start       # next start → http://localhost:3000
```

Rebuild after changing code or any `NEXT_PUBLIC_*` variable. For live-reload while editing, use `npm run dev`
(uses more memory; don't run a build at the same time).

Check at <http://localhost:3000>:

| Where | Expect |
| --- | --- |
| Header badges | **Cal OES live**, **Supabase**, **Realtime** (all green) |
| Green bar under the header | **Rescue operations online** (click **Open console →** to open the rescue console) |
| Stats | Active zones > 0, Hotspots > 0 |
| <http://localhost:3000/api/health> | all tables `ok`, `serverKey: "secret"`, `hints: []` |

### 2.3 Window 3: phone simulator (port 4545)

From the repo root:

```powershell
npm run simulate
```

Open <http://localhost:4545>. The log should say `loaded … zones from http://localhost:3000`.

### 2.4 End-to-end check (5 minutes)

1. **Phone → dashboard.** In the simulator, on *Phone 1* choose a place → **Teleport** → type **fire** →
   **Send report**. The report appears on the dashboard (Field reports list and map) within a second.
2. **Dashboard → phones.** On the dashboard, click a live zone near that phone → **Generate** an alert. Within 10 s
   the phone's **Inbox** in the simulator shows it.
3. **Dashboard → rescue console.** Click **Open console →**, log in as `coordinator@rescuermap.local` /
   `Demo123!`, and look at the incident and help requests.
4. **Clean up** the test report and alert rows in Supabase → Table Editor (`reports`, `alerts`), because the
   deployed dashboard shares them.

### 2.5 Stop everything

Press **Ctrl+C** in each window. If a port stays busy (`EADDRINUSE`), free it:

```powershell
foreach ($port in 3000, 4000, 4545) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}
```

---

## 3. The deployed system (Render)

### 3.1 What's deployed

`render.yaml` on `main` defines two free web services in Render's **Singapore** region:

| Service | Root | Build → start | Health check | Key settings |
| --- | --- | --- | --- | --- |
| `rescuermap-rset` (rescue API) | `backend/` | `npm ci --include=dev && npm run build` → `npm run start:render` (seed if empty, then start) | `/api/health` | `NODE_ENV=production` (trusts Render's proxy), `DATABASE_PATH=/tmp/rescuermap.db`, generated `JWT_SECRET`, `CORS_ORIGINS=https://rescuermap-dashboard-rset.onrender.com`, `PROVIDER_MODE=mock` |
| `rescuermap-dashboard-rset` (dashboard) | repo root | `npm ci --include=dev && npm run build` → `npm start` | `/api/health` | `RESCUERMAP_API_URL` and `NEXT_PUBLIC_RESCUERMAP_API_URL` → the rescue API; Supabase and API keys in the Render dashboard |

Free-tier behaviour:

- **Both sleep** after about 15 minutes without traffic; the first request then takes up to a minute.
- **The rescue API's SQLite database resets** on every restart, redeploy, and wake-up (`/tmp`). Startup re-seeds
  the demo accounts, so logins always work, but anything created during a session can disappear.
- The dashboard's data lives in Supabase and doesn't reset.

### 3.2 How deploys happen

**Merge or push to `main` → both services rebuild and deploy automatically.** Watch progress in Render → service →
**Events** / **Logs**. A deploy only goes live after its health check passes, so a broken build keeps the previous
version running.

Manual redeploy: Render → service → **Manual Deploy** → **Deploy latest commit**, or **Clear build cache & deploy**
after changing `NEXT_PUBLIC_*` variables (they're baked into the browser code at build time).

### 3.3 Environment variables on Render

`render.yaml` sets the non-secret ones. The dashboard's secrets are entered in Render → **rescuermap-dashboard-rset →
Environment** and stay there across deploys:

| Variable | Status (checked via `/api/health`) |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | set |
| `SUPABASE_SERVICE_ROLE_KEY` | set |
| `FIRMS_MAP_KEY`, `GROQ_API_KEY`, `NEXT_PUBLIC_CARTO_KEY` | set |
| `DASHBOARD_PASSWORD` | not set (see warning) |

> ⚠️ **Don't set `DASHBOARD_PASSWORD` on Render as things stand.** The service's health check is `/api/health`,
> which the password protects, so Render would see `401`, mark every deploy unhealthy, and keep the old version.
> To add a password safely, first change the dashboard's `healthCheckPath` in `render.yaml` to a public endpoint
> such as `/api/reports`, merge that, then add the variable.

For heavy simulator demos against the deployed dashboard, add `REPORTS_PER_MINUTE=120` to the dashboard service
(all simulated phones share one IP).

To let another site's browser code call the rescue API, append its origin to `CORS_ORIGINS` on
**rescuermap-rset** (comma-separated, no trailing slash).

### 3.4 Wake it up and check it (before any use)

```powershell
$api  = "https://rescuermap-rset.onrender.com"
$dash = "https://rescuermap-dashboard-rset.onrender.com"

Invoke-RestMethod "$api/api/health"            # waits up to ~1 min if asleep → service "up"
Invoke-RestMethod "$dash/api/rescue-health"    # → online : True
(Invoke-RestMethod "$dash/api/health").supabase # tables ok, serverKey secret, browserRealtimeConfigured True
(Invoke-RestMethod "$dash/api/zones").sources  # live caloes, demo supabase
(Invoke-RestMethod "$dash/api/fires").Count    # hotspots > 0
```

The first `/api/fires` or `/api/zones` call after waking can fail to reach NASA FIRMS (`fetch failed`, 0
hotspots). Wait a minute and call it again; the dashboard also refreshes on its own.

Then open both URLs in a browser: the dashboard should show the green badges and **Rescue operations online**.

### 3.5 Point the simulator at the deployed dashboard

In `simulator/.env`:

```dotenv
TARGET_URL=https://rescuermap-dashboard-rset.onrender.com
```

Restart `npm run simulate`. Reports go to the deployed dashboard and appear for everyone viewing it. Sharing the
simulator itself with others (LAN or Cloudflare tunnel): [SIMULATOR.md Part 6](SIMULATOR.md#part-6-exposing-the-simulator-to-other-devices).

---

## 4. Demo day

### T-30 minutes

- [ ] `git pull` on the demo laptop; the simulator's `simulator/.env` has `TARGET_URL` set to the deployed dashboard.
- [ ] Run the checks in **3.4** (this also wakes both services).
- [ ] Clear old test rows in Supabase (`reports`, `alerts`) if you want a clean screen.
- [ ] Close memory-heavy apps on the laptop.

### T-10 minutes

- [ ] Browser tab 1: deployed dashboard. Badges **Cal OES live / Supabase / Realtime**, **Rescue operations online**.
- [ ] Browser tab 2: rescue console, logged in as `coordinator@rescuermap.local`.
- [ ] Window: `npm run simulate`, then <http://localhost:4545> with phones loaded and **live evacuation zones** in the place lists.
- [ ] Backup: the local stack from Part 2, built and ready to start, in case the venue network or Render is slow.

### The flow (about 5 minutes)

1. **Statewide picture** (dashboard): live Cal OES zones, satellite hotspots, zones ranked by threat. Open the top
   zone: wind, nearest hotspot, route to a shelter.
2. **Residents' phones** (simulator): teleport a phone into that zone and send a fire report; then run a **Burst**
   there. Reports land on the dashboard live.
3. **Warn people** (dashboard): **Generate** an alert in English and Spanish. The phones still in the zone receive
   it in their inbox (simulator).
4. **Coordinate the rescue** (console): **Open console →**, show incidents, help requests, responder matching and
   assignments.
5. **Evacuation** (simulator): start **Evacuation** from the zone to a shelter; reports stream in along the route.

Detailed scripts: [SIMULATOR.md Part 8](SIMULATOR.md#part-8-demo-script-3-minutes).

---

## 5. Making changes

1. **Branch from `main`:** `git switch main; git pull; git switch -c feature/<name>`.
2. **Run locally** (Part 2) and check your change.
3. **Check before pushing:**
   ```powershell
   npx tsc --noEmit
   npm run lint
   npm run build
   cd backend; npm run build; npm test; cd ..
   ```
4. **Push and open a pull request** into `main`. Never commit `.env.local`, `backend/.env` or `simulator/.env`
   (they're git-ignored; double-check `git status`).
5. **Merge →** Render deploys both services (3.2). Run the checks in 3.4.

Things that break builds if forgotten:

- New standalone folders with their own `package.json` or `.ts` files must be excluded from the root
  `tsconfig.json` (`exclude`) and `eslint.config.mjs` (`globalIgnores`), like `backend/` and `simulator/`.
- Route modules must not create API clients at import time (build-time evaluation has no secrets).
- `NEXT_PUBLIC_*` changes need a rebuild (locally) or a clear-cache deploy (Render).

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Dashboard badge **Seed data** | Supabase tables missing or keys wrong | Open `/api/health`; follow its `hints`; [SETUP.md Part 4B](SETUP.md#part-4b-fixing-seed-data--polling-on-a-vercel-deployment) |
| Dashboard badge **Polling** | Browser can't use realtime | `NEXT_PUBLIC_SUPABASE_*` missing at build time → rebuild / clear-cache deploy; realtime publication (SETUP.md 2.3) |
| **Rescue operations checking** (amber) | Rescue API asleep, down, or wrong URL | Open `…/api/health` on the API; wait for wake-up; check `RESCUERMAP_API_URL` |
| Hotspots **0** | FIRMS request failed (often right after waking) or key missing | Reload after a minute; `/api/health` → `FIRMS_MAP_KEY: true` |
| Map shows **API KEY REQUIRED** | `NEXT_PUBLIC_CARTO_KEY` missing at build | Set it; rebuild / clear-cache deploy; hard refresh |
| **Generate** alert fails | `GROQ_API_KEY` missing or revoked | Set a valid key; redeploy |
| Rescue console data vanished | Free-tier `/tmp` database reset | Expected on Render free; demo accounts come back automatically |
| Rescue console API calls fail with **500 "Origin not allowed"** | Calling page's origin not in `CORS_ORIGINS` | Add it on `rescuermap-rset` |
| Render deploy stuck "unhealthy" | App crashed, or health check returns 401 | Read the deploy logs; don't set `DASHBOARD_PASSWORD` (3.3) |
| Simulator reports rejected / throttled | Wrong `TARGET_URL`, or rate limits | [SIMULATOR.md Part 9](SIMULATOR.md#part-9-troubleshooting) |
| `EADDRINUSE` locally | Old process still on the port | 2.5 stop script |
| `npm ci` fails with **EPERM … unlink … .node** (e.g. `lightningcss.win32-x64-msvc.node`) | A running `next dev`/`next start` (or the simulator/backend) still has that native file loaded, so Windows won't delete it. `npm ci` stops half-way and leaves `node_modules` incomplete | Stop every Node process from the project (Ctrl+C in each window, or the 2.5 stop script; check with `Get-Process node`), then run `npm ci` again. If it still fails, pause OneDrive syncing and retry |
| `npm run build` very slow or killed | Low memory | Stop dev servers and other apps; build one project at a time |
| Backend: `NODE_MODULE_VERSION` error | Node version changed | `cd backend; npm run rebuild:sqlite` |

---

## 7. Reference

**Ports (local):** dashboard `3000` · rescue API `4000` · simulator `4545`

**Demo accounts (rescue console, all `Demo123!`):** `admin@rescuermap.local`, `coordinator@rescuermap.local`,
`resident@rescuermap.local`, `resident2@rescuermap.local`, `responder@rescuermap.local`,
`responder2@rescuermap.local`. They're public (in the repo), so don't store real data.

**Public dashboard endpoints** (no password even when `DASHBOARD_PASSWORD` is set): `GET /api/zones`,
`GET /api/fires`, `GET /api/alert`, `GET`/`POST /api/reports`. Everything else, including the page and
`/api/health`, is behind the password when it's set.

**Guides:**

- [SETUP.md](SETUP.md): keys, Supabase schema, fixing Supabase/realtime problems
- [RENDER.md](RENDER.md): Render free-tier details, persistent disk, real providers
- [SIMULATOR.md](SIMULATOR.md): phone simulator, its API, tunnels
- [MOBILE.md](MOBILE.md): optional real phone app (Expo) and dashboard report toasts
- [`backend/README.md`](../backend/README.md): rescue API features, roles, Socket.IO events, simulator endpoints
