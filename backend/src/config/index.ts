import 'dotenv/config';
import path from 'node:path';

const num = (v: string | undefined, fallback: number) => v ? Number(v) : fallback;
export const config = {
  port: num(process.env.PORT, 4000),
  databasePath: process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data/rescuermap.db'),
  jwtSecret: process.env.JWT_SECRET || 'development-only-secret-change-me-32chars',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(','),
  severityWeights: { threat: .18, population: .12, requests: .15, vulnerable: .12, spread: .1, weather: .08, roads: .07, responderGap: .08, delays: .06, shelter: .04 },
  alertRadiiKm: { LOW: 1, MODERATE: 3, HIGH: 5, VERY_HIGH: 8, CRITICAL: 15 } as Record<string, number>
};
