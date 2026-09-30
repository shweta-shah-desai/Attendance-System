import { z } from 'zod';
import { ATTENDANCE_STATUSES, WAGE_TYPES } from '../types/attendance';
import { fromUi, isFuture, UI_DATE } from './date';

/** Name: letters, spaces and dots only (spec: no other special characters). */
export const NAME_RE = /^[A-Za-z][A-Za-z .]*$/;
/** Indian mobile: exactly 10 digits, first digit 6-9. */
export const PHONE_RE = /^[6-9]\d{9}$/;

export const nameField = (max: number, label = 'Name') =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 letters`)
    .max(max, `${label} can be at most ${max} characters`)
    .regex(NAME_RE, `${label} can only contain letters, spaces and a dot (.)`);

export const phoneRequired = z
  .string()
  .trim()
  .regex(PHONE_RE, 'Enter a valid 10-digit mobile number');

export const phoneOptional = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || PHONE_RE.test(v), 'Enter a valid 10-digit mobile number');

const uiDateOptional = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || fromUi(v) !== null, `Use the ${UI_DATE.toLowerCase()} format`);

/** Required dd/mm/yyyy date that cannot be in the future - the Hajari date. */
const uiDateRequired = z
  .string()
  .trim()
  .min(1, 'Choose a date')
  .refine((v) => fromUi(v) !== null, `Use the ${UI_DATE.toLowerCase()} format`)
  .refine((v) => {
    const db = fromUi(v);
    return !db || !isFuture(db);
  }, 'You cannot mark attendance for a future date');

/** Login popup: name + 10-digit mobile. */
export const loginSchema = z.object({
  name: nameField(50),
  phone: phoneRequired,
});
export type LoginForm = z.infer<typeof loginSchema>;

/** New Saathi / Employee entry form. */
export const employeeSchema = z
  .object({
    name: nameField(50),
    phone: phoneOptional,
    address: z
      .string()
      .trim()
      .max(120, 'Address can be at most 120 characters')
      .optional()
      .or(z.literal('')),
    wage_type: z.enum(WAGE_TYPES, { errorMap: () => ({ message: 'Choose a wage type' }) }),
    wage_amt: z
      .string()
      .trim()
      .min(1, 'Wage amount is required')
      .regex(/^\d+$/, 'Amount must be a whole number in INR (no decimals)')
      .refine((v) => Number(v) > 0, 'Amount must be more than 0')
      .refine((v) => Number(v) <= 1000000, 'Amount looks too large'),
    remarks: z
      .string()
      .trim()
      .max(150, 'Remarks can be at most 150 characters')
      .optional()
      .or(z.literal('')),
    start_date: uiDateOptional,
    end_date: uiDateOptional,
    status: z.enum(['active', 'inactive']),
  })
  .refine(
    (v) => {
      const from = fromUi(v.start_date);
      const till = fromUi(v.end_date);
      return !from || !till || till >= from;
    },
    { message: 'Kaam Till cannot be before Kaam From', path: ['end_date'] },
  );
export type EmployeeForm = z.infer<typeof employeeSchema>;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOptional = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || HHMM_RE.test(v), 'Use 24-hour time, e.g. 09:30');

/** Manual attendance entry form. */
export const attendanceSchema = z
  .object({
    emp_id: z.coerce
      .number({ invalid_type_error: 'Choose a Saathi' })
      .int()
      .positive('Choose a Saathi'),
    date: z
      .string()
      .min(1, 'Choose a date')
      .refine((v) => !isFuture(v), 'You cannot mark attendance for a future date'),
    status: z.enum(ATTENDANCE_STATUSES, { errorMap: () => ({ message: 'Choose a status' }) }),
    time_in: timeOptional,
    time_out: timeOptional,
    remarks: z
      .string()
      .trim()
      .max(200, 'Remarks can be at most 200 characters')
      .optional()
      .or(z.literal('')),
  })
  .refine((v) => !v.time_in || !v.time_out || v.time_out > v.time_in, {
    message: 'Out time must be after In time',
    path: ['time_out'],
  })
  .refine((v) => !(v.status === 'Absent' && (v.time_in || v.time_out)), {
    message: 'An absent day cannot have In/Out times',
    path: ['time_in'],
  });
export type AttendanceForm = z.infer<typeof attendanceSchema>;

/**
 * Hajari (Attendance) screen: the everyday form. Deliberately narrower than
 * attendanceSchema above - Present/Absent only, no in/out times - because that
 * is all the spec asks the user for.
 *
 * emp_id is carried as text (like wage_amt on the Saathi form) so the picker can
 * start out empty; it is filled only by choosing a name from the suggestions,
 * which is what makes the id trustworthy.
 */
export const HAJARI_STATUSES = ['Present', 'Absent'] as const;
export type HajariStatus = (typeof HAJARI_STATUSES)[number];

export const hajariSchema = z.object({
  date: uiDateRequired,
  name: z
    .string()
    .trim()
    .min(1, 'Enter the Saathi name')
    .max(50, 'Name can be at most 50 characters'),
  emp_id: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, 'Pick the Saathi from the suggestion list'),
  status: z.enum(HAJARI_STATUSES, { errorMap: () => ({ message: 'Choose Present or Absent' }) }),
  remarks: z
    .string()
    .trim()
    .max(200, 'Remarks can be at most 200 characters')
    .optional()
    .or(z.literal('')),
});
export type HajariForm = z.infer<typeof hajariSchema>;

/**
 * Auto Hajari (Attendance): one status stamped across a whole period for a
 * single Saathi.
 *
 * The period keys drive the From/To boxes - everything but "custom" fills them
 * in and locks them, so the dates reaching this schema are always a real,
 * past-or-today window whichever way they were chosen.
 */
export const AUTO_PERIODS = [
  'current_month',
  'last_month',
  'last_15',
  'last_7',
  'custom',
] as const;
export type AutoPeriod = (typeof AUTO_PERIODS)[number];

export const autoHajariSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter the Saathi name')
      .max(50, 'Name can be at most 50 characters'),
    emp_id: z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/, 'Pick the Saathi from the suggestion list'),
    period: z.enum(AUTO_PERIODS, { errorMap: () => ({ message: 'Choose a period' }) }),
    from: uiDateRequired,
    to: uiDateRequired,
    status: z.enum(HAJARI_STATUSES, {
      errorMap: () => ({ message: 'Choose Present or Absent' }),
    }),
  })
  .refine(
    (v) => {
      const from = fromUi(v.from);
      const to = fromUi(v.to);
      return !from || !to || to >= from;
    },
    { message: 'To date cannot be before From date', path: ['to'] },
  );
export type AutoHajariForm = z.infer<typeof autoHajariSchema>;

/** Strips everything but digits and clamps to 10 - used by the phone inputs. */
export const sanitizePhone = (raw: string): string => raw.replace(/\D/g, '').slice(0, 10);
/** Blocks disallowed characters while typing a name. */
export const sanitizeName = (raw: string): string => raw.replace(/[^A-Za-z .]/g, '').slice(0, 50);
export const sanitizeAmount = (raw: string): string => raw.replace(/\D/g, '').slice(0, 7);
