import { booleanPointInPolygon } from '@turf/turf';

// Approximate California outline (lng, lat): the Oregon and Nevada borders, the Colorado River,
// the Mexico border, then a line well out in the Pacific. Accurate to a few km on land borders,
// which is enough to drop out-of-state hotspots and reject reports sent from outside the state.
export const CALIFORNIA: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-124.8, 42.0],
      [-120.0, 42.0],
      [-120.0, 39.0],
      [-114.63, 35.0],
      [-114.6, 34.87],
      [-114.14, 34.3],
      [-114.43, 34.08],
      [-114.53, 33.93],
      [-114.5, 33.6],
      [-114.72, 33.4],
      [-114.72, 32.72],
      [-117.12, 32.53],
      [-121.0, 32.53],
      [-125.0, 40.0],
      [-124.8, 42.0],
    ],
  ],
};

export function inCalifornia(lat: number, lng: number) {
  return booleanPointInPolygon([lng, lat], CALIFORNIA);
}
