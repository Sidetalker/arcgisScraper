import type { ArcGisFeature, GeoRegion } from '../types';

export const DEFAULT_LAYER_URL =
  'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0';

const DEFAULT_WHERE = '1=1';
const DEFAULT_FIELDS = '*';
const SPATIAL_REL = 'esriSpatialRelIntersects';
const PAGE_SIZE = 1000;

type SpatialReference = {
  wkid: number;
};

type Envelope = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  spatialReference: SpatialReference;
};

interface QueryResponse {
  features: ArcGisFeature[];
  exceededTransferLimit?: boolean;
  error?: {
    message: string;
    details?: string[];
  };
}

export interface QueryOptions {
  layerUrl?: string;
  where?: string;
  outFields?: string;
  includeGeometry?: boolean;
  maxRecords?: number;
  signal?: AbortSignal;
}

function metersPerDegreeLongitude(lat: number) {
  const metersPerDegreeLat = 111_320;
  return metersPerDegreeLat * Math.cos((lat * Math.PI) / 180);
}

export function buildSearchEnvelope({
  center,
  radiusMeters,
}: Pick<GeoRegion, 'center' | 'radiusMeters'>): Envelope {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = metersPerDegreeLongitude(center.lat);

  if (!Number.isFinite(metersPerDegreeLng) || metersPerDegreeLng === 0) {
    throw new Error('Unable to compute longitude delta for the provided latitude.');
  }

  const deltaLat = radiusMeters / metersPerDegreeLat;
  const deltaLng = radiusMeters / metersPerDegreeLng;

  return {
    xmin: center.lng - deltaLng,
    xmax: center.lng + deltaLng,
    ymin: center.lat - deltaLat,
    ymax: center.lat + deltaLat,
    spatialReference: { wkid: 4326 },
  };
}

function normalizeLayerUrl(url: string) {
  return url.replace(/\/$/, '');
}

async function requestPage(
  layerUrl: string,
  envelope: Envelope,
  offset: number,
  pageSize: number,
  options: QueryOptions
): Promise<QueryResponse> {
  const params = new URLSearchParams({
    f: 'json',
    where: options.where ?? DEFAULT_WHERE,
    outFields: options.outFields ?? DEFAULT_FIELDS,
    returnGeometry: options.includeGeometry === false ? 'false' : 'true',
    spatialRel: SPATIAL_REL,
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    resultOffset: offset.toString(),
    resultRecordCount: pageSize.toString(),
    cacheHint: 'true',
  });

  const endpoint = `${normalizeLayerUrl(layerUrl)}/query?${params.toString()}`;
  const response = await fetch(endpoint, { signal: options.signal });

  if (!response.ok) {
    throw new Error(`ArcGIS query failed with status ${response.status}`);
  }

  const payload = (await response.json()) as QueryResponse;

  if (payload.error) {
    throw new Error(payload.error.message ?? 'ArcGIS query returned an error payload.');
  }

  payload.features = payload.features ?? [];
  return payload;
}

export async function fetchFeaturesForRegion(
  region: GeoRegion,
  options: QueryOptions = {}
): Promise<ArcGisFeature[]> {
  const layerUrl = options.layerUrl ?? DEFAULT_LAYER_URL;
  const envelope = buildSearchEnvelope(region);
  const collected: ArcGisFeature[] = [];

  let offset = 0;
  let keepPaging = true;

  while (keepPaging) {
    const desired = options.maxRecords ? options.maxRecords - collected.length : PAGE_SIZE;
    const pageSize = Math.min(PAGE_SIZE, Math.max(desired, 1));
    const payload = await requestPage(layerUrl, envelope, offset, pageSize, options);

    collected.push(...payload.features);

    const reachedLimit = options.maxRecords ? collected.length >= options.maxRecords : false;

    if (reachedLimit) {
      return collected.slice(0, options.maxRecords);
    }

    if (!payload.features.length || payload.features.length < pageSize) {
      keepPaging = false;
    } else if (payload.exceededTransferLimit) {
      offset += payload.features.length;
    } else {
      keepPaging = false;
    }
  }

  return collected;
}
