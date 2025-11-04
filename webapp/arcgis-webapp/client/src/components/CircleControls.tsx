import { KeyboardEvent, useEffect, useState } from 'react';
import { GeoCircle } from '../types';

interface CircleControlsProps {
  circles: GeoCircle[];
  onCirclesChange: (circles: GeoCircle[]) => void;
  defaultCenter: { lat: number; lng: number };
}

interface CircleDraft {
  lat: string;
  lng: string;
  radius: string;
}

const LAT_DECIMALS = 6;

function formatLatLng(value: number): string {
  return value.toFixed(LAT_DECIMALS);
}

function formatRadius(value: number): string {
  return Math.max(0, value).toFixed(0);
}

export function CircleControls({ circles, onCirclesChange, defaultCenter }: CircleControlsProps) {
  const [drafts, setDrafts] = useState<Record<string, CircleDraft>>({});

  useEffect(() => {
    const nextDrafts: Record<string, CircleDraft> = {};
    circles.forEach((circle) => {
      nextDrafts[circle.id] = {
        lat: formatLatLng(circle.center.lat),
        lng: formatLatLng(circle.center.lng),
        radius: formatRadius(circle.radiusMeters),
      };
    });
    setDrafts(nextDrafts);
  }, [circles]);

  const updateCircle = (id: string, draft: CircleDraft) => {
    const circle = circles.find((item) => item.id === id);
    if (!circle) {
      return;
    }

    const lat = parseFloat(draft.lat);
    const lng = parseFloat(draft.lng);
    const radius = parseFloat(draft.radius);

    if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius)) {
      setDrafts((prev) => ({
        ...prev,
        [id]: {
          lat: formatLatLng(circle.center.lat),
          lng: formatLatLng(circle.center.lng),
          radius: formatRadius(circle.radiusMeters),
        },
      }));
      return;
    }

    const updated: GeoCircle = {
      ...circle,
      center: { lat, lng },
      radiusMeters: Math.max(0, radius),
    };

    onCirclesChange(circles.map((item) => (item.id === id ? updated : item)));
  };

  const handleInputChange = (id: string, field: keyof CircleDraft, value: string) => {
    const circle = circles.find((item) => item.id === id);
    setDrafts((prev) => {
      const previous = prev[id];
      const base: CircleDraft = circle
        ? {
            lat: previous?.lat ?? formatLatLng(circle.center.lat),
            lng: previous?.lng ?? formatLatLng(circle.center.lng),
            radius: previous?.radius ?? formatRadius(circle.radiusMeters),
          }
        : previous ?? { lat: '', lng: '', radius: '' };

      return {
        ...prev,
        [id]: {
          ...base,
          [field]: value,
        },
      };
    });
  };

  const handleBlur = (id: string) => {
    const draft = drafts[id];
    if (draft) {
      updateCircle(id, draft);
    }
  };

  const handleKeyDown = (id: string, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const draft = drafts[id];
      if (draft) {
        updateCircle(id, draft);
      }
    }
  };

  const handleRemove = (id: string) => {
    onCirclesChange(circles.filter((circle) => circle.id !== id));
  };

  const handleAddCircle = () => {
    const newCircle: GeoCircle = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      center: { ...defaultCenter },
      radiusMeters: 400,
    };
    onCirclesChange([...circles, newCircle]);
  };

  return (
    <div className="circle-controls">
      <div className="circle-controls__header">
        <h3>Active Circles</h3>
        <button type="button" onClick={handleAddCircle} className="secondary">
          Add Circle
        </button>
      </div>
      {circles.length === 0 ? (
        <p className="circle-controls__empty">Draw on the map or add a circle to begin filtering.</p>
      ) : (
        <div className="circle-controls__list">
          {circles.map((circle, index) => {
            const draft = drafts[circle.id];
            return (
              <div key={circle.id} className="circle-controls__row">
                <div className="circle-controls__index">#{index + 1}</div>
                <div className="circle-controls__inputs">
                  <label>
                    <span>Latitude</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.000001"
                      value={draft?.lat ?? formatLatLng(circle.center.lat)}
                      onChange={(event) => handleInputChange(circle.id, 'lat', event.target.value)}
                      onBlur={() => handleBlur(circle.id)}
                      onKeyDown={(event) => handleKeyDown(circle.id, event)}
                    />
                  </label>
                  <label>
                    <span>Longitude</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.000001"
                      value={draft?.lng ?? formatLatLng(circle.center.lng)}
                      onChange={(event) => handleInputChange(circle.id, 'lng', event.target.value)}
                      onBlur={() => handleBlur(circle.id)}
                      onKeyDown={(event) => handleKeyDown(circle.id, event)}
                    />
                  </label>
                  <label>
                    <span>Radius (m)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="10"
                      value={draft?.radius ?? formatRadius(circle.radiusMeters)}
                      onChange={(event) => handleInputChange(circle.id, 'radius', event.target.value)}
                      onBlur={() => handleBlur(circle.id)}
                      onKeyDown={(event) => handleKeyDown(circle.id, event)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  aria-label="Remove circle"
                  className="circle-controls__remove secondary"
                  onClick={() => handleRemove(circle.id)}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
