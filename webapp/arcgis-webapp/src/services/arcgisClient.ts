import {
  ArcgisAuthentication,
  ArcgisFeatureSet,
  ArcgisLayerInfo,
  ArcgisQueryFilters,
  EnvelopeGeometry,
  FetchListingsParams,
  ListingFeatureSet,
  QueryGeometry,
  SearchEnvelopeOptions,
} from '@/types';

const DEFAULT_LAYER_URL =
  'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0';
const DEFAULT_PORTAL_URL = 'https://summitcountyco.maps.arcgis.com';
const DEFAULT_REFERER =
  'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/';
const DEFAULT_PAGE_SIZE = 1000;

const layerInfoCache = new Map<string, Promise<ArcgisLayerInfo>>();
const requestCache = new Map<string, Promise<ListingFeatureSet>>();

function normaliseOutFields(filters?: ArcgisQueryFilters): string {
  const outFields = filters?.outFields ?? ['*'];
  if (outFields.length === 0) {
    return '*';
  }
  return outFields.join(',');
}

function inferGeometryType(geometry?: QueryGeometry): string | undefined {
  if (!geometry) {
    return undefined;
  }

  if ('xmin' in geometry && 'xmax' in geometry && 'ymin' in geometry && 'ymax' in geometry) {
    return 'esriGeometryEnvelope';
  }

  const geometryType = (geometry as { geometryType?: string }).geometryType;
  if (typeof geometryType === 'string') {
    return geometryType;
  }

  if ('rings' in geometry) {
    return 'esriGeometryPolygon';
  }

  if ('paths' in geometry) {
    return 'esriGeometryPolyline';
  }

  if ('x' in geometry && 'y' in geometry) {
    return 'esriGeometryPoint';
  }

  return undefined;
}

function ensureSpatialReference(geometry?: QueryGeometry): QueryGeometry | undefined {
  if (!geometry) {
    return geometry;
  }

  const hasSpatialReference = typeof geometry === 'object' && geometry !== null && 'spatialReference' in geometry;
  if (hasSpatialReference) {
    return geometry;
  }

  return {
    ...geometry,
    spatialReference: { wkid: 4326 },
  } as QueryGeometry;
}

const SENSITIVE_PARAM_KEYS = new Set([
  'token',
  'password',
  'client_id',
  'client_secret',
  'username',
]);

function sanitiseParams(params: URLSearchParams): Record<string, string> {
  const entries: Record<string, string> = {};
  params.forEach((value, key) => {
    entries[key] = SENSITIVE_PARAM_KEYS.has(key) ? '<redacted>' : value;
  });
  return entries;
}

async function fetchJson(
  url: string,
  params: URLSearchParams,
  {
    referer,
    signal,
  }: {
    referer: string;
    signal?: AbortSignal;
  },
): Promise<Record<string, unknown>> {
  console.info('[ArcGIS] Sending request', {
    url,
    params: sanitiseParams(params),
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: referer,
    },
    body: params.toString(),
    signal,
  });

  console.info('[ArcGIS] Received response', {
    url,
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[ArcGIS] Request failed', {
      url,
      status: response.status,
      body: text,
    });
    throw new Error(`ArcGIS request failed with status ${response.status}: ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if ('error' in data && data.error) {
    console.error('[ArcGIS] Response error payload', {
      url,
      error: data.error,
    });
    throw new Error(`ArcGIS request error: ${JSON.stringify(data.error)}`);
  }

  console.debug('[ArcGIS] Response payload sample', {
    url,
    keys: Object.keys(data).slice(0, 5),
  });

  return data;
}

async function fetchLayerInfo(
  layerUrl: string,
  referer: string,
  token?: string,
  signal?: AbortSignal,
): Promise<ArcgisLayerInfo> {
  const cacheKey = `${layerUrl}?token=${token ?? ''}`;
  const shouldUseCache = !signal;

  if (shouldUseCache && layerInfoCache.has(cacheKey)) {
    return layerInfoCache.get(cacheKey)!;
  }

  console.info('[ArcGIS] Fetching layer info', {
    layerUrl,
  });
  const params = new URLSearchParams({ f: 'json' });
  if (token) {
    params.set('token', token);
  }

  const promise = fetchJson(layerUrl, params, { referer, signal }).then(
    (data) => data as ArcgisLayerInfo,
  );

  if (shouldUseCache) {
    layerInfoCache.set(cacheKey, promise);
    promise.catch(() => {
      layerInfoCache.delete(cacheKey);
    });
  }

  return promise;
}

async function generateToken(
  authentication: ArcgisAuthentication,
  portalUrl: string,
  referer: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (authentication.token) {
    console.info('[ArcGIS] Using provided token for authentication');
    return authentication.token;
  }

  if (authentication.apiKey) {
    console.info('[ArcGIS] Using provided API key for authentication');
    return authentication.apiKey;
  }

  if (!authentication.username || !authentication.password) {
    console.info('[ArcGIS] No authentication credentials supplied; requesting public data');
    return undefined;
  }

  const tokenUrl = `${portalUrl.replace(/\/?$/, '')}/sharing/rest/generateToken`;
  console.info('[ArcGIS] Generating token via credentials', {
    portalUrl,
  });
  const params = new URLSearchParams({
    f: 'json',
    username: authentication.username,
    password: authentication.password,
    referer,
    expiration: '60',
    client: 'referer',
  });

  const data = await fetchJson(tokenUrl, params, { referer, signal });
  const token = data.token;
  if (typeof token !== 'string') {
    throw new Error('ArcGIS authentication failed: token missing from response');
  }

  return token;
}

function buildQueryParams({
  filters,
  geometry,
  pageSize,
  offset,
  token,
}: {
  filters?: ArcgisQueryFilters;
  geometry?: QueryGeometry;
  pageSize: number;
  offset: number;
  token?: string;
}): URLSearchParams {
  const params = new URLSearchParams({
    f: 'json',
    where: filters?.where ?? '1=1',
    outFields: normaliseOutFields(filters),
    outSR: '4326',
    resultOffset: offset.toString(),
    resultRecordCount: pageSize.toString(),
    returnGeometry: filters?.returnGeometry === false ? 'false' : 'true',
    spatialRel: 'esriSpatialRelIntersects',
  });

  const orderByFields = filters?.orderByFields;
  if (orderByFields?.length) {
    params.set('orderByFields', orderByFields.join(','));
  }

  if (filters?.resultRecordCount) {
    params.set('resultRecordCount', String(filters.resultRecordCount));
  }

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (
        [
          'where',
          'outFields',
          'returnGeometry',
          'orderByFields',
          'resultRecordCount',
          'maxRecords',
        ].includes(key)
      ) {
        continue;
      }
      if (value == null) {
        continue;
      }
      params.set(key, String(value));
    }
  }

  const preparedGeometry = ensureSpatialReference(geometry);
  if (preparedGeometry) {
    const geometryType = inferGeometryType(preparedGeometry) ?? 'esriGeometryEnvelope';
    params.set('geometryType', geometryType);
    params.set('geometry', JSON.stringify(preparedGeometry));

    const spatialReference = (preparedGeometry as {
      spatialReference?: { wkid?: number; latestWkid?: number; wkt?: string };
    }).spatialReference;
    if (spatialReference) {
      if (typeof spatialReference.wkid === 'number') {
        params.set('inSR', String(spatialReference.wkid));
      } else if (typeof spatialReference.latestWkid === 'number') {
        params.set('inSR', String(spatialReference.latestWkid));
      } else if (typeof spatialReference.wkt === 'string' && spatialReference.wkt.trim()) {
        params.set('inSR', JSON.stringify({ wkt: spatialReference.wkt }));
      }
    }
  }

  if (token) {
    params.set('token', token);
  }

  return params;
}

async function queryFeatures(
  layerUrl: string,
  referer: string,
  {
    filters,
    geometry,
    pageSize,
    token,
    maxRecords,
    signal,
  }: {
    filters?: ArcgisQueryFilters;
    geometry?: QueryGeometry;
    pageSize: number;
    token?: string;
    maxRecords?: number;
    signal?: AbortSignal;
  },
): Promise<ListingFeatureSet> {
  let offset = 0;
  const collected: ArcgisFeatureSet['features'] = [];
  let template: Omit<ListingFeatureSet, 'features'> & { features?: ListingFeatureSet['features'] } | undefined;

  while (true) {
    const params = buildQueryParams({ filters, geometry, pageSize, offset, token });
    console.info('[ArcGIS] Querying features', {
      layerUrl,
      offset,
      pageSize,
    });
    const page = (await fetchJson(`${layerUrl}/query`, params, { referer, signal })) as ListingFeatureSet;

    const featureCount = page.features?.length ?? 0;
    console.info('[ArcGIS] Received feature page', {
      layerUrl,
      offset,
      featureCount,
      exceededTransferLimit: page.exceededTransferLimit ?? false,
    });

    if (!template) {
      const { features: _ignored, ...rest } = page;
      template = rest;
    }

    const features = page.features ?? [];
    collected.push(...features);

    if (typeof maxRecords === 'number' && collected.length >= maxRecords) {
      collected.splice(maxRecords);
      template = {
        ...template,
        exceededTransferLimit: true,
      };
      break;
    }

    if (!features.length || features.length < pageSize) {
      template = {
        ...template,
        exceededTransferLimit: page.exceededTransferLimit ?? false,
      };
      break;
    }

    offset += pageSize;
  }

  return {
    ...(template ?? {}),
    features: collected,
  } as ListingFeatureSet;
}

function createCacheKey(args: FetchListingsParams & { token?: string }): string {
  const { geometry, filters, layerUrl, portalUrl, referer, token } = args;
  return JSON.stringify({ geometry, filters, layerUrl, portalUrl, referer, token });
}

async function resolvePageSize(
  layerUrl: string,
  referer: string,
  token?: string,
  filters?: ArcgisQueryFilters,
  signal?: AbortSignal,
): Promise<number> {
  if (filters?.resultRecordCount) {
    return filters.resultRecordCount;
  }

  const info = await fetchLayerInfo(layerUrl, referer, token, signal);
  const maxRecordCount = typeof info.maxRecordCount === 'number' ? info.maxRecordCount : DEFAULT_PAGE_SIZE;
  const maxRecords = filters?.maxRecords;
  if (typeof maxRecords === 'number') {
    return Math.min(maxRecordCount, Math.max(1, maxRecords));
  }

  return maxRecordCount;
}

export function buildSearchEnvelope({
  latitude,
  longitude,
  radiusMeters,
}: SearchEnvelopeOptions): EnvelopeGeometry {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos((latitude * Math.PI) / 180);
  if (!Number.isFinite(metersPerDegreeLng) || metersPerDegreeLng === 0) {
    throw new Error('Unable to compute longitude delta for the provided latitude');
  }

  const deltaLat = radiusMeters / metersPerDegreeLat;
  const deltaLng = radiusMeters / metersPerDegreeLng;

  return {
    xmin: longitude - deltaLng,
    xmax: longitude + deltaLng,
    ymin: latitude - deltaLat,
    ymax: latitude + deltaLat,
    spatialReference: { wkid: 4326 },
  };
}

export async function fetchListings(params: FetchListingsParams = {}): Promise<ListingFeatureSet> {
  const {
    geometry,
    filters,
    authentication = {},
    layerUrl = DEFAULT_LAYER_URL,
    portalUrl = DEFAULT_PORTAL_URL,
    referer = DEFAULT_REFERER,
    signal,
    useCache = true,
  } = params;

  const token = await generateToken(authentication, portalUrl, referer, signal);
  const cacheKey = createCacheKey({ ...params, layerUrl, portalUrl, referer, token });
  const shouldUseCache = useCache && !signal;

  if (shouldUseCache && requestCache.has(cacheKey)) {
    console.info('[ArcGIS] Returning cached listings response', {
      layerUrl,
      portalUrl,
    });
    return requestCache.get(cacheKey)!;
  }

  const promise = (async () => {
    console.info('[ArcGIS] Fetching listings', {
      layerUrl,
      portalUrl,
      geometryType: geometry ? inferGeometryType(geometry) : 'none',
      hasFilters: Boolean(filters),
    });
    const pageSize = await resolvePageSize(layerUrl, referer, token, filters, signal);
    console.info('[ArcGIS] Resolved page size', {
      layerUrl,
      pageSize,
    });
    const result = await queryFeatures(layerUrl, referer, {
      filters,
      geometry,
      pageSize,
      token,
      maxRecords: filters?.maxRecords,
      signal,
    });
    return result;
  })();

  if (shouldUseCache) {
    requestCache.set(cacheKey, promise);
    promise.catch(() => {
      requestCache.delete(cacheKey);
    });
  }

  promise
    .then((featureSet) => {
      console.info('[ArcGIS] Listings request complete', {
        featureCount: featureSet.features?.length ?? 0,
        exceededTransferLimit: featureSet.exceededTransferLimit ?? false,
      });
    })
    .catch((error) => {
      console.error('[ArcGIS] Listings request failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

  return promise;
}

export function clearArcgisCaches(): void {
  layerInfoCache.clear();
  requestCache.clear();
}

export const ArcgisDefaults = {
  layerUrl: DEFAULT_LAYER_URL,
  portalUrl: DEFAULT_PORTAL_URL,
  referer: DEFAULT_REFERER,
};
