import { config } from "../../config/index.js";
import { log } from "../../utils/core.js";
import { realProviders } from "./real.js";

export type SourceType =
  "OFFICIAL" | "COMMUNITY" | "SYSTEM_GENERATED" | "SIMULATED";
export type ProviderRecord<T> = {
  data: T;
  sourceType: SourceType;
  observedAt: string;
  expiresAt: string;
  stale: boolean;
  provider: string;
};
export interface DisasterDataProvider {
  fetchIncident(
    query?: string,
  ): Promise<ProviderRecord<Record<string, unknown>>>;
}
export interface WeatherDataProvider {
  fetchWeather(
    latitude: number,
    longitude: number,
  ): Promise<
    ProviderRecord<{
      windSpeed: number;
      windDirection: number;
      temperature: number;
      humidity: number;
    }>
  >;
}
export interface AlertDataProvider {
  fetchAlerts(): Promise<ProviderRecord<unknown[]>>;
}
export interface ShelterDataProvider {
  fetchShelters(): Promise<ProviderRecord<unknown[]>>;
}
export interface RoadDataProvider {
  fetchRoads(from?: string, to?: string): Promise<ProviderRecord<unknown[]>>;
}
export interface GeocodingProvider {
  geocode(
    query: string,
  ): Promise<ProviderRecord<{ latitude: number; longitude: number }>>;
}
export interface AIAnalysisProvider {
  analyze(payload: unknown): Promise<
    ProviderRecord<{
      summary: string;
      draft?: boolean;
      approvalRequired?: boolean;
    }>
  >;
}

type CacheEntry = { record: ProviderRecord<any> };
const cache = new Map<string, CacheEntry>();
const health = new Map<
  string,
  {
    status: "up" | "degraded" | "down" | "unknown";
    lastSuccess?: string;
    lastFailure?: string;
    error?: string;
  }
>();

function record<T>(
  data: T,
  provider: string,
  sourceType: SourceType,
  ttlMs = 15 * 60_000,
): ProviderRecord<T> {
  const observedAt = new Date().toISOString();
  return {
    data,
    provider,
    sourceType,
    observedAt,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    stale: false,
  };
}

export async function resilientFetch<T>(
  key: string,
  provider: string,
  sourceType: SourceType,
  loader: () => Promise<T>,
  ttlMs = 15 * 60_000,
): Promise<ProviderRecord<T>> {
  const healthKey = key.split(":", 1)[0];
  try {
    const result = record(await loader(), provider, sourceType, ttlMs);
    cache.set(key, { record: result });
    health.set(healthKey, { status: "up", lastSuccess: result.observedAt });
    return result;
  } catch (error: any) {
    const failedAt = new Date().toISOString(),
      cached = cache.get(key)?.record as ProviderRecord<T> | undefined;
    health.set(healthKey, {
      status: cached ? "degraded" : "down",
      lastFailure: failedAt,
      error: error.message,
    });
    log("error", "provider_failure", {
      provider,
      key,
      error: error.message,
      usingStaleCache: !!cached,
    });
    if (cached) return { ...cached, stale: true };
    throw Object.assign(
      new Error(`${provider} unavailable and no cached data exists`),
      { status: 503, code: "PROVIDER_UNAVAILABLE" },
    );
  }
}

const mock = {
  disaster: async () => ({
    disasterType: "WILDFIRE",
    intensity: 72,
    spreadSpeed: 3.2,
  }),
  weather: async () => ({
    windSpeed: 28,
    windDirection: 70,
    temperature: 37,
    humidity: 18,
  }),
  alerts: async () => [] as unknown[],
  shelters: async () => [] as unknown[],
  roads: async () => [] as unknown[],
  // Middletown, Lake County, California.
  geocoding: async () => ({ latitude: 38.7524, longitude: -122.615 }),
  ai: async () => ({
    summary: "Mock draft analysis; operational decisions remain rule-based.",
    draft: true,
    approvalRequired: true,
  }),
};
const real = config.providerMode === "real";

export const providers = {
  simulator: {
    fetchIncident: (query?: string) =>
      resilientFetch<Record<string, unknown>>(
        `simulator:${query || "default"}`,
        "simulator-wildfire",
        "SIMULATED",
        mock.disaster,
      ),
  } satisfies DisasterDataProvider,
  disaster: {
    fetchIncident: (query?: string) =>
      resilientFetch<Record<string, unknown>>(
        `disaster:${query || "default"}`,
        real ? "nasa-firms" : "mock-wildfire",
        real ? "OFFICIAL" : "SIMULATED",
        async () =>
          real ? realProviders.disaster.fetchIncident(query) : mock.disaster(),
      ),
  } satisfies DisasterDataProvider,
  weather: {
    fetchWeather: (latitude: number, longitude: number) =>
      resilientFetch(
        `weather:${latitude.toFixed(3)}:${longitude.toFixed(3)}`,
        real ? "open-meteo" : "mock-weather",
        real ? "OFFICIAL" : "SIMULATED",
        () =>
          real
            ? realProviders.weather.fetchWeather(latitude, longitude)
            : mock.weather(),
        5 * 60_000,
      ),
  } satisfies WeatherDataProvider,
  alerts: {
    fetchAlerts: () =>
      resilientFetch("alerts", "mock-alerts", "SIMULATED", mock.alerts),
  } satisfies AlertDataProvider,
  shelters: {
    fetchShelters: () =>
      resilientFetch("shelters", "mock-shelters", "SIMULATED", mock.shelters),
  } satisfies ShelterDataProvider,
  roads: {
    fetchRoads: (from?: string, to?: string) =>
      resilientFetch(
        `roads:${from || ""}:${to || ""}`,
        real ? "osrm" : "mock-roads",
        real ? "OFFICIAL" : "SIMULATED",
        () => (real ? realProviders.roads.fetchRoads(from, to) : mock.roads()),
        5 * 60_000,
      ),
  } satisfies RoadDataProvider,
  geocoding: {
    geocode: (query: string) =>
      resilientFetch(
        `geocode:${query.toLowerCase()}`,
        real ? "nominatim" : "mock-geocoding",
        real ? "OFFICIAL" : "SIMULATED",
        () =>
          real ? realProviders.geocoding.geocode(query) : mock.geocoding(),
        24 * 60 * 60_000,
      ),
  } satisfies GeocodingProvider,
  ai: {
    analyze: (payload: unknown) =>
      resilientFetch(
        `ai:${JSON.stringify(payload)}`,
        real ? "groq" : "mock-ai",
        "SYSTEM_GENERATED",
        () => (real ? realProviders.ai.analyze(payload) : mock.ai()),
      ),
  } satisfies AIAnalysisProvider,
};

export function providerHealth() {
  return Object.fromEntries(
    [
      "disaster",
      "weather",
      "alerts",
      "shelters",
      "roads",
      "geocoding",
      "ai",
    ].map((key) => [key, health.get(key) || { status: "unknown" }]),
  );
}

export async function warmProviders() {
  await Promise.allSettled([
    providers.disaster.fetchIncident(),
    providers.weather.fetchWeather(0, 0),
    providers.alerts.fetchAlerts(),
    providers.shelters.fetchShelters(),
    providers.roads.fetchRoads(),
  ]);
}

export function clearProviderCache() {
  cache.clear();
  health.clear();
}
