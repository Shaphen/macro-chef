import { eq } from 'drizzle-orm';

import { db } from '../client';
import { settings, type Settings } from '../schema';

export function getSettings(): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) throw new Error('settings row missing — migrations not run?');
  return row;
}

export function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Settings {
  db.update(settings).set(patch).where(eq(settings.id, 1)).run();
  return getSettings();
}
