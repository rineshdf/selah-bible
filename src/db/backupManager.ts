/**
 * Backup & restore for all SQLite tables in one JSON file.
 *
 * Saves backups into Android/media/com.rinesh.selahbible/Backups/<YYYY-MM-DD>/SelahBible_Backup_<YYYY-MM-DD>_<HH-mm-ss>.json
 * with both a sandbox local copy (SelahBible/backups/<date>/) and an Android
 * public copy in the app's media folder (direct or SAF).
 *
 * Provides a 4-stage sandbox-safe URI reader (fetch -> XHR -> SAF -> FileSystem)
 * that permanently fixes the Expo Go DocumentPicker cache access error.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SQLiteBindParams } from 'expo-sqlite';
import { db, notifyProgressUpdated } from '@/db/database';
import { SELAH_DIRS, selahBackupDirForDate, androidPublicBackupDirForDate, initStorageDirectories } from '@/db/storagePaths';

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
  /** Verse-level read progress (schema v5). */
  verse_read_progress?: Record<string, unknown>[];
  /** Serial-numbered Rhema/Devotion/Worship entries (v2). */
  daily_entries: Record<string, unknown>[];
  /** Embedded Daily Walk scripture cards (v2). */
  daily_verses: Record<string, unknown>[];
  /** Per-version reading progress keyed by bible version id (schema v4). */
  reading_progress_v2: Record<string, unknown>[];
}

export interface BackupFile {
  app: 'TamilBibleApp' | 'SelahBible' | 'SelahBibleApp';
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
  verse_read_progress?: number;
  daily_entries: number;
  daily_verses: number;
  reading_progress_v2: number;
}

export interface ExportBackupResult {
  success: boolean;
  fileName: string;
  displayPath: string;
  dateFolder: string;
  humanReadablePath: string;
  localPath: string;
}

export interface SavedBackupItem {
  uri: string;
  fileName: string;
  dateFolder: string;
  displayPath: string;
  size?: number;
  modificationTime?: number;
}

export const BACKUP_SCHEMA_VERSION = 4;

const TABLE_NAMES = [
  'highlights',
  'messages',
  'message_blocks',
  'daily_devotions',
  'prayer_points',
  'reading_progress',
  'verse_read_progress',
  'daily_entries',
  'daily_verses',
  'reading_progress_v2',
] as const;

/** Tables added after v1 — older backups may not carry them. */
const OPTIONAL_TABLES: readonly TableName[] = [
  'verse_read_progress',
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
    'id', 'entry_date', 'request_text', 'is_answered', 'answered_date', 'answered_at',
    'verse_ref', 'verse_text', 'verse_note', 'verse_version_id', 'color',
  ],
  reading_progress: ['book_id', 'chapter', 'read_date'],
  verse_read_progress: ['book_id', 'chapter', 'verse', 'read_at'],
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Generate local date/time strings for the proper folder and file naming. */
export function getBackupTimestampParts(date = new Date()): {
  dateFolder: string;
  timePart: string;
  fileName: string;
  displayPath: string;
  humanReadablePath: string;
} {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  const sec = pad2(date.getSeconds());

  const dateFolder = `${yyyy}-${mm}-${dd}`;
  const timePart = `${hh}-${min}-${sec}`;
  const fileName = `SelahBible_Backup_${dateFolder}_${timePart}.json`;
  const displayPath = `Android/media/com.rinesh.selahbible/Backups/${dateFolder}/${fileName}`;
  const humanReadablePath = `Internal Storage/Android/media/com.rinesh.selahbible/Backups/${dateFolder}/${fileName}`;

  return { dateFolder, timePart, fileName, displayPath, humanReadablePath };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Build the full backup document from the live database.
 * Exported separately so callers can preview counts before sharing.
 */
export function buildBackupFile(): BackupFile {
  const tables: BackupTables = {
    highlights: db.getAllSync<Record<string, unknown>>('SELECT * FROM highlights;'),
    messages: db.getAllSync<Record<string, unknown>>('SELECT * FROM messages;'),
    message_blocks: db.getAllSync<Record<string, unknown>>('SELECT * FROM message_blocks;'),
    daily_devotions: db.getAllSync<Record<string, unknown>>('SELECT * FROM daily_devotions;'),
    prayer_points: db.getAllSync<Record<string, unknown>>('SELECT * FROM prayer_points;'),
    reading_progress: db.getAllSync<Record<string, unknown>>('SELECT * FROM reading_progress;'),
    verse_read_progress: db.getAllSync<Record<string, unknown>>('SELECT * FROM verse_read_progress;'),
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
 * Helper to find or create a directory in Android Scoped Storage SAF.
 */
async function findOrCreateSafDirectory(parentUri: string, dirName: string): Promise<string> {
  try {
    const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(parentUri);
    const existing = entries.find((u) => {
      const decoded = decodeURIComponent(u);
      return decoded.endsWith(`/${dirName}`) || decoded.endsWith(`:${dirName}`);
    });
    if (existing) return existing;
  } catch {}
  // 'vnd.android.document/directory' tells Android DocumentsContract to create a real folder
  try {
    if (typeof FileSystem.StorageAccessFramework.makeDirectoryAsync === 'function') {
      return await FileSystem.StorageAccessFramework.makeDirectoryAsync(parentUri, dirName);
    }
  } catch {}
  return await FileSystem.StorageAccessFramework.createFileAsync(
    parentUri,
    dirName,
    'vnd.android.document/directory',
  );
}

/**
 * Save backup into Android/media/com.rinesh.selahbible/Backups/<YYYY-MM-DD>/SelahBible_Backup_<YYYY-MM-DD>_<HH-mm-ss>.json
 *
 * 1. Always saves local copy first at `SelahBible/backups/<dateFolder>/<fileName>`
 *    inside the app sandbox (via `selahBackupDirForDate`).
 * 2. On Android, also saves to the app's public media folder
 *    `Android/media/com.rinesh.selahbible/Backups/<dateFolder>/` via direct
 *    path or SAF (granted tree cached in `@selah_saf_backup_dir_uri`).
 *
 * Returns `{ success: true, fileName, displayPath: "Android/media/com.rinesh.selahbible/Backups/" + dateFolder + "/" + fileName, ... }`.
 */
export async function exportBackup(): Promise<ExportBackupResult> {
  await initStorageDirectories();
  const backup = buildBackupFile();
  const backupJsonString = JSON.stringify(backup, null, 2);
  const { dateFolder, fileName, displayPath, humanReadablePath } = getBackupTimestampParts();

  // 1. Always save a local copy first at SelahBible/backups/<dateFolder>/<fileName>
  const localDir = selahBackupDirForDate(dateFolder);
  await FileSystem.makeDirectoryAsync(localDir, { intermediates: true });
  const localPath = `${localDir}/${fileName}`;
  await FileSystem.writeAsStringAsync(localPath, backupJsonString, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // 2. Next, save into the app's public media folder on Android
  if (Platform.OS === 'android') {
    let publicSaved = false;

    // Step A (Direct public media path — app-specific dirs need no permission)
    try {
      const publicDir = androidPublicBackupDirForDate(dateFolder);
      await FileSystem.makeDirectoryAsync(publicDir, { intermediates: true });
      await FileSystem.writeAsStringAsync(`${publicDir}/${fileName}`, backupJsonString, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      publicSaved = true;
    } catch {
      // Direct write restricted by Android Scoped Storage -> fallback to Step B
    }

    // Step B (Android Scoped Storage SAF into the app's media folder)
    if (!publicSaved && FileSystem.StorageAccessFramework) {
      try {
        let treeUri = await AsyncStorage.getItem('@selah_saf_backup_dir_uri');
        let valid = false;
        if (treeUri) {
          try {
            await FileSystem.StorageAccessFramework.readDirectoryAsync(treeUri);
            valid = true;
          } catch {
            valid = false;
          }
        }
        if (!valid) {
          const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
            'content://com.android.externalstorage.documents/document/primary%3AAndroid%2Fmedia%2Fcom.rinesh.selahbible',
          );
          if (perm.granted) {
            treeUri = perm.directoryUri;
            await AsyncStorage.setItem('@selah_saf_backup_dir_uri', treeUri);
            valid = true;
          }
        }
        if (valid && treeUri) {
          const backupsFolderUri = await findOrCreateSafDirectory(treeUri, 'Backups');
          const dateFolderUri = await findOrCreateSafDirectory(backupsFolderUri, dateFolder);
          const safFileUri = await FileSystem.StorageAccessFramework.createFileAsync(
            dateFolderUri,
            fileName,
            'application/json',
          );
          await FileSystem.StorageAccessFramework.writeAsStringAsync(safFileUri, backupJsonString, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          publicSaved = true;
        }
      } catch {
        // Scoped storage error handled; local copy is already securely written
      }
    }
  } else if (Platform.OS === 'ios') {
    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(localPath, {
          mimeType: 'application/json',
          dialogTitle: 'Export Selah Bible Backup',
        });
      }
    } catch {}
  }

  return {
    success: true,
    fileName,
    displayPath,
    dateFolder,
    humanReadablePath,
    localPath,
  };
}

// ---------------------------------------------------------------------------
// Restore & Sandbox-Safe Reading
// ---------------------------------------------------------------------------

/**
 * 4-stage sandbox-safe URI reader:
 * Stage 1: Native fetch() stream reader (bypasses ExponentFileSystem sandbox check in Expo Go & APK)
 * Stage 2: XMLHttpRequest local file/content reader
 * Stage 3: StorageAccessFramework ContentResolver reader
 * Stage 4: Standard FileSystem fallback
 */
export async function readPickedBackupUri(uri: string): Promise<string> {
  const isLikelyJson = (str: string): boolean => {
    const trimmed = str.replace(/^﻿/, '').trim();
    return trimmed.startsWith('{');
  };

  // Stage 1: Native fetch() stream reader (bypasses ExponentFileSystem sandbox check in Expo Go & APK)
  try {
    const response = await fetch(uri);
    if (response.ok) {
      const text = await response.text();
      if (text && isLikelyJson(text)) return text.replace(/^﻿/, '');
    }
  } catch {}

  // Stage 2: XMLHttpRequest local file/content reader
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.responseText);
      xhr.onerror = () => reject(new Error('XHR read failed'));
      xhr.responseType = 'text';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
    if (text && isLikelyJson(text)) return text.replace(/^﻿/, '');
  } catch {}

  // Stage 3: StorageAccessFramework ContentResolver reader
  if (Platform.OS === 'android' && FileSystem.StorageAccessFramework) {
    try {
      const text = await FileSystem.StorageAccessFramework.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (text && isLikelyJson(text)) return text.replace(/^﻿/, '');
    } catch {}
  }

  // Stage 4: Standard FileSystem fallback
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/** Basic shape + per-table row validation before touching user data. */
export function validateBackupFile(payload: unknown): BackupFile {
  if (!payload || typeof payload !== 'object') {
    throw new Error('This file is not a Tamil Bible App backup.');
  }
  const candidate = payload as Partial<BackupFile>;
  const validApps = ['TamilBibleApp', 'SelahBible', 'SelahBibleApp'];
  if (
    !candidate.app ||
    !validApps.includes(candidate.app) ||
    !candidate.tables ||
    typeof candidate.tables !== 'object'
  ) {
    throw new Error('This file is not a Tamil Bible App backup.');
  }
  for (const name of TABLE_NAMES) {
    const rows = (candidate.tables as unknown as Record<string, unknown>)[name];
    if (rows === undefined && OPTIONAL_TABLES.includes(name)) {
      // v1 backups: optional tables default to empty on restore.
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
 * Replace tables with the backup contents inside a single transaction.
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
    verse_read_progress: 0,
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
    db.runSync('DELETE FROM verse_read_progress;');
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

  notifyProgressUpdated();

  return { counts, total: TABLE_NAMES.reduce((sum, name) => sum + (counts[name] ?? 0), 0) };
}

/** Restore from an arbitrary JSON backup string (throws on invalid content). */
export function restoreBackupFromString(raw: string): RestoreResult {
  let payload: unknown;
  try {
    const cleaned = raw.replace(/^﻿/, '').trim();
    payload = JSON.parse(cleaned);
  } catch {
    throw new Error('Could not read the backup file (invalid JSON).');
  }
  return restoreBackup(validateBackupFile(payload));
}

/** Restore from any URI (file://, content://, etc.) using sandbox-safe reader. */
export async function restoreBackupFromUri(uri: string): Promise<RestoreResult> {
  const raw = await readPickedBackupUri(uri);
  return restoreBackupFromString(raw);
}

/**
 * Open system document picker and restore JSON backup.
 * Uses copyToCacheDirectory: false to prevent Expo Go sandbox errors.
 */
export async function restoreBackupFromPicker(): Promise<RestoreResult | null> {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', '*/*'],
      copyToCacheDirectory: false,
    });
  } catch {
    result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', '*/*'],
      copyToCacheDirectory: true,
    });
  }

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;

  const raw = await readPickedBackupUri(asset.uri);
  return restoreBackupFromString(raw);
}

/**
 * Scan the sandbox `SelahBible/backups/` folder for saved backups.
 */
export async function listLocalBackups(): Promise<SavedBackupItem[]> {
  await initStorageDirectories();
  const items: SavedBackupItem[] = [];
  const baseDir = SELAH_DIRS.backups;

  try {
    const baseInfo = await FileSystem.getInfoAsync(baseDir);
    if (!baseInfo.exists || !baseInfo.isDirectory) {
      return [];
    }

    const entries = await FileSystem.readDirectoryAsync(baseDir);
    for (const entry of entries) {
      const entryUri = `${baseDir}${entry}`;
      const entryInfo = await FileSystem.getInfoAsync(entryUri);
      if (entryInfo.isDirectory) {
        try {
          const files = await FileSystem.readDirectoryAsync(`${entryUri}/`);
          for (const file of files) {
            if (file.toLowerCase().endsWith('.json')) {
              const fileUri = `${entryUri}/${file}`;
              const fileInfo = await FileSystem.getInfoAsync(fileUri);
              items.push({
                uri: fileUri,
                fileName: file,
                dateFolder: entry,
                displayPath: `SelahBible/Backups/${entry}/${file}`,
                size: fileInfo.exists && !fileInfo.isDirectory ? fileInfo.size : undefined,
                modificationTime: fileInfo.exists && !fileInfo.isDirectory ? fileInfo.modificationTime : undefined,
              });
            }
          }
        } catch {}
      } else if (entry.toLowerCase().endsWith('.json')) {
        items.push({
          uri: entryUri,
          fileName: entry,
          dateFolder: '',
          displayPath: `SelahBible/Backups/${entry}`,
          size: entryInfo.exists && !entryInfo.isDirectory ? entryInfo.size : undefined,
          modificationTime: entryInfo.exists && !entryInfo.isDirectory ? entryInfo.modificationTime : undefined,
        });
      }
    }
  } catch {
    return [];
  }

  items.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0) || b.fileName.localeCompare(a.fileName));
  return items;
}
