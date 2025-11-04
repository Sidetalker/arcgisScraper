import { describe, it, expect } from 'vitest';
import { getEvStations, findNearestEvStationDistance } from '@/services/evChargingStations';

describe('evChargingStations', () => {
  describe('getEvStations', () => {
    it('should parse EV charging stations from CSV', () => {
      const stations = getEvStations();
      expect(stations.length).toBeGreaterThan(200);

      // Check first station has required fields
      const firstStation = stations[0];
      expect(firstStation).toHaveProperty('id');
      expect(firstStation).toHaveProperty('name');
      expect(firstStation).toHaveProperty('latitude');
      expect(firstStation).toHaveProperty('longitude');
      expect(typeof firstStation.latitude).toBe('number');
      expect(typeof firstStation.longitude).toBe('number');
    });

    it('should cache parsed stations', () => {
      const stations1 = getEvStations();
      const stations2 = getEvStations();
      expect(stations1).toBe(stations2); // Same reference
    });
  });

  describe('findNearestEvStationDistance', () => {
    it('should return null for null coordinates', () => {
      expect(findNearestEvStationDistance(null, null)).toBeNull();
      expect(findNearestEvStationDistance(39.6, null)).toBeNull();
      expect(findNearestEvStationDistance(null, -106.0)).toBeNull();
    });

    it('should calculate distance to nearest EV station', () => {
      // Coordinates near Breckenridge, Colorado
      const distance = findNearestEvStationDistance(39.4817, -106.0455);
      expect(distance).not.toBeNull();
      expect(typeof distance).toBe('number');
      expect(distance!).toBeGreaterThan(0);
      expect(distance!).toBeLessThan(1500);
    });

    it('should return different distances for different locations', () => {
      const distance1 = findNearestEvStationDistance(39.4817, -106.0455);
      const distance2 = findNearestEvStationDistance(39.6109, -106.0967);

      expect(distance1).not.toBeNull();
      expect(distance2).not.toBeNull();
      // Distances should be different (unless extremely unlikely coincidence)
      expect(distance1).not.toBe(distance2);
    });
  });
});
