import rawPresets from '@/constants/serviceLayers.json';

type RawLayerPreset = {
  name?: string;
  url?: string;
  description?: string;
  referer?: string;
  supportsOwnerTable?: boolean;
};

export interface LayerPreset {
  name: string;
  url: string;
  description?: string;
  referer?: string;
  supportsOwnerTable?: boolean;
}

function normalisePresetEntries(
  entries: Record<string, RawLayerPreset>,
): Record<string, LayerPreset> {
  const result: Record<string, LayerPreset> = {};
  Object.entries(entries).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    if (!url) {
      return;
    }
    const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name.trim() : key;
    result[key] = {
      name,
      url,
      description: typeof value.description === 'string' ? value.description : undefined,
      referer: typeof value.referer === 'string' && value.referer.trim().length > 0 ? value.referer.trim() : undefined,
      supportsOwnerTable: value.supportsOwnerTable === true,
    };
  });
  return result;
}

export const LAYER_PRESETS: Record<string, LayerPreset> = normalisePresetEntries(
  rawPresets as Record<string, RawLayerPreset>,
);

export const DEFAULT_LAYER_PRESET = 'str_public';
export const OWNER_LAYER_PRESET = 'owner_contacts';

function fallbackPresetId(): string | null {
  if (LAYER_PRESETS[DEFAULT_LAYER_PRESET]) {
    return DEFAULT_LAYER_PRESET;
  }
  if (LAYER_PRESETS[OWNER_LAYER_PRESET]) {
    return OWNER_LAYER_PRESET;
  }
  const firstKey = Object.keys(LAYER_PRESETS)[0];
  return firstKey ?? null;
}

export function resolveLayerPreset(presetId?: string | null): LayerPreset | undefined {
  if (!presetId) {
    const fallback = fallbackPresetId();
    return fallback ? LAYER_PRESETS[fallback] : undefined;
  }
  return LAYER_PRESETS[presetId];
}

export function getLayerUrlForPreset(presetId?: string | null): string | undefined {
  return resolveLayerPreset(presetId)?.url;
}

export function getRefererForPreset(presetId?: string | null): string | undefined {
  return resolveLayerPreset(presetId)?.referer;
}

export function listLayerPresetOptions(): Array<{ id: string; name: string; description?: string }> {
  return Object.entries(LAYER_PRESETS)
    .map(([id, preset]) => ({ id, name: preset.name, description: preset.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
