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
  id: number;
  emp_id: number;
  date: string; // YYYY-MM-DD
  time_in: string | null; // HH:mm
  time_out: string | null; // HH:mm
  status: AttendanceStatus;
  remarks: string | null;
  entry_type: EntryType;
  entered_by: number | null; // users.id
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

export type NewAttendance = Omit<
  Attendance,
  'id' | 'created_at' | 'updated_at' | 'entry_type'
> & { entry_type?: EntryType };

export const WAGE_TYPES = ['Monthly', 'Rokadi', 'Bi-weekly'] as const;
export type WageType = (typeof WAGE_TYPES)[number];

export const EMPLOYEE_STATUSES = ['active', 'inactive'] as const;

/** A "Saathi" — the household helper whose attendance is being tracked. */
export interface Employee {
  id: number;
  name: string;
  phone: string;
  resi_address: string | null;
  status: 'active' | 'inactive';
  remarks: string | null;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD
  wage_type: WageType;
  wage_amt: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export type NewEmployee = Omit<Employee, 'id' | 'created_at' | 'updated_at'>;

export interface Holiday {
  id: number;
  date: string;
  name: string;
  region: string | null;
}
