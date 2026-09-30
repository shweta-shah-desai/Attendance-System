import type { EmployeeMonthSummary, WageBreakdown, MonthlyWageReport } from '../types/report';
import { inr, inrPrecise } from './formatters';

/**
 * Wage rules used across GharSaathi+.
 *
 *  lostDays   = Absent + (Half-day / 2) + Leave
 *  workedDays = Present + WFH + (Half-day / 2)
 *
 *  Monthly    fixed salary, pro-rated over the days the Saathi was on the
 *             books that month, minus a per-day cut for every lost day.
 *  Bi-weekly  same idea, but the quoted amount covers 15 days.
 *  Rokadi     paid only for days actually worked; nothing to deduct.
 *
 * Every screen shows the `formula` string so the household owner can see
 * exactly how the number was reached.
 */
export function computeWage(summary: EmployeeMonthSummary, basisDays: number): WageBreakdown {
  const { tally, wageType, wageAmt } = summary;

  const lostDays = tally.Absent + tally['Half-day'] / 2 + tally.Leave;
  const workedDays = tally.Present + tally.WFH + tally['Half-day'] / 2;

  let perDayRate = 0;
  let grossWage = 0;
  let absentDeduction = 0;
  let formula = '';

  switch (wageType) {
    case 'Rokadi': {
      perDayRate = wageAmt;
      grossWage = round(perDayRate * workedDays);
      absentDeduction = 0;
      formula = `${inr(perDayRate)} per day x ${fmtDays(workedDays)} worked`;
      break;
    }
    case 'Bi-weekly': {
      perDayRate = wageAmt / 15;
      grossWage = round(perDayRate * summary.totalDays);
      absentDeduction = round(perDayRate * lostDays);
      formula = `${inr(wageAmt)} per 15 days = ${inrPrecise(perDayRate)}/day x ${fmtDays(
        summary.totalDays,
      )}, minus ${fmtDays(lostDays)} not worked`;
      break;
    }
    case 'Monthly':
    default: {
      perDayRate = wageAmt / basisDays;
      grossWage = round(perDayRate * summary.totalDays);
      absentDeduction = round(perDayRate * lostDays);
      formula =
        summary.totalDays === basisDays
          ? `${inr(wageAmt)} salary, minus ${inrPrecise(perDayRate)}/day x ${fmtDays(lostDays)} not worked`
          : `${inrPrecise(perDayRate)}/day x ${fmtDays(summary.totalDays)} on the books, minus ${fmtDays(
              lostDays,
            )} not worked`;
      break;
    }
  }

  const netWage = Math.max(0, round(grossWage - absentDeduction));

  return {
    ...summary,
    basisDays,
    perDayRate,
    grossWage,
    absentDeduction,
    netWage,
    formula,
  };
}

export function buildMonthlyReport(
  month: string,
  summaries: EmployeeMonthSummary[],
  basisDays: number,
): MonthlyWageReport {
  const rows = summaries.map((s) => computeWage(s, basisDays));
  return {
    month,
    rows,
    totalNet: rows.reduce((sum, r) => sum + r.netWage, 0),
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** "3 days" / "2.5 days" - never shows a trailing .00 */
export const fmtDays = (n: number): string => {
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${text} ${n === 1 ? 'day' : 'days'}`;
};
