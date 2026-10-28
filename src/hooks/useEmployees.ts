import { useCallback, useEffect, useState } from 'react';
import {
  getEmployee,
  listEmployees,
  listWorkingEmployees,
  type EmployeeFilter,
} from '../db/queries/employees';
import type { Employee } from '../types/attendance';
import { useCurrentUserId } from '../store/authStore';

interface Result {
  employees: Employee[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Saathi rows belonging to the signed-in user. Every list in the app is scoped
 * by owner_id, so one household never sees another household's Saathi.
 */
export function useEmployees(filter: Omit<EmployeeFilter, 'ownerId'> = {}): Result {
  const userId = useCurrentUserId();
  const { status = 'all', search, sort = 'name_asc' } = filter;

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEmployees(await listEmployees({ ownerId: userId, status, search, sort }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your Saathi list');
    } finally {
      setLoading(false);
    }
  }, [userId, status, search, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { employees, loading, error, reload };
}

/** The "Working Saathi" list under the New Saathi form: active rows only. */
export function useWorkingSaathi(): Result {
  return useEmployees({ status: 'active', sort: 'recent' });
}

/** One Saathi, for the detail screen reached from the All Saathi eye icon. */
export function useEmployeeDetail(id: string | null) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) {
      setEmployee(null);
      setError('This Saathi could not be found');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await getEmployee(id);
      setEmployee(row);
      if (!row) setError('This Saathi is no longer in your register');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this Saathi');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { employee, loading, error, reload };
}

/**
 * Saathis whose attendance can be marked on a given date: active, created by
 * this user, and inside their Kaam From / Kaam Till period. Feeds the name
 * suggestions on the Hajari form.
 */
export function useMarkableSaathi(date: string): Result {
  const userId = useCurrentUserId();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEmployees(await listWorkingEmployees(userId, date || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your Saathi list');
    } finally {
      setLoading(false);
    }
  }, [userId, date]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { employees, loading, error, reload };
}
