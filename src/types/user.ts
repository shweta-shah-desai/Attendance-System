export type Status = 'active' | 'inactive';

/** A login account — the person who owns the household / marks attendance. */
export interface User {
  id: number;
  name: string;
  email_id: string | null;
  phone: string; // 10 digits, no +91 prefix stored
  resi_address: string | null;
  status: Status;
  created_at: string; // ISO string
  updated_at: string;
}

export type NewUser = Pick<User, 'name' | 'phone'> &
  Partial<Pick<User, 'email_id' | 'resi_address' | 'status'>>;

export interface Session {
  userId: number;
  name: string;
  phone: string;
  issuedAt: string;
}
