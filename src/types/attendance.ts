export const ATTENDANCE_STATUSES = [
  'Present',
  'Absent',
  'Half-day',
  'WFH',
  'Leave',
  'Holiday',
  'Weekend',
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type EntryType = 'manual' | 'admin-entered';

export interface Attendance {
  /** Client-minted UUID, not a sequence - see src/db/schema.ts. */
  id: string;
  /** Stamped from the Saathi's owner; what Row Level Security filters on. */
  owner_id: string;
  emp_id: string;
  date: string; // YYYY-MM-DD
  time_in: string | null; // HH:mm
  time_out: string | null; // HH:mm
  status: AttendanceStatus;
  remarks: string | null;
  entry_type: EntryType;
  entered_by: string | null; // users.id
  /** 1 while the row still has to be pushed to the cloud. */
  pending_sync: number;
  /** Soft delete: set means the row is gone everywhere but the table. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Attendance row joined with the Saathi's name — what lists actually render. */
export interface AttendanceWithEmployee extends Attendance {
  emp_name: string;
  wage_type: WageType;
  wage_amt: number;
  /** The Saathi's own active/inactive state, not this day's attendance. */
  emp_status: Employee['status'];
}

/**
 * `owner_id` is absent on purpose: upsertAttendance derives it from the
 * Saathi's own owner, so no caller can stamp a row with the wrong household.
 */
export type NewAttendance = Omit<
  Attendance,
  | 'id'
  | 'owner_id'
  | 'created_at'
  | 'updated_at'
  | 'entry_type'
  | 'pending_sync'
  | 'deleted_at'
> & { entry_type?: EntryType };

export const WAGE_TYPES = ['Monthly', 'Rokadi', 'Bi-weekly'] as const;
export type WageType = (typeof WAGE_TYPES)[number];

export const EMPLOYEE_STATUSES = ['active', 'inactive'] as const;

/** A "Saathi" — the household helper whose attendance is being tracked. */
export interface Employee {
  /** Client-minted UUID, not a sequence - see src/db/schema.ts. */
  id: string;
  /** The household this Saathi belongs to; was `created_by` before v2. */
  owner_id: string;
  name: string;
  phone: string;
  resi_address: string | null;
  status: 'active' | 'inactive';
  remarks: string | null;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD
  wage_type: WageType;
  wage_amt: number;
  /** 1 while the row still has to be pushed to the cloud. */
  pending_sync: number;
  /** Soft delete: set means the row is gone everywhere but the table. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewEmployee = Omit<
  Employee,
  'id' | 'created_at' | 'updated_at' | 'pending_sync' | 'deleted_at'
>;

export interface Holiday {
  id: number;
  date: string;
  name: string;
  region: string | null;
}
