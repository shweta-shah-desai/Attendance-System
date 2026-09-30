import { colors, tints } from '../constants/colors';
import { AttendanceStatus, WageType } from '../types/attendance';

const RUPEE = '₹';

/** Rs 1,200 - Indian digit grouping, no decimals (spec: whole rupees). */
export const inr = (amount: number): string =>
  `${RUPEE}${Math.round(amount).toLocaleString('en-IN')}`;

/** Two-decimal variant, used only for computed per-day rates. */
export const inrPrecise = (amount: number): string =>
  `${RUPEE}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const phoneUi = (phone?: string | null): string =>
  phone ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : '-';

/** "98765 43210" - the table variant, where the +91 column prefix is implied. */
export const phoneShort = (phone?: string | null): string =>
  phone ? phone.slice(0, 5) + ' ' + phone.slice(5) : '-';

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export const truncate = (text: string | null | undefined, max: number): string => {
  if (!text) return '-';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** "1200 (Monthly)" - the All-Saathi table format from the spec. */
export const wageLabel = (amt: number, type: WageType): string => `${inr(amt)} (${type})`;

export const wageTypeHelp: Record<WageType, string> = {
  Monthly: 'Fixed salary every month',
  Rokadi: 'Paid for each day worked',
  'Bi-weekly': 'Paid every 15 days',
};

export interface StatusMeta {
  label: string;
  short: string;
  color: string;
  tint: string;
  icon: string;
  /** How much of a working day this status is worth when calculating wages. */
  weight: number;
  hint: string;
}

/** One place that decides how every status looks and what it is worth. */
export const statusMeta: Record<AttendanceStatus, StatusMeta> = {
  Present: {
    label: 'Present',
    short: 'P',
    color: colors.success,
    tint: tints.success,
    icon: 'check-circle',
    weight: 1,
    hint: 'Saathi came and did the work',
  },
  Absent: {
    label: 'Absent',
    short: 'A',
    color: colors.error,
    tint: tints.error,
    icon: 'close-circle',
    weight: 0,
    hint: 'Saathi did not come - wage is cut for this day',
  },
  'Half-day': {
    label: 'Half-day',
    short: 'H',
    color: colors.warning,
    tint: tints.warning,
    icon: 'circle-half-full',
    weight: 0.5,
    hint: 'Came for half the work - half wage',
  },
  WFH: {
    label: 'Work from home',
    short: 'W',
    color: colors.info,
    tint: tints.info,
    icon: 'home-heart',
    weight: 1,
    hint: 'Worked from another place - full wage',
  },
  Leave: {
    label: 'Leave',
    short: 'L',
    color: colors.secondary,
    tint: tints.secondary,
    icon: 'palm-tree',
    weight: 0,
    hint: 'Approved leave - not counted as a working day',
  },
  Holiday: {
    label: 'Holiday',
    short: 'F',
    color: colors.primary,
    tint: colors.primaryTint,
    icon: 'flag-variant',
    weight: 1,
    hint: 'Festival or declared holiday - paid',
  },
  Weekend: {
    label: 'Weekly off',
    short: 'O',
    color: colors.textSecondary,
    tint: tints.neutral,
    icon: 'calendar-weekend',
    weight: 1,
    hint: 'Weekly rest day - paid',
  },
};

export const pluralise = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

export const percent = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.round((part / whole) * 100);

/**
 * The employees table stores active / inactive; the spec shows the user
 * "Working" / "Not Working". This is the only place that mapping lives.
 */
export const employeeStatusLabel = (status: 'active' | 'inactive'): string =>
  status === 'active' ? 'Working' : 'Not Working';
