import crypto from "node:crypto";

export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
export const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, n));
export const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude),
    dLon = rad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
export const severityLevel = (score: number) =>
  score <= 20
    ? "LOW"
    : score <= 40
      ? "MODERATE"
      : score <= 60
        ? "HIGH"
        : score <= 80
          ? "VERY_HIGH"
          : "CRITICAL";
export const priorityLevel = (score: number) =>
  score >= 80
    ? "CRITICAL"
    : score >= 60
      ? "URGENT"
      : score >= 35
        ? "HIGH"
        : score >= 15
          ? "NORMAL"
          : "LOW";
export const log = (
  level: string,
  event: string,
  data: Record<string, unknown> = {},
) => console.log(JSON.stringify({ timestamp: now(), level, event, ...data }));
