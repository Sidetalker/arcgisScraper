const MAX_SIGNAL_DEPTH = 4;
const MAX_SIGNAL_ARRAY_LENGTH = 25;

const DATE_KEY_HINT = /(date|dt|year|record|recept|sale|deed|permit|license|renew|transfer|expir|assess|valuation|updated|entered|filed|document)/i;
const DATE_VALUE_HINT = /(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{2}|\d{4}))|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+(?:\d{2}|\d{4}))|(\b(19|20)\d{2}\b)/i;

const SIGNAL_TYPE_RULES: Array<{ type: RenewalSignal['type']; pattern: RegExp }> = [
  { type: 'permit', pattern: /(license|permit|renew|expir|str[_-]?permit|lodging)/i },
  { type: 'transfer', pattern: /(sale|deed|recept|record|doc|transfer)/i },
  { type: 'assessment', pattern: /(assess|valuation|actualvalue|marketvalue|apprais|taxyear|levy)/i },
  { type: 'update', pattern: /(update|modified|change|entered|capture|created)/i },
];

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export interface RenewalSignal {
  type: 'permit' | 'transfer' | 'assessment' | 'update' | 'generic';
  path: string;
  date: Date;
  rawValue: unknown;
}

export interface RenewalEstimate {
  date: Date;
  method: 'direct_permit' | 'transfer_cycle' | 'assessment_cycle' | 'update_cycle' | 'generic_cycle';
  reference: Date | null;
}

export type RenewalCategory = 'overdue' | 'due_30' | 'due_60' | 'due_90' | 'future' | 'missing';

export interface CategorisedRenewal {
  estimate: RenewalEstimate | null;
  category: RenewalCategory;
  monthKey: string | null;
}

export function parseDateValue(value: unknown): Date | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    if (value >= 1900 && value <= 2100) {
      return new Date(Date.UTC(value, 0, 1));
    }
    if (value > 1e12) {
      return new Date(value);
    }
    if (value > 1e9) {
      return new Date(value * 1000);
    }
    return new Date(value * 24 * 60 * 60 * 1000);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const isoMatch = trimmed.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const arcgisEpoch = trimmed.match(/\/Date\((\d+)\)\//);
    if (arcgisEpoch) {
      const ms = Number.parseInt(arcgisEpoch[1], 10);
      if (!Number.isNaN(ms)) {
        return new Date(ms);
      }
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return parseDateValue(numeric);
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function classifySignalType(path: string): RenewalSignal['type'] {
  const normalised = path.toLowerCase();
  for (const rule of SIGNAL_TYPE_RULES) {
    if (rule.pattern.test(normalised)) {
      return rule.type;
    }
  }
  return 'generic';
}

function shouldParseValue(path: string, value: unknown): boolean {
  if (!path) {
    return false;
  }
  if (DATE_KEY_HINT.test(path)) {
    return true;
  }
  if (typeof value === 'string' && DATE_VALUE_HINT.test(value)) {
    return true;
  }
  return false;
}

function collectDatesFromValue(value: unknown): Date[] {
  if (Array.isArray(value)) {
    const results: Date[] = [];
    for (const entry of value.slice(0, MAX_SIGNAL_ARRAY_LENGTH)) {
      const parsed = parseDateValue(entry);
      if (parsed) {
        results.push(parsed);
      }
    }
    return results;
  }

  const parsed = parseDateValue(value);
  return parsed ? [parsed] : [];
}

export function collectRenewalSignals(raw: Record<string, unknown> | null | undefined): RenewalSignal[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const results = new Map<string, RenewalSignal>();

  function traverse(value: unknown, path: string, depth: number): void {
    if (depth > MAX_SIGNAL_DEPTH || value == null) {
      return;
    }

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_SIGNAL_ARRAY_LENGTH);
      for (let index = 0; index < limit; index += 1) {
        traverse(value[index], `${path}[${index}]`, depth + 1);
      }
      return;
    }

    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        traverse(child, nextPath, depth + 1);
      }
      return;
    }

    if (!shouldParseValue(path, value)) {
      return;
    }

    const dates = collectDatesFromValue(value);
    if (dates.length === 0) {
      return;
    }

    const type = classifySignalType(path);
    for (const date of dates) {
      if (!date) {
        continue;
      }
      const key = `${type}:${path}:${date.getTime()}`;
      if (!results.has(key)) {
        results.set(key, { type, path, date, rawValue: value });
      }
    }
  }

  traverse(raw, '', 0);
  return Array.from(results.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function inferAssessmentRenewal(signals: RenewalSignal[], today: Date): RenewalEstimate | null {
  if (signals.length === 0) {
    return null;
  }

  const latest = signals[signals.length - 1];
  let baseYear = latest.date.getUTCFullYear();
  if (baseYear % 2 === 0) {
    baseYear += 1;
  }
  let nextYear = baseYear + 2;
  let candidate = new Date(Date.UTC(nextYear, 4, 1));
  while (candidate <= today) {
    nextYear += 2;
    candidate = new Date(Date.UTC(nextYear, 4, 1));
  }
  return { date: candidate, method: 'assessment_cycle', reference: latest.date };
}

function inferCycleRenewal(
  latestSignal: RenewalSignal | null,
  cycleYears: number,
  method: RenewalEstimate['method'],
  today: Date,
): RenewalEstimate | null {
  if (!latestSignal) {
    return null;
  }
  let candidate = addYears(latestSignal.date, cycleYears);
  while (candidate <= today) {
    candidate = addYears(candidate, cycleYears);
  }
  return { date: candidate, method, reference: latestSignal.date };
}

function inferDirectRenewal(signals: RenewalSignal[], today: Date): RenewalEstimate | null {
  if (signals.length === 0) {
    return null;
  }

  const upcoming = signals.find((signal) => signal.date >= today);
  if (upcoming) {
    return { date: upcoming.date, method: 'direct_permit', reference: upcoming.date };
  }

  const latest = signals[signals.length - 1];
  return { date: latest.date, method: 'direct_permit', reference: latest.date };
}

export function estimateRenewal(
  raw: Record<string, unknown> | null | undefined,
  referenceDate: Date = new Date(),
): RenewalEstimate | null {
  const signals = collectRenewalSignals(raw);
  if (signals.length === 0) {
    return null;
  }

  const today = startOfUtcDay(referenceDate);

  const permitSignals = signals.filter((signal) => signal.type === 'permit');
  if (permitSignals.length > 0) {
    return inferDirectRenewal(permitSignals, today);
  }

  const transferSignals = signals.filter((signal) => signal.type === 'transfer');
  if (transferSignals.length > 0) {
    return inferCycleRenewal(transferSignals[transferSignals.length - 1], 1, 'transfer_cycle', today);
  }

  const assessmentSignals = signals.filter((signal) => signal.type === 'assessment');
  if (assessmentSignals.length > 0) {
    return inferAssessmentRenewal(assessmentSignals, today);
  }

  const updateSignals = signals.filter((signal) => signal.type === 'update');
  if (updateSignals.length > 0) {
    return inferCycleRenewal(updateSignals[updateSignals.length - 1], 1, 'update_cycle', today);
  }

  const latest = signals[signals.length - 1] ?? null;
  return inferCycleRenewal(latest, 1, 'generic_cycle', today);
}

export function resolveRenewalCategory(
  estimate: RenewalEstimate | null,
  referenceDate: Date = new Date(),
): CategorisedRenewal {
  if (!estimate) {
    return { estimate: null, category: 'missing', monthKey: null };
  }

  const today = startOfUtcDay(referenceDate);
  const in30 = addDays(today, 30);
  const in60 = addDays(today, 60);
  const in90 = addDays(today, 90);

  const estimateDate = estimate.date;
  if (!(estimateDate instanceof Date) || Number.isNaN(estimateDate.getTime())) {
    return { estimate: null, category: 'missing', monthKey: null };
  }

  if (estimateDate < today) {
    return { estimate, category: 'overdue', monthKey: formatMonthKey(estimateDate) };
  }
  if (estimateDate <= in30) {
    return { estimate, category: 'due_30', monthKey: formatMonthKey(estimateDate) };
  }
  if (estimateDate <= in60) {
    return { estimate, category: 'due_60', monthKey: formatMonthKey(estimateDate) };
  }
  if (estimateDate <= in90) {
    return { estimate, category: 'due_90', monthKey: formatMonthKey(estimateDate) };
  }
  return { estimate, category: 'future', monthKey: formatMonthKey(estimateDate) };
}

export function categoriseRenewal(
  raw: Record<string, unknown> | null | undefined,
  referenceDate: Date = new Date(),
): CategorisedRenewal {
  const estimate = estimateRenewal(raw, referenceDate);
  return resolveRenewalCategory(estimate, referenceDate);
}

export function normaliseMonthKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function computeRenewalMonthKey(date: Date | null | undefined): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return formatMonthKey(date);
}

export { startOfUtcDay };
