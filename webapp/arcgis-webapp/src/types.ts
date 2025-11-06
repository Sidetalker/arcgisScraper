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

export type ListingFeatureSet = ArcgisFeatureSet<ListingAttributes>;

export type RenewalCategory = 'overdue' | 'due_30' | 'due_60' | 'due_90' | 'future' | 'missing';

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
  zone: string;
  scheduleNumber: string;
  publicDetailUrl: string;
  physicalAddress: string;
  isBusinessOwner: boolean;
  isFavorited: boolean;
  latitude: number | null;
  longitude: number | null;
  estimatedRenewalDate: Date | null;
  estimatedRenewalMethod: string | null;
  estimatedRenewalReference: Date | null;
  estimatedRenewalCategory: RenewalCategory;
  estimatedRenewalMonthKey: string | null;
  raw: ListingAttributes;
}

export interface ListingFilters {
  searchTerm: string;
  complex: string;
  owner: string;
  zones: string[];
  subdivisions: string[];
  renewalCategories: string[];
  renewalMethods: string[];
  renewalMonths: string[];
}

export interface RegionPoint {
  lat: number;
  lng: number;
}

export interface RegionPoint {
  lat: number;
  lng: number;
}

export interface RegionCircle {
  type: 'circle';
  lat: number;
  lng: number;
  radius: number;
}

export interface RegionPolygon {
  type: 'polygon';
  points: RegionPoint[];
}

export type RegionShape = RegionCircle | RegionPolygon;

export interface ConfigurationProfile {
  id: string;
  name: string;
  filters: ListingFilters;
  regions: RegionShape[];
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
