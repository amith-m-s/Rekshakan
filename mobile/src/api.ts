export const BACKEND_URL = 'https://rescuermap-rset.onrender.com';
export const DASHBOARD_URL = 'https://rescuermap-dashboard-rset.onrender.com';

export type Session = { accessToken: string; user: { id: string; name: string; email: string; role: string } };
export type Incident = { id: string; name: string; description?: string | null; status: string; severity_level: string; severity_score: number; latitude: number; longitude: number };
export type HelpRequest = { id: string; category: string; status: string; priority_score: number; created_at: string };
export type Shelter = { id: string; name: string; status: string; capacity: number; occupancy: number; latitude: number; longitude: number; services: string[] };
export type Zone = { id: string; code: string; name: string; county?: string | null; status: string; threatScore?: number };

async function request<T>(base: string, path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? `Request failed (${response.status})`);
    return (body?.data ?? body) as T;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('The free server is waking up. Please retry in a moment.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export const api = {
  login: (email: string, password: string) => request<Session>(BACKEND_URL, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  incidents: (token: string) => request<Incident[]>(BACKEND_URL, '/api/incidents?status=ACTIVE', {}, token),
  shelters: (token: string, incidentId?: string) => request<Shelter[]>(BACKEND_URL, `/api/shelters${incidentId ? `?incidentId=${incidentId}` : ''}`, {}, token),
  myRequests: (token: string) => request<HelpRequest[]>(BACKEND_URL, '/api/help-requests', {}, token),
  createHelp: (token: string, body: Record<string, unknown>) => request<HelpRequest>(BACKEND_URL, '/api/help-requests', { method: 'POST', body: JSON.stringify(body) }, token),
  safeCheckIn: (token: string, incidentId: string, latitude?: number, longitude?: number) => request(BACKEND_URL, '/api/safe-checkins', { method: 'POST', body: JSON.stringify({ incidentId, latitude, longitude, source: 'SELF' }) }, token),
  zones: async () => { const data = await request<{ zones: Zone[]; fireCount: number }>(DASHBOARD_URL, '/api/zones'); return { ...data, zones: data.zones.slice(0, 12) }; },
};
