# RescuerMap Field Reporter: phone app guide

How to build an Android app that sends field reports from **spoofed California locations** to the deployed
dashboard, and how to make the dashboard visibly react when one arrives.

| Part | What | Time |
| --- | --- | --- |
| 0 | How it works, prerequisites | 5 min read |
| A | Dashboard reaction to incoming reports (toast, fly-to, pulse, zone check) | 45 min |
| B | Create the Expo app and run it on your phone with Expo Go | 1–2 h |
| C | Build an installable APK with EAS Build | 30 min + build queue |
| D | Demo script | — |
| E | Troubleshooting | — |

---

## Part 0: How it works

```
 Android phone (Expo app)                 Vercel (Next.js API)                 Supabase                Dashboard (browser)
 ───────────────────────                 ────────────────────                 ────────                ───────────────────
 pick a California spot  ── POST ──▶  /api/reports                        
 (preset or live zone)                   • checks kind + inside California
                                         • rate limit per phone
                                         • inserts row  ─────────────────▶  reports table
                                                                              realtime INSERT ──────▶ toast + fly to report
                                                                                                      + "inside ORDER zone …"
 phone reads live zones ◀── GET ────  /api/zones (no password)
```

- **The phone never uses its GPS.** You choose a preset spot, or one of the live evacuation zones pulled from
  `/api/zones`, and the app adds a small random offset so repeated reports spread out. This works from
  anywhere, including India, without mock-location settings.
- **Vercel is the server.** `POST /api/reports` already exists, needs no password, rejects coordinates outside
  California, and rate-limits each client (defaults 20/minute, 300/hour; raise with `REPORTS_PER_MINUTE` /
  `REPORTS_PER_HOUR` on Vercel for heavy simulation).
- **Supabase delivers the push.** Vercel functions can't hold open connections to browsers, so the dashboard
  subscribes to Supabase realtime and receives the new row instantly.
- **The app holds no secrets.** It only knows the public production URL.

> The separate Express backend in `backend/` (amith-m-s's) also has help-request and Socket.IO features. This
> guide targets the Next.js API that the deployed dashboard uses. If the team later standardises on
> `backend/`, only `src/api.ts` in the app needs to change.

### Prerequisites

- [ ] **The deployment is healthy:** `/api/health` on production shows all tables `ok` and the dashboard shows
      **Supabase** and **Realtime** badges. If not, do [SETUP.md Part 4B](SETUP.md#part-4b-fixing-seed-data--polling-on-a-vercel-deployment) first.
- [ ] **Production URL**, e.g. `https://rescuermap.vercel.app`. Not a preview URL: previews sit behind Vercel
      login and the phone will get an HTML login page instead of JSON.
- [ ] **Node.js 20 or newer** on the laptop (`node -v`).
- [ ] **An Android phone** with **Expo Go** installed from the Play Store (for Part B).
- [ ] **A free Expo account** at <https://expo.dev/signup> (for Part C).

---

## Part A: Make the dashboard react to incoming reports

Right now a new report only adds a small pin and a list entry. For a demo you want the room to *see* it
arrive. These changes add:

1. a **toast** at the top of the map: report type, message, reporter, coordinates;
2. a **zone check**: "Inside ORDER zone US-CA-XLK-MNF-E016 · nearest hotspot 1.1 km", or "Not inside any
   active evacuation zone";
3. the map **flies to** the report and shows a **pulsing marker**;
4. an **Open zone** button that jumps to that zone's panel (alerts, routing).

It works with realtime (instant) and with polling (within 10 s).

### A1. Pulse animation (`app/globals.css`)

Append at the end of the file:

```css
/* Pulsing marker for the most recent field report (components/ZoneMap.tsx). */
.report-pulse span {
  display: block;
  width: 18px;
  height: 18px;
  border: 2px solid #fff;
  border-radius: 9999px;
  background: #d946ef;
  animation: report-pulse 1.6s ease-out infinite;
}

@keyframes report-pulse {
  0% { box-shadow: 0 0 0 0 rgba(217, 70, 239, 0.7); }
  100% { box-shadow: 0 0 0 24px rgba(217, 70, 239, 0); }
}
```

### A2. Pulsing marker on the map (`components/ZoneMap.tsx`)

1. Change the imports at the top:

   ```tsx
   'use client';

   import 'leaflet/dist/leaflet.css';
   import L from 'leaflet';
   import { useEffect } from 'react';
   import { CircleMarker, GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
   ```

2. Below the `CARTO_TILES` constant, add:

   ```tsx
   // HTML marker so it can animate; the canvas renderer used for circle markers can't run CSS animations.
   const pulseIcon = L.divIcon({ className: 'report-pulse', html: '<span></span>', iconSize: [18, 18] });
   ```

3. Inside `<MapContainer>`, just after the `{reports.map(...)}` block, add:

   ```tsx
   {focusReport && (
     <Marker position={[focusReport.lat, focusReport.lng]} icon={pulseIcon} interactive={false} />
   )}
   ```

The map already flies to `focusReport` (the `Focus` component), so nothing else changes here.

### A3. Detect new reports and show the toast (`components/Dashboard.tsx`)

1. **Imports.** Replace the first import lines with:

   ```tsx
   'use client';

   import { booleanPointInPolygon } from '@turf/turf';
   import dynamic from 'next/dynamic';
   import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
   ```

2. **State and the `announce` function.** Inside `Dashboard()`, directly after the line
   `const [error, setError] = useState<string | null>(null);`, add:

   ```tsx
   // Latest zones for callbacks that outlive a render (realtime handler, polling).
   const zonesRef = useRef<ScoredZone[]>([]);
   const [toast, setToast] = useState<{ report: Report; zone: ScoredZone | null } | null>(null);

   // Called once per newly arrived report: find the zone it's in, show the toast, fly the map there.
   const announce = useCallback((report: Report) => {
     const zone =
       zonesRef.current.find(z => booleanPointInPolygon([report.lng, report.lat], z.geom)) ?? null;
     setToast({ report, zone });
     setFocusReport(report);
   }, []);

   useEffect(() => {
     if (!toast) return;
     const timer = setTimeout(() => setToast(null), 10_000);
     return () => clearTimeout(timer);
   }, [toast]);

   // Report ids already on screen, so polling can tell which ones are new. null until the first load.
   const seenReports = useRef<Set<string> | null>(null);
   ```

3. **Polling detects new reports.** Replace the existing `loadReports`:

   ```tsx
   const loadReports = useCallback(
     () =>
       getJSON<{ reports: Report[] }>('/api/reports')
         .then(({ reports: latest }) => {
           const seen = seenReports.current;
           // Skip the first load so existing reports don't all pop up when the page opens.
           if (seen) {
             const fresh = latest.filter(r => !seen.has(r.id));
             if (fresh.length) announce(fresh[0]);
           }
           seenReports.current = new Set(latest.map(r => r.id));
           setReports(latest);
         })
         .catch(() => {}),
     [announce]
   );
   ```

4. **Keep `zonesRef` current.** Directly after the line
   `const zones = useMemo(() => data?.zones ?? [], [data]);`, add:

   ```tsx
   useEffect(() => {
     zonesRef.current = zones;
   }, [zones]);
   ```

   The realtime `useEffect` sits *above* that line and doesn't read `zones` directly, so the order is fine.

5. **Realtime announces too.** In the realtime `useEffect`, replace the `reports` handler:

   ```tsx
   .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, p => {
     const report = p.new as Report;
     seenReports.current?.add(report.id);
     setReports(rs => [report, ...rs.filter(r => r.id !== report.id)]);
     announce(report);
   })
   ```

   and add `announce` to that effect's dependency list: `}, [loadZones, announce]);`

6. **Render the toast.** In the JSX, inside `<main className="relative ...">`, directly after `<Legend />`, add:

   ```tsx
   {toast && (
     <div className="absolute left-1/2 top-4 z-[1000] w-[min(92%,440px)] -translate-x-1/2 rounded-lg border border-fuchsia-500/60 bg-zinc-950/95 p-3 text-sm shadow-2xl">
       <div className="flex items-center justify-between gap-2">
         <strong className="text-fuchsia-300">
           New field report: {toast.report.kind.replace('_', ' ')}
         </strong>
         <button onClick={() => setToast(null)} className="text-zinc-500 hover:text-zinc-200" aria-label="Dismiss">
           ✕
         </button>
       </div>
       {toast.report.message && <p className="mt-1 text-zinc-200">{toast.report.message}</p>}
       <p className="mt-1 text-xs text-zinc-300">
         {toast.zone ? (
           <>
             Inside{' '}
             <span className="font-semibold" style={{ color: STATUS_COLOR[toast.zone.status] }}>
               {toast.zone.status.toUpperCase()}
             </span>{' '}
             zone {toast.zone.code}
             {toast.zone.threat.km !== null && ` · nearest hotspot ${toast.zone.threat.km.toFixed(1)} km`}
           </>
         ) : (
           'Not inside any active evacuation zone'
         )}
       </p>
       <p className="mt-0.5 text-xs text-zinc-500">
         {toast.report.reporter ?? 'anonymous'} · {toast.report.lat.toFixed(4)}, {toast.report.lng.toFixed(4)}
       </p>
       {toast.zone && (
         <button
           onClick={() => {
             setSelectedId(toast.zone!.id);
             setToast(null);
           }}
           className="mt-2 rounded bg-fuchsia-700 px-2 py-1 text-xs font-medium text-white hover:bg-fuchsia-600"
         >
           Open zone
         </button>
       )}
     </div>
   )}
   ```

### A4. Check, commit, deploy

```powershell
npx tsc --noEmit
npx eslint app components lib
npm run build
git add app/globals.css components/Dashboard.tsx components/ZoneMap.tsx
git commit -m "Dashboard reacts to incoming field reports"
git push
```

After Vercel redeploys, open the dashboard and send a test report from PowerShell:

```powershell
$u = "https://<production-url>"
Invoke-RestMethod "$u/api/reports" -Method Post -ContentType application/json `
  -Body '{"kind":"fire","message":"Flames visible from the road","lat":39.043,"lng":-122.915,"reporter":"laptop-test"}'
```

Expected: the toast appears, the map flies to Lakeport, and the pin pulses. To see the **Inside ORDER zone**
line, use coordinates inside a live zone: click a zone in the list, and use a point near its middle.

---

## Part B: Create the phone app

### B1. Keep the app out of the dashboard build ⚠️

The app will live in `mobile/` in the same repo. The dashboard's `tsconfig.json` type-checks every `.ts` file
in the repo, which is exactly what broke the Vercel build for `backend/`. **Do this first**:

- `tsconfig.json`: change the exclude line to
  ```json
  "exclude": ["node_modules", "backend", "mobile"]
  ```
- `eslint.config.mjs`: in `globalIgnores([...])`, add `"mobile/**",` after `"backend/**",`.

### B2. Create the Expo project

From the repo root:

```powershell
npx create-expo-app@latest mobile --template blank-typescript
cd mobile
npx expo install react-native-safe-area-context
```

`blank-typescript` gives a single-screen app with TypeScript and no router, which is all this needs. At the
time of writing that's **Expo SDK 57**; the Expo Go app on the Play Store supports the latest SDK.

### B3. Point the app at the deployment

Create `mobile/.env`:

```dotenv
EXPO_PUBLIC_API_URL=https://<production-url>
```

- No trailing slash. Must be the production URL (see prerequisites).
- `EXPO_PUBLIC_*` values are copied into the app when it bundles. Restart `npx expo start` after changing it.
- It isn't a secret, but `.env` files are git-ignored in this repo, so each teammate creates their own.

Also give the Android app an ID. In `mobile/app.json`, inside `"expo"`, set a name and add an `android.package`:

```json
{
  "expo": {
    "name": "RescuerMap Reporter",
    "slug": "rescuermap-reporter",
    "android": {
      "package": "com.rescuermap.reporter"
    }
  }
}
```

Merge these keys into the existing file. Keep the other keys the template created (`version`, `icon`,
`splash`, etc.); if `android` already exists, just add `package` inside it.

### B4. Add the app code

Create the `mobile/src/` folder with these three files, then replace `mobile/App.tsx`.

#### `mobile/src/presets.ts`: spoofed locations

```ts
export interface Spot {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

// Fixed places across California. All are on land and inside the state outline that
// POST /api/reports checks. The first two sit inside the dashboard's Santa Cruz demo zones.
export const PRESET_SPOTS: Spot[] = [
  { id: 'boulder-creek', label: 'Boulder Creek (demo zone SCZ-E014)', lat: 37.126, lng: -122.12 },
  { id: 'felton', label: 'Felton (demo zone SCZ-E021)', lat: 37.051, lng: -122.072 },
  { id: 'lakeport', label: 'Lakeport, Lake County', lat: 39.043, lng: -122.915 },
  { id: 'big-sur', label: 'Big Sur, Monterey County', lat: 36.27, lng: -121.81 },
  { id: 'paradise', label: 'Paradise, Butte County', lat: 39.76, lng: -121.62 },
  { id: 'sacramento', label: 'Sacramento', lat: 38.58, lng: -121.49 },
  { id: 'fresno', label: 'Fresno', lat: 36.74, lng: -119.79 },
  { id: 'malibu', label: 'Malibu, Los Angeles County', lat: 34.04, lng: -118.78 },
  { id: 'lake-arrowhead', label: 'Lake Arrowhead, San Bernardino Mtns', lat: 34.25, lng: -117.19 },
  { id: 'ramona', label: 'Ramona, San Diego County', lat: 33.04, lng: -116.87 },
];

// Random point within `meters` of lat/lng, so repeated reports don't stack on one pixel.
export function jitter(lat: number, lng: number, meters = 600) {
  const r = meters * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.cos(theta)) / 111_320;
  const dLng = (r * Math.sin(theta)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}
```

#### `mobile/src/api.ts`: talking to the dashboard's API

```ts
import type { Spot } from './presets';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type ReportKind = 'fire' | 'smoke' | 'blocked_road' | 'needs_help' | 'other';
export const REPORT_KINDS: ReportKind[] = ['fire', 'smoke', 'blocked_road', 'needs_help', 'other'];

type Geom =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

interface ZoneSummary {
  id: string;
  code: string;
  name: string;
  county?: string | null;
  status: string;
  origin?: 'caloes' | 'demo';
  geom: Geom;
}

function requireUrl() {
  if (!API_URL) throw new Error('EXPO_PUBLIC_API_URL is not set (mobile/.env)');
  return API_URL;
}

// Readable error from a failed response: the API's JSON error, or a hint when it returned a web page.
async function failure(res: Response, what: string) {
  const text = await res.text();
  try {
    return new Error(JSON.parse(text).error ?? `${what} returned ${res.status}`);
  } catch {
    return new Error(`${what} returned ${res.status} (not JSON: is this a preview URL behind Vercel login?)`);
  }
}

// Center of a zone's bounding box.
function center(geom: Geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(p => p[0]);
  const points = rings.flat();
  const lngs = points.map(p => p[0]);
  const lats = points.map(p => p[1]);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
}

// The highest-threat live evacuation zones, as spots to report from.
export async function fetchLiveZoneSpots(limit = 8): Promise<Spot[]> {
  const res = await fetch(`${requireUrl()}/api/zones`);
  if (!res.ok) throw await failure(res, 'GET /api/zones');
  const body: { zones: ZoneSummary[] } = await res.json();
  return body.zones
    .filter(z => z.origin === 'caloes')
    .slice(0, limit)
    .map(z => ({
      id: z.id,
      label: `${z.code} · ${z.county ?? z.name} · ${z.status}`,
      ...center(z.geom),
    }));
}

export interface NewReport {
  kind: ReportKind;
  message: string;
  lat: number;
  lng: number;
  reporter: string | null;
}

export async function sendReport(report: NewReport): Promise<{ id: string }> {
  const res = await fetch(`${requireUrl()}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!res.ok) throw await failure(res, 'POST /api/reports');
  return res.json();
}
```

#### `mobile/App.tsx`: the screen

```tsx
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, REPORT_KINDS, fetchLiveZoneSpots, sendReport, type ReportKind } from './src/api';
import { PRESET_SPOTS, jitter, type Spot } from './src/presets';

const KIND_LABEL: Record<ReportKind, string> = {
  fire: 'Fire',
  smoke: 'Smoke',
  blocked_road: 'Blocked road',
  needs_help: 'Needs help',
  other: 'Other',
};

const SIMULATION_INTERVAL_MS = 10_000;

interface LogEntry {
  id: string;
  at: string;
  text: string;
  ok: boolean;
}

export default function App() {
  const [liveSpots, setLiveSpots] = useState<Spot[]>([]);
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ok' | string>('loading');
  const [spot, setSpot] = useState<Spot>(PRESET_SPOTS[0]);
  const [kind, setKind] = useState<ReportKind>('fire');
  const [message, setMessage] = useState('');
  const [reporter, setReporter] = useState(() => `phone-${Math.random().toString(36).slice(2, 6)}`);
  const [scatter, setScatter] = useState(true);
  const [sending, setSending] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  // The simulation timer reads the latest form values from here instead of a stale render.
  const form = useRef({ spot, kind, message, reporter, scatter });
  useEffect(() => {
    form.current = { spot, kind, message, reporter, scatter };
  });

  function loadLiveSpots() {
    setLiveStatus('loading');
    fetchLiveZoneSpots()
      .then(spots => {
        setLiveSpots(spots);
        setLiveStatus('ok');
      })
      .catch((e: Error) => setLiveStatus(e.message));
  }

  useEffect(loadLiveSpots, []);

  function addLog(text: string, ok: boolean) {
    const entry = { id: `${Date.now()}-${Math.random()}`, at: new Date().toLocaleTimeString(), text, ok };
    setLog(entries => [entry, ...entries].slice(0, 20));
  }

  async function send() {
    const f = form.current;
    const { lat, lng } = f.scatter ? jitter(f.spot.lat, f.spot.lng) : f.spot;
    try {
      await sendReport({
        kind: f.kind,
        message: f.message.trim() || `${KIND_LABEL[f.kind]} reported near ${f.spot.label}`,
        lat,
        lng,
        reporter: f.reporter.trim() || null,
      });
      addLog(`Sent ${KIND_LABEL[f.kind]} at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, true);
    } catch (e) {
      addLog((e as Error).message, false);
    }
  }

  async function sendOnce() {
    setSending(true);
    await send();
    setSending(false);
  }

  // Simulation: send one report now, then one every 10 s from the selected spot until stopped.
  useEffect(() => {
    if (!simulating) return;
    send();
    const timer = setInterval(send, SIMULATION_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulating]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>RescuerMap Reporter</Text>
          <Text style={styles.subtle}>Sends to {API_URL || '⚠️ EXPO_PUBLIC_API_URL not set'}</Text>

          <Section title="1. Location (spoofed)">
            <Text style={styles.selected}>
              {spot.label}
              {'\n'}
              <Text style={styles.subtle}>
                {spot.lat.toFixed(4)}, {spot.lng.toFixed(4)}
              </Text>
            </Text>

            <Text style={styles.groupLabel}>Live evacuation zones</Text>
            {liveStatus === 'loading' && <ActivityIndicator color="#d946ef" />}
            {liveStatus !== 'loading' && liveStatus !== 'ok' && (
              <Text style={styles.error}>
                {liveStatus}{' '}
                <Text style={styles.link} onPress={loadLiveSpots}>
                  Retry
                </Text>
              </Text>
            )}
            {liveStatus === 'ok' && !liveSpots.length && <Text style={styles.subtle}>No active zones right now.</Text>}
            {liveSpots.map(s => (
              <SpotRow key={s.id} spot={s} selected={spot.id === s.id} onPress={() => setSpot(s)} />
            ))}

            <Text style={styles.groupLabel}>Preset places</Text>
            {PRESET_SPOTS.map(s => (
              <SpotRow key={s.id} spot={s} selected={spot.id === s.id} onPress={() => setSpot(s)} />
            ))}

            <View style={styles.row}>
              <Text style={styles.label}>Scatter within 600 m</Text>
              <Switch value={scatter} onValueChange={setScatter} />
            </View>
          </Section>

          <Section title="2. Report">
            <View style={styles.chips}>
              {REPORT_KINDS.map(k => (
                <Pressable key={k} onPress={() => setKind(k)} style={[styles.chip, kind === k && styles.chipOn]}>
                  <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{KIND_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder="Message (optional)"
              placeholderTextColor="#71717a"
              maxLength={500}
              multiline
            />
            <TextInput
              style={styles.input}
              value={reporter}
              onChangeText={setReporter}
              placeholder="Reporter name"
              placeholderTextColor="#71717a"
              maxLength={80}
            />
          </Section>

          <Section title="3. Send">
            <Pressable
              onPress={sendOnce}
              disabled={sending || simulating}
              style={[styles.button, (sending || simulating) && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>{sending ? 'Sending…' : 'Send report'}</Text>
            </Pressable>
            <Pressable
              onPress={() => setSimulating(s => !s)}
              style={[styles.button, simulating ? styles.buttonStop : styles.buttonSecondary]}
            >
              <Text style={styles.buttonText}>
                {simulating ? 'Stop simulation' : `Simulate: send every ${SIMULATION_INTERVAL_MS / 1000} s`}
              </Text>
            </Pressable>
          </Section>

          <Section title="Log">
            {!log.length && <Text style={styles.subtle}>Nothing sent yet.</Text>}
            {log.map(entry => (
              <Text key={entry.id} style={entry.ok ? styles.logOk : styles.error}>
                {entry.at} · {entry.text}
              </Text>
            ))}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SpotRow({ spot, selected, onPress }: { spot: Spot; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.spot, selected && styles.spotOn]}>
      <Text style={styles.spotText}>{spot.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, gap: 16 },
  title: { color: '#fafafa', fontSize: 22, fontWeight: '700' },
  subtle: { color: '#a1a1aa', fontSize: 12 },
  section: { backgroundColor: '#18181b', borderRadius: 10, padding: 12, gap: 8 },
  sectionTitle: { color: '#e4e4e7', fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  groupLabel: { color: '#71717a', fontSize: 12, marginTop: 6 },
  selected: { color: '#f5d0fe', fontSize: 15, fontWeight: '600' },
  spot: { borderWidth: 1, borderColor: '#3f3f46', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  spotOn: { borderColor: '#d946ef', backgroundColor: '#3b0a45' },
  spotText: { color: '#e4e4e7', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  label: { color: '#e4e4e7', fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#3f3f46', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  chipText: { color: '#d4d4d8', fontSize: 13 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    color: '#fafafa',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  button: { backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonSecondary: { backgroundColor: '#0369a1' },
  buttonStop: { backgroundColor: '#52525b' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  logOk: { color: '#86efac', fontSize: 12 },
  error: { color: '#fca5a5', fontSize: 12 },
  link: { color: '#f0abfc', textDecorationLine: 'underline' },
});
```

### B5. Run it on your phone with Expo Go

1. Laptop, inside `mobile/`:
   ```powershell
   npx expo start
   ```
   A QR code appears in the terminal.
2. Phone: open **Expo Go** → **Scan QR code** → scan it. The app loads over the network.
3. **Phone and laptop on different networks**, or college/office Wi-Fi blocking it (the app never loads)?
   Use a tunnel instead:
   ```powershell
   npx expo start --tunnel
   ```
   Accept the prompt to install the tunnel package, then scan the new QR code.
4. Edits to `App.tsx` reload on the phone automatically. After changing `.env`, stop and restart
   `npx expo start`.

### B6. Check it works

With the dashboard open on the laptop:

1. **Live evacuation zones** fills with zone codes (proves `GET /api/zones` works from the phone).
2. Pick **Lakeport, Lake County**, type **Fire**, tap **Send report**. The log shows `Sent Fire at …`, and within
   a second the dashboard shows the toast and flies to Lake County.
3. Pick a **live zone** at the top of the list and send again. The toast says **Inside ORDER/WARNING zone …**.
4. Tap **Simulate**. A report arrives every 10 s, scattered around the spot. Tap **Stop simulation**.

### B7. Commit the app

From the repo root (after the B1 exclusions are committed):

```powershell
git add mobile tsconfig.json eslint.config.mjs
git commit -m "Add Expo field reporter app"
git push
```

`create-expo-app` writes its own `mobile/.gitignore`, which keeps `node_modules` and `.env` out of git.
Check with `git status` that `mobile/node_modules` isn't staged before committing.

---

## Part C: Build an installable APK

Expo Go is perfect for development, but for a demo you want a real app icon on the phone. EAS Build compiles
the APK in Expo's cloud, so you don't need Android Studio or the Android SDK.

### C1. Log in and configure

Inside `mobile/`:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure
```

- `login` uses your Expo account.
- `build:configure`: choose **Android** (or All). It creates `mobile/eas.json` and links the project to your
  Expo account (adds an `extra.eas.projectId` to `app.json`).

### C2. Make the preview profile produce an APK

Open `mobile/eas.json` and make the `preview` profile look like this (keep the other profiles it created):

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://<production-url>"
      }
    }
  }
}
```

Why `env` here: EAS uploads the project from git, and `mobile/.env` is git-ignored, so the cloud build would not
see it. Values in the build profile's `env` are used during the cloud build and baked into the APK. (It's a
public URL, so it's fine to commit.)

### C3. Build

```powershell
npx eas-cli@latest build -p android --profile preview
```

- First build: accept **Generate a new Android Keystore** (Expo stores it for you).
- The build runs in Expo's cloud. Free accounts share a queue, so expect anything from a few minutes to much
  longer at busy times. You can close the terminal; progress is on <https://expo.dev> → your project →
  **Builds**.

### C4. Install on the phone

1. When the build finishes, the terminal and the Expo website show a **download link and QR code**.
2. Open the link on the phone (scan the QR code) and download the `.apk`.
3. Android will ask to allow installs from this source (your browser or Files app): allow it, then **Install**.
   Play Protect may warn about an unknown developer; choose **Install anyway**.
4. Open **RescuerMap Reporter** from the app drawer.

To change the target URL later: edit `eas.json`, rebuild (C3), and reinstall.

---

## Part D: Demo script (3 minutes)

1. **Before the audience:** dashboard open full-screen on production, logged in, badges **Cal OES live /
   Supabase / Realtime** green. Phone app open, live zones loaded, simulation stopped.
2. **Set the scene (dashboard):** "72 live evacuation zones from Cal OES, 136 satellite hotspots, ranked by
   threat using wind and fire distance." Click the top zone: notes, wind alignment, route, alert generation.
3. **The signal:** "A resident in Lake County reports fire." On the phone pick the top **live zone**, type
   **Fire**, message "Flames crossing the road", **Send report**.
4. **The reaction (dashboard):** toast appears, map flies there, marker pulses, "Inside ORDER zone …".
   Click **Open zone**, **Generate** an alert in English and Spanish.
5. **Scale:** on the phone tap **Simulate** from a preset (e.g. Malibu). Reports stream in every 10 s. Stop it.
6. **Fallback if the network fails:** send the PowerShell POST from Part A4 from the laptop; the dashboard
   reacts identically.

Tidy up afterwards: delete demo rows in Supabase **Table Editor → reports** (and **alerts**) if needed.

---

## Part E: Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| App shows `EXPO_PUBLIC_API_URL is not set` | `.env` missing, or Expo not restarted | Create `mobile/.env` (B3); restart `npx expo start` |
| APK shows `EXPO_PUBLIC_API_URL is not set` | Missing from `eas.json` | Add it under `preview.env` (C2) and rebuild |
| `… returned 401 (not JSON: is this a preview URL…)` | Using a preview URL behind Vercel login | Use the production URL |
| `POST /api/reports returned 401` with JSON | `proxy.ts` changed so `/api/reports` needs the password | `/api/reports` GET/POST must stay in `isPublic()` in `proxy.ts` |
| `lat/lng must be numbers inside California` | Custom spot outside the state outline (or in the ocean near the border) | Move the point inland |
| `too many reports, try again shortly` | Rate limit (20/min per phone by default) | Slow the simulation, or set `REPORTS_PER_MINUTE` on Vercel and redeploy |
| Log says `Sent…` but the dashboard shows nothing | Dashboard on **Seed data** (server memory) or not reacting | Fix Supabase first ([SETUP.md Part 4B](SETUP.md#part-4b-fixing-seed-data--polling-on-a-vercel-deployment)); make sure Part A is deployed |
| Dashboard updates only after ~10 s | Badge says **Polling** | SETUP.md Part 4B, case F |
| Live zones list: `Network request failed` | Phone offline, or wrong URL (typo, `http://`) | Open the URL in the phone's browser: `/api/zones` should show JSON |
| Expo Go: "Project is incompatible with this version of Expo Go" | Expo Go and project SDK differ | Update Expo Go from the Play Store, or `npx expo install expo@latest` then `npx expo install --fix` |
| QR code scans but the app never loads | Phone can't reach the laptop | `npx expo start --tunnel` |
| Vercel build fails with errors in `mobile/…` | B1 exclusions missing | Add `"mobile"` to `tsconfig.json` exclude and `"mobile/**"` to ESLint ignores |
| EAS: "android.package is required" | Missing in `app.json` | Add `expo.android.package` (B3) |
