import { ReactElement, useState } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ListingTable from '@/components/ListingTable';
import type { ListingRecord } from '@/types';
import type { ListingTableSort } from '@/constants/listingTable';
import { createDefaultColumnFilters } from '@/constants/listingTable';
import { describe, it, expect, vi } from 'vitest';

function makeListing(id: string, complex: string): ListingRecord {
  return {
    id,
    complex,
    unit: '',
    unitNormalized: '',
    ownerName: '',
    ownerNames: [],
    mailingAddress: '',
    mailingAddressLine1: '',
    mailingAddressLine2: '',
    mailingCity: '',
    mailingState: '',
    mailingZip5: '',
    mailingZip9: '',
    subdivision: '',
    zone: '',
    scheduleNumber: '',
    publicDetailUrl: '',
    physicalAddress: '',
    isBusinessOwner: false,
    isFavorited: false,
    hasCustomizations: false,
    latitude: null,
    longitude: null,
    estimatedRenewalDate: null,
    estimatedRenewalMethod: null,
    estimatedRenewalReference: null,
    estimatedRenewalCategory: 'future',
    estimatedRenewalMonthKey: null,
    strLicenseId: null,
    strLicenseStatus: null,
    strLicenseStatusNormalized: 'unknown',
    strLicenseUpdatedAt: null,
    waitlistType: null,
    waitlistPosition: null,
    raw: {},
    sourceOfTruth: null,
  };
}

const listings: ListingRecord[] = [makeListing('1', 'B Complex'), makeListing('2', 'A Complex')];

function Harness(): ReactElement {
  const [sort, setSort] = useState<ListingTableSort | null>(null);
  return (
    <MemoryRouter>
      <ListingTable
        listings={listings}
        pageSize={50}
        currentPage={1}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        isLoading={false}
        columnOrder={['complex']}
        hiddenColumns={[]}
  columnFilters={createDefaultColumnFilters()}
        sort={sort}
        onSortChange={setSort}
        onColumnOrderChange={vi.fn()}
        onHiddenColumnsChange={vi.fn()}
        onColumnFiltersChange={vi.fn()}
        onFavoriteChange={vi.fn()}
        canToggleFavorites={true}
        onListingEdit={vi.fn()}
        onListingRevert={vi.fn()}
        canEditListings={false}
      />
    </MemoryRouter>
  );
}

function getVisibleComplexOrder(container: HTMLElement): string[] {
  const rows = Array.from(container.querySelectorAll('tbody tr.listing-table__row'));
  return rows.map((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    // Favorite + details are first two cells; complex starts at index 2
    return cells[2]?.textContent?.trim() || '';
  });
}

describe('ListingTable sorting', () => {
  it('cycles through asc, desc, none for Complex column and updates order', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    // Initial (unsorted) order reflects input array
    expect(getVisibleComplexOrder(container)).toEqual(['B Complex', 'A Complex']);

    // Click to sort ascending
    const sortButton = container.querySelector('button.listing-table__sort-button');
    expect(sortButton).toBeTruthy();
    await user.click(sortButton!);
    expect(getVisibleComplexOrder(container)).toEqual(['A Complex', 'B Complex']);

    // Click to sort descending
    await user.click(sortButton!);
    expect(getVisibleComplexOrder(container)).toEqual(['B Complex', 'A Complex']);

    // Click to clear sort (back to original input order)
    await user.click(sortButton!);
    expect(getVisibleComplexOrder(container)).toEqual(['B Complex', 'A Complex']);
  });
});
