// RescuerMap phone simulator.
//
// Runs virtual smartphones on the laptop. Each phone has a phone User-Agent and a spoofed California
// location, sends field reports to the dashboard's POST /api/reports exactly like the mobile app would,
// and receives the dashboard's alerts in an inbox. It also exposes its own HTTP API (and a control UI) so
// scripts, teammates, or webhooks can drive phones and push notifications to them.
//
// Zero dependencies; needs Node 20.12+. Setup and hosting: docs/SIMULATOR.md.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESET_SPOTS, distanceKm, jitter, moveToward, zoneCenter } from './geo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, '.env'));
} catch {
  // No simulator/.env: environment variables and defaults apply.
}

const config = {
  target: (process.env.TARGET_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 4545,
  password: process.env.SIM_PASSWORD || '',
  // Keep below the dashboard's REPORTS_PER_MINUTE: every simulated phone shares the laptop's IP.
  maxPerMinute: Number(process.env.MAX_REPORTS_PER_MINUTE) || 15,
  alertPollMs: (Number(process.env.ALERT_POLL_SECONDS) || 10) * 1000,
  alertRadiusKm: Number(process.env.ALERT_RADIUS_KM) || 30,
  // Driving speed multiplier so evacuations finish in minutes, not hours.
  timeScale: Number(process.env.TIME_SCALE) || 30,
  startPhones: Number(process.env.START_PHONES ?? 3),
};

const KINDS = ['fire', 'smoke', 'blocked_road', 'needs_help', 'other'];

const DEVICES = [
  {
    model: 'Pixel 8',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  },
  {
    model: 'iPhone 15',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  },
  {
    model: 'Galaxy S23',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
  },
  {
    model: 'Moto G Power',
    ua: 'Mozilla/5.0 (Linux; Android 13; moto g power 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  },
];

const DEFAULT_MESSAGES = {
  fire: ['Flames visible from the road', 'Fire moving uphill behind the houses', 'Spot fire across the ridge'],
  smoke: ['Thick smoke, visibility under 100 m', 'Ash falling, strong smell of smoke'],
  blocked_road: ['Road blocked by a fallen tree', 'Traffic stopped on the evacuation route'],
  needs_help: ['Elderly neighbour needs help evacuating', 'Car stuck, family with kids'],
  other: ['Power lines down across the road', 'Livestock loose on the highway'],
};

const pick = list => list[Math.floor(Math.random() * list.length)];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));
const round5 = n => Math.round(n * 1e5) / 1e5;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------------------
// State, log and live updates (Server-Sent Events to the control UI)

const phones = new Map();
const logEntries = [];
const sseClients = new Set();
let liveZones = []; // every zone from the dashboard, for alert targeting
let liveSpots = []; // top live Cal OES zones, offered as places
let scenario = null; // { name, startedAt, options, timers }
const sendTimes = [];

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function log(level, message, phone) {
  const entry = { at: new Date().toISOString(), level, message, phone: phone?.name ?? null };
  logEntries.unshift(entry);
  logEntries.length = Math.min(logEntries.length, 200);
  broadcast('log', entry);
  console.log(`[${entry.at.slice(11, 19)}] ${level.padEnd(5)} ${phone ? `${phone.name}: ` : ''}${message}`);
}

function snapshot() {
  const minuteAgo = Date.now() - 60_000;
  return {
    config: { target: config.target, maxPerMinute: config.maxPerMinute, timeScale: config.timeScale },
    phones: [...phones.values()],
    spots: { presets: PRESET_SPOTS, live: liveSpots },
    scenario: scenario && { name: scenario.name, startedAt: scenario.startedAt, options: scenario.options },
    sentLastMinute: sendTimes.filter(t => t > minuteAgo).length,
  };
}

// Coalesce bursts of changes into one UI update.
let stateQueued = false;
function stateChanged() {
  if (stateQueued) return;
  stateQueued = true;
  setTimeout(() => {
    stateQueued = false;
    broadcast('state', snapshot());
  }, 200);
}

// ---------------------------------------------------------------------------------------------------------
// Places

function findSpot(id) {
  return PRESET_SPOTS.find(s => s.id === id) ?? liveSpots.find(s => s.id === id) ?? null;
}

function requireSpot(id) {
  const spot = findSpot(id);
  if (!spot) throw new HttpError(400, `unknown spot "${id}"`);
  return spot;
}

async function refreshLiveSpots() {
  try {
    const res = await fetch(`${config.target}/api/zones`, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    liveZones = body.zones.map(z => ({
      id: z.id,
      code: z.code,
      status: z.status,
      label: `${z.code} · ${z.county ?? z.name} · ${z.status}`,
      origin: z.origin,
      center: zoneCenter(z.geom),
    }));
    liveSpots = liveZones
      .filter(z => z.origin === 'caloes')
      .slice(0, 15)
      .map(z => ({ id: z.id, label: z.label, ...z.center }));
    log('info', `loaded ${liveZones.length} zones from ${config.target} (${liveSpots.length} live places)`);
  } catch (e) {
    log('warn', `could not load zones from ${config.target}/api/zones: ${e.message}`);
  }
  stateChanged();
}

// ---------------------------------------------------------------------------------------------------------
// Phones

function createPhone({ name, spotId, lat, lng } = {}) {
  const spot = findSpot(spotId) ?? PRESET_SPOTS[phones.size % PRESET_SPOTS.length];
  const device = DEVICES[phones.size % DEVICES.length];
  const start = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : jitter(spot.lat, spot.lng, 800);
  const phone = {
    id: randomUUID().slice(0, 8),
    name: String(name ?? '').trim().slice(0, 40) || `Phone ${phones.size + 1}`,
    model: device.model,
    userAgent: device.ua,
    battery: 45 + Math.floor(Math.random() * 55),
    lat: start.lat,
    lng: start.lng,
    near: spot.label,
    destination: null, // { lat, lng, label } while driving
    speedKmh: 40,
    sent: 0,
    failed: 0,
    lastStatus: 'idle',
    inbox: [],
  };
  phones.set(phone.id, phone);
  log('info', `joined near ${spot.label} (${phone.model})`, phone);
  stateChanged();
  return phone;
}

function requirePhone(id) {
  const phone = phones.get(id);
  if (!phone) throw new HttpError(404, `no phone "${id}"`);
  return phone;
}

function pushInbox(phone, notification) {
  phone.inbox.unshift({ ...notification, at: new Date().toISOString() });
  phone.inbox.length = Math.min(phone.inbox.length, 10);
  stateChanged();
}

// Local limiter shared by all phones, so the simulator never trips the dashboard's per-IP limit.
function takeSlot() {
  const minuteAgo = Date.now() - 60_000;
  while (sendTimes.length && sendTimes[0] <= minuteAgo) sendTimes.shift();
  if (sendTimes.length >= config.maxPerMinute) return false;
  sendTimes.push(Date.now());
  return true;
}

// The request a real phone app sends: POST /api/reports with the phone's location and User-Agent.
async function sendReport(phone, { kind = 'fire', message } = {}) {
  if (!takeSlot()) {
    phone.lastStatus = 'throttled';
    log('warn', `skipped ${kind}: over ${config.maxPerMinute} reports/minute (MAX_REPORTS_PER_MINUTE)`, phone);
    stateChanged();
    return { ok: false, throttled: true };
  }

  const body = {
    kind,
    message: String(message ?? '').trim() || pick(DEFAULT_MESSAGES[kind]),
    lat: round5(phone.lat),
    lng: round5(phone.lng),
    reporter: `${phone.name} (${phone.model})`,
  };

  try {
    const res = await fetch(`${config.target}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': phone.userAgent, 'X-Device-Id': phone.id },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: usually a login page (Vercel preview) or the wrong URL.
    }
    if (!res.ok) {
      const error = json?.error ?? `HTTP ${res.status}${json ? '' : ' (not JSON: wrong TARGET_URL or a Vercel login page?)'}`;
      phone.failed++;
      phone.lastStatus = `error ${res.status}`;
      log('error', `${kind} rejected: ${error}`, phone);
      stateChanged();
      return { ok: false, status: res.status, error };
    }
    phone.sent++;
    phone.lastStatus = `sent ${kind}`;
    log('info', `sent ${kind} at ${body.lat}, ${body.lng} → report ${json?.id ?? '?'}`, phone);
    stateChanged();
    return { ok: true, report: json };
  } catch (e) {
    phone.failed++;
    phone.lastStatus = 'network error';
    log('error', `${kind} failed: ${e.message}`, phone);
    stateChanged();
    return { ok: false, error: e.message };
  }
}

// Driving: phones with a destination move toward it every tick.
const TICK_MS = 2000;
setInterval(() => {
  let moved = false;
  for (const phone of phones.values()) {
    if (!phone.destination) continue;
    const km = (phone.speedKmh * config.timeScale * TICK_MS) / 3_600_000;
    const next = moveToward(phone, phone.destination, km);
    phone.lat = next.lat;
    phone.lng = next.lng;
    moved = true;
    if (next.arrived) {
      log('info', `arrived at ${phone.destination.label}`, phone);
      phone.near = phone.destination.label;
      phone.destination = null;
    }
  }
  if (moved) stateChanged();
}, TICK_MS);

// ---------------------------------------------------------------------------------------------------------
// Receiving alerts from the dashboard (polls its public GET /api/alert)

let seenAlerts = null;
let alertPollFailing = false;

async function pollAlerts() {
  try {
    const res = await fetch(`${config.target}/api/alert`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const alerts = await res.json();
    if (!Array.isArray(alerts)) throw new Error('unexpected response');
    // The first poll only records what already exists.
    if (seenAlerts) for (const alert of alerts.filter(a => !seenAlerts.has(a.id)).reverse()) deliverAlert(alert);
    seenAlerts = new Set(alerts.map(a => a.id));
    alertPollFailing = false;
  } catch (e) {
    if (!alertPollFailing) log('warn', `alert polling failed: ${e.message}`);
    alertPollFailing = true;
  }
}

// Like a cell broadcast: phones within ALERT_RADIUS_KM of the zone get it (all phones if the zone is unknown).
function deliverAlert(alert) {
  const zone = liveZones.find(z => z.id === alert.zone_id);
  const text = alert.messages?.en ?? Object.values(alert.messages ?? {})[0] ?? '';
  const recipients = [...phones.values()].filter(p => !zone || distanceKm(p, zone.center) <= config.alertRadiusKm);
  for (const phone of recipients) {
    pushInbox(phone, {
      title: `${String(alert.status).toUpperCase()} · ${alert.zone_code}`,
      body: text,
      source: 'dashboard alert',
    });
  }
  log(
    'alert',
    `dashboard alert for ${alert.zone_code} delivered to ${recipients.length} phone(s)` +
      (zone ? ` within ${config.alertRadiusKm} km` : ' (zone not loaded: sent to all)')
  );
}

// ---------------------------------------------------------------------------------------------------------
// Scenarios

function stopScenario(reason = 'stopped') {
  if (!scenario) return false;
  for (const timer of scenario.timers) clearTimeout(timer); // also clears intervals
  log('info', `scenario "${scenario.name}" ${reason}`);
  scenario = null;
  stateChanged();
  return true;
}

// Reuse existing phones (moved to the spot), adding new ones until there are `count`.
function phonesAt(spot, count) {
  const list = [...phones.values()].slice(0, count);
  while (list.length < count) list.push(createPhone({ spotId: spot.id }));
  for (const phone of list) {
    Object.assign(phone, jitter(spot.lat, spot.lng, 1500), { near: spot.label, destination: null });
  }
  return list;
}

const SCENARIOS = {
  // Several phones near one place report once each, 1.5 s apart.
  burst({ spotId, count = 5, kind = 'mixed' }) {
    const spot = requireSpot(spotId);
    const list = phonesAt(spot, clamp(count, 1, 20));
    list.forEach((phone, i) => {
      scenario.timers.push(
        setTimeout(async () => {
          await sendReport(phone, { kind: KINDS.includes(kind) ? kind : pick(KINDS) });
          if (i === list.length - 1) stopScenario('finished');
        }, i * 1500)
      );
    });
  },

  // A random phone reports from where it is (nudged a little) every interval.
  stream({ intervalSeconds = 8 }) {
    if (!phones.size) throw new HttpError(400, 'add at least one phone first');
    scenario.timers.push(
      setInterval(() => {
        const phone = pick([...phones.values()]);
        if (!phone) return;
        Object.assign(phone, jitter(phone.lat, phone.lng, 300));
        sendReport(phone, { kind: pick(KINDS) });
      }, clamp(intervalSeconds, 2, 300) * 1000)
    );
  },

  // Phones start around a zone and drive to a destination, reporting conditions on the way.
  evacuation({ spotId, destinationSpotId, count = 4, intervalSeconds = 10 }) {
    const from = requireSpot(spotId);
    const to = requireSpot(destinationSpotId);
    const list = phonesAt(from, clamp(count, 1, 20));
    for (const phone of list) phone.destination = { lat: to.lat, lng: to.lng, label: to.label };
    sendReport(list[0], { kind: 'needs_help', message: `Evacuating from ${from.label} toward ${to.label}` });
    scenario.timers.push(
      setInterval(() => {
        const driving = list.filter(p => p.destination && phones.has(p.id));
        if (!driving.length) return stopScenario('finished: everyone arrived');
        sendReport(pick(driving), { kind: pick(['smoke', 'blocked_road', 'fire', 'needs_help']) });
      }, clamp(intervalSeconds, 2, 300) * 1000)
    );
  },
};

function startScenario(name, options) {
  if (!Object.hasOwn(SCENARIOS, name)) throw new HttpError(404, `unknown scenario "${name}"`);
  stopScenario('replaced');
  scenario = { name, startedAt: new Date().toISOString(), options, timers: [] };
  try {
    SCENARIOS[name](options);
  } catch (e) {
    scenario = null;
    throw e;
  }
  log('info', `scenario "${name}" started ${JSON.stringify(options)}`);
  stateChanged();
}

// ---------------------------------------------------------------------------------------------------------
// HTTP server: control UI + API

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

const digest = s => createHash('sha256').update(s).digest();

// Optional HTTP Basic auth (any username) when SIM_PASSWORD is set.
function authorized(req) {
  if (!config.password) return true;
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  return timingSafeEqual(digest(decoded.slice(decoded.indexOf(':') + 1)), digest(config.password));
}

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://simulator');
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /healthz') return sendJson(res, 200, { ok: true, phones: phones.size, target: config.target });

  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="RescuerMap phone simulator", charset="UTF-8"' });
    return res.end('Authentication required');
  }

  if (req.method === 'GET' && Object.hasOwn(STATIC_FILES, url.pathname)) {
    const [file, type] = STATIC_FILES[url.pathname];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    return res.end(await readFile(path.join(here, 'public', file)));
  }

  if (route === 'GET /api/state') return sendJson(res, 200, { ...snapshot(), log: logEntries.slice(0, 100) });

  if (route === 'GET /api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  if (route === 'POST /api/phones') {
    const b = await readJson(req);
    return sendJson(res, 201, createPhone({ name: b.name, spotId: b.spotId, lat: Number(b.lat), lng: Number(b.lng) }));
  }

  if (route === 'POST /api/spots/refresh') {
    await refreshLiveSpots();
    return sendJson(res, 200, { live: liveSpots.length, zones: liveZones.length });
  }

  if (route === 'POST /api/scenarios/stop') return sendJson(res, 200, { stopped: stopScenario() });

  let match = url.pathname.match(/^\/api\/scenarios\/(\w+)$/);
  if (req.method === 'POST' && match) {
    startScenario(match[1], await readJson(req));
    return sendJson(res, 202, { started: match[1] });
  }

  // Inbound notifications: anything (a script, the backend, a webhook) can push a message to the phones.
  if (route === 'POST /api/inbox') {
    const b = await readJson(req);
    if (!b.title && !b.body) throw new HttpError(400, 'title or body is required');
    const targets = b.phoneId ? [requirePhone(b.phoneId)] : [...phones.values()];
    const notification = {
      title: String(b.title ?? 'Notification').slice(0, 120),
      body: String(b.body ?? '').slice(0, 1000),
      source: String(b.source ?? 'webhook').slice(0, 60),
    };
    for (const phone of targets) pushInbox(phone, notification);
    log('alert', `notification "${notification.title}" received for ${targets.length} phone(s)`);
    return sendJson(res, 202, { delivered: targets.length });
  }

  match = url.pathname.match(/^\/api\/phones\/([\w-]+)(?:\/(report|move))?$/);
  if (match) {
    const phone = requirePhone(match[1]);

    if (req.method === 'DELETE' && !match[2]) {
      phones.delete(phone.id);
      log('info', 'left', phone);
      stateChanged();
      return sendJson(res, 200, { removed: phone.id });
    }

    if (req.method === 'POST' && match[2] === 'report') {
      const b = await readJson(req);
      const kind = b.kind ?? 'fire';
      if (!KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
      if (b.scatterMeters) Object.assign(phone, jitter(phone.lat, phone.lng, clamp(b.scatterMeters, 0, 5000)));
      const result = await sendReport(phone, { kind, message: b.message });
      return sendJson(res, result.ok ? 201 : result.throttled ? 429 : 502, result);
    }

    if (req.method === 'POST' && match[2] === 'move') {
      const b = await readJson(req);
      if (b.destinationSpotId) {
        const to = requireSpot(b.destinationSpotId);
        phone.destination = { lat: to.lat, lng: to.lng, label: to.label };
        log('info', `driving to ${to.label}`, phone);
      } else {
        const spot = b.spotId ? requireSpot(b.spotId) : null;
        const lat = Number(b.lat ?? spot?.lat);
        const lng = Number(b.lng ?? spot?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new HttpError(400, 'spotId, destinationSpotId, or lat and lng are required');
        }
        Object.assign(phone, { lat, lng, near: spot?.label ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`, destination: null });
        log('info', `teleported to ${phone.near}`, phone);
      }
      stateChanged();
      return sendJson(res, 200, phone);
    }
  }

  throw new HttpError(404, `no route for ${route}`);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (res.headersSent) return res.end();
    sendJson(res, e.status ?? 500, { error: e.message });
  });
});

server.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`RescuerMap phone simulator: http://${shown}:${config.port}  →  sending to ${config.target}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) && !config.password) {
    console.warn('Warning: listening beyond this laptop without SIM_PASSWORD; anyone on the network can drive it.');
  }
});

for (let i = 0; i < config.startPhones; i++) createPhone();
refreshLiveSpots();
setInterval(refreshLiveSpots, 5 * 60_000);
pollAlerts();
setInterval(pollAlerts, config.alertPollMs);
