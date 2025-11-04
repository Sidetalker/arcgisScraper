import { describe, it, expect } from 'vitest';

import {
  canToggleShowAll,
  resolveDisplayedListings,
  shouldForceShowAllOff,
} from '@/components/RegionMap';

describe('resolveDisplayedListings', () => {
  it('returns all listings when showAllProperties is true', () => {
    const showAllProperties = true;
    const allListings = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const listings = [{ id: '1' }];

    const displayedListings = resolveDisplayedListings(showAllProperties, allListings, listings);

    expect(displayedListings).toEqual(allListings);
  });

  it('falls back to region-filtered listings when showAllProperties is false', () => {
    const showAllProperties = false;
    const allListings = [{ id: '1' }, { id: '2' }];
    const listings = [{ id: '2' }];

    const displayedListings = resolveDisplayedListings(showAllProperties, allListings, listings);

    expect(displayedListings).toEqual(listings);
  });

  it('gracefully falls back to region listings when the cache of all listings is empty', () => {
    const showAllProperties = true;
    const allListings: Array<{ id: string }> = [];
    const listings = [{ id: '1' }, { id: '2' }];

    const displayedListings = resolveDisplayedListings(showAllProperties, allListings, listings);

    expect(displayedListings).toEqual(listings);
  });
});

describe('shouldForceShowAllOff', () => {
  it('returns false when showAllProperties is disabled', () => {
    expect(shouldForceShowAllOff(false, 0)).toBe(false);
  });

  it('returns false when listings are available', () => {
    expect(shouldForceShowAllOff(true, 3)).toBe(false);
  });

  it('returns true when the toggle is on but there are no listings to display', () => {
    expect(shouldForceShowAllOff(true, 0)).toBe(true);
  });
});

describe('canToggleShowAll', () => {
  it('allows the toggle when at least one listing exists', () => {
    expect(canToggleShowAll(1)).toBe(true);
  });

  it('disables the toggle when there are no listings', () => {
    expect(canToggleShowAll(0)).toBe(false);
  });
});
