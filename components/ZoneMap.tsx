'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Fire, Report, ScoredZone } from '@/lib/types';
import { REPORT_COLOR, STATUS_COLOR, zoneBounds } from '@/lib/ui';

// CARTO basemaps show an "API key required" watermark unless the key is passed on each tile.
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY;
const CARTO_TILES = `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ''}`;

interface Props {
  zones: ScoredZone[];
  fires: Fire[];
  reports: Report[];
  route: GeoJSON.LineString | null;
  selectedId: string | null;
  focusReport: Report | null;
  onSelectZone: (id: string) => void;
}

function Focus({ zone, report, route }: { zone?: ScoredZone; report: Report | null; route: GeoJSON.LineString | null }) {
  const map = useMap();
  const zoneId = zone?.id;
  useEffect(() => {
    // Keyed on the id so background zone refreshes don't re-fly the map.
    if (zone) map.flyToBounds(zoneBounds(zone), { padding: [80, 80], maxZoom: 14, duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, zoneId]);
  useEffect(() => {
    if (!route?.coordinates.length) return;
    const lats = route.coordinates.map(p => p[1]);
    const lngs = route.coordinates.map(p => p[0]);
    map.flyToBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [60, 60], maxZoom: 14, duration: 0.8 }
    );
  }, [map, route]);
  useEffect(() => {
    if (report) map.flyTo([report.lat, report.lng], 11, { duration: 0.8 });
  }, [map, report]);
  return null;
}

export default function ZoneMap({ zones, fires, reports, route, selectedId, focusReport, onSelectZone }: Props) {
  const selected = zones.find(z => z.id === selectedId);

  return (
    // Canvas rendering keeps thousands of statewide hotspot markers responsive.
    <MapContainer center={[37.2, -119.5]} zoom={6} className="h-full w-full" zoomControl={false} preferCanvas>
      <TileLayer
        url={CARTO_TILES}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={19}
      />

      {zones.map(z => (
        <GeoJSON
          // GeoJSON layers don't restyle on prop changes, so remount when the look changes.
          key={`${z.id}-${z.status}-${z.threat.score}-${z.id === selectedId}`}
          data={z.geom}
          style={{
            color: STATUS_COLOR[z.status],
            weight: z.id === selectedId ? 4 : 2,
            fillColor: STATUS_COLOR[z.status],
            fillOpacity: 0.15 + 0.5 * z.threat.score,
          }}
          eventHandlers={{ click: () => onSelectZone(z.id) }}
        >
          <Tooltip sticky>
            <strong>{z.code}</strong> {z.name}
            <br />
            {z.status} · threat {z.threat.score.toFixed(2)}
          </Tooltip>
        </GeoJSON>
      ))}

      {fires.map((f, i) => (
        <CircleMarker
          key={`fire-${i}`}
          center={[+f.latitude, +f.longitude]}
          radius={Math.min(12, 4 + Math.sqrt(+f.frp || 0))}
          pathOptions={{ color: '#ff5a1f', fillColor: '#ffb020', fillOpacity: 0.85, weight: 1 }}
        >
          <Popup>
            <strong>Satellite hotspot</strong>
            <br />
            FRP {f.frp} MW · {f.acq_date} {f.acq_time.padStart(4, '0')} UTC
            <br />
            Confidence: {f.confidence ?? 'n/a'}
          </Popup>
        </CircleMarker>
      ))}

      {reports.map(r => (
        <CircleMarker
          key={r.id}
          center={[r.lat, r.lng]}
          radius={focusReport?.id === r.id ? 11 : 8}
          pathOptions={{ color: '#fff', fillColor: REPORT_COLOR[r.kind], fillOpacity: 0.95, weight: 2 }}
        >
          <Popup>
            <strong>Field report: {r.kind.replace('_', ' ')}</strong>
            <br />
            {r.message || <em>No message</em>}
            <br />
            <small>
              {r.reporter ?? 'anonymous'} · {new Date(r.created_at).toLocaleString()}
              <br />
              {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
            </small>
          </Popup>
        </CircleMarker>
      ))}

      {route && (
        <Polyline
          positions={route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
          pathOptions={{ color: '#38bdf8', weight: 5, opacity: 0.9 }}
        />
      )}

      <Focus zone={selected} report={focusReport} route={route} />
    </MapContainer>
  );
}
