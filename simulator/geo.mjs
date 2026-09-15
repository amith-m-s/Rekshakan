// Places and small geometry helpers for the phone simulator.

// Fixed places across California, all on land and inside the outline that POST /api/reports checks.
// Boulder Creek and Felton sit inside the dashboard's Santa Cruz demo zones.
export const PRESET_SPOTS = [
  { id: 'boulder-creek', label: 'Boulder Creek (demo zone SCZ-E014)', lat: 37.126, lng: -122.12 },
  { id: 'felton', label: 'Felton (demo zone SCZ-E021)', lat: 37.051, lng: -122.072 },
  { id: 'santa-cruz-fairgrounds', label: 'Santa Cruz County Fairgrounds (shelter)', lat: 36.9516, lng: -121.7356 },
  { id: 'lakeport', label: 'Lakeport, Lake County', lat: 39.043, lng: -122.915 },
  { id: 'big-sur', label: 'Big Sur, Monterey County', lat: 36.27, lng: -121.81 },
  { id: 'paradise', label: 'Paradise, Butte County', lat: 39.76, lng: -121.62 },
  { id: 'sacramento', label: 'Sacramento', lat: 38.58, lng: -121.49 },
  { id: 'fresno', label: 'Fresno', lat: 36.74, lng: -119.79 },
  { id: 'malibu', label: 'Malibu, Los Angeles County', lat: 34.04, lng: -118.78 },
  { id: 'lake-arrowhead', label: 'Lake Arrowhead, San Bernardino Mtns', lat: 34.25, lng: -117.19 },
  { id: 'ramona', label: 'Ramona, San Diego County', lat: 33.04, lng: -116.87 },
];

// Random point within `meters` of lat/lng.
export function jitter(lat, lng, meters = 600) {
  const r = meters * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  return {
    lat: lat + (r * Math.cos(theta)) / 111_320,
    lng: lng + (r * Math.sin(theta)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
  };
}

// Great-circle distance in km between two { lat, lng } points.
export function distanceKm(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

// Move `km` from `from` toward `to` in a straight line.
export function moveToward(from, to, km) {
  const d = distanceKm(from, to);
  if (d <= km) return { lat: to.lat, lng: to.lng, arrived: true };
  const f = km / d;
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f, arrived: false };
}

// Center of a GeoJSON Polygon/MultiPolygon's bounding box.
export function zoneCenter(geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(p => p[0]);
  const points = rings.flat();
  const lngs = points.map(p => p[0]);
  const lats = points.map(p => p[1]);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
}
