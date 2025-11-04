import type { ListingTableState } from '@/constants/listingTable';

export interface SpatialReference {
  wkid?: number;
  latestWkid?: number;
  [key: string]: unknown;
}

export interface EnvelopeGeometry {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  spatialReference?: SpatialReference;
  [key: string]: unknown;
}

export type QueryGeometry = EnvelopeGeometry | Record<string, unknown>;

export interface ArcgisField {
  name: string;
  type: string;
  alias: string;
  length?: number;
  [key: string]: unknown;
}

export interface ArcgisFeature<A = Record<string, unknown>, G = QueryGeometry> {
  attributes: A;
  geometry?: G;
}

export interface ArcgisFeatureSet<A = Record<string, unknown>, G = QueryGeometry> {
  objectIdFieldName?: string;
  globalIdFieldName?: string;
  displayFieldName?: string;
  geometryType?: string;
  spatialReference?: SpatialReference;
  fields?: ArcgisField[];
  features: Array<ArcgisFeature<A, G>>;
  exceededTransferLimit?: boolean;
  [key: string]: unknown;
}

export type ListingAttributes = Record<string, string | number | boolean | null>;

export interface ListingFeatureSet extends ArcgisFeatureSet<ListingAttributes> {
  layerUrl?: string;
  layerPresetId?: string | null;
}

export interface ListingRecord {
  id: string;
  complex: string;
  unit: string;
  ownerName: string;
  ownerNames: string[];
  mailingAddress: string;
  mailingAddressLine1: string;
  mailingAddressLine2: string;
  mailingCity: string;
  mailingState: string;
  mailingZip5: string;
  mailingZip9: string;
  subdivision: string;
  scheduleNumber: string;
  publicDetailUrl: string;
  physicalAddress: string;
  townName: string;
  zoneName: string;
  zoningType: string;
  briefPropertyDescription: string;
  situsAddressTypeDescription: string;
  isBusinessOwner: boolean;
  latitude: number | null;
  longitude: number | null;
  raw: ListingAttributes;
  sourceLayerUrl: string | null;
  sourcePresetId: string | null;
}

export interface ListingFilters {
  searchTerm: string;
  complex: string;
  owner: string;
}

export interface RegionCircle {
  lat: number;
  lng: number;
  radius: number;
}

export interface ConfigurationProfile {
  id: string;
  name: string;
  filters: ListingFilters;
  regions: RegionCircle[];
  table: ListingTableState;
  updatedAt: Date | null;
}

export interface ArcgisLayerInfo {
  id?: number;
  name?: string;
  maxRecordCount?: number;
  [key: string]: unknown;
}

export interface ArcgisQueryFilters {
  where?: string;
  outFields?: string[];
  returnGeometry?: boolean;
  orderByFields?: string[];
  resultRecordCount?: number;
  maxRecords?: number;
  [key: string]: unknown;
}

export interface ArcgisAuthentication {
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface FetchListingsParams {
  geometry?: QueryGeometry;
  filters?: ArcgisQueryFilters;
  authentication?: ArcgisAuthentication;
  layerUrl?: string;
  layerPresetId?: string;
  portalUrl?: string;
  referer?: string;
  signal?: AbortSignal;
  useCache?: boolean;
}

export interface SearchEnvelopeOptions {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}
