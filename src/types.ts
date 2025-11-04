export interface GeoRegion {
  id: string;
  label: string;
  center: {
    lat: number;
    lng: number;
  };
  radiusMeters: number;
  createdAt: string;
}

export interface ArcGisFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    x: number;
    y: number;
    [key: string]: unknown;
  };
}

export interface CachePayload<T> {
  version: number;
  entries: Record<string, T>;
}

export interface FilterRule {
  id: string;
  field: string;
  value: string;
}
