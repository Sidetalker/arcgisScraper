export interface ArcgisGeometry {
  x: number;
  y: number;
}

export interface ArcgisFeature {
  attributes: Record<string, unknown>;
  geometry?: ArcgisGeometry | null;
}

export interface ArcgisResponse {
  features: ArcgisFeature[];
  fields?: Array<{ name: string; type: string }>;
}

export interface GeoCircle {
  id: string;
  center: { lat: number; lng: number };
  radiusMeters: number;
}
