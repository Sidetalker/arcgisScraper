import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';

type LeafletEditTooltip = {
  updateContent: (content: { text: string; subtext: string }) => void;
};

type LeafletCircleEditor = {
  _moveMarker: L.Marker;
  _map: L.Map & {
    distance: (from: L.LatLngExpression, to: L.LatLngExpression) => number;
    _editTooltip?: LeafletEditTooltip;
  };
  _shape: L.Circle;
  options?: {
    feet?: boolean;
    nautic?: boolean;
  };
};

const leafletWithDraw = L as typeof L & {
  Edit?: {
    Circle?: {
      prototype: {
        _resize?: (this: LeafletCircleEditor, latlng: L.LatLng) => void;
      };
    };
  };
  GeometryUtil?: {
    isVersion07x?: () => boolean;
    readableDistance?: (
      radius: number,
      isMetric?: boolean,
      useFeet?: boolean,
      useNautic?: boolean,
    ) => string;
  };
  Draw?: {
    Event: {
      EDITRESIZE: string;
    };
  };
  drawLocal?: {
    draw: {
      handlers: {
        circle: {
          radius: string;
        };
      };
    };
    edit: {
      handlers: {
        edit: {
          tooltip: {
            text: string;
            subtext: string;
          };
        };
      };
    };
  };
};

const circleEditPrototype = leafletWithDraw.Edit?.Circle?.prototype;

if (circleEditPrototype) {
  circleEditPrototype._resize = function patchLeafletDrawResize(this: LeafletCircleEditor, latlng: L.LatLng) {
    const moveLatLng = this._moveMarker.getLatLng();
    const geometryUtil = leafletWithDraw.GeometryUtil;
    const isV07 =
      geometryUtil?.isVersion07x?.() ?? false;

    const radiusValue = isV07
      ? moveLatLng.distanceTo(latlng)
      : this._map.distance(moveLatLng, latlng);

    this._shape.setRadius(radiusValue);

    const tooltipStrings = leafletWithDraw.drawLocal?.edit?.handlers?.edit?.tooltip;
    const radiusLabel = leafletWithDraw.drawLocal?.draw?.handlers?.circle?.radius;

    if (this._map._editTooltip && tooltipStrings && radiusLabel) {
      this._map._editTooltip.updateContent({
        text: `${tooltipStrings.subtext}<br />${tooltipStrings.text}`,
        subtext: `${radiusLabel}: ${
          geometryUtil?.readableDistance?.(
            radiusValue,
            true,
            this.options?.feet,
            this.options?.nautic,
          ) ?? radiusValue.toFixed(2)
        }`,
      });
    }

    this._map.fire(leafletWithDraw.Draw?.Event.EDITRESIZE ?? 'draw:editresize', {
      layer: this._shape,
    });
  };
}

import type { ListingRecord, RegionCircle } from '@/types';

import './RegionMap.css';

type RegionMapProps = {
  regions: RegionCircle[];
  onRegionsChange: (regions: RegionCircle[]) => void;
  listings?: ListingRecord[];
  onListingSelect?: (listingId: string) => void;
};

const DEFAULT_CENTER: [number, number] = [39.6, -106.07];
const DEFAULT_ZOOM = 10;

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

type DrawManagerProps = {
  regions: RegionCircle[];
  onRegionsChange: (regions: RegionCircle[]) => void;
};

function DrawManager({
  regions,
  onRegionsChange,
}: DrawManagerProps): null {
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

type ListingMarkersProps = {
  listings: ListingRecord[];
  onListingSelect?: (listingId: string) => void;
};

function ListingMarkers({ listings, onListingSelect }: ListingMarkersProps): null {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!layerRef.current) {
      layerRef.current = L.layerGroup().addTo(map);
    }
    const layerGroup = layerRef.current;
    layerGroup.clearLayers();

    listings.forEach((listing) => {
      if (listing.latitude === null || listing.longitude === null) {
        return;
      }

      const marker = L.circleMarker([listing.latitude, listing.longitude], {
        radius: 5,
        color: '#991b1b',
        weight: 1,
        fillColor: '#ef4444',
        fillOpacity: 0.85,
        pane: 'markerPane',
      });

      const tooltipLabel =
        listing.complex ||
        listing.physicalAddress ||
        listing.ownerName ||
        listing.scheduleNumber ||
        'Listing';

      marker.bindTooltip(tooltipLabel, {
        direction: 'top',
        offset: L.point(0, -6),
      });

      marker.on('click', (event: L.LeafletMouseEvent) => {
        event.originalEvent?.preventDefault?.();
        event.originalEvent?.stopPropagation?.();
        onListingSelect?.(listing.id);
      });

      marker.addTo(layerGroup);
    });
  }, [listings, map, onListingSelect]);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        layerRef.current.removeFrom(map);
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

function RegionMap({
  regions,
  onRegionsChange,
  listings = [],
  onListingSelect,
}: RegionMapProps): JSX.Element {
  const mapCenter = useMemo(() => DEFAULT_CENTER, []);
  const subtitle = 'Draw circles on the map to filter listings by one or more regions.';

  return (
    <section
      className="region-map"
      aria-label="Draw regions to filter listings"
      title="Draw circles to focus the ArcGIS search on specific areas"
    >
      <div>
        <h2 className="region-map__title">Search Regions</h2>
        <p className="region-map__subtitle">
          {subtitle}
        </p>
      </div>
      <MapContainer
        className="region-map__map"
        center={mapCenter}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <DrawManager
          regions={regions}
          onRegionsChange={onRegionsChange}
        />
        {listings.length ? (
          <ListingMarkers listings={listings} onListingSelect={onListingSelect} />
        ) : null}
      </MapContainer>
    </section>
  );
}

export default RegionMap;
