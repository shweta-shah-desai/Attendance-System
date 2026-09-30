import { getDb } from '../client';
import type { User } from '../../types/user';

export async function findUserByPhone(phone: string): Promise<User | null> {
  const db = await getDb();
  return db.getFirstAsync<User>('SELECT * FROM users WHERE phone = ?', phone);
}

export async function getUserById(id: number): Promise<User | null> {
  const db = await getDb();
  return db.getFirstAsync<User>('SELECT * FROM users WHERE id = ?', id);
}

export async function createUser(name: string, phone: string): Promise<User> {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO users (name, phone, status) VALUES (?, ?, ?)',
    name,
    phone,
    'active',
  );
  const created = await getUserById(res.lastInsertRowId);
  if (!created) throw new Error('Could not create the user record');
  return created;
}

/**
 * Login rule from the spec: look the mobile number up; sign the person in if
 * it exists, otherwise create the account and sign them in. If the stored name
 * differs from what was typed, the typed name wins.
 *
 * An inactive row is reactivated on login. Without that, the number would sign
 * in here but be rejected by the session restore on the next app start, which
 * only accepts active users.
 */
export async function loginOrRegister(
  name: string,
  phone: string,
): Promise<{ user: User; isNew: boolean }> {
  const existing = await findUserByPhone(phone);
  if (!existing) {
    return { user: await createUser(name, phone), isNew: true };
  }

  const nameChanged = existing.name !== name;
  const wasInactive = existing.status !== 'active';
  if (nameChanged || wasInactive) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE users SET name = ?, status = 'active' WHERE id = ?",
      name,
      existing.id,
    );
    return { user: { ...existing, name, status: 'active' }, isNew: false };
  }
  return { user: existing, isNew: false };
}

export async function updateUser(
  id: number,
  patch: Partial<Pick<User, 'name' | 'email_id' | 'resi_address' | 'status'>>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const db = await getDb();
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.runAsync(
    `UPDATE users SET ${sets} WHERE id = ?`,
    ...entries.map(([, v]) => v as string),
    id,
  );
}
