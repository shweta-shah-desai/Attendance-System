import { AttendanceStatus, WageType } from './attendance';

/** Per-status day counts for one Saathi over a period. */
export interface StatusTally {
  Present: number;
  Absent: number;
  'Half-day': number;
  WFH: number;
  Leave: number;
  Holiday: number;
  Weekend: number;
}

export interface EmployeeMonthSummary {
  empId: number;
  empName: string;
  wageType: WageType;
  wageAmt: number;
  tally: StatusTally;
  /** Days that count as worked: Present + WFH = 1, Half-day = 0.5. */
  payableDays: number;
  /** Calendar days in the month that were not marked at all. */
  unmarkedDays: number;
  totalDays: number;
}

export interface WageBreakdown extends EmployeeMonthSummary {
  /** Denominator used to turn a monthly salary into a per-day rate. */
  basisDays: number;
  perDayRate: number;
  grossWage: number;
  absentDeduction: number;
  netWage: number;
  /** Human-readable explanation shown under the amount. */
  formula: string;
}

export interface MonthlyWageReport {
  month: string; // YYYY-MM
  rows: WageBreakdown[];
  totalNet: number;
}

export interface TrendPoint {
  label: string;
  value: number;
}

export type ReportRange = 'month' | 'last30' | 'year';

export const STATUS_KEYS: AttendanceStatus[] = [
  'Present',
  'Absent',
  'Half-day',
  'WFH',
  'Leave',
  'Holiday',
  'Weekend',
];

export const emptyTally = (): StatusTally => ({
  Present: 0,
  Absent: 0,
  'Half-day': 0,
  WFH: 0,
  Leave: 0,
  Holiday: 0,
  Weekend: 0,
});
