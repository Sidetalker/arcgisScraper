import evStationsCSV from '@/assets/EV_Charging_Stations.csv?raw';

export interface EvChargingStation {
  id: string;
  name: string;
  address: string;
  chargerType: string;
  latitude: number;
  longitude: number;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

export function parseEvStations(): EvChargingStation[] {
  const lines = evStationsCSV.split(/\r?\n/).filter((line) => line.trim());
  
  if (lines.length < 2) {
    return [];
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);
  
  const objectIdIndex = headers.indexOf('ObjectID');
  const locationIndex = headers.indexOf('USER_Location');
  const addressIndex = headers.indexOf('USER_Address');
  const chargerTypeIndex = headers.indexOf('USER_Charger_Type');
  const xIndex = headers.indexOf('X');
  const yIndex = headers.indexOf('Y');

  if (objectIdIndex === -1 || xIndex === -1 || yIndex === -1) {
    console.warn('EV Charging Stations CSV missing required columns');
    return [];
  }

  const stations: EvChargingStation[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }

    const values = parseCSVLine(line);
    
    const id = values[objectIdIndex]?.trim() || `station-${i}`;
    const name = values[locationIndex]?.trim() || '';
    const address = values[addressIndex]?.trim() || '';
    const chargerType = values[chargerTypeIndex]?.trim() || '';
    const x = parseFloat(values[xIndex]);
    const y = parseFloat(values[yIndex]);

    if (!isFinite(x) || !isFinite(y)) {
      continue;
    }

    stations.push({
      id,
      name,
      address,
      chargerType,
      longitude: x,
      latitude: y,
    });
  }

  return stations;
}

let cachedStations: EvChargingStation[] | null = null;

export function getEvStations(): EvChargingStation[] {
  if (cachedStations === null) {
    cachedStations = parseEvStations();
  }
  return cachedStations;
}

/**
 * Calculate the Haversine distance between two points in meters
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Find the distance to the nearest EV charging station from a given location
 * @returns Distance in meters, or null if no valid location provided
 */
export function findNearestEvStationDistance(
  latitude: number | null,
  longitude: number | null,
): number | null {
  if (latitude === null || longitude === null) {
    return null;
  }

  const stations = getEvStations();
  if (stations.length === 0) {
    return null;
  }

  let minDistance = Infinity;

  for (const station of stations) {
    const distance = haversineDistance(
      latitude,
      longitude,
      station.latitude,
      station.longitude,
    );
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return isFinite(minDistance) ? minDistance : null;
}
