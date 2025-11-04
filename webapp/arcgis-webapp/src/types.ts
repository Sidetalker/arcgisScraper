import type { ListingTableState } from '@/constants/listingTable';
import type {
  ArcgisFeature as SharedArcgisFeature,
  ListingAttributes as SharedListingAttributes,
  ListingFilters as SharedListingFilters,
  ListingRecord as SharedListingRecord,
  RegionCircle as SharedRegionCircle,
} from '@shared/types';

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

export interface ArcgisFeature<A = Record<string, unknown>, G = QueryGeometry>
  extends SharedArcgisFeature<A, G> {}

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

export type ListingAttributes = SharedListingAttributes;

export type ListingFeatureSet = ArcgisFeatureSet<ListingAttributes>;

export type ListingRecord = SharedListingRecord;

export type ListingFilters = SharedListingFilters;

export type RegionCircle = SharedRegionCircle;

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
