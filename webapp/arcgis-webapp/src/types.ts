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

export interface OwnerRecord {
  id: string;
  complex: string;
  unit: string;
  ownerName: string;
  ownerLink: string | null;
  businessOwner: boolean;
  mailingAddress: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip5: string;
  zip9: string;
  subdivision: string;
  scheduleNumber: string;
  publicDetailUrl: string;
  physicalAddress: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  title: string;
  company: string;
  originalZip: string;
  comments: string;
  raw: ListingAttributes;
}

export interface ListingFilters {
  ownerName: string;
  complex: string;
  city: string;
  state: string;
  zip: string;
  subdivision: string;
  scheduleNumber: string;
  unit: string;
  businessType: 'all' | 'business' | 'individual';
}

export interface RegionCircle {
  lat: number;
  lng: number;
  radius: number;
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
