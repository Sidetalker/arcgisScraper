export interface ArcgisFeature<A = Record<string, unknown>, G = Record<string, unknown>> {
  attributes: A;
  geometry?: G;
}

export type ListingAttributes = Record<string, string | number | boolean | null>;

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
  raw: ListingAttributes;
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

export type MailingListExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface MailingListExportJobPayload {
  id: string;
  status: MailingListExportStatus;
  downloadUrls?: {
    csv?: string | null;
    xlsx?: string | null;
  } | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}
