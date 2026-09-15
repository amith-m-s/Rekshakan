# Phone simulator: fake smartphones on the laptop

Instead of building and installing a phone app, run **virtual smartphones on the laptop**. They send the
dashboard exactly the requests a phone app would (`POST /api/reports` with a spoofed California location and a
phone User-Agent), and they **receive** the dashboard's alerts in an inbox. A control page shows every phone as a
card, and the simulator has its own HTTP API so scripts, teammates or webhooks can drive it.

| Part | What | Time |
| --- | --- | --- |
| 1 | How it works | 3 min |
| 2 | Where to run it (hosting options) | 3 min |
| 3 | Setup and first run | 10 min |
| 4 | Using the control page | — |
| 5 | Driving it with HTTP (and receiving requests) | — |
| 6 | Exposing it to other devices (LAN, Cloudflare tunnel) | 10 min |
| 7 | Optional: always-on hosting on Render | 15 min |
| 8 | Demo script | — |
| 9 | Troubleshooting | — |

---

## Part 1: How it works

```
                        laptop                                              internet
┌───────────────────────────────────────────────────────┐
│  simulator/server.mjs  (http://localhost:4545)        │
│                                                       │        POST /api/reports  (phone UA, lat/lng)
│   Phone 1 (Pixel 8)   near Lakeport        ───────────┼──────────────────────────────▶  Dashboard API
│   Phone 2 (iPhone 15) driving to Sacramento ──────────┼──────────────────────────────▶  (Vercel or localhost:3000)
│   Phone 3 (Galaxy)    near Malibu                     │                                     │
│        ▲                                              │        GET /api/alert (every 10 s)  │ saves to Supabase
│        └── inbox ◀── alerts near the phone ◀──────────┼──────────────────────────────────── │
│                                                       │                                     ▼
│   Control page + HTTP API ◀── you / scripts / webhooks│                               Dashboard in browser
└───────────────────────────────────────────────────────┘                               (toast, map, realtime)
```

- **Outbound (phone → dashboard):** each report is a normal HTTPS request from the laptop to the dashboard's public
  `POST /api/reports`, with the phone's `User-Agent` and an `X-Device-Id` header. The dashboard can't tell it apart
  from the phone app in [MOBILE.md](MOBILE.md).
- **Inbound, alerts (dashboard → phones):** the simulator polls the dashboard's public `GET /api/alert`. When an
  alert is generated on the dashboard, every phone within `ALERT_RADIUS_KM` (30 km) of that zone gets it in its
  inbox, like a cell broadcast. Polling means the dashboard never has to reach the laptop, so this works behind
  any Wi-Fi, NAT or firewall.
- **Inbound, requests to the simulator:** the simulator is itself a server. `POST /api/inbox` lets anything push a
  notification to the phones, and the rest of its API adds phones, moves them, sends reports and runs scenarios.
- **No dependencies.** One Node process, no `npm install`. The laptop is short on memory, and this uses very
  little.

What it simulates, and what it doesn't:

| Simulated | Not simulated |
| --- | --- |
| Many devices with different models / User-Agents | Real GPS, cell networks, push services (FCM/APNs) |
| Spoofed locations anywhere in California, teleporting or driving | Different IP addresses: every phone shares the laptop's IP |
| Reports, bursts, streams, evacuations | Battery or connectivity loss |
| Receiving dashboard alerts and arbitrary notifications | |

Because all phones share one IP, the dashboard's per-IP rate limit (20 reports/minute by default) applies to all of
them together. The simulator therefore throttles itself (`MAX_REPORTS_PER_MINUTE`, default 15) and you can raise
both for big demos (Part 3.4).

---

## Part 2: Where to run it

| Option | Reach the dashboard? | Others can open the control page / send it requests? | Cost | Best for |
| --- | --- | --- | --- | --- |
| **A. Laptop only** (`127.0.0.1`) | ✅ | ❌ (only this laptop) | Free | **Recommended.** Demos run from the laptop |
| **B. Laptop + LAN** (`HOST=0.0.0.0`) | ✅ | Devices on the same Wi-Fi | Free | A teammate's laptop or phone in the same room |
| **C. Laptop + Cloudflare quick tunnel** | ✅ | Anyone with the `https://…trycloudflare.com` URL | Free, no account | Remote teammates, external webhooks, phone browser on mobile data |
| **D. Render web service** | ✅ | Anyone with the URL | Free (sleeps), or paid | Running without the laptop on (Part 7) |

**Recommendation: A.** The simulator only makes *outgoing* requests to the dashboard and polls for alerts, so it
doesn't need to be reachable from the internet to work. Add **C** on top when something outside the laptop has to
send it requests. Use **D** only if the laptop can't stay on; the free tier sleeps and stops the scenarios.

---

## Part 3: Setup and first run

### 3.1 Prerequisites

- **Node.js 20.12 or newer** (`node -v`; this laptop has 24).
- The repo checked out, with the `simulator/` folder.
- **A dashboard to send to**, either:
  - **Local:** the dashboard running on this laptop (`npm run build`, then `npx next start`) at
    `http://localhost:3000`, with `.env.local` connected to Supabase. Good for rehearsing.
  - **Deployed:** the Vercel **production** URL. Check first that `https://<app>/api/health` shows all tables
    `ok` and the dashboard shows **Supabase** and **Realtime** badges ([SETUP.md Part 4B](SETUP.md#part-4b-fixing-seed-data--polling-on-a-vercel-deployment)).
    Otherwise reports end up in one Vercel server's memory and appear at random. Preview URLs don't work (they
    return a Vercel login page).

### 3.2 Configure

```powershell
Copy-Item simulator\example.env simulator\.env
notepad simulator\.env
```

Set at least `TARGET_URL`:

```dotenv
TARGET_URL=https://<your-app>.vercel.app     # or http://localhost:3000
```

`simulator/.env` is git-ignored. All settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TARGET_URL` | `http://localhost:3000` | Dashboard the phones send to (no trailing slash) |
| `HOST` | `127.0.0.1` | Interface for the control page/API. `0.0.0.0` = reachable from the LAN |
| `PORT` | `4545` | Port for the control page/API |
| `SIM_PASSWORD` | *(empty)* | If set, the control page/API needs HTTP Basic auth (any username). **Required** for options B, C, D |
| `MAX_REPORTS_PER_MINUTE` | `15` | Simulator-wide cap; keep below the dashboard's `REPORTS_PER_MINUTE` |
| `ALERT_POLL_SECONDS` | `10` | How often phones check for new dashboard alerts |
| `ALERT_RADIUS_KM` | `30` | Phones within this distance of an alerted zone receive it |
| `START_PHONES` | `3` | Phones created at startup |
| `TIME_SCALE` | `30` | Driving speed multiplier (40 km/h × 30 = 1,200 km/h, so an evacuation takes minutes) |

### 3.3 Run

From the repo root:

```powershell
npm run simulate
```

(or `node simulator/server.mjs`). You'll see:

```
RescuerMap phone simulator: http://127.0.0.1:4545  →  sending to https://<your-app>.vercel.app
[..] info  Phone 1: joined near Boulder Creek (demo zone SCZ-E014) (Pixel 8)
[..] info  loaded 77 zones from https://<your-app>.vercel.app (15 live places)
```

Open <http://localhost:4545>. Stop with **Ctrl+C**. Phones and scenarios live in memory, so a restart starts fresh.

### 3.4 For big demos: raise the rate limits

All phones share the laptop's IP, so the dashboard counts them as one client.

1. **Vercel** → project → **Settings → Environment Variables** → add `REPORTS_PER_MINUTE` = `120` (and optionally
   `REPORTS_PER_HOUR` = `2000`) for Production → **redeploy**.
   Locally: add the same lines to `.env.local` and restart the dashboard.
2. `simulator/.env`: `MAX_REPORTS_PER_MINUTE=100`, then restart the simulator.

---

## Part 4: Using the control page

<http://localhost:4545> has three columns:

**Left: controls**

- **Add a phone**: optional name, and a starting place. Places are the top live Cal OES evacuation zones (loaded
  from the dashboard) plus fixed California places, including the two Santa Cruz demo zones and the Santa Cruz
  County Fairgrounds shelter.
- **Scenarios** (one at a time; starting one replaces the previous):
  - **Burst**: N phones gather around a place and each report once, 1.5 s apart. Type `mixed` picks random types.
  - **Stream**: every N seconds a random phone nudges its position and sends a random report. Runs until stopped.
  - **Evacuation**: N phones start around a place and *drive* to a destination, sending smoke / blocked road /
    fire / needs-help reports on the way. Stops when everyone arrives.
  - **Stop scenario**.
- **Notify all phones**: push a notification into every inbox (same as `POST /api/inbox`).
- **Reload live zones**: re-fetch places from the dashboard (also happens every 5 minutes).

**Middle: phones**, one card each:

- model, battery, name and short id;
- where it is (`Near …` or `Driving to …`) and coordinates;
- counters: sent / failed / last status (`sent fire`, `throttled`, `error 400`, …);
- **Send report**: type and optional message; the phone moves up to 300 m before sending so repeated reports
  spread out;
- **Teleport** (jump) or **Drive** (move over time) to a chosen place;
- **Inbox**: dashboard alerts near it, and pushed notifications.

**Right: log.** Every request, response, throttle, alert and error, live.

The header shows the target URL, reports sent in the last minute against the cap, and a **live** badge while the page
is connected.

---

## Part 5: Driving it with HTTP (and receiving requests)

Everything on the control page is also an HTTP API, so you can script demos or let other systems send the
simulator requests. Examples in PowerShell; replace `$sim` if exposed (Part 6). If `SIM_PASSWORD` is set, add
`-Credential` or a Basic auth header (shown at the end).

```powershell
$sim = "http://localhost:4545"
$json = @{ ContentType = "application/json" }
```

| Method & path | Body | Does |
| --- | --- | --- |
| `GET /healthz` | — | Liveness (never needs a password) |
| `GET /api/state` | — | Phones, places, running scenario, recent log |
| `GET /api/events` | — | Server-Sent Events stream: `state` and `log` events |
| `POST /api/phones` | `{ name?, spotId?, lat?, lng? }` | Add a phone |
| `DELETE /api/phones/{id}` | — | Remove a phone |
| `POST /api/phones/{id}/report` | `{ kind?, message?, scatterMeters? }` | Send one report (201 sent, 429 throttled, 502 dashboard rejected) |
| `POST /api/phones/{id}/move` | `{ spotId }` or `{ lat, lng }` or `{ destinationSpotId }` | Teleport, or drive to a place |
| `POST /api/scenarios/burst` | `{ spotId, count?, kind? }` | Start a burst |
| `POST /api/scenarios/stream` | `{ intervalSeconds? }` | Start a stream |
| `POST /api/scenarios/evacuation` | `{ spotId, destinationSpotId, count?, intervalSeconds? }` | Start an evacuation |
| `POST /api/scenarios/stop` | — | Stop the running scenario |
| `POST /api/inbox` | `{ title, body?, source?, phoneId? }` | **Receive** a notification: to one phone, or all |
| `POST /api/spots/refresh` | — | Reload live zones from the dashboard |

`kind` is one of `fire`, `smoke`, `blocked_road`, `needs_help`, `other`. `spotId` is a place id from
`GET /api/state` (`spots.presets[].id`, e.g. `lakeport`, or a live zone id like `caloes-US-CA-XLK-MNF-E016`).

**Examples:**

```powershell
# List phones and places
$state = Invoke-RestMethod "$sim/api/state"
$state.phones | Select-Object id, name, model, near, sent
$state.spots.presets | Select-Object id, label

# Add a phone in Paradise and send a fire report from it
$p = Invoke-RestMethod "$sim/api/phones" -Method Post @json -Body '{"name":"Resident A","spotId":"paradise"}'
Invoke-RestMethod "$sim/api/phones/$($p.id)/report" -Method Post @json -Body '{"kind":"fire","message":"Flames on Skyway"}'

# Report from exact coordinates
Invoke-RestMethod "$sim/api/phones/$($p.id)/move" -Method Post @json -Body '{"lat":39.043,"lng":-122.915}'
Invoke-RestMethod "$sim/api/phones/$($p.id)/report" -Method Post @json -Body '{"kind":"smoke"}'

# Burst of 8 mixed reports at the top live zone
$zone = $state.spots.live[0].id
Invoke-RestMethod "$sim/api/scenarios/burst" -Method Post @json -Body (@{ spotId = $zone; count = 8 } | ConvertTo-Json)

# Evacuate 5 phones from Lakeport to Sacramento, reporting every 8 s
Invoke-RestMethod "$sim/api/scenarios/evacuation" -Method Post @json `
  -Body '{"spotId":"lakeport","destinationSpotId":"sacramento","count":5,"intervalSeconds":8}'
Invoke-RestMethod "$sim/api/scenarios/stop" -Method Post

# Receive a request: push a notification to every phone
Invoke-RestMethod "$sim/api/inbox" -Method Post @json `
  -Body '{"title":"Shelter open","body":"Fairgrounds accepting evacuees","source":"county webhook"}'
```

**With `SIM_PASSWORD` set:**

```powershell
$auth = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("demo:YOUR_PASSWORD")) }
Invoke-RestMethod "$sim/api/state" -Headers $auth
```

**How the phones receive dashboard alerts:** generate an alert from the dashboard (select a zone → Generate). Within
`ALERT_POLL_SECONDS` the log shows `dashboard alert for <zone> delivered to N phone(s) within 30 km`, and those
phones' inboxes show it. Move a phone into the zone first (Teleport to the live zone) to see it arrive.

---

## Part 6: Exposing the simulator to other devices

Only needed if something other than this laptop must open the control page or send the simulator requests.
**Always set `SIM_PASSWORD` first.** Anyone who can reach the simulator can make it send reports to your
dashboard.

### 6A. Same Wi-Fi (LAN)

1. `simulator/.env`:
   ```dotenv
   HOST=0.0.0.0
   SIM_PASSWORD=choose-a-passphrase
   ```
2. Restart the simulator. Windows may ask whether Node.js can accept connections: allow **Private networks** only.
3. Find the laptop's IP: `ipconfig` → **IPv4 Address** under the Wi-Fi adapter (e.g. `172.30.2.247`).
4. On the other device: `http://172.30.2.247:4545`, then sign in with any username and the password.

College, office and hotel Wi-Fi often block device-to-device traffic. If it doesn't load, use 6B.

### 6B. Cloudflare quick tunnel (public HTTPS URL, no account)

A quick tunnel gives the local simulator a temporary public `https://…trycloudflare.com` address. It works on any
network because the laptop makes an outgoing connection to Cloudflare.

1. Set `SIM_PASSWORD` in `simulator/.env` and restart the simulator. Keep `HOST=127.0.0.1`; the tunnel connects
   locally.
2. Install `cloudflared` (once):
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
   Then open a **new** PowerShell window so it's on `PATH`. (Alternatively download `cloudflared-windows-amd64.exe`
   from Cloudflare's GitHub releases page.)
3. Start the tunnel:
   ```powershell
   cloudflared tunnel --url http://localhost:4545
   ```
4. It prints a URL like `https://random-words-here.trycloudflare.com`. Share that URL and the password. It
   works for the control page, the HTTP API, and incoming webhooks (`POST https://…/api/inbox`).
5. Stop with **Ctrl+C**. The URL changes every time. For a fixed URL, use a named tunnel with a free Cloudflare
   account and your own domain.

Quick tunnels are for testing and demos; Cloudflare doesn't guarantee uptime for them.

---

## Part 7: Optional: always-on hosting on Render

Use this only if the simulator must run without the laptop. Caveats on the **free** plan: the service sleeps after
15 minutes without incoming traffic, which **pauses scenarios and alert polling** (outgoing requests don't keep it
awake), and restarts clear all phones.

1. Add a second service to `render.yaml` (under `services:`, next to `rescuermap-backend`):
   ```yaml
     - type: web
       name: rescuermap-phone-simulator
       runtime: node
       rootDir: simulator
       plan: free
       region: oregon
       buildCommand: echo "no build step"
       startCommand: node server.mjs
       healthCheckPath: /healthz
       envVars:
         - key: NODE_VERSION
           value: 24.14.1
         - key: HOST
           value: 0.0.0.0
         - key: TARGET_URL
           sync: false
         - key: SIM_PASSWORD
           generateValue: true
         - key: MAX_REPORTS_PER_MINUTE
           value: "15"
   ```
   Render sets `PORT` itself; the simulator reads it.
2. Commit and push. Render's Blueprint sync proposes the new service. Approve it, and enter `TARGET_URL` (the Vercel
   production URL).
3. Get the generated password from Render → **rescuermap-phone-simulator → Environment → SIM_PASSWORD** (reveal).
4. Open `https://rescuermap-phone-simulator.onrender.com` and sign in with any username and that password.
5. To keep it awake during an event, ping `https://…/healthz` every 10 minutes with an uptime monitor.

---

## Part 8: Demo script (3 minutes)

**Before:** dashboard open (badges **Supabase** + **Realtime**), simulator page open side by side, no scenario
running. Optional: dashboard reaction from MOBILE.md Part A deployed, so reports pop up with a toast.

1. **"These are three residents' phones."** Point at the phone cards: different models, different places.
2. **Single report.** On *Phone 1*, choose **Teleport → the top live zone**, type **fire**, message "Flames crossing
   the road", **Send report**. The dashboard shows it instantly on the map.
3. **Crowd.** Start **Burst** at the same live zone with 6 phones. Reports stream onto the dashboard.
4. **Evacuation.** Start **Evacuation** from that zone to **Sacramento** with 4 phones. Phone cards show them
   driving; the dashboard gets blocked-road and smoke reports along the route.
5. **Two-way.** On the dashboard, open the zone → **Generate** an alert. Within 10 seconds the phones still near the
   zone show it in their **inbox**; phones that already left don't.
6. **Stop scenario.**

Fallback if the dashboard's internet is flaky: point `TARGET_URL` at the local dashboard (`http://localhost:3000`).

---

## Part 9: Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Log: `could not load zones … fetch failed` | Dashboard not running / wrong `TARGET_URL` | Open `TARGET_URL/api/zones` in a browser; fix the URL; restart |
| Log: `rejected: HTTP 401 (not JSON: … Vercel login page?)` | `TARGET_URL` is a Vercel **preview** URL | Use the production URL |
| Log: `rejected: lat/lng must be numbers inside California` | Custom coordinates outside the state outline | Use a place from the list, or inland coordinates |
| Log: `rejected: too many reports, try again shortly` | Dashboard's per-IP limit | Lower `MAX_REPORTS_PER_MINUTE`, or raise `REPORTS_PER_MINUTE` on the dashboard (3.4) |
| Phone status `throttled` | Simulator's own cap reached | Wait a minute, or raise `MAX_REPORTS_PER_MINUTE` (keep it below the dashboard's limit) |
| Reports sent but the dashboard doesn't show them (or they come and go) | Dashboard on **Seed data** (in-memory) | Fix Supabase on the deployment ([SETUP.md Part 4B](SETUP.md#part-4b-fixing-seed-data--polling-on-a-vercel-deployment)) |
| Dashboard shows them only after ~10 s | Dashboard badge **Polling** | SETUP.md Part 4B, case F |
| Inbox stays empty after generating an alert | Phones more than 30 km from the zone, or zones not loaded | Teleport a phone into the zone; **Reload live zones**; or raise `ALERT_RADIUS_KM` |
| Log: `alert polling failed: HTTP 401` | Dashboard's `proxy.ts` no longer lets `GET /api/alert` through without the password | Keep `/api/alert` GET in `isPublic()` |
| `EADDRINUSE` on start | Port 4545 already used (another simulator?) | Stop the other one, or set `PORT=4546` |
| Control page asks for a password | `SIM_PASSWORD` is set | Any username + that password |
| `process.loadEnvFile is not a function` | Node older than 20.12 | Update Node |
| Other device can't open `http://<laptop-ip>:4545` | `HOST` still `127.0.0.1`, Windows firewall, or Wi-Fi isolation | `HOST=0.0.0.0`; allow Node on private networks; or use the tunnel (6B) |
