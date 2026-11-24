import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GET } from '../app/api/route/route.ts';
import { parseLngLat } from '../lib/route-coordinates.mjs';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(from, to) {
  const url = new URL('https://example.test/api/route');
  if (from !== undefined) url.searchParams.set('from', from);
  if (to !== undefined) url.searchParams.set('to', to);
  return new Request(url);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('parses decimal coordinates in longitude,latitude order', () => {
  assert.deepEqual(parseLngLat(' -122.4194, 37.7749 '), [-122.4194, 37.7749]);
});

test('accepts inclusive geographic coordinate boundaries', () => {
  assert.deepEqual(parseLngLat('180,90'), [180, 90]);
  assert.deepEqual(parseLngLat('-180,-90'), [-180, -90]);
});

test('accepts valid scientific notation and normalizes to numbers', () => {
  assert.deepEqual(parseLngLat('1.2e2,-4.5e1'), [120, -45]);
});

test('rejects missing, empty, malformed, and extra coordinate values', () => {
  for (const value of [null, '', ' ', '1', '1,2,3', ',2', '1,', '1,,2']) {
    assert.equal(parseLngLat(value), null, `expected ${String(value)} to be rejected`);
  }
});

test('rejects non-numeric and non-finite coordinate values', () => {
  for (const value of ['NaN,0', 'Infinity,0', '-Infinity,0', 'north,37', '0,NaN']) {
    assert.equal(parseLngLat(value), null, `expected ${value} to be rejected`);
  }
});

test('rejects longitude and latitude outside their geographic ranges', () => {
  for (const value of ['180.0001,0', '-180.0001,0', '0,90.0001', '0,-90.0001']) {
    assert.equal(parseLngLat(value), null, `expected ${value} to be rejected`);
  }
});

test('returns 400 without calling OSRM for invalid route coordinates', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('OSRM must not be called');
  };

  const response = await GET(request('181,0', '-122,37'));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test('returns 400 when either endpoint is missing', async () => {
  const response = await GET(request(undefined, '-122,37'));
  assert.equal(response.status, 400);
});

test('normalizes valid coordinates and returns a valid OSRM LineString', async () => {
  const geometry = {
    type: 'LineString',
    coordinates: [[-122.4, 37.8], [-121.9, 38.1]],
  };
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      'https://router.project-osrm.org/route/v1/driving/-122.4,37.8;-121.9,38.1?overview=full&geometries=geojson',
    );
    assert.ok(init.signal instanceof AbortSignal);
    return jsonResponse({ code: 'Ok', routes: [{ geometry }] });
  };

  const response = await GET(request(' -1.224e2,37.8 ', '-121.9,38.1'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), geometry);
});

test('returns 502 when OSRM cannot find a route', async () => {
  globalThis.fetch = async () => jsonResponse({ code: 'NoRoute', message: 'No route found', routes: [] });
  const response = await GET(request('-122,37', '-121,38'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /No route found/);
});

test('returns 502 when OSRM responds with malformed JSON', async () => {
  globalThis.fetch = async () => new Response('not-json');
  const response = await GET(request('-122,37', '-121,38'));
  assert.equal(response.status, 502);
});

test('returns 502 when OSRM returns invalid route geometry', async () => {
  globalThis.fetch = async () => jsonResponse({
    code: 'Ok',
    routes: [{ geometry: { type: 'Polygon', coordinates: [] } }],
  });
  const response = await GET(request('-122,37', '-121,38'));
  assert.equal(response.status, 502);
});

test('returns 502 when the upstream service responds with an HTTP error', async () => {
  globalThis.fetch = async () => jsonResponse({ message: 'Service unavailable' }, 503);
  const response = await GET(request('-122,37', '-121,38'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Service unavailable/);
});

test('returns a controlled 502 when the upstream request fails or times out', async () => {
  globalThis.fetch = async () => {
    throw new Error('network failure');
  };
  const response = await GET(request('-122,37', '-121,38'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /unavailable or timed out/);
});
