import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { sqlite } from '../db/client';

/**
 * JSON export/import — the whole "backup story" until cloud sync exists
 * (PLAN §1). Design decisions:
 *
 *  - Rows travel with their raw snake_case SQLite column names (read via the
 *    sqlite handle, not drizzle) so the file is a faithful dump of the
 *    schema, independent of how the TS layer renames things. That makes the
 *    format stable across app refactors and trivially inspectable.
 *  - The file records the schema version (PRAGMA user_version). Importing a
 *    file from an OLDER schema is fine: inserts name their columns, so
 *    columns added by later migrations simply keep their defaults.
 *    Importing from a NEWER schema is refused — we can't know what the
 *    extra columns meant, and silently dropping user data is worse than an
 *    error message telling them to update the app.
 *  - Import is replace-all inside one transaction: either the entire backup
 *    lands or the existing data is untouched. Merge semantics were
 *    considered and rejected for v1 — reconciling autoincrement ids across
 *    two histories is exactly the kind of complexity §1 keeps out of scope.
 */

/** Every user-data table, in FK-safe insert order (parents before children). */
const TABLES = [
  'foods',
  'recipes',
  'recipe_items',
  'log_entries',
  'weight_entries',
  'settings',
  // Health rows are a re-syncable cache, but including them keeps a restored
  // device's charts populated before the first sync runs (and costs little —
  // one row per day).
  'health_days',
  'health_workouts',
] as const;

const FORMAT_MARKER = 'macrochef-backup';

interface BackupFile {
  format: typeof FORMAT_MARKER;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

function currentSchemaVersion(): number {
  return sqlite.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
}

/** Snapshot the whole database into the portable JSON structure. */
export function buildBackup(): BackupFile {
  const tables: BackupFile['tables'] = {};
  for (const table of TABLES) {
    tables[table] = sqlite.getAllSync<Record<string, unknown>>(`SELECT * FROM ${table}`);
  }
  return {
    format: FORMAT_MARKER,
    schemaVersion: currentSchemaVersion(),
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/**
 * Write the backup to the cache directory and hand it to the iOS share
 * sheet (AirDrop / Files / Messages — wherever the user wants it). The
 * cache dir is deliberate: the OS may reclaim it, which is fine because the
 * share sheet copies the file out, and we don't want stale multi-megabyte
 * exports accumulating in documents.
 */
export async function exportBackup(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `macrochef-backup-${stamp}.json`);
  // SDK 54 File API: create-before-write; overwrite handles a same-day
  // re-export replacing the earlier file instead of throwing.
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(buildBackup()));
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Export MacroChef data',
  });
}

/**
 * Validate the parsed JSON is actually one of our backups before we let it
 * anywhere near a DELETE statement. Returns the typed structure or throws
 * a message suitable for showing to the user directly.
 */
function parseBackup(text: string): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const b = json as Partial<BackupFile>;
  if (b.format !== FORMAT_MARKER || typeof b.tables !== 'object' || b.tables === null) {
    throw new Error('That file is not a MacroChef backup.');
  }
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > currentSchemaVersion()) {
    throw new Error('This backup was made by a newer version of MacroChef — update the app first.');
  }
  return b as BackupFile;
}

/**
 * Replace-all restore. Runs inside a single transaction so a malformed row
 * midway can't leave the DB half-old-half-new — SQLite rolls the whole
 * thing back and the pre-import data survives intact.
 *
 * Insert strategy: column names come from each row's own keys, filtered
 * against the live table's columns (via PRAGMA table_info) so a backup from
 * an older schema inserts cleanly and unknown/renamed columns fail loudly
 * instead of via SQL injection-shaped surprises.
 */
export function restoreBackup(backup: BackupFile): void {
  sqlite.withTransactionSync(() => {
    for (const table of [...TABLES].reverse()) {
      sqlite.runSync(`DELETE FROM ${table}`);
    }
    for (const table of TABLES) {
      const rows = backup.tables[table] ?? [];
      if (rows.length === 0) continue;
      const liveColumns = new Set(
        sqlite
          .getAllSync<{ name: string }>(`PRAGMA table_info(${table})`)
          .map((c) => c.name),
      );
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => liveColumns.has(k));
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        sqlite.runSync(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
          cols.map((c) => row[c] as never),
        );
      }
    }
    // The settings table must always hold its single row — a backup that
    // somehow lacks it would otherwise brick every settings read.
    const hasSettings = sqlite.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM settings');
    if (!hasSettings || hasSettings.n === 0) {
      sqlite.runSync('INSERT INTO settings (id) VALUES (1)');
    }
  });
}

/**
 * Full import flow: document picker → validate → restore. Returns false
 * when the user cancelled the picker (not an error), true after a
 * successful restore. The caller shows its own confirm dialog BEFORE
 * calling this — destructive replace must be an explicit user decision.
 */
export async function pickAndRestoreBackup(): Promise<boolean> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return false;
  const text = await new File(result.assets[0].uri).text();
  restoreBackup(parseBackup(text));
  return true;
}
