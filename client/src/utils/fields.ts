import { ArcgisField } from '../types';

export interface FieldDefinition {
  name: string;
  label: string;
  type: string;
  alias?: string;
}

const CUSTOM_LABELS: Record<string, string> = {
  PropertyScheduleText: 'Schedule Number',
  HC_RegistrationsOriginalCleaned: 'Registration ID',
  HC_RegistrationOriginalCleaned: 'Registration ID',
  HC_RegistrationsOriginalCleanClear: 'Registration ID (Cleaned)',
  SitusAddress: 'Physical Address',
  BriefPropertyDescription: 'Property Description',
  OwnerFullName: 'Owner Name',
  OwnerContactPublicMailingAddr: 'Owner Mailing Address',
  SubdivisionName: 'Subdivision',
  Parcel: 'Parcel',
};

const ACRONYM_TOKENS = new Set([
  'STR',
  'HC',
  'URL',
  'ID',
  'PO',
  'GIS',
  'LLC',
  'LLP',
  'LP',
  'LLLP',
  'CO',
]);

function humanizeIdentifier(name: string): string {
  const normalized = name
    .replace(/[_\s]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .trim();
  const parts = normalized
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .map((part) => {
      const upper = part.toUpperCase();
      if (ACRONYM_TOKENS.has(upper) || (upper.length <= 3 && /[A-Z]/.test(upper))) {
        return upper;
      }
      if (/^\d+$/.test(part)) {
        return part;
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function normalizeLabel(field: ArcgisField): string {
  const alias = field.alias?.trim();
  if (alias) {
    return alias;
  }

  const custom = CUSTOM_LABELS[field.name];
  if (custom) {
    return custom;
  }

  return humanizeIdentifier(field.name);
}

export function createFieldDefinition(field: ArcgisField): FieldDefinition {
  return {
    name: field.name,
    label: normalizeLabel(field),
    type: field.type,
    alias: field.alias?.trim() || undefined,
  };
}

export function createFieldDefinitionFromName(name: string): FieldDefinition {
  return createFieldDefinition({ name, type: 'unknown' });
}
