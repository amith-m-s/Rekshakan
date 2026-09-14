export type ProviderRecord<T> = { data: T; sourceType: 'OFFICIAL'|'COMMUNITY'|'SYSTEM_GENERATED'|'SIMULATED'; observedAt: string; expiresAt: string; stale: boolean; provider: string };
export interface DisasterDataProvider { fetchIncident(id?: string): Promise<ProviderRecord<Record<string, unknown>>> }
export interface WeatherDataProvider { fetchWeather(latitude: number, longitude: number): Promise<ProviderRecord<{ windSpeed: number; windDirection: number; temperature: number; humidity: number }>> }
export interface AlertDataProvider { fetchAlerts(): Promise<ProviderRecord<unknown[]>> }
export interface ShelterDataProvider { fetchShelters(): Promise<ProviderRecord<unknown[]>> }
export interface RoadDataProvider { fetchRoads(): Promise<ProviderRecord<unknown[]>> }
export interface AIAnalysisProvider { analyze(payload: unknown): Promise<ProviderRecord<{ summary: string }>> }

const record = <T>(data: T, provider: string): ProviderRecord<T> => { const observedAt = new Date().toISOString(); return { data, provider, sourceType: 'SIMULATED', observedAt, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), stale: false }; };
export const providers = {
  disaster: { fetchIncident: async (_id?: string) => record({ disasterType: 'WILDFIRE', intensity: 72, spreadSpeed: 3.2 }, 'mock-wildfire') } satisfies DisasterDataProvider,
  weather: { fetchWeather: async (_latitude: number, _longitude: number) => record({ windSpeed: 28, windDirection: 70, temperature: 37, humidity: 18 }, 'mock-weather') } satisfies WeatherDataProvider,
  alerts: { fetchAlerts: async () => record([], 'mock-alerts') } satisfies AlertDataProvider,
  shelters: { fetchShelters: async () => record([], 'mock-shelters') } satisfies ShelterDataProvider,
  roads: { fetchRoads: async () => record([], 'mock-roads') } satisfies RoadDataProvider,
  ai: { analyze: async () => record({ summary: 'Mock analysis; operational decisions remain rule-based.' }, 'mock-ai') } satisfies AIAnalysisProvider
};
