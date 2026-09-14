export type ZoneStatus = 'normal' | 'advisory' | 'warning' | 'order' | 'repopulation';

export interface Zone {
  id: string;
  code: string;
  name: string;
  population: number;
  status: ZoneStatus;
  geom: GeoJSON.Polygon;
}

export interface Fire {
  latitude: string;
  longitude: string;
  frp: string;
  acq_date: string;
  acq_time: string;
  [key: string]: string;
}

export interface Wind {
  speed: number;
  direction: number;
}
