export type ShortTermRentalPriority = 'high' | 'medium' | 'baseline';

export interface ResidentialZoneDefinition {
  code: string;
  name: string;
  densityRange: string;
  jurisdictions: string[];
  description: string;
  aliases?: string[];
  filterable?: boolean;
  notes?: string;
  shortTermRentalPriority?: ShortTermRentalPriority;
}

function normaliseZoneKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export const RESIDENTIAL_ZONES: ResidentialZoneDefinition[] = [
  {
    code: 'RU',
    name: 'Rural Residential',
    densityRange: '≈1 home per 5 acres (minimum 5-acre lots)',
    jurisdictions: ['Unincorporated Summit County'],
    description:
      'Preserves very low-density rural character on the edge of townsites. Allows a single detached home on expansive 5–20 acre parcels with accessory agricultural structures.',
  },
  {
    code: 'RE',
    name: 'Rural Estate',
    densityRange: '≈1 home per 2–5 acres (minimum 2-acre lots)',
    jurisdictions: ['Unincorporated Summit County', 'Town of Dillon (Residential Estate)'],
    description:
      'Estate-scale single-family neighborhoods that buffer rural land from in-town development. Supports large-lot homes with barns, detached garages, or small-scale accessory uses.',
  },
  {
    code: 'R-1',
    aliases: ['R1'],
    name: 'Single-Family Residential',
    densityRange: '≈1 home per acre in the county; 1–2 acre lots in Blue River',
    jurisdictions: ['Unincorporated Summit County', 'Town of Blue River'],
    description:
      'Low-density single-family subdivisions with generous yards. County standards target one detached home per ~40,000 sq ft, while Blue River keeps a quiet forested setting with one home on roughly 1–2 acre lots.',
  },
  {
    code: 'R-2',
    aliases: ['R2'],
    name: 'Single-Family Residential (2 du/acre)',
    densityRange: '≈2 dwelling units per acre (≈0.5-acre lots)',
    jurisdictions: ['Unincorporated Summit County', 'Town of Silverthorne (R-2)'],
    description:
      'Half-acre single-family districts that still read as rural. Supports detached homes with limited accessory uses and functions as Silverthorne’s large-lot residential option.',
  },
  {
    code: 'R-3',
    aliases: ['R3'],
    name: 'Single-Family Residential (3 du/acre)',
    densityRange: '≈3 dwelling units per acre (≈0.33-acre lots)',
    jurisdictions: ['Unincorporated Summit County'],
    description:
      'Medium-low density single-family zoning that trims lot sizes to roughly 14,500 sq ft while keeping a detached neighborhood character.',
  },
  {
    code: 'R-4',
    aliases: ['R4'],
    name: 'Single-Family Residential (4 du/acre)',
    densityRange: '≈4 dwelling units per acre (≈0.25-acre lots)',
    jurisdictions: ['Unincorporated Summit County'],
    description:
      'Quarter-acre single-family neighborhoods. Commonly mapped in established townsites with compact lots while maintaining detached housing.',
    shortTermRentalPriority: 'medium',
  },
  {
    code: 'R-6',
    aliases: ['R6'],
    name: 'Single-Family / Duplex Residential',
    densityRange: '≈6 dwelling units per acre (single-family or duplex lots)',
    jurisdictions: ['Unincorporated Summit County', 'Town of Silverthorne (R-6)'],
    description:
      'Higher-intensity neighborhood district that mixes small-lot single-family homes with duplexes—roughly six homes or three duplexes per acre.',
    shortTermRentalPriority: 'medium',
  },
  {
    code: 'R-15',
    aliases: ['R15'],
    name: 'Residential High Density (Silverthorne)',
    densityRange: '≈15 dwelling units per acre',
    jurisdictions: ['Town of Silverthorne'],
    description:
      'Silverthorne’s multifamily zone for compact condo or apartment projects near the town core and Blue River corridor.',
    shortTermRentalPriority: 'high',
  },
  {
    code: 'R-25',
    aliases: ['R25'],
    name: 'Multi-Family Residential',
    densityRange: '≈25 dwelling units per acre',
    jurisdictions: ['Unincorporated Summit County'],
    description:
      'High-density residential district tailored to condominium or apartment buildings in resort centers or mixed-use cores.',
    shortTermRentalPriority: 'high',
  },
  {
    code: 'RC-40000',
    aliases: ['RC-40,000', 'RC40000', 'RC 40000'],
    name: 'Rural Community Residential (40,000 sq ft)',
    densityRange: '≈1 home per 40,000 sq ft (~0.9 acres)',
    jurisdictions: ['Unincorporated Summit County (Legacy Townsites)'],
    description:
      'Historic rural community platting with near-acre lots that preserve a village feel in older unincorporated settlements.',
    shortTermRentalPriority: 'medium',
  },
  {
    code: 'RC-5000',
    aliases: ['RC-5,000', 'RC5000', 'RC 5000'],
    name: 'Rural Community Residential (5,000 sq ft)',
    densityRange: '≈8–9 dwelling units per acre',
    jurisdictions: ['Unincorporated Summit County (Legacy Townsites)'],
    description:
      'Legacy mining-era townsites platted with tiny lots. Supports one detached home per 5,000 sq ft but is rarely applied to new subdivisions.',
    shortTermRentalPriority: 'high',
  },
  {
    code: 'R-P',
    name: 'Residential with Plan',
    densityRange: 'Plan-specific densities',
    jurisdictions: ['Unincorporated Summit County'],
    description:
      'Indicates a parcel governed by an approved site-specific development plan instead of blanket zoning standards.',
    filterable: false,
    notes: 'Review the recorded plan documents for exact density and use permissions.',
  },
  {
    code: 'BRECKENRIDGE LUD',
    aliases: ['LUD', 'BRECK LUD'],
    name: 'Breckenridge Land Use Districts',
    densityRange: 'Varies by district: ≈10–20+ du/acre downtown; 1 du per 10–20 acres on hillsides',
    jurisdictions: ['Town of Breckenridge'],
    description:
      'Breckenridge regulates residential development through numbered Land Use Districts with performance-based guidelines instead of uniform R-zones. Downtown districts support townhomes, condos, and mixed use, while outlying slopes limit density to protect open space.',
    filterable: false,
    notes: 'Filter by specific Land Use District numbers using the table search when detailed parcel data is available.',
    shortTermRentalPriority: 'high',
  },
  {
    code: 'RS',
    name: 'Residential Single-Household',
    densityRange: '≈1–4 dwelling units per acre',
    jurisdictions: ['Town of Frisco'],
    description:
      'Frisco’s lowest-density district for detached homes on quarter- to one-acre lots with ample open space and optional accessory units.',
  },
  {
    code: 'RN',
    name: 'Residential Traditional Neighborhood',
    densityRange: '≈Traditional town lots (~5,000–7,000 sq ft)',
    jurisdictions: ['Town of Frisco'],
    description:
      'Maintains Frisco’s historic grid of walkable blocks with single-family homes (and occasional duplexes) on classic in-town lots.',
  },
  {
    code: 'RL',
    name: 'Residential Low Density',
    densityRange: 'Dillon: single-family lots (~7,500–15,000 sq ft); Frisco: up to 8 du/acre with duplex/townhomes',
    jurisdictions: ['Town of Dillon', 'Town of Frisco'],
    description:
      'Transition-scale districts. Dillon’s RL protects single-family neighborhoods on modest lots, while Frisco’s RL enables duplex or small townhouse clusters up to eight units per acre.',
    shortTermRentalPriority: 'medium',
  },
  {
    code: 'RM',
    name: 'Residential Medium Density',
    densityRange: 'Dillon medium-density multi-unit; Frisco up to 12 du/acre',
    jurisdictions: ['Town of Dillon', 'Town of Frisco'],
    description:
      'Enables duplexes, townhomes, and small condo buildings that bridge low-density areas with higher-intensity mixed-use districts.',
    shortTermRentalPriority: 'high',
  },
  {
    code: 'RH',
    name: 'Residential High Density',
    densityRange: '≈15–20+ dwelling units per acre',
    jurisdictions: ['Town of Dillon', 'Town of Frisco'],
    description:
      'High-density zones for multi-story condominiums or apartments near town centers and amenities.',
    shortTermRentalPriority: 'high',
  },
];

const RESIDENTIAL_ZONE_LOOKUP = new Map<string, ResidentialZoneDefinition>();

for (const definition of RESIDENTIAL_ZONES) {
  const keys = [definition.code, ...(definition.aliases ?? [])].map((value) => normaliseZoneKey(value));
  for (const key of keys) {
    if (!RESIDENTIAL_ZONE_LOOKUP.has(key)) {
      RESIDENTIAL_ZONE_LOOKUP.set(key, definition);
    }
  }
}

export function findResidentialZoneDefinition(zone: string): ResidentialZoneDefinition | undefined {
  if (!zone) {
    return undefined;
  }
  return RESIDENTIAL_ZONE_LOOKUP.get(normaliseZoneKey(zone));
}
