/**
 * Centralized on-device storage layout for Selah Bible.
 *
 * Sandbox root (created on first launch):
 *   ${FileSystem.documentDirectory}SelahBible/
 *     bibles/      — offline Bible JSON files + per-chapter caches
 *     manifests/   — downloadable-catalog manifests
 *     backups/     — <YYYY-MM-DD>/SelahBible_Backup_<date>_<time>.json
 *
 * Cache scratch area (safe to purge):
 *   ${FileSystem.cacheDirectory}SelahBible/tmp/
 *
 * Android public export target (direct write or SAF fallback):
 *   file:///storage/emulated/0/Android/media/com.rinesh.selahbible/Backups/<YYYY-MM-DD>/
 *
 * `ensureStorageDirectories()` also performs a one-time migration of the
 * legacy layout (`${documentDirectory}bibles/` and loose `TAMIL_BSI.json` /
 * per-chapter cache JSONs at the document root) into the new sandbox root.
 */

import * as FileSystem from 'expo-file-system/legacy';

const DOCUMENT_ROOT = FileSystem.documentDirectory?.endsWith('/')
  ? FileSystem.documentDirectory
  : `${FileSystem.documentDirectory ?? ''}/`;

const CACHE_ROOT = FileSystem.cacheDirectory?.endsWith('/')
  ? FileSystem.cacheDirectory
  : `${FileSystem.cacheDirectory ?? ''}/`;

const APP_ROOT = `${DOCUMENT_ROOT}SelahBible/`;

/** Every sandbox location the app owns, rooted at `<documents>/SelahBible/`. */
export const SELAH_DIRS = {
  root: APP_ROOT,
  bibles: `${APP_ROOT}bibles/`,
  manifests: `${APP_ROOT}manifests/`,
  backups: `${APP_ROOT}backups/`,
  tmp: `${CACHE_ROOT}SelahBible/tmp/`,
} as const;

/** Date-scoped backup folder inside the sandbox: `SelahBible/backups/<date>/`. */
export function selahBackupDirForDate(dateFolder: string): string {
  return `${SELAH_DIRS.backups}${dateFolder}/`;
}

/** Android app-specific public media folder for exported backups. */
export const ANDROID_PUBLIC_BACKUP_BASE = 'file:///storage/emulated/0/Android/media/com.rinesh.selahbible/Backups';

/** Date-scoped Android public export folder. */
export function androidPublicBackupDirForDate(dateFolder: string): string {
  return `${ANDROID_PUBLIC_BACKUP_BASE}/${dateFolder}`;
}

/** File names produced by bibleLoader / backupManager, kept in one pattern. */
const BIBLE_FILE_PATTERN = /^[A-Za-z0-9_-]+(\.chapter\.[0-9]+\.[0-9]+)?\.json$/;

/** Legacy `bibles/` directory used before the SelahBible sandbox root existed. */
const LEGACY_BIBLES_DIR = `${DOCUMENT_ROOT}bibles/`;

let initPromise: Promise<void> | null = null;

/**
 * Create every storage directory exactly once per launch (and run the legacy
 * migration). Concurrent callers share the same promise; a failure resets it
 * so the next caller retries.
 */
export function initStorageDirectories(): Promise<void> {
  if (!initPromise) {
    initPromise = bootstrapStorageDirectories().catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

async function bootstrapStorageDirectories(): Promise<void> {
  for (const dir of [
    SELAH_DIRS.root,
    SELAH_DIRS.bibles,
    SELAH_DIRS.manifests,
    SELAH_DIRS.backups,
    SELAH_DIRS.tmp,
  ]) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  await migrateLegacyBibleFiles();
}

/**
 * One-time migration of legacy on-disk state:
 * 1. Every file from the old `${documentDirectory}bibles/` moves into
 *    `SelahBible/bibles/`; the emptied legacy directory is removed.
 * 2. Loose `TAMIL_BSI.json` / per-chapter cache JSONs sitting directly in the
 *    document root (very old installs) move into `SelahBible/bibles/` too.
 */
async function migrateLegacyBibleFiles(): Promise<void> {
  // 1. Old bibles/ directory -> SelahBible/bibles/
  try {
    const info = await FileSystem.getInfoAsync(LEGACY_BIBLES_DIR);
    if (info.exists && info.isDirectory) {
      const entries = await FileSystem.readDirectoryAsync(LEGACY_BIBLES_DIR);
      for (const entry of entries) {
        try {
          const entryInfo = await FileSystem.getInfoAsync(`${LEGACY_BIBLES_DIR}${entry}`);
          if (entryInfo.exists && !entryInfo.isDirectory && BIBLE_FILE_PATTERN.test(entry)) {
            await moveIfAbsent(`${LEGACY_BIBLES_DIR}${entry}`, `${SELAH_DIRS.bibles}${entry}`);
          }
        } catch {
          // single-file failures never block the rest of the migration
        }
      }
      const leftovers = await FileSystem.readDirectoryAsync(LEGACY_BIBLES_DIR);
      if (leftovers.length === 0) {
        await FileSystem.deleteAsync(LEGACY_BIBLES_DIR, { idempotent: true });
      }
    }
  } catch {
    // legacy dir absent or unreadable -> nothing to migrate
  }

  // 2. Loose bible JSONs at the document root -> SelahBible/bibles/
  try {
    const entries = await FileSystem.readDirectoryAsync(DOCUMENT_ROOT);
    for (const entry of entries) {
      if (!BIBLE_FILE_PATTERN.test(entry) || !isKnownBibleRootFile(entry)) continue;
      try {
        const entryInfo = await FileSystem.getInfoAsync(`${DOCUMENT_ROOT}${entry}`);
        if (entryInfo.exists && !entryInfo.isDirectory) {
          await moveIfAbsent(`${DOCUMENT_ROOT}${entry}`, `${SELAH_DIRS.bibles}${entry}`);
        }
      } catch {
        // single-file failures never block the rest of the migration
      }
    }
  } catch {
    // document root unreadable -> nothing to migrate
  }
}

/** Bible-shaped files legitimately expected at the legacy document root. */
function isKnownBibleRootFile(name: string): boolean {
  return name === 'TAMIL_BSI.json' || name.includes('.chapter.');
}

/** Move `from` to `to` unless the destination already exists (keeps newer copy). */
async function moveIfAbsent(from: string, to: string): Promise<void> {
  const dest = await FileSystem.getInfoAsync(to);
  if (dest.exists) {
    await FileSystem.deleteAsync(from, { idempotent: true });
    return;
  }
  await FileSystem.moveAsync({ from, to });
}
