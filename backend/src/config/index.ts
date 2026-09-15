import "dotenv/config";
import path from "node:path";

const num = (v: string | undefined, fallback: number) =>
  v ? Number(v) : fallback;
export const config = {
  port: num(process.env.PORT, 4000),
  databasePath:
    process.env.DATABASE_PATH ||
    path.resolve(process.cwd(), "data/rescuermap.db"),
  jwtSecret:
    process.env.JWT_SECRET || "development-only-secret-change-me-32chars",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  // Number of reverse proxies in front of the app (1 on Render). Lets rate limiting see real client IPs.
  trustProxy: num(process.env.TRUST_PROXY, 0),
  corsOrigins: (
    process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173"
  ).split(","),
  providerMode: process.env.PROVIDER_MODE === "real" ? "real" : "mock",
  providerTimeoutMs: num(process.env.PROVIDER_TIMEOUT_MS, 5000),
  intelligenceUrl:
    process.env.INTELLIGENCE_URL ||
    "https://rescuermap-dashboard-rset.onrender.com",
  severityWeights: {
    threat: 0.18,
    population: 0.12,
    requests: 0.15,
    vulnerable: 0.12,
    spread: 0.1,
    weather: 0.08,
    roads: 0.07,
    responderGap: 0.08,
    delays: 0.06,
    shelter: 0.04,
  },
  alertRadiiKm: {
    LOW: 1,
    MODERATE: 3,
    HIGH: 5,
    VERY_HIGH: 8,
    CRITICAL: 15,
  } as Record<string, number>,
};
