import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';

import type { RegionCircle } from '@/types';

import './RegionMap.css';

type RegionMapProps = {
  regions: RegionCircle[];
  onRegionsChange: (regions: RegionCircle[]) => void;
  pinRegion: RegionCircle | null;
  onPinRegionChange: (region: RegionCircle | null) => void;
  pinDropActive: boolean;
  pinDropRequestId: number;
  onPinDropComplete: () => void;
  defaultPinRadius?: number;
};

const DEFAULT_CENTER: [number, number] = [39.6, -106.07];
const DEFAULT_ZOOM = 10;
const DEFAULT_PIN_RADIUS_FALLBACK = 750;

function toRegionCircle(layer: L.Circle): RegionCircle {
  const center = layer.getLatLng();
  return {
    lat: center.lat,
    lng: center.lng,
    radius: layer.getRadius(),
  };
}

function collectRegions(featureGroup: L.FeatureGroup): RegionCircle[] {
  const results: RegionCircle[] = [];
  featureGroup.eachLayer((layer) => {
    if (layer instanceof L.Circle) {
      results.push(toRegionCircle(layer));
    }
  });
  return results;
}

function DrawManager({ regions, onRegionsChange }: Pick<RegionMapProps, 'regions' | 'onRegionsChange'>): null {
  const map = useMap();
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const drawControlRef = useRef<L.Control.Draw | null>(null);
  const previousCountRef = useRef(0);

  const initialiseLayers = useCallback(() => {
    if (!featureGroupRef.current) {
      featureGroupRef.current = new L.FeatureGroup();
      map.addLayer(featureGroupRef.current);
    }

    if (!drawControlRef.current && featureGroupRef.current) {
      drawControlRef.current = new L.Control.Draw({
        edit: {
          featureGroup: featureGroupRef.current,
        },
        draw: {
          circle: {
            shapeOptions: {
              color: '#2563eb',
              fillColor: '#3b82f6',
              fillOpacity: 0.2,
              weight: 2,
            },
          },
          polygon: false,
          polyline: false,
          rectangle: false,
          marker: false,
          circlemarker: false,
        },
      });
      map.addControl(drawControlRef.current);
    }
  }, [map]);

  const teardown = useCallback(() => {
    if (drawControlRef.current) {
      map.removeControl(drawControlRef.current);
      drawControlRef.current = null;
    }

    if (featureGroupRef.current) {
      map.removeLayer(featureGroupRef.current);
      featureGroupRef.current = null;
    }
  }, [map]);

  useEffect(() => {
    initialiseLayers();

    const handleCreated = (event: L.DrawEvents.Created) => {
      if (!featureGroupRef.current) {
        return;
      }

      const layer = event.layer;
      if (layer instanceof L.Circle) {
        featureGroupRef.current.addLayer(layer);
        onRegionsChange(collectRegions(featureGroupRef.current));
      }
    };

    const handleEdited = () => {
      if (!featureGroupRef.current) {
        return;
      }
      onRegionsChange(collectRegions(featureGroupRef.current));
    };

    const handleDeleted = () => {
      if (!featureGroupRef.current) {
        return;
      }
      onRegionsChange(collectRegions(featureGroupRef.current));
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, handleEdited);
    map.on(L.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, handleEdited);
      map.off(L.Draw.Event.DELETED, handleDeleted);
      teardown();
    };
  }, [initialiseLayers, map, onRegionsChange, teardown]);

  useEffect(() => {
    if (!featureGroupRef.current) {
      return;
    }

    featureGroupRef.current.clearLayers();
    regions.forEach((region) => {
      const circle = L.circle([region.lat, region.lng], {
        radius: region.radius,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.2,
        weight: 2,
      });
      featureGroupRef.current?.addLayer(circle);
    });
  }, [regions]);

  useEffect(() => {
    const previousCount = previousCountRef.current;
    previousCountRef.current = regions.length;

    if (regions.length === 0 || !featureGroupRef.current) {
      return;
    }

    if (previousCount > 0) {
      return;
    }

    const bounds = new L.LatLngBounds([]);
    featureGroupRef.current.eachLayer((layer) => {
      if (layer instanceof L.Circle) {
        bounds.extend(layer.getBounds());
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.3));
    }
  }, [map, regions]);

  return null;
}

type PinDropManagerProps = {
  pinRegion: RegionCircle | null;
  onPinRegionChange: (region: RegionCircle | null) => void;
  pinDropActive: boolean;
  pinDropRequestId: number;
  onPinDropComplete: () => void;
  defaultPinRadius?: number;
};

function PinDropManager({
  pinRegion,
  onPinRegionChange,
  pinDropActive,
  pinDropRequestId,
  onPinDropComplete,
  defaultPinRadius,
}: PinDropManagerProps): null {
  const map = useMap();
  const circleRef = useRef<L.Circle | null>(null);
  const clickHandlerRef = useRef<((event: L.LeafletMouseEvent) => void) | null>(null);
  const requestRef = useRef(0);
  const previousLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const container = map.getContainer();
    if (pinDropActive) {
      container.classList.add('region-map__container--pin-drop');
    } else {
      container.classList.remove('region-map__container--pin-drop');
    }
  }, [map, pinDropActive]);

  useEffect(() => {
    if (!pinDropActive) {
      if (clickHandlerRef.current) {
        map.off('click', clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
      requestRef.current = pinDropRequestId;
      return;
    }

    if (pinDropRequestId === requestRef.current && clickHandlerRef.current) {
      return;
    }

    requestRef.current = pinDropRequestId;

    if (clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current);
      clickHandlerRef.current = null;
    }

    const defaultRadius =
      defaultPinRadius && Number.isFinite(defaultPinRadius) && defaultPinRadius > 0
        ? defaultPinRadius
        : DEFAULT_PIN_RADIUS_FALLBACK;

    const handleClick = (event: L.LeafletMouseEvent) => {
      const { latlng } = event;
      const radius =
        pinRegion && Number.isFinite(pinRegion.radius) && pinRegion.radius > 0
          ? pinRegion.radius
          : defaultRadius;
      onPinRegionChange({ lat: latlng.lat, lng: latlng.lng, radius });
      onPinDropComplete();
      clickHandlerRef.current = null;
    };

    clickHandlerRef.current = handleClick;
    map.once('click', handleClick);

    return () => {
      if (clickHandlerRef.current) {
        map.off('click', clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
    };
  }, [defaultPinRadius, map, onPinDropComplete, onPinRegionChange, pinDropActive, pinDropRequestId, pinRegion]);

  useEffect(() => {
    if (!pinRegion) {
      if (circleRef.current) {
        circleRef.current.removeFrom(map);
        circleRef.current = null;
      }
      return;
    }

    const latLng: L.LatLngExpression = [pinRegion.lat, pinRegion.lng];
    if (!circleRef.current) {
      circleRef.current = L.circle(latLng, {
        radius: pinRegion.radius,
        color: '#059669',
        fillColor: '#10b981',
        fillOpacity: 0.2,
        weight: 2,
        dashArray: '6 4',
      });
      circleRef.current.addTo(map);
    } else {
      circleRef.current.setLatLng(latLng);
      circleRef.current.setRadius(pinRegion.radius);
    }
  }, [map, pinRegion]);

  useEffect(() => {
    if (!pinRegion) {
      previousLocationRef.current = null;
      return;
    }

    const previous = previousLocationRef.current;
    const next = { lat: pinRegion.lat, lng: pinRegion.lng };
    const moved = !previous || previous.lat !== next.lat || previous.lng !== next.lng;
    previousLocationRef.current = next;
    if (moved) {
      map.flyTo([next.lat, next.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
    }
  }, [map, pinRegion]);

  useEffect(() => {
    return () => {
      if (clickHandlerRef.current) {
        map.off('click', clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.removeFrom(map);
        circleRef.current = null;
      }
      map.getContainer().classList.remove('region-map__container--pin-drop');
    };
  }, [map]);

  return null;
}

function RegionMap({
  regions,
  onRegionsChange,
  pinRegion,
  onPinRegionChange,
  pinDropActive,
  pinDropRequestId,
  onPinDropComplete,
  defaultPinRadius,
}: RegionMapProps): JSX.Element {
  const mapCenter = useMemo(() => DEFAULT_CENTER, []);

  return (
    <section
      className="region-map"
      aria-label="Draw regions to filter listings"
      title="Draw circles to focus the ArcGIS search on specific areas"
    >
      <div>
        <h2 className="region-map__title">Search Regions</h2>
        <p className="region-map__subtitle">
          Draw circles to focus the ArcGIS search on specific areas of Summit County.
        </p>
      </div>
      <MapContainer
        className={`region-map__map${pinDropActive ? ' region-map__map--pin-drop' : ''}`}
        center={mapCenter}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <DrawManager regions={regions} onRegionsChange={onRegionsChange} />
        <PinDropManager
          pinRegion={pinRegion}
          onPinRegionChange={onPinRegionChange}
          pinDropActive={pinDropActive}
          pinDropRequestId={pinDropRequestId}
          onPinDropComplete={onPinDropComplete}
          defaultPinRadius={defaultPinRadius}
        />
      </MapContainer>
    </section>
  );
}

export default RegionMap;
