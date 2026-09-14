'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import type { AlertRecord, Fire, Report, ZoneStatus, ZonesResponse } from '@/lib/types';
import { ZONE_STATUSES } from '@/lib/types';
import { LANGUAGES, REPORT_COLOR, STATUS_COLOR, compass, timeAgo, zoneCenter } from '@/lib/ui';

// Leaflet touches `window` on import, so the map is client-only.
const ZoneMap = dynamic(() => import('./ZoneMap'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-zinc-500">Loading map…</div>,
});

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${url} returned ${res.status}`);
  return body;
}

export default function Dashboard() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [fires, setFires] = useState<Fire[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusReport, setFocusReport] = useState<Report | null>(null);
  const [route, setRoute] = useState<GeoJSON.LineString | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadZones = useCallback(
    () => getJSON<ZonesResponse>('/api/zones').then(setData).catch(e => setError(e.message)),
    []
  );
  const loadReports = useCallback(
    () => getJSON<{ reports: Report[] }>('/api/reports').then(r => setReports(r.reports)).catch(() => {}),
    []
  );
  const loadAlerts = useCallback(() => getJSON<AlertRecord[]>('/api/alert').then(setAlerts).catch(() => {}), []);

  useEffect(() => {
    const loadFires = () => getJSON<Fire[]>('/api/fires').then(setFires).catch(() => {});
    loadZones();
    loadFires();
    loadReports();
    loadAlerts();
    const timers = [
      setInterval(loadZones, 60_000),
      setInterval(loadFires, 300_000),
      setInterval(loadReports, 10_000),
    ];
    return () => timers.forEach(clearInterval);
  }, [loadZones, loadReports, loadAlerts]);

  const zones = data?.zones ?? [];
  const selected = zones.find(z => z.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-zinc-800 bg-zinc-950 md:h-full md:w-[400px] md:border-r">
        <header className="border-b border-zinc-800 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">RescuerMap</h1>
            {data && (
              <span
                className={`rounded px-2 py-0.5 text-xs ${data.source === 'supabase' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'}`}
                title={data.source === 'seed' ? 'Supabase tables not found; run supabase/schema.sql' : 'Live from Supabase'}
              >
                {data.source === 'supabase' ? 'Supabase' : 'Seed data'}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">Santa Cruz Mountains, California</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Hotspots" value={data ? String(fires.length || data.fireCount) : '–'} />
            <Stat label="Wind" value={data ? `${data.wind.speed.toFixed(0)} km/h` : '–'} />
            <Stat label="Blowing" value={data ? `→ ${compass(data.wind.direction)}` : '–'} />
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </header>

        {selected ? (
          <ZonePanel
            key={selected.id}
            zone={selected}
            onBack={() => setSelectedId(null)}
            onStatusChanged={loadZones}
            onAlertIssued={loadAlerts}
            onRoute={setRoute}
          />
        ) : (
          <section className="p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Zones by threat</h2>
            {!data && <p className="text-sm text-zinc-500">Loading zones…</p>}
            <ul className="space-y-1.5">
              {zones.map(z => (
                <li key={z.id}>
                  <button
                    onClick={() => setSelectedId(z.id)}
                    className="flex w-full items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left hover:border-zinc-600"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: STATUS_COLOR[z.status] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {z.code} · {z.name}
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {z.status} · pop {z.population.toLocaleString()}
                        {z.threat.km !== null && ` · fire ${z.threat.km.toFixed(1)} km`}
                      </span>
                    </span>
                    <ThreatBar score={z.threat.score} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-t border-zinc-800 p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Field reports <span className="text-zinc-600">({reports.length})</span>
          </h2>
          {!reports.length && <p className="text-sm text-zinc-500">No reports yet. The mobile app posts to /api/reports.</p>}
          <ul className="space-y-1.5">
            {reports.slice(0, 15).map(r => (
              <li key={r.id}>
                <button
                  onClick={() => setFocusReport(r)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-900"
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: REPORT_COLOR[r.kind] }} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{r.kind.replace('_', ' ')}</span>
                    <span className="text-zinc-500"> · {timeAgo(r.created_at)}</span>
                    {r.message && <span className="block truncate text-xs text-zinc-400">{r.message}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-zinc-800 p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Issued alerts</h2>
          {!alerts.length && <p className="text-sm text-zinc-500">None yet.</p>}
          <ul className="space-y-2">
            {alerts.slice(0, 5).map(a => (
              <li key={a.id} className="rounded-md bg-zinc-900/60 p-2 text-xs">
                <div className="mb-1 flex justify-between text-zinc-500">
                  <span>
                    {a.zone_code} · {a.status}
                  </span>
                  <span>{timeAgo(a.created_at)}</span>
                </div>
                <p className="text-zinc-300">{a.messages.en ?? Object.values(a.messages)[0]}</p>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="relative h-[60vh] flex-1 md:h-full">
        <ZoneMap
          zones={zones}
          fires={fires}
          reports={reports}
          route={route}
          selectedId={selectedId}
          focusReport={focusReport}
          onSelectZone={setSelectedId}
        />
        <Legend />
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-zinc-900 px-2 py-1.5">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

function ThreatBar({ score }: { score: number }) {
  const color = score >= 0.6 ? '#dc2626' : score >= 0.3 ? '#f97316' : '#71717a';
  return (
    <span className="flex w-16 shrink-0 flex-col items-end gap-1">
      <span className="text-xs tabular-nums text-zinc-400">{score.toFixed(2)}</span>
      <span className="h-1.5 w-full overflow-hidden rounded bg-zinc-800">
        <span className="block h-full" style={{ width: `${Math.max(4, score * 100)}%`, background: color }} />
      </span>
    </span>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-6 right-3 z-[1000] rounded-md bg-zinc-950/85 p-3 text-xs shadow-lg">
      {ZONE_STATUSES.map(s => (
        <div key={s} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
          {s}
        </div>
      ))}
      <div className="mt-1.5 flex items-center gap-2 border-t border-zinc-800 pt-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffb020]" /> satellite hotspot
      </div>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full border border-white bg-[#d946ef]" /> field report
      </div>
      <div className="flex items-center gap-2">
        <span className="h-1 w-3 rounded bg-[#38bdf8]" /> evacuation route
      </div>
    </div>
  );
}

function ZonePanel({
  zone,
  onBack,
  onStatusChanged,
  onAlertIssued,
  onRoute,
}: {
  zone: ZonesResponse['zones'][number];
  onBack: () => void;
  onStatusChanged: () => Promise<unknown>;
  onAlertIssued: () => Promise<unknown>;
  onRoute: (r: GeoJSON.LineString | null) => void;
}) {
  const [savingStatus, setSavingStatus] = useState(false);
  // "Santa Cruz, CA" geocodes to the county centroid, a few km from the zones; use a real shelter site.
  const [destination, setDestination] = useState('Santa Cruz County Fairgrounds');
  const [routeInfo, setRouteInfo] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const [langs, setLangs] = useState<string[]>(['en', 'es']);
  const [alertStatus, setAlertStatus] = useState<ZoneStatus>(zone.status);
  const [messages, setMessages] = useState<Record<string, string> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  // Clear the route when leaving this zone.
  useEffect(() => () => onRoute(null), [onRoute]);

  async function changeStatus(status: ZoneStatus) {
    setSavingStatus(true);
    setPanelError(null);
    try {
      await getJSON(`/api/zones/${zone.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setAlertStatus(status);
      await onStatusChanged();
    } catch (e) {
      setPanelError((e as Error).message);
    } finally {
      setSavingStatus(false);
    }
  }

  async function planRoute() {
    setRouting(true);
    setPanelError(null);
    setRouteInfo(null);
    try {
      const dest = await getJSON<{ lat: number; lon: number }>(`/api/geocode?q=${encodeURIComponent(destination)}`);
      const from = zoneCenter(zone);
      const line = await getJSON<GeoJSON.LineString>(`/api/route?from=${from.lng},${from.lat}&to=${dest.lon},${dest.lat}`);
      onRoute(line);
      setRouteInfo(`Route to ${destination} plotted (${line.coordinates.length} points).`);
    } catch (e) {
      onRoute(null);
      setPanelError((e as Error).message);
    } finally {
      setRouting(false);
    }
  }

  async function generateAlert() {
    setGenerating(true);
    setPanelError(null);
    setMessages(null);
    try {
      const res = await getJSON<Record<string, string>>('/api/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone, status: alertStatus, langs }),
      });
      setMessages(res);
      await onAlertIssued();
    } catch (e) {
      setPanelError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const t = zone.threat;

  return (
    <section className="space-y-5 p-4">
      <div>
        <button onClick={onBack} className="mb-2 text-xs text-zinc-400 hover:text-zinc-200">
          ← All zones
        </button>
        <h2 className="text-base font-semibold">
          {zone.code} · {zone.name}
        </h2>
        <p className="text-xs text-zinc-500">Population {zone.population.toLocaleString()}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Threat score" value={t.score.toFixed(2)} />
        <Stat label="Nearest fire" value={t.km === null ? 'none' : `${t.km.toFixed(1)} km`} />
        <Stat label="Proximity" value={t.proximity.toFixed(2)} />
        <Stat label="Wind alignment" value={t.alignment.toFixed(2)} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Zone status</label>
        <div className="grid grid-cols-3 gap-1.5">
          {ZONE_STATUSES.map(s => (
            <button
              key={s}
              disabled={savingStatus}
              onClick={() => changeStatus(s)}
              className={`rounded border px-2 py-1 text-xs capitalize disabled:opacity-50 ${zone.status === s ? 'border-transparent text-black' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}
              style={zone.status === s ? { background: STATUS_COLOR[s] } : undefined}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Evacuation route</label>
        <div className="flex gap-2">
          <input
            value={destination}
            onChange={e => setDestination(e.target.value)}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
            placeholder="Shelter or town"
          />
          <button
            onClick={planRoute}
            disabled={routing || !destination.trim()}
            className="rounded bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {routing ? 'Routing…' : 'Route'}
          </button>
        </div>
        {routeInfo && <p className="mt-1 text-xs text-sky-300">{routeInfo}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Generate alert</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {LANGUAGES.map(l => (
            <label key={l.code} className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-xs">
              <input
                type="checkbox"
                checked={langs.includes(l.code)}
                onChange={e => setLangs(e.target.checked ? [...langs, l.code] : langs.filter(c => c !== l.code))}
              />
              {l.label}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            value={alertStatus}
            onChange={e => setAlertStatus(e.target.value as ZoneStatus)}
            className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm capitalize"
          >
            {ZONE_STATUSES.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={generateAlert}
            disabled={generating || !langs.length}
            className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {generating ? 'Writing…' : 'Generate'}
          </button>
        </div>
        {messages && (
          <ul className="mt-2 space-y-2">
            {Object.entries(messages).map(([code, text]) => (
              <li key={code} className="rounded bg-zinc-900 p-2 text-xs">
                <div className="mb-1 flex justify-between text-zinc-500">
                  <span className="uppercase">{code}</span>
                  <button onClick={() => navigator.clipboard?.writeText(text)} className="hover:text-zinc-300">
                    Copy
                  </button>
                </div>
                <p className="text-zinc-200">{text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {panelError && <p className="text-xs text-red-400">{panelError}</p>}
    </section>
  );
}
