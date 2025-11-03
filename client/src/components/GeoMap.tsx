import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L, { LatLng, LeafletEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { ArcgisFeature, GeoCircle } from '../types';

interface GeoMapProps {
  features: ArcgisFeature[];
  circles: GeoCircle[];
  onCirclesChange: (circles: GeoCircle[]) => void;
}

const DEFAULT_CENTER: [number, number] = [39.63, -106.06];

function toCircle(layer: L.Circle): GeoCircle {
  const center = layer.getLatLng();
  return {
    id: (layer.options as L.PathOptions & { id?: string }).id ?? `${Date.now()}-${Math.random()}`,
    center: { lat: center.lat, lng: center.lng },
    radiusMeters: layer.getRadius(),
  };
}

export function GeoMap({ features, circles, onCirclesChange }: GeoMapProps) {
  const drawnItemsRef = useRef<L.FeatureGroup<any> | null>(null);

  const initialBounds = useMemo(() => {
    if (!features.length) {
      return null;
    }
    const latLngs: LatLng[] = [];
    features.forEach((feature) => {
      if (feature.geometry) {
        latLngs.push(L.latLng(feature.geometry.y, feature.geometry.x));
      }
    });
    if (!latLngs.length) {
      return null;
    }
    return L.latLngBounds(latLngs);
  }, [features]);

  useEffect(() => {
    const featureGroup = drawnItemsRef.current;
    if (!featureGroup) {
      return;
    }
    featureGroup.clearLayers();
    circles.forEach((circle) => {
      const layer = L.circle([circle.center.lat, circle.center.lng], {
        radius: circle.radiusMeters,
      });
      (layer.options as L.PathOptions & { id?: string }).id = circle.id;
      featureGroup.addLayer(layer);
    });
  }, [circles]);

  const handleCreated = (event: LeafletEvent) => {
    const layer = (event as unknown as { layer: L.Circle }).layer;
    const circle = toCircle(layer);
    onCirclesChange([...circles, circle]);
  };

  const handleDeleted = (event: LeafletEvent) => {
    const { layers } = event as unknown as { layers: L.LayerGroup<L.Circle> };
    const ids = new Set<string>();
    layers.eachLayer((layer) => {
      const circleLayer = layer as L.Circle;
      const id = (circleLayer.options as L.PathOptions & { id?: string }).id;
      if (id) {
        ids.add(id);
      }
    });
    onCirclesChange(circles.filter((circle) => !ids.has(circle.id)));
  };

  const handleEdited = (event: LeafletEvent) => {
    const { layers } = event as unknown as { layers: L.LayerGroup<L.Circle> };
    const updated = [...circles];
    layers.eachLayer((layer) => {
      const circleLayer = layer as L.Circle;
      const id = (circleLayer.options as L.PathOptions & { id?: string }).id;
      if (!id) {
        return;
      }
      const index = updated.findIndex((circle) => circle.id === id);
      if (index !== -1) {
        const circle = toCircle(circleLayer);
        circle.id = id;
        updated[index] = circle;
      }
    });
    onCirclesChange(updated);
  };

  const mapCenter = initialBounds ? initialBounds.getCenter() : null;

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Geo Regions</h2>
        <p className="panel__description">
          Use the circle tool to draw any number of regions. Properties outside the selected
          regions are hidden from the results.
        </p>
      </header>
      <div className="map-container">
        <MapContainer
          center={mapCenter ? [mapCenter.lat, mapCenter.lng] : DEFAULT_CENTER}
          bounds={initialBounds ?? undefined}
          zoom={11}
          className="map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FeatureGroup ref={drawnItemsRef}>
            <EditControl
              position="topright"
              onCreated={handleCreated}
              onDeleted={handleDeleted}
              onEdited={handleEdited}
              draw={{
                polygon: false,
                marker: false,
                polyline: false,
                rectangle: false,
                circlemarker: false,
                circle: {
                  shapeOptions: {
                    color: '#2563eb',
                  },
                },
              }}
            />
          </FeatureGroup>
          {features.map((feature, index) => {
            if (!feature.geometry) {
              return null;
            }
            return (
              <CircleMarker
                key={index}
                center={[feature.geometry.y, feature.geometry.x]}
                radius={4}
                pathOptions={{ color: '#22c55e' }}
              />
            );
          })}
        </MapContainer>
      </div>
    </section>
  );
}
