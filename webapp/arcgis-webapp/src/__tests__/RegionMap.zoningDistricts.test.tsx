import { describe, expect, it } from 'vitest';

import type { ListingRecord } from '@/types';
import { adjustColorBrightness, computeTopZoningDistricts, DISTRICT_COLORS } from '@/utils/zoningDistricts';

function createListing(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return {
    id: 'listing-1',
    complex: 'Test Complex',
    unit: 'Unit 101',
    ownerName: 'Test Owner',
    ownerNames: ['Test Owner'],
    mailingAddress: '123 Test St',
    mailingAddressLine1: '123 Test St',
    mailingAddressLine2: '',
    mailingCity: 'Test City',
    mailingState: 'CO',
    mailingZip5: '80424',
    mailingZip9: '80424-0000',
    subdivision: 'Test Subdivision',
    scheduleNumber: 'SCH123',
    publicDetailUrl: 'https://example.com',
    physicalAddress: '123 Main St',
    isBusinessOwner: false,
    latitude: 39.5,
    longitude: -106.0,
    zoningDistrict: null,
    estimatedRenewalDate: null,
    estimatedRenewalMethod: null,
    estimatedRenewalReference: null,
    estimatedRenewalCategory: 'missing',
    estimatedRenewalMonthKey: null,
    raw: {},
    ...overrides,
  };
}

describe('computeTopZoningDistricts', () => {
  it('returns the ten most common districts above the threshold', () => {
    const listings: ListingRecord[] = [];

    for (let districtIndex = 0; districtIndex < 12; districtIndex += 1) {
      const count = 101 + districtIndex;
      for (let propertyIndex = 0; propertyIndex < count; propertyIndex += 1) {
        listings.push(
          createListing({
            id: `district-${districtIndex}-${propertyIndex}`,
            zoningDistrict: `District ${districtIndex}`,
          }),
        );
      }
    }

    const districts = computeTopZoningDistricts(listings);
    const entries = Array.from(districts.entries());

    expect(entries).toHaveLength(DISTRICT_COLORS.length);

    // Highest count should appear first, colours should follow palette order
    expect(entries[0]?.[0]).toBe('District 11');
    expect(entries[0]?.[1].count).toBe(112);
    expect(entries[0]?.[1].color).toBe(DISTRICT_COLORS[0]);

    // Lowest qualifying district in the top-ten slice should be District 2
    const lastEntry = entries.at(-1);
    expect(lastEntry?.[0]).toBe('District 2');
    expect(lastEntry?.[1].count).toBe(103);

    entries.forEach(([, info], index) => {
      expect(info.color).toBe(DISTRICT_COLORS[index]);
    });
  });

  it('ignores districts with 100 or fewer properties and missing values', () => {
    const listings: ListingRecord[] = [
      createListing({ id: 'd1', zoningDistrict: 'Included', latitude: 39.6, longitude: -106.1 }),
      createListing({ id: 'd2', zoningDistrict: 'Included', latitude: 39.6, longitude: -106.1 }),
    ];

    // Add 102 properties for one district to meet threshold
    for (let index = 0; index < 100; index += 1) {
      listings.push(
        createListing({
          id: `included-${index}`,
          zoningDistrict: 'Included',
          latitude: 39.6,
          longitude: -106.1,
        }),
      );
    }

    // Add entries that should be ignored
    listings.push(createListing({ id: 'ignored-1', zoningDistrict: 'Ignored', latitude: 39.5 }));
    listings.push(createListing({ id: 'ignored-2', zoningDistrict: '', latitude: 39.5 }));
    listings.push(createListing({ id: 'ignored-3', zoningDistrict: null }));

    const districts = computeTopZoningDistricts(listings);
    expect(districts.size).toBe(1);

    const district = districts.get('Included');
    expect(district?.count).toBe(102);
    expect(district?.color).toBe(DISTRICT_COLORS[0]);
  });

  it('returns an empty map when no listings qualify', () => {
    const listings: ListingRecord[] = [
      createListing({ id: 'a', zoningDistrict: 'Too Small' }),
      createListing({ id: 'b', zoningDistrict: null }),
    ];

    const districts = computeTopZoningDistricts(listings);
    expect(districts.size).toBe(0);
  });
});

describe('adjustColorBrightness', () => {
  it('darkens colours by the requested percentage', () => {
    const darkened = adjustColorBrightness('#3498db', -20);
    expect(darkened).toMatch(/^#[0-9a-f]{6}$/i);
    expect(darkened).not.toBe('#3498db');
  });

  it('brightens colours by the requested percentage', () => {
    const brightened = adjustColorBrightness('#3498db', 20);
    expect(brightened).toMatch(/^#[0-9a-f]{6}$/i);
    expect(brightened).not.toBe('#3498db');
  });

  it('clamps values when the colour is already pure black or white', () => {
    expect(adjustColorBrightness('#000000', -50)).toBe('#000000');
    expect(adjustColorBrightness('#ffffff', 50)).toBe('#ffffff');
  });

  it('returns the original colour when the format is invalid', () => {
    expect(adjustColorBrightness('blue', 10)).toBe('blue');
    expect(adjustColorBrightness('#abc', 10)).toBe('#abc');
  });
});
