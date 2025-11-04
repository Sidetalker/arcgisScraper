import type { ListingFilters } from '@/types';

export const DEFAULT_PAGE_SIZE = 25;

export const DEFAULT_FILTERS: ListingFilters = {
  searchTerm: '',
  complex: '',
  owner: '',
};
