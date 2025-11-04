import type { ListingRecord } from '@/types';

export type ZoningDistrictInfo = {
  name: string;
  count: number;
  color: string;
};

export type ZoningDistrictMap = Map<string, ZoningDistrictInfo>;

export const DISTRICT_COLORS: readonly string[] = [
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

export const DEFAULT_MARKER_COLOR = '#3b82f6';

export function computeTopZoningDistricts(listings: ListingRecord[]): ZoningDistrictMap {
  const districtCounts = new Map<string, number>();

  for (const listing of listings) {
    const district = listing.zoningDistrict?.trim();
    if (!district) {
      continue;
    }

    districtCounts.set(district, (districtCounts.get(district) ?? 0) + 1);
  }

  const topDistricts = Array.from(districtCounts.entries())
    .filter(([, count]) => count > 100)
    .sort((a, b) => b[1] - a[1])
    .slice(0, DISTRICT_COLORS.length)
    .map(([name, count], index) => [
      name,
      {
        name,
        count,
        color: DISTRICT_COLORS[index] ?? DISTRICT_COLORS[0]!,
      },
    ] as const);

  return new Map(topDistricts);
}

export function adjustColorBrightness(color: string, percent: number): string {
  const hex = color.replace('#', '').trim();

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return color;
  }

  const clampPercent = Math.max(-100, Math.min(100, percent));

  const adjust = (value: number) => {
    const adjusted = value + (value * clampPercent) / 100;
    return Math.max(0, Math.min(255, Math.round(adjusted)));
  };

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const newR = adjust(r).toString(16).padStart(2, '0');
  const newG = adjust(g).toString(16).padStart(2, '0');
  const newB = adjust(b).toString(16).padStart(2, '0');

  return `#${newR}${newG}${newB}`;
}
