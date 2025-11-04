export interface ArcgisGeometry {
  x: number;
  y: number;
}

export interface ArcgisFeature {
  attributes: Record<string, unknown>;
  geometry?: ArcgisGeometry | null;
}

export interface ArcgisField {
  name: string;
  type: string;
  alias?: string;
}

export interface ArcgisResponse {
  features: ArcgisFeature[];
  fields?: ArcgisField[];
}

export interface GeoCircle {
  id: string;
  center: { lat: number; lng: number };
  radiusMeters: number;
}
