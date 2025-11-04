import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function getUniqueOwners(listing: ListingRecord): string[] {
  const owners = new Set<string>();
  listing.ownerNames.forEach((name) => {
    const trimmed = name.trim();
    if (trimmed) {
      owners.add(trimmed);
    }
  });

  const fallbackOwner = listing.ownerName?.trim();
  if (owners.size === 0 && fallbackOwner) {
    owners.add(fallbackOwner);
  }

  return Array.from(owners);
}

function normaliseDetailUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function splitLines(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type ListingSelectionPanelProps = {
  listing: ListingRecord | null;
  hasListings: boolean;
};

function ListingSelectionPanel({ listing, hasListings }: ListingSelectionPanelProps): JSX.Element {
  if (!listing) {
    return (
      <div className="region-map__selection region-map__selection--empty" aria-live="polite">
        <span>{hasListings ? 'Select a marker to see property details.' : 'Draw a region or adjust filters to find properties.'}</span>
      </div>
    );
  }

  const title =
    listing.complex?.trim() ||
    listing.physicalAddress?.trim() ||
    listing.ownerName?.trim() ||
    listing.scheduleNumber?.trim() ||
    'Listing';

  const subtitleParts: string[] = [];
  const unit = listing.unit?.trim();
  if (unit) {
    subtitleParts.push(`Unit ${unit}`);
  }
  const subdivision = listing.subdivision?.trim();
  if (subdivision) {
    subtitleParts.push(subdivision);
  }
  const subtitle = subtitleParts.join(' · ');

  const owners = getUniqueOwners(listing);
  const mailingAddressLines = splitLines(listing.mailingAddress);
  const detailUrl = normaliseDetailUrl(listing.publicDetailUrl);

  return (
    <div className="region-map__selection" aria-live="polite">
      <div className="region-map__selection-header">
        <div className="region-map__selection-heading">
          <h3 className="region-map__selection-title">{title}</h3>
          {subtitle ? <p className="region-map__selection-subtitle">{subtitle}</p> : null}
        </div>
        {detailUrl ? (
          <a
            href={detailUrl}
            target="_blank"
            rel="noreferrer"
            className="region-map__selection-link"
            aria-label="Open listing details in a new tab"
          >
            <svg className="region-map__selection-link-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="8" r="1" fill="currentColor" />
              <path
                d="M11.25 10.5c0-.414.336-.75.75-.75s.75.336.75.75v5.25a.75.75 0 0 1-1.5 0Z"
                fill="currentColor"
              />
            </svg>
            <span>Official details</span>
          </a>
        ) : null}
      </div>

      <dl className="region-map__selection-grid">
        {owners.length ? (
          <div>
            <dt>Owner(s)</dt>
            <dd>{owners.join(', ')}</dd>
          </div>
        ) : null}
        {listing.physicalAddress ? (
          <div>
            <dt>Physical address</dt>
            <dd>{listing.physicalAddress}</dd>
          </div>
        ) : null}
        {listing.scheduleNumber ? (
          <div>
            <dt>Schedule #</dt>
            <dd>{listing.scheduleNumber}</dd>
          </div>
        ) : null}
        {listing.mailingAddress ? (
          <div>
            <dt>Mailing address</dt>
            <dd>
              {mailingAddressLines.length > 0
                ? mailingAddressLines.map((line, index) => <span key={index}>{line}</span>)
                : listing.mailingAddress}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
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
  selectedListingId?: string | null;
  hoveredListingId?: string | null;
  onListingHover?: (listingId: string | null) => void;
};

function ListingMarkers({ listings, onListingSelect, selectedListingId, hoveredListingId, onListingHover }: ListingMarkersProps): null {
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

      const isSelected = listing.id === selectedListingId;
      const isHovered = listing.id === hoveredListingId;
      const isActive = isSelected || isHovered;

      const marker = L.circleMarker([listing.latitude, listing.longitude], {
        radius: isActive ? 7 : 5,
        color: isActive ? '#1d4ed8' : '#991b1b',
        weight: isActive ? 2 : 1,
        fillColor: isActive ? '#3b82f6' : '#ef4444',
        fillOpacity: isActive ? 0.95 : 0.85,
        pane: 'markerPane',
      });

      marker.on('click', (event: L.LeafletMouseEvent) => {
        event.originalEvent?.preventDefault?.();
        event.originalEvent?.stopPropagation?.();
        onListingSelect?.(listing.id);
      });

      marker.on('mouseover', () => {
        onListingHover?.(listing.id);
      });

      marker.on('mouseout', () => {
        onListingHover?.(null);
      });

      if (isActive) {
        marker.bringToFront();
      }

      marker.addTo(layerGroup);
    });
  }, [hoveredListingId, listings, map, onListingHover, onListingSelect, selectedListingId]);

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
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [hoveredListingId, setHoveredListingId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedListingId && !listings.some((listing) => listing.id === selectedListingId)) {
      setSelectedListingId(null);
    }
  }, [listings, selectedListingId]);

  useEffect(() => {
    if (hoveredListingId && !listings.some((listing) => listing.id === hoveredListingId)) {
      setHoveredListingId(null);
    }
  }, [hoveredListingId, listings]);

  useEffect(() => {
    if (!selectedListingId && listings.length === 1) {
      setSelectedListingId(listings[0]?.id ?? null);
    }
  }, [listings, selectedListingId]);

  const activeListingId = hoveredListingId ?? selectedListingId;

  const activeListing = useMemo(() => {
    if (!activeListingId) {
      return null;
    }
    return listings.find((listing) => listing.id === activeListingId) ?? null;
  }, [activeListingId, listings]);

  const handleMarkerSelect = useCallback(
    (listingId: string) => {
      setSelectedListingId(listingId);
      onListingSelect?.(listingId);
    },
    [onListingSelect],
  );

  const handleMarkerHover = useCallback((listingId: string | null) => {
    setHoveredListingId(listingId);
  }, []);

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
      <ListingSelectionPanel listing={activeListing} hasListings={listings.length > 0} />
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
          <ListingMarkers
            listings={listings}
            onListingSelect={handleMarkerSelect}
            selectedListingId={selectedListingId}
            hoveredListingId={hoveredListingId}
            onListingHover={handleMarkerHover}
          />
        ) : null}
      </MapContainer>
    </section>
  );
}

export default RegionMap;
