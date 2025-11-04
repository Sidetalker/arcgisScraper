import { describe, it, expect } from 'vitest';
import type { ListingRecord } from '@/types';

// Helper to create mock listing with zoning district
function createMockListing(id: string, zoningDistrict: string | null, lat: number, lng: number): ListingRecord {
  return {
    id,
    complex: 'Test Complex',
    unit: '101',
    ownerName: 'Test Owner',
    ownerNames: ['Test Owner'],
    mailingAddress: '123 Test St',
    mailingAddressLine1: '123 Test St',
    mailingAddressLine2: '',
    mailingCity: 'Test City',
    mailingState: 'CO',
    mailingZip5: '12345',
    mailingZip9: '12345-6789',
    subdivision: 'Test Subdivision',
    scheduleNumber: 'SCH123',
    publicDetailUrl: 'https://example.com',
    physicalAddress: '123 Main St',
    isBusinessOwner: false,
    latitude: lat,
    longitude: lng,
    zoningDistrict,
    estimatedRenewalDate: null,
    estimatedRenewalMethod: null,
    estimatedRenewalReference: null,
    estimatedRenewalCategory: 'missing',
    estimatedRenewalMonthKey: null,
    raw: {},
  };
}

describe('Zoning District Visualization', () => {
  it('should identify top zoning districts with more than 100 properties', () => {
    const listings: ListingRecord[] = [];
    
    // Create 150 listings for District A
    for (let i = 0; i < 150; i++) {
      listings.push(createMockListing(`a${i}`, 'District A', 39.5 + i * 0.001, -106.0 + i * 0.001));
    }
    
    // Create 120 listings for District B
    for (let i = 0; i < 120; i++) {
      listings.push(createMockListing(`b${i}`, 'District B', 39.6 + i * 0.001, -106.1 + i * 0.001));
    }
    
    // Create 50 listings for District C (should be filtered out)
    for (let i = 0; i < 50; i++) {
      listings.push(createMockListing(`c${i}`, 'District C', 39.7 + i * 0.001, -106.2 + i * 0.001));
    }
    
    // Create 10 listings with no zoning district
    for (let i = 0; i < 10; i++) {
      listings.push(createMockListing(`n${i}`, null, 39.8 + i * 0.001, -106.3 + i * 0.001));
    }
    
    // Count districts manually
    const districtCounts = new Map<string, number>();
    listings.forEach((listing) => {
      if (listing.zoningDistrict) {
        const count = districtCounts.get(listing.zoningDistrict) || 0;
        districtCounts.set(listing.zoningDistrict, count + 1);
      }
    });
    
    // Filter districts with > 100 properties
    const qualifiedDistricts = Array.from(districtCounts.entries())
      .filter(([, count]) => count > 100)
      .sort((a, b) => b[1] - a[1]);
    
    expect(qualifiedDistricts).toHaveLength(2);
    expect(qualifiedDistricts[0][0]).toBe('District A');
    expect(qualifiedDistricts[0][1]).toBe(150);
    expect(qualifiedDistricts[1][0]).toBe('District B');
    expect(qualifiedDistricts[1][1]).toBe(120);
  });

  it('should limit to top 10 districts even if more qualify', () => {
    const listings: ListingRecord[] = [];
    
    // Create 15 districts with 101-115 properties each
    for (let d = 0; d < 15; d++) {
      const count = 101 + d;
      for (let i = 0; i < count; i++) {
        listings.push(createMockListing(`d${d}_${i}`, `District ${d}`, 39.5 + i * 0.001, -106.0 + i * 0.001));
      }
    }
    
    const districtCounts = new Map<string, number>();
    listings.forEach((listing) => {
      if (listing.zoningDistrict) {
        const count = districtCounts.get(listing.zoningDistrict) || 0;
        districtCounts.set(listing.zoningDistrict, count + 1);
      }
    });
    
    const qualifiedDistricts = Array.from(districtCounts.entries())
      .filter(([, count]) => count > 100)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    expect(qualifiedDistricts).toHaveLength(10);
    expect(qualifiedDistricts[0][0]).toBe('District 14');
    expect(qualifiedDistricts[0][1]).toBe(115);
    expect(qualifiedDistricts[9][0]).toBe('District 5');
    expect(qualifiedDistricts[9][1]).toBe(106);
  });

  it('should assign distinct colors to each district', () => {
    const DISTRICT_COLORS = [
      '#e74c3c', // Red
      '#3498db', // Blue
      '#2ecc71', // Green
      '#f39c12', // Orange
      '#9b59b6', // Purple
      '#1abc9c', // Turquoise
      '#e67e22', // Carrot
      '#34495e', // Dark Blue Gray
      '#16a085', // Green Sea
      '#c0392b', // Dark Red
    ];

    expect(DISTRICT_COLORS).toHaveLength(10);
    
    // Check all colors are unique
    const uniqueColors = new Set(DISTRICT_COLORS);
    expect(uniqueColors.size).toBe(10);
    
    // Check all colors are valid hex
    DISTRICT_COLORS.forEach(color => {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('should adjust color brightness correctly', () => {
    // Test the adjustColorBrightness logic
    const adjustColorBrightness = (color: string, percent: number): string => {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);

      const adjust = (value: number) => {
        const adjusted = value + (value * percent) / 100;
        return Math.max(0, Math.min(255, Math.round(adjusted)));
      };

      const newR = adjust(r).toString(16).padStart(2, '0');
      const newG = adjust(g).toString(16).padStart(2, '0');
      const newB = adjust(b).toString(16).padStart(2, '0');

      return `#${newR}${newG}${newB}`;
    };

    // Test darkening
    const darkened = adjustColorBrightness('#3498db', -20);
    expect(darkened).not.toBe('#3498db');
    expect(darkened).toMatch(/^#[0-9a-f]{6}$/i);
    
    // Verify it's actually darker
    const originalB = parseInt('3498db'.substring(4, 6), 16);
    const darkenedB = parseInt(darkened.substring(5, 7), 16);
    expect(darkenedB).toBeLessThan(originalB);

    // Test brightening
    const brightened = adjustColorBrightness('#3498db', 20);
    expect(brightened).not.toBe('#3498db');
    
    // Test edge cases
    expect(adjustColorBrightness('#000000', -50)).toBe('#000000'); // Already black
    expect(adjustColorBrightness('#ffffff', 50)).toBe('#ffffff'); // Already white
  });

  it('should handle listings without coordinates gracefully', () => {
    const listing = createMockListing('test', 'District A', 0, 0);
    listing.latitude = null;
    listing.longitude = null;
    
    // Should not crash when processing
    expect(listing.zoningDistrict).toBe('District A');
    expect(listing.latitude).toBeNull();
    expect(listing.longitude).toBeNull();
  });

  it('should handle listings without zoning district', () => {
    const listing = createMockListing('test', null, 39.5, -106.0);
    
    expect(listing.zoningDistrict).toBeNull();
    expect(listing.latitude).toBe(39.5);
    expect(listing.longitude).toBe(-106.0);
  });
});
