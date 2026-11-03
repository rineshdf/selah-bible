/**
 * Backup & restore for all six SQLite tables in one JSON file.
 *
 * Export walks the tables through `@/db/database`, writes a single JSON
 * document into the app cache directory and hands it over to `expo-sharing`
 * (Save to Files / AirDrop / WhatsApp...). Restore picks a file with
 * `expo-document-picker`, validates it and replaces the six tables inside one
 * transaction, keeping every restored id.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import type { SQLiteBindParams } from 'expo-sqlite';
import { db } from '@/db/database';

// ---------------------------------------------------------------------------
// Backup shape
// ---------------------------------------------------------------------------

export interface BackupTables {
  highlights: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  message_blocks: Record<string, unknown>[];
  daily_devotions: Record<string, unknown>[];
  prayer_points: Record<string, unknown>[];
  reading_progress: Record<string, unknown>[];
  /** Serial-numbered Rhema/Devotion/Worship entries (v2). */
  daily_entries: Record<string, unknown>[];
  /** Embedded Daily Walk scripture cards (v2). */
  daily_verses: Record<string, unknown>[];
  /** Per-version reading progress keyed by bible version id (schema v4). */
  reading_progress_v2: Record<string, unknown>[];
}

export interface BackupFile {
  app: 'TamilBibleApp';
  schemaVersion: number;
  exportedAt: string;
  tables: BackupTables;
}

export interface RestoreResult {
  /** Rows imported per table. */
  counts: RestoreCounts;
  /** Sum of all restored rows. */
  total: number;
}

export interface RestoreCounts {
  highlights: number;
  messages: number;
  message_blocks: number;
  daily_devotions: number;
  prayer_points: number;
  reading_progress: number;
  daily_entries: number;
  daily_verses: number;
  reading_progress_v2: number;
}

export const BACKUP_SCHEMA_VERSION = 3;

const TABLE_NAMES = [
  'highlights',
  'messages',
  'message_blocks',
  'daily_devotions',
  'prayer_points',
  'reading_progress',
  'daily_entries',
  'daily_verses',
  'reading_progress_v2',
] as const;

/** Tables added after v1 — older backups may not carry them. */
const OPTIONAL_TABLES: readonly TableName[] = [
  'daily_entries',
  'daily_verses',
  'reading_progress_v2',
];

type TableName = (typeof TABLE_NAMES)[number];

/** Columns per table in insert order; AUTOINCREMENT tables carry `id`. */
const TABLE_COLUMNS: Record<TableName, readonly string[]> = {
  highlights: [
    'id', 'version_id', 'version_key', 'book_id', 'book_name', 'chapter', 'verse',
    'verse_text', 'color_hex', 'created_date',
  ],
  messages: ['id', 'title', 'preacher', 'message_date', 'created_at'],
  message_blocks: [
    'id', 'message_id', 'serial_no', 'block_type', 'content', 'verse_ref',
    'verse_note', 'highlight_color',
  ],
  daily_devotions: [
    'entry_date', 'worship_prayer', 'god_spoke_word', 'god_spoke_color',
    'understanding_today', 'updated_at',
  ],
  prayer_points: [
    'id', 'entry_date', 'request_text', 'is_answered', 'answered_date',
    'verse_ref', 'verse_text', 'verse_note', 'verse_version_id',
  ],
  reading_progress: ['book_id', 'chapter', 'read_date'],
  daily_entries: ['id', 'entry_date', 'section', 'serial_no', 'content', 'highlight_color', 'created_at'],
  daily_verses: [
    'id', 'entry_date', 'section', 'verse_ref', 'verse_text', 'note',
    'version_id', 'version_short_name', 'created_at',
  ],
  reading_progress_v2: ['version_id', 'book_id', 'chapter', 'read_date'],
};

/** Tables whose ids must be re-synced with sqlite_sequence after restore. */
const AUTOINCREMENT_TABLES: readonly TableName[] = [
  'highlights',
  'messages',
  'message_blocks',
  'prayer_points',
];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function timestampSlug(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(), '-',
    pad(date.getMonth() + 1), '-',
    pad(date.getDate()), '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

/**
 * Build the full backup document from the live database.
 * Exported separately so callers can preview counts before sharing.
 */
export function buildBackupFile(): BackupFile {
  const tables = {
    highlights: db.getAllSync<Record<string, unknown>>('SELECT * FROM highlights;'),
    messages: db.getAllSync<Record<string, unknown>>('SELECT * FROM messages;'),
    message_blocks: db.getAllSync<Record<string, unknown>>('SELECT * FROM message_blocks;'),
    daily_devotions: db.getAllSync<Record<string, unknown>>('SELECT * FROM daily_devotions;'),
    prayer_points: db.getAllSync<Record<string, unknown>>('SELECT * FROM prayer_points;'),
    reading_progress: db.getAllSync<Record<string, unknown>>('SELECT * FROM reading_progress;'),
    daily_entries: db.getAllSync<Record<string, unknown>>('SELECT * FROM daily_entries;'),
    daily_verses: db.getAllSync<Record<string, unknown>>('SELECT * FROM daily_verses;'),
    reading_progress_v2: db.getAllSync<Record<string, unknown>>('SELECT * FROM reading_progress_v2;'),
  };
  return {
    app: 'TamilBibleApp',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/**
 * Write every table into one JSON backup and open the system share sheet.
 * Returns the cache file URI that was shared.
 */
export async function exportBackup(): Promise<string> {
  const backup = buildBackupFile();
  const path = `${FileSystem.cacheDirectory ?? ''}TamilBibleApp-backup-${timestampSlug()}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(backup, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (Sharing.isAvailableAsync) {
    const available = await Sharing.isAvailableAsync();
    if (available) {
      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: 'Export Tamil Bible backup',
      });
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** Basic shape + per-table row validation before touching user data. */
export function validateBackupFile(payload: unknown): BackupFile {
  if (!payload || typeof payload !== 'object') {
    throw new Error('This file is not a Tamil Bible App backup.');
  }
  const candidate = payload as Partial<BackupFile>;
  if (
    candidate.app !== 'TamilBibleApp' ||
    !candidate.tables ||
    typeof candidate.tables !== 'object'
  ) {
    throw new Error('This file is not a Tamil Bible App backup.');
  }
  for (const name of TABLE_NAMES) {
    const rows = (candidate.tables as unknown as Record<string, unknown>)[name];
    if (rows === undefined && OPTIONAL_TABLES.includes(name)) {
      // v1 backups: v2 tables default to empty on restore.
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new Error(`Backup is missing the "${name}" table.`);
    }
    if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`Backup table "${name}" has invalid rows.`);
    }
  }
  return candidate as BackupFile;
}

/** Rows of one table, tolerating v1 backups that predate optional tables. */
function tableRows(backup: BackupFile, name: TableName): Record<string, unknown>[] {
  const rows = backup.tables[name];
  return Array.isArray(rows) ? rows : [];
}

function tableValue(name: TableName, row: Record<string, unknown>, column: string): unknown {
  const value = row[column];
  return value === undefined ? null : value;
}

/** Keep sqlite_sequence ahead of every restored explicit id. */
function resyncAutoincrementSequences(): void {
  for (const table of AUTOINCREMENT_TABLES) {
    db.runSync(
      `UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM ${table}) WHERE name = '${table}';`,
    );
  }
}

/**
 * Replace the six tables with the backup contents inside a single transaction.
 * Foreign keys are respected by deleting blocks before their messages.
 */
export function restoreBackup(backup: BackupFile): RestoreResult {
  const counts = {
    highlights: 0,
    messages: 0,
    message_blocks: 0,
    daily_devotions: 0,
    prayer_points: 0,
    reading_progress: 0,
    daily_entries: 0,
    daily_verses: 0,
    reading_progress_v2: 0,
  } as RestoreCounts;

  db.withTransactionSync(() => {
    // Clear children first so FKs stay satisfied (message_blocks -> messages).
    db.runSync('DELETE FROM message_blocks;');
    db.runSync('DELETE FROM messages;');
    db.runSync('DELETE FROM highlights;');
    db.runSync('DELETE FROM daily_entries;');
    db.runSync('DELETE FROM daily_verses;');
    db.runSync('DELETE FROM daily_devotions;');
    db.runSync('DELETE FROM prayer_points;');
    db.runSync('DELETE FROM reading_progress;');
    db.runSync('DELETE FROM reading_progress_v2;');

    for (const name of TABLE_NAMES) {
      const columns = TABLE_COLUMNS[name];
      const rows = tableRows(backup, name);
      for (const row of rows) {
        const values = columns.map((column) => tableValue(name, row, column)) as SQLiteBindParams;
        const placeholders = columns.map(() => '?').join(', ');
        db.runSync(
          `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${placeholders});`,
          values,
        );
      }
      counts[name] = rows.length;
    }

    // Older backups carry no reading_progress_v2 rows: mirror the legacy
    // per-book progress into the versioned table under TAMIL_BSI so the
    // Progress tab keeps showing that history instead of starting empty.
    const hasVersionedProgress = tableRows(backup, 'reading_progress_v2').length > 0;
    if (!hasVersionedProgress && counts.reading_progress > 0) {
      db.runSync(
        `INSERT INTO reading_progress_v2 (version_id, book_id, chapter, read_date)
         SELECT 'TAMIL_BSI', book_id, chapter, read_date FROM reading_progress;`,
      );
      counts.reading_progress_v2 = counts.reading_progress;
    }

    resyncAutoincrementSequences();
  });

  return { counts, total: TABLE_NAMES.reduce((sum, name) => sum + counts[name], 0) };
}

/** Restore from an arbitrary JSON backup string (throws on invalid content). */
export function restoreBackupFromString(raw: string): RestoreResult {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('Could not read the backup file (invalid JSON).');
  }
  return restoreBackup(validateBackupFile(payload));
}

/**
 * Open the system document picker and restore whatever JSON backup the user
 * selects. Returns the row counts, or null when the picker was dismissed.
 */
export async function restoreBackupFromPicker(): Promise<RestoreResult | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const raw = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return restoreBackupFromString(raw);
}
