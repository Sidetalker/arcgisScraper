import type { GeoRegion } from '../types';

interface RegionListProps {
  regions: GeoRegion[];
  loadingRegionIds: string[];
  onRemoveRegion: (id: string) => void;
}

function formatRadius(radiusMeters: number) {
  if (radiusMeters >= 1000) {
    return `${(radiusMeters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(radiusMeters)} m`;
}

export function RegionList({ regions, loadingRegionIds, onRemoveRegion }: RegionListProps) {
  if (regions.length === 0) {
    return <div className="empty-state">Draw search regions on the map to begin collecting data.</div>;
  }

  return (
    <div className="region-list">
      {regions.map((region) => {
        const isLoading = loadingRegionIds.includes(region.id);
        return (
          <div key={region.id} className="region-card">
            <div>
              <strong>{region.label}</strong>
              <div>
                <span>
                  {region.center.lat.toFixed(5)}, {region.center.lng.toFixed(5)}
                </span>
                <span style={{ marginLeft: '0.5rem' }}>• Radius {formatRadius(region.radiusMeters)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {isLoading ? <span className="status-pill">Loading…</span> : null}
              <button className="secondary-button" type="button" onClick={() => onRemoveRegion(region.id)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
