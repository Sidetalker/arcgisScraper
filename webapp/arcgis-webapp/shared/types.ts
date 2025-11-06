export interface ArcgisFeature<A = Record<string, unknown>, G = Record<string, unknown>> {
  attributes: A;
  geometry?: G;
}

export type ListingAttributes = Record<string, string | number | boolean | null>;

export interface MunicipalLicenseSummary {
  municipality: string;
  licenseId: string;
  status: string;
  normalizedStatus: string;
  expirationDate: string | null;
  detailUrl: string | null;
  sourceUpdatedAt: string | null;
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
  isBusinessOwner: boolean;
  latitude: number | null;
  longitude: number | null;
  municipalMunicipality: string | null;
  municipalLicenseId: string | null;
  municipalLicenseStatus: string | null;
  municipalLicenseNormalizedStatus: string | null;
  municipalLicenseExpiration: string | null;
  municipalLicenses: MunicipalLicenseSummary[];
  raw: ListingAttributes;
}

export interface ListingFilters {
  searchTerm: string;
  complex: string;
  owner: string;
  zones: string[];
  subdivisions: string[];
  municipalities: string[];
  renewalCategories: string[];
  renewalMethods: string[];
  renewalMonths: string[];
  maxEvDistanceMiles: number | null;
}

export interface RegionCircle {
  lat: number;
  lng: number;
  radius: number;
}

