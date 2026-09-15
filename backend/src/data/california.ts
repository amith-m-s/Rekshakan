import { haversineKm } from "../utils/core.js";

export type Point = { latitude: number; longitude: number };
export type Place = Point & { name: string };

// California towns and cities (approximate centres), used to name and place demo shelters near real incidents
// and to describe incidents created from field reports. Shelter placements are illustrative, not official.
export const CALIFORNIA_TOWNS: Place[] = [
  { name: "Lakeport", latitude: 39.043, longitude: -122.9158 },
  { name: "Clearlake", latitude: 38.9582, longitude: -122.6264 },
  { name: "Middletown", latitude: 38.7524, longitude: -122.615 },
  { name: "Ukiah", latitude: 39.1502, longitude: -123.2078 },
  { name: "Willits", latitude: 39.4096, longitude: -123.3556 },
  { name: "Fort Bragg", latitude: 39.4457, longitude: -123.8053 },
  { name: "Santa Rosa", latitude: 38.4404, longitude: -122.7141 },
  { name: "Napa", latitude: 38.2975, longitude: -122.2869 },
  { name: "Eureka", latitude: 40.8021, longitude: -124.1637 },
  { name: "Redding", latitude: 40.5865, longitude: -122.3917 },
  { name: "Yreka", latitude: 41.7354, longitude: -122.6345 },
  { name: "Susanville", latitude: 40.4163, longitude: -120.653 },
  { name: "Chico", latitude: 39.7285, longitude: -121.8375 },
  { name: "Oroville", latitude: 39.5138, longitude: -121.5564 },
  { name: "Grass Valley", latitude: 39.2191, longitude: -121.0611 },
  { name: "Sacramento", latitude: 38.5816, longitude: -121.4944 },
  { name: "Placerville", latitude: 38.7296, longitude: -120.7985 },
  { name: "Stockton", latitude: 37.9577, longitude: -121.2908 },
  { name: "Modesto", latitude: 37.6391, longitude: -120.9969 },
  { name: "Sonora", latitude: 37.9841, longitude: -120.3822 },
  { name: "Mariposa", latitude: 37.4849, longitude: -119.9663 },
  { name: "Merced", latitude: 37.3022, longitude: -120.483 },
  { name: "San Jose", latitude: 37.3382, longitude: -121.8863 },
  { name: "Santa Cruz", latitude: 36.9741, longitude: -122.0308 },
  { name: "Hollister", latitude: 36.8525, longitude: -121.4016 },
  { name: "Salinas", latitude: 36.6777, longitude: -121.6555 },
  { name: "Monterey", latitude: 36.6002, longitude: -121.8947 },
  { name: "King City", latitude: 36.2127, longitude: -121.1261 },
  { name: "Paso Robles", latitude: 35.6266, longitude: -120.691 },
  { name: "San Luis Obispo", latitude: 35.2828, longitude: -120.6596 },
  { name: "Fresno", latitude: 36.7378, longitude: -119.7871 },
  { name: "Visalia", latitude: 36.3302, longitude: -119.2921 },
  { name: "Bakersfield", latitude: 35.3733, longitude: -119.0187 },
  { name: "Bishop", latitude: 37.3635, longitude: -118.3951 },
  { name: "Santa Barbara", latitude: 34.4208, longitude: -119.6982 },
  { name: "Ventura", latitude: 34.2746, longitude: -119.229 },
  { name: "Thousand Oaks", latitude: 34.1706, longitude: -118.8376 },
  { name: "Malibu", latitude: 34.0259, longitude: -118.7798 },
  { name: "Los Angeles", latitude: 34.0522, longitude: -118.2437 },
  { name: "San Bernardino", latitude: 34.1083, longitude: -117.2898 },
  { name: "Riverside", latitude: 33.9533, longitude: -117.3962 },
  { name: "Ramona", latitude: 33.0417, longitude: -116.8681 },
  { name: "San Diego", latitude: 32.7157, longitude: -117.1611 },
];

// Used when the statewide intelligence dashboard can't be reached while seeding (and in tests).
// Clearly labelled samples at real California places, not live evacuation orders.
export const OFFLINE_SAMPLE_INCIDENTS = [
  {
    county: "Lake",
    code: "SAMPLE-LAKE",
    status: "order",
    notes: "Offline sample: wildfire evacuation order in the hills above Middletown",
    latitude: 38.7524,
    longitude: -122.615,
    radiusKm: 4,
    threatScore: 0.65,
    windKmh: 18,
  },
  {
    county: "Monterey",
    code: "SAMPLE-MONTEREY",
    status: "warning",
    notes: "Offline sample: wildfire evacuation warning along the Big Sur coast",
    latitude: 36.27,
    longitude: -121.81,
    radiusKm: 6,
    threatScore: 0.5,
    windKmh: 22,
  },
  {
    county: "Mendocino",
    code: "SAMPLE-MENDOCINO",
    status: "warning",
    notes: "Offline sample: wildfire evacuation warning near Potter Valley",
    latitude: 39.322,
    longitude: -123.111,
    radiusKm: 5,
    threatScore: 0.45,
    windKmh: 15,
  },
];

// Nearest town at least `minKm` away (so a shelter sits outside the danger area), within `maxKm` if possible.
export function nearestTown(point: Point, minKm = 0, maxKm = Infinity): Place {
  const ranked = CALIFORNIA_TOWNS.map((town) => ({ town, km: haversineKm(point, town) })).sort(
    (a, b) => a.km - b.km,
  );
  return (ranked.find((x) => x.km >= minKm && x.km <= maxKm) ?? ranked[0]).town;
}

// Point `northKm` / `eastKm` from `point`.
export function offsetKm(point: Point, northKm: number, eastKm: number): Point {
  return {
    latitude: point.latitude + northKm / 111.32,
    longitude: point.longitude + eastKm / (111.32 * Math.cos((point.latitude * Math.PI) / 180)),
  };
}
