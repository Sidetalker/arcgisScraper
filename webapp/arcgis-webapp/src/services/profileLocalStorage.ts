import { normaliseProfileConfiguration } from '@/constants/profiles';
import type { ProfileConfiguration } from '@/types';

const LOCAL_STORAGE_KEY = 'arcgis-configuration-profile:v1';

export interface StoredLocalProfile {
  profileId: string | null;
  name: string;
  configuration: ProfileConfiguration;
}

export function loadLocalProfile(): StoredLocalProfile | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredLocalProfile> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const configuration = normaliseProfileConfiguration(parsed.configuration);
    const name = typeof parsed.name === 'string' && parsed.name.trim().length > 0 ? parsed.name : '';
    const profileId = typeof parsed.profileId === 'string' ? parsed.profileId : null;

    return {
      profileId,
      name,
      configuration,
    };
  } catch (error) {
    console.warn('Unable to restore configuration profile from localStorage.', error);
    return null;
  }
}

export function saveLocalProfile(snapshot: StoredLocalProfile): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const payload: StoredLocalProfile = {
      profileId: snapshot.profileId,
      name: snapshot.name,
      configuration: normaliseProfileConfiguration(snapshot.configuration),
    };
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist configuration profile to localStorage.', error);
  }
}
