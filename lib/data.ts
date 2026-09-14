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
    if (!error && data?.length) return { zones: data as Zone[], source: 'supabase' };
    if (error) console.warn('[data] zones query failed, using seed:', error.message);
  }
  return {
    zones: seedZones.map(z => ({ ...z, status: seedState.get(z.id) ?? z.status })),
    source: 'seed',
  };
}

export async function updateZoneStatus(id: string, status: ZoneStatus): Promise<{ source: DataSource }> {
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
  if (sb && !alert.zone_id.startsWith('seed-')) {
    const { data, error } = await sb.from('alerts').insert(alert).select().single();
    if (!error) return data as AlertRecord;
    console.warn('[data] alert insert failed, using memory:', error.message);
  }
  const record = { ...alert, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  memoryAlerts.unshift(record);
  return record;
}

export async function listReports(limit = 100): Promise<{ reports: Report[]; source: DataSource }> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(limit);
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
