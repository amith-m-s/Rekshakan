import { getSupabase } from './supabase';
import { seedZones } from './seed';
import type { AlertRecord, DataSource, Report, Zone, ZoneStatus } from './types';

// Zones live in Supabase (supabase/schema.sql). Until that table exists or if it is
// unreachable, fall back to lib/seed.ts so the dashboard still works.
// Seed status changes are kept in memory so the demo stays interactive without a database.
const seedState = new Map<string, ZoneStatus>();

export async function getZones(): Promise<{ zones: Zone[]; source: DataSource }> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('zones').select('id, code, name, population, status, geom').order('code');
    if (!error && data?.length) return { zones: (data as Zone[]).map(z => ({ ...z, origin: 'demo' })), source: 'supabase' };
    if (error) console.warn('[data] zones query failed, using seed:', error.message);
  }
  return {
    zones: seedZones.map(z => ({ ...z, origin: 'demo', status: seedState.get(z.id) ?? z.status })),
    source: 'seed',
  };
}

export class ReadOnlyZoneError extends Error {}

export async function updateZoneStatus(id: string, status: ZoneStatus): Promise<{ source: DataSource }> {
  if (id.startsWith('caloes-')) {
    throw new ReadOnlyZoneError('live Cal OES zones are read-only; their status is set by the county');
  }
  const sb = getSupabase();
  if (sb && !id.startsWith('seed-')) {
    const { data, error } = await sb.from('zones').update({ status }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('zone not found, or update blocked by RLS');
    return { source: 'supabase' };
  }
  if (!seedZones.some(z => z.id === id)) throw new Error('zone not found');
  seedState.set(id, status);
  return { source: 'seed' };
}

const memoryAlerts: AlertRecord[] = [];
const memoryReports: Report[] = [];

export async function listAlerts(limit = 20): Promise<AlertRecord[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('alerts').select('*').order('created_at', { ascending: false }).limit(limit);
    if (!error) return data as AlertRecord[];
    console.warn('[data] alerts query failed, using memory:', error.message);
  }
  return memoryAlerts.slice(0, limit);
}

export async function saveAlert(alert: Omit<AlertRecord, 'id' | 'created_at'>): Promise<AlertRecord> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('alerts').insert(alert).select().single();
    if (!error) return data as AlertRecord;
    console.warn('[data] alert insert failed, using memory:', error.message);
  }
  const record = { ...alert, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  memoryAlerts.unshift(record);
  return record;
}

// Per-client limits for POST /api/reports. Generous by default because the demo mobile app
// sends many spoofed reports from one phone; tune with env vars.
const PER_MINUTE = Number(process.env.REPORTS_PER_MINUTE) || 20;
const PER_HOUR = Number(process.env.REPORTS_PER_HOUR) || 300;
const memoryRate = new Map<string, number[]>();

// Returns true and records the attempt if the client is under both limits.
export async function allowReport(clientHash: string): Promise<boolean> {
  const now = Date.now();
  const minuteAgo = now - 60_000;
  const hourAgo = now - 3_600_000;

  // First line: this server instance's memory (cheap, catches bursts).
  const recent = (memoryRate.get(clientHash) ?? []).filter(t => t > hourAgo);
  if (recent.length >= PER_HOUR || recent.filter(t => t > minuteAgo).length >= PER_MINUTE) return false;

  // Second line: the shared ledger, so limits hold across serverless instances.
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('report_rate')
      .select('created_at')
      .eq('client_hash', clientHash)
      .gte('created_at', new Date(hourAgo).toISOString())
      .order('created_at', { ascending: false })
      .limit(PER_HOUR);
    if (!error) {
      const minuteCount = data.filter(r => new Date(r.created_at).getTime() > minuteAgo).length;
      if (data.length >= PER_HOUR || minuteCount >= PER_MINUTE) return false;
      await sb.from('report_rate').insert({ client_hash: clientHash });
    }
  }

  recent.push(now);
  memoryRate.set(clientHash, recent);
  return true;
}

export async function listReports(limit = 100): Promise<{ reports: Report[]; source: DataSource }> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('reports')
      .select('id, kind, message, lat, lng, reporter, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error) return { reports: data as Report[], source: 'supabase' };
    console.warn('[data] reports query failed, using memory:', error.message);
  }
  return { reports: memoryReports.slice(0, limit), source: 'seed' };
}

export async function saveReport(report: Omit<Report, 'id' | 'created_at'>): Promise<Report> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('reports').insert(report).select().single();
    if (!error) return data as Report;
    console.warn('[data] report insert failed, using memory:', error.message);
  }
  const record = { ...report, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  memoryReports.unshift(record);
  return record;
}
