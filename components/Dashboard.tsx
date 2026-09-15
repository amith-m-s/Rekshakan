'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AlertRecord, Fire, Report, ScoredZone, ZoneStatus, ZonesResponse } from '@/lib/types';
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

type OriginFilter = 'all' | 'caloes' | 'demo';
const RESCUE_API = process.env.NEXT_PUBLIC_RESCUERMAP_API_URL || 'http://localhost:4000';

export default function Dashboard() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [fires, setFires] = useState<Fire[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusReport, setFocusReport] = useState<Report | null>(null);
  const [route, setRoute] = useState<GeoJSON.LineString | null>(null);
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [rescueOnline, setRescueOnline] = useState(false);

  const loadZones = useCallback(
    () =>
      getJSON<ZonesResponse>('/api/zones')
        .then(d => {
          setData(d);
          setError(null);
        })
        .catch(e => setError(e.message)),
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
    const timers = [setInterval(loadZones, 120_000), setInterval(loadFires, 300_000)];
    return () => timers.forEach(clearInterval);
  }, [loadZones, loadReports, loadAlerts]);

  useEffect(() => {
    fetch(`${RESCUE_API}/api/health`)
      .then(res => {
        if (!res.ok) throw new Error('Rescue API unavailable');
        return res.json();
      })
      .then(body => setRescueOnline(body?.data?.service === 'up' && body?.data?.database === 'up'))
      .catch(() => setRescueOnline(false));
  }, []);

  // Push updates from Supabase realtime. Falls back to polling when it isn't configured or connected.
  const [realtime, setRealtime] = useState(false);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Literal references so Next inlines them into the browser bundle at build time.
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;

    let cancelled = false;
    let cleanup = () => {};
    import('@supabase/supabase-js').then(({ createClient }) => {
      if (cancelled) return;
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const channel = sb
        .channel('dashboard')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, p => {
          const report = p.new as Report;
          setReports(rs => [report, ...rs.filter(r => r.id !== report.id)]);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, p => {
          const alert = p.new as AlertRecord;
          setAlerts(as => [alert, ...as.filter(a => a.id !== alert.id)]);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'zones' }, () => loadZones())
        .subscribe(status => setRealtime(status === 'SUBSCRIBED'));
      cleanup = () => {
        sb.removeChannel(channel);
      };
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [loadZones]);

  useEffect(() => {
    if (realtime) return;
    const timer = setInterval(loadReports, 10_000);
    return () => clearInterval(timer);
  }, [realtime, loadReports]);

  const zones = useMemo(() => data?.zones ?? [], [data]);
  const selected = zones.find(z => z.id === selectedId) ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return zones.filter(
      z =>
        (origin === 'all' || z.origin === origin) &&
        (!q || [z.code, z.name, z.county ?? '', z.notes ?? ''].some(s => s.toLowerCase().includes(q)))
    );
  }, [zones, query, origin]);

  const live = zones.filter(z => z.origin === 'caloes');
  const orders = live.filter(z => z.status === 'order').length;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-zinc-800 bg-zinc-950 md:h-full md:w-[400px] md:border-r">
        <header className="border-b border-zinc-800 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400">Statewide intelligence</p>
              <h1 className="text-lg font-semibold tracking-tight">RescuerMap</h1>
            </div>
            {data && (
              <div className="flex gap-1.5 text-xs">
                <Badge ok={data.sources.live === 'caloes'} label={data.sources.live === 'caloes' ? 'Cal OES live' : 'Cal OES down'} />
                <Badge
                  ok={data.sources.demo === 'supabase'}
                  label={data.sources.demo === 'supabase' ? 'Supabase' : 'Seed data'}
                  title={data.sources.demo === 'seed' ? 'Supabase tables not found; run supabase/schema.sql' : undefined}
                />
                <Badge
                  ok={realtime}
                  label={realtime ? 'Realtime' : 'Polling'}
                  title={realtime ? 'Reports and alerts arrive instantly' : 'Realtime not connected; refreshing reports every 10 s'}
                />
              </div>
            )}
          </div>
          <a
            href={RESCUE_API}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center justify-between rounded-md border border-emerald-900/70 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200 transition hover:border-emerald-600 hover:bg-emerald-950/70"
          >
            <span><b className={`mr-2 inline-block h-2 w-2 rounded-full ${rescueOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />Rescue operations {rescueOnline ? 'online' : 'checking'}</span>
            <strong>Open console →</strong>
          </a>
          <p className="text-xs text-zinc-500">California wildfire evacuations</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Active zones" value={data ? String(live.length) : '–'} />
            <Stat label="Orders" value={data ? String(orders) : '–'} />
            <Stat label="Hotspots" value={data ? String(fires.length || data.fireCount) : '–'} />
          </div>
          {!!data?.sources.staleHidden && (
            <p className="mt-2 text-xs text-zinc-500">
              {data.sources.staleHidden} stale zone{data.sources.staleHidden === 1 ? '' : 's'} hidden (not updated in 90+ days).
            </p>
          )}
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
            <div className="mb-2 flex gap-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search zone, county, fire…"
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
              />
              <select
                value={origin}
                onChange={e => setOrigin(e.target.value as OriginFilter)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
              >
                <option value="all">All</option>
                <option value="caloes">Live</option>
                <option value="demo">Demo</option>
              </select>
            </div>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Zones by threat <span className="text-zinc-600">({visible.length})</span>
            </h2>
            {!data && <p className="text-sm text-zinc-500">Loading zones…</p>}
            {data && !visible.length && <p className="text-sm text-zinc-500">No zones match.</p>}
            <ul className="space-y-1.5">
              {visible.map(z => (
                <li key={z.id}>
                  <button
                    onClick={() => setSelectedId(z.id)}
                    className="flex w-full items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left hover:border-zinc-600"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: STATUS_COLOR[z.status] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {z.code}
                        <span className="ml-1.5 text-[10px] font-normal uppercase text-zinc-500">{z.origin === 'caloes' ? 'live' : 'demo'}</span>
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {z.county ? `${z.county} · ` : `${z.name} · `}
                        {z.status}
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

function Badge({ ok, label, title }: { ok: boolean; label: string; title?: string }) {
  return (
    <span
      title={title}
      className={`rounded px-2 py-0.5 ${ok ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'}`}
    >
      {label}
    </span>
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
  zone: ScoredZone;
  onBack: () => void;
  onStatusChanged: () => Promise<unknown>;
  onAlertIssued: () => Promise<unknown>;
  onRoute: (r: GeoJSON.LineString | null) => void;
}) {
  const readOnly = zone.origin === 'caloes';
  const [savingStatus, setSavingStatus] = useState(false);
  const [destination, setDestination] = useState('');
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
      setRouteInfo(`Route to ${destination} plotted.`);
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
        body: JSON.stringify({
          zone: { id: zone.id, code: zone.code, name: zone.county ? `${zone.county} County` : zone.name, population: zone.population },
          status: alertStatus,
          langs,
        }),
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
        <h2 className="text-base font-semibold">{zone.code}</h2>
        <p className="text-xs text-zinc-500">
          {zone.county ? `${zone.county} County` : zone.name}
          {' · '}
          {readOnly ? 'Live from Cal OES' : 'Demo zone'}
          {zone.updatedAt && ` · updated ${timeAgo(zone.updatedAt)}`}
        </p>
        {zone.notes && <p className="mt-2 rounded bg-zinc-900 p-2 text-xs text-zinc-300">{zone.notes}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Threat score" value={t.score.toFixed(2)} />
        <Stat label="Nearest hotspot" value={t.km === null ? 'none' : `${t.km.toFixed(1)} km`} />
        <Stat label="Wind" value={zone.wind ? `${zone.wind.speed.toFixed(0)} km/h → ${compass(zone.wind.direction)}` : 'n/a'} />
        <Stat label="Wind alignment" value={t.alignment.toFixed(2)} />
        <Stat label="Area" value={`${zone.areaKm2.toFixed(1)} km²`} />
        <Stat label="Population" value={zone.population === null ? 'unknown' : zone.population.toLocaleString()} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Zone status</label>
        {readOnly ? (
          <p className="text-sm">
            <span className="rounded px-2 py-0.5 text-xs capitalize text-black" style={{ background: STATUS_COLOR[zone.status] }}>
              {zone.status}
            </span>
            <span className="ml-2 text-xs text-zinc-500">Set by the county; read-only here.</span>
          </p>
        ) : (
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
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Evacuation route</label>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            planRoute();
          }}
        >
          <input
            value={destination}
            onChange={e => setDestination(e.target.value)}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
            placeholder="Shelter, fairgrounds, or town"
          />
          <button
            type="submit"
            disabled={routing || !destination.trim()}
            className="rounded bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {routing ? 'Routing…' : 'Route'}
          </button>
        </form>
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
