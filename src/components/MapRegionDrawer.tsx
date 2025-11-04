import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FeatureGroup, MapContainer, TileLayer } from 'react-leaflet';
import type { Circle, FeatureGroup as LeafletFeatureGroup, LayerGroup, LeafletEvent } from 'leaflet';
import L from 'leaflet';
import { EditControl } from 'react-leaflet-draw';

import type { GeoRegion } from '../types';

interface MapRegionDrawerProps {
  regions: GeoRegion[];
  onRegionsChange: (regions: GeoRegion[]) => void;
}

const SUMMIT_COUNTY_CENTER = { lat: 39.603761, lng: -106.062881 };

function createRegionLabel(index: number) {
  return `Region ${index}`;
}

function createRegionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `region-${Math.random().toString(36).slice(2, 10)}`;
}

export function MapRegionDrawer({ regions, onRegionsChange }: MapRegionDrawerProps) {
  const featureGroupRef = useRef<LeafletFeatureGroup | null>(null);

  const center = useMemo(() => {
    if (regions.length > 0) {
      return regions[regions.length - 1].center;
    }
    return SUMMIT_COUNTY_CENTER;
  }, [regions]);

  useEffect(() => {
    const featureGroup = featureGroupRef.current;
    if (!featureGroup) {
      return;
    }

    featureGroup.clearLayers();

    regions.forEach((region) => {
      const circle = L.circle([region.center.lat, region.center.lng], {
        radius: region.radiusMeters,
        color: '#2563eb',
        weight: 2,
        fillOpacity: 0.15,
        fillColor: '#3b82f6',
      });
      (circle as L.Circle & { regionId?: string }).regionId = region.id;
      circle.addTo(featureGroup);
    });
  }, [regions]);

  const handleCreated = useCallback(
    (event: LeafletEvent & { layer: Circle }) => {
      const layer = event.layer;
      const latLng = layer.getLatLng();
      const radius = layer.getRadius();
      const region: GeoRegion = {
        id: createRegionId(),
        label: createRegionLabel(regions.length + 1),
        center: {
          lat: latLng.lat,
          lng: latLng.lng,
        },
        radiusMeters: radius,
        createdAt: new Date().toISOString(),
      };

      onRegionsChange([...regions, region]);
    },
    [onRegionsChange, regions]
  );

  const handleEdited = useCallback(
    (event: LeafletEvent & { layers: LayerGroup<Circle> }) => {
      const updates = new Map<string, GeoRegion>();
      event.layers.eachLayer((layer) => {
        const circle = layer as Circle;
        const regionId = (circle as L.Circle & { regionId?: string }).regionId;
        if (!regionId) {
          return;
        }
        const latLng = circle.getLatLng();
        updates.set(regionId, {
          id: regionId,
          label: regions.find((region) => region.id === regionId)?.label ?? regionId,
          center: {
            lat: latLng.lat,
            lng: latLng.lng,
          },
          radiusMeters: circle.getRadius(),
          createdAt: regions.find((region) => region.id === regionId)?.createdAt ?? new Date().toISOString(),
        });
      });

      if (updates.size === 0) {
        return;
      }

      const nextRegions = regions.map((region) => updates.get(region.id) ?? region);
      onRegionsChange(nextRegions);
    },
    [onRegionsChange, regions]
  );

  const handleDeleted = useCallback(
    (event: LeafletEvent & { layers: LayerGroup<Circle> }) => {
      const removedIds = new Set<string>();
      event.layers.eachLayer((layer) => {
        const circle = layer as Circle;
        const regionId = (circle as L.Circle & { regionId?: string }).regionId;
        if (regionId) {
          removedIds.add(regionId);
        }
      });

      if (removedIds.size === 0) {
        return;
      }

      onRegionsChange(regions.filter((region) => !removedIds.has(region.id)));
    },
    [onRegionsChange, regions]
  );

  return (
    <MapContainer center={center} zoom={12} className="map-container">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FeatureGroup ref={(group) => (featureGroupRef.current = group)}>
        <EditControl
          position="topright"
          draw={{
            rectangle: false,
            polyline: false,
            polygon: false,
            marker: false,
            circlemarker: false,
            circle: {
              shapeOptions: {
                color: '#2563eb',
                fillOpacity: 0.1,
                weight: 2,
              },
            },
          }}
          edit={{
            edit: true,
            remove: true,
          }}
          onCreated={handleCreated}
          onEdited={handleEdited}
          onDeleted={handleDeleted}
        />
      </FeatureGroup>
    </MapContainer>
  );
}
