import type { Zone } from './types';

// Sample zones around the Santa Cruz Mountains demo center (37.05, -122.05).
// Stand-in for database data until the Supabase layer is wired up.
export const seedZones: Zone[] = [
  {
    id: 'seed-1',
    code: 'SCZ-E014',
    name: 'Boulder Creek',
    population: 3200,
    status: 'warning',
    geom: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.135, 37.115],
          [-122.105, 37.115],
          [-122.105, 37.138],
          [-122.135, 37.138],
          [-122.135, 37.115],
        ],
      ],
    },
  },
  {
    id: 'seed-2',
    code: 'SCZ-E021',
    name: 'Felton',
    population: 2100,
    status: 'advisory',
    geom: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.085, 37.04],
          [-122.06, 37.04],
          [-122.06, 37.062],
          [-122.085, 37.062],
          [-122.085, 37.04],
        ],
      ],
    },
  },
  {
    id: 'seed-3',
    code: 'SCZ-E030',
    name: 'Scotts Valley',
    population: 4700,
    status: 'normal',
    geom: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.03, 37.035],
          [-122.0, 37.035],
          [-122.0, 37.065],
          [-122.03, 37.065],
          [-122.03, 37.035],
        ],
      ],
    },
  },
];
