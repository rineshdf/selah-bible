/**
 * Offline Bible file manager. Downloaded/seeded Bibles live in
 * `${FileSystem.documentDirectory}bibles/`:
 *
 * - `${versionId}.json`                  — whole-Bible (bundled seed or downloaded)
 * - `${versionId}.chapter.${b}.${c}.json`— helloao per-chapter payload cache
 * - `${versionId}.partial.json`          — in-flight download, deleted once processed
 *
 * All local files use a single normalized shape (LocalBibleFile) so the reader
 * never has to know where the verses came from.
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUNDLED_VERSION_ID,
  findDefaultVersion,
  fuzzyMatchScore,
  languageDisplayLabel,
  loadCachedOnlineCatalog,
  POPULAR_BIBLE_VERSIONS,
  TAMIL_BSI_DOWNLOAD_URL,
  type DownloadableVersion,
} from '@/constants/versionCatalog';
import { BIBLE_BOOKS, getBookById } from '@/constants/books';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChapterVerse {
  verse: number;
  text: string;
}

export interface LocalBibleBook {
  /** Canonical book id 1-66 matching `BIBLE_BOOKS` from `@/constants/books`. */
  id: number;
  /** Display name in the version's own language. */
  name: string;
  /** helloao USFM book code (GEN, EXO, MAT...) when known. */
  helloaoBookId?: string;
  /** Chapter number (as string key) -> verses in reading order. */
  chapters: Record<string, ChapterVerse[]>;
}

export interface LocalBibleFile {
  versionId: string;
  versionName: string;
  language: string;
  languageCode: string;
  books: LocalBibleBook[];
}

export interface DownloadProgress {
  versionId: string;
  /** 0-100, rounded down. */
  percent: number;
  bytesWritten: number;
  totalBytes: number;
}

/** Raw helloao verse item inside `chapter.content` (subset). */
interface HelloaoContentItem {
  type?: string;
  number?: number;
  text?: string;
  content?: string | string[];
}

/** Raw helloao `complete.simple.json` (subset used for normalization). */
interface HelloaoCompleteFile {
  translation?: {
    id?: string;
    name?: string;
    shortName?: string;
    englishName?: string;
    language?: string;
    languageName?: string;
    languageEnglishName?: string;
  };
  books?: {
    id: string;
    name?: string;
    commonName?: string;
    order?: number;
    chapters?: {
      chapter?: {
        number?: number;
        content?: HelloaoContentItem[];
      };
    }[];
  }[];
}

/** Raw helloao per-chapter payload (`.simple.json` / `.json`). */
interface HelloaoChapterPayload {
  chapter?: {
    number?: number;
    content?: HelloaoContentItem[];
  };
}

interface CachedChapterFile {
  versionId: string;
  bookId: number;
  chapter: number;
  verses: ChapterVerse[];
}

/** One verse item inside a `godlytalias` chapter array (`{ Verse: "..." }`). */
interface RawGodlytaliasVerse {
  Verse?: string;
  verse?: string;
  VerseNumber?: number;
  VerseID?: number;
  [key: string]: unknown;
}

/** One book inside a `godlytalias` payload (`{ BookName, Chapter: [...] }`). */
interface RawGodlytaliasBook {
  BookName?: string;
  BookNameEN?: string;
  book?: string;
  name?: string;
  Chapter?: unknown[];
  chapters?: unknown[];
  [key: string]: unknown;
}

/**
 * `godlytalias` whole-Bible payload: `{ Book: [{ BookName, Chapter:
 * [ [ { Verse: "..." }, ... ], ... ] }] }` — chapter verses carry their text
 * on `.Verse` and their position defines the verse number.
 */
interface RawGodlytaliasFile {
  Book?: RawGodlytaliasBook[];
  books?: RawGodlytaliasBook[];
  [key: string]: unknown;
}

/**
 * `thiagobodruk` whole-Bible payload: a 66-entry array (or a record keyed by
 * book number) where each book is an array of chapters and each chapter is an
 * array of verse strings (or `{ verse|Verse: "..." }` items), e.g.
 * `["[...]","[...]"]`.
 */
type RawThiagobodrukFile = unknown[] | Record<string, unknown[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 66 USFM book codes in canonical order (GEN=1 ... REV=66). */
const USFM_BOOK_CODES = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS',
  '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];

/** Canonical book id -> USFM code, e.g. 1 -> GEN, 43 -> JHN. */
const USFM_BY_BOOK_ID: Record<number, string> = Object.fromEntries(
  USFM_BOOK_CODES.map((code, index) => [index + 1, code]),
);

const ACTIVE_VERSION_KEY = 'bible.activeVersionId';

/**
 * Canonical bundled identifier. Every spelling of the bundled Tamil BSI
 * ("tamil bsi", "tamil_bsi", "Tamil-BSI", ...) normalizes to this constant so
 * stale ids from backups or older builds can never break offline reads.
 */
export const TAMIL_BSI_ID = 'TAMIL_BSI';

/**
 * Normalize any persisted version id. Missing/blank/any-"tamil bsi" ids
 * always resolve to `TAMIL_BSI`; other ids return trimmed and unchanged.
 */
export function normalizeVersionId(id?: string | null): string {
  if (!id) return TAMIL_BSI_ID;
  const cleaned = id.toLowerCase().replace(/[\s_.-]+/g, '');
  if (cleaned === 'tamilbsi' || cleaned === 'tamilbsiov' || cleaned === 'bsi') return TAMIL_BSI_ID;
  return id.trim();
}

/** True when the id refers to the always-offline bundled Tamil BSI. */
export function isBundledVersionId(id?: string | null): boolean {
  return normalizeVersionId(id) === TAMIL_BSI_ID;
}

// ---------------------------------------------------------------------------
// Human-readable metadata for raw technical ids (`eng_bbe`, `eng_kjv`, ...)
// ---------------------------------------------------------------------------

interface KnownVersionMeta {
  name: string;
  shortName: string;
  languageName: string;
  languageCode: string;
}

/**
 * Built-in dictionary of common translation ids so a raw technical id like
 * `eng_bbe` or `kjt_luk` can NEVER appear as a card title, even when both the
 * curated catalog and the cached online catalog are unavailable.
 */
const KNOWN_RAW_VERSION_IDS: Record<string, KnownVersionMeta> = {
  'eng_kjv': { name: 'King James Version', shortName: 'KJV', languageName: 'English', languageCode: 'eng' },
  'eng_bbe': { name: 'Bible in Basic English', shortName: 'BBE', languageName: 'English', languageCode: 'eng' },
  'eng_web': { name: 'World English Bible', shortName: 'WEB', languageName: 'English', languageCode: 'eng' },
  'ENGWEBP': { name: 'World English Bible Protestant', shortName: 'WEBP', languageName: 'English', languageCode: 'eng' },
  'tam_irv': { name: 'Tamil Indian Revised Version Bible', shortName: 'Tamil IRV', languageName: 'Tamil', languageCode: 'tam' },
  'hin_irv': { name: 'Hindi Indian Revised Version Bible', shortName: 'Hindi IRV', languageName: 'Hindi', languageCode: 'hin' },
  'HINIRV': { name: 'Hindi Indian Revised Version Bible', shortName: 'Hindi IRV', languageName: 'Hindi', languageCode: 'hin' },
  'mal_irv': { name: 'Malayalam Indian Revised Version Bible', shortName: 'Malayalam IRV', languageName: 'Malayalam', languageCode: 'mal' },
  'tel_irv': { name: 'Telugu Indian Revised Version Bible', shortName: 'Telugu IRV', languageName: 'Telugu', languageCode: 'tel' },
  'kan_irv': { name: 'Kannada Indian Revised Version Bible', shortName: 'Kannada IRV', languageName: 'Kannada', languageCode: 'kan' },
  'kjt_luk': { name: 'The Book of Luke in Karen Pwo Phrae', shortName: 'Karen Pwo Phrae Luke', languageName: 'Phrae Pwo Karen', languageCode: 'kjt' },
  'kjt_ea': { name: 'Tun (Karen Pwo Phrae)', shortName: 'KPP', languageName: 'Phrae Pwo Karen', languageCode: 'kjt' },
};

/** True when a stored title is still a raw id (`eng_bbe`, `kjt_luk`, ...). */
function isRawVersionIdName(id: string, name: string): boolean {
  const candidate = name.trim();
  if (!candidate) return true;
  if (/[/_.]/.test(candidate)) return true;
  return candidate.toLowerCase() === id.trim().toLowerCase();
}

/** True when any stored field of this registry entry is still a raw id. */
function hasRawVersionIdName(meta: BibleVersionMeta): boolean {
  return isRawVersionIdName(meta.id, meta.name) || isRawVersionIdName(meta.id, meta.shortName);
}

/** Resolve true human metadata for a version id: dictionary -> curated catalog. */
function resolveKnownVersionMeta(versionId: string): KnownVersionMeta | null {
  const normalized = normalizeVersionId(versionId);
  const direct = KNOWN_RAW_VERSION_IDS[versionId]
    ?? KNOWN_RAW_VERSION_IDS[versionId.toLowerCase()]
    ?? KNOWN_RAW_VERSION_IDS[normalized];
  if (direct) return direct;
  const known = findDefaultVersion(versionId);
  if (known) {
    return {
      name: known.name,
      shortName: known.shortName,
      languageName: known.languageName,
      languageCode: known.languageCode,
    };
  }
  const popular = POPULAR_BIBLE_VERSIONS.find(
    (version) => version.id.toLowerCase() === normalized.toLowerCase(),
  );
  if (popular) {
    return {
      name: popular.name,
      shortName: popular.shortName,
      languageName: popular.languageName,
      languageCode: popular.languageCode,
    };
  }
  return null;
}

/** Prefer the human title over a version field that still looks like an id. */
function pickHumanVersionName(...candidates: (string | undefined | null)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (!trimmed) continue;
    return trimmed;
  }
  return 'Bible';
}

/** Compact display language code for styled pills: TAM, MAL, ENG, HIN... */
export function languageShortCode(
  meta?: Pick<BibleVersionMeta, 'language' | 'languageCode' | 'id'> | null,
): string {
  const code = (meta?.languageCode ?? '').trim().toLowerCase();
  if (code) return code.slice(0, 3).toUpperCase();
  const language = (meta?.language ?? '').trim().toLowerCase();
  if (language.startsWith('tamil')) return 'TAM';
  if (language.startsWith('english')) return 'ENG';
  if (language.startsWith('malayalam')) return 'MAL';
  if (language.startsWith('hindi')) return 'HIN';
  if (language.startsWith('telugu')) return 'TEL';
  if (language.startsWith('kannada')) return 'KAN';
  if (language.startsWith('karen')) return 'KJT';
  const id = (meta?.id ?? '').trim();
  const prefix = id.split(/[_.\s-]/)[0] || id.slice(0, 3);
  return prefix ? prefix.toUpperCase() || 'ENG' : 'ENG';
}

// ---------------------------------------------------------------------------
// Native book names per installed version (`getLocalizedBookName` support)
// ---------------------------------------------------------------------------

/** Bible version metadata as needed for localized book-name resolution. */
export interface VersionMetaForBooks {
  id: string;
  language: string;
  languageCode: string;
}

/**
 * Native book names (`{ 1: 'ഉല്‍പത്തി', ... }`) read from the version's own
 * parsed Bible JSON (helloao `book.name`, godlytalias `BookName`, ...). The
 * bundled Tamil BSI resolves its native names from `@/constants/books`
 * directly, so an empty map is returned for it. Results are cached.
 */
const customBookNamesCache = new Map<string, Record<number, string>>();

export async function getVersionBookNames(
  versionId: string,
): Promise<Record<number, string>> {
  const normalized = normalizeVersionId(versionId);
  const cached = customBookNamesCache.get(normalized);
  if (cached) return cached;
  const names: Record<number, string> = {};
  try {
    if (!isBundledVersionId(normalized)) {
      const local = await readLocalBibleFile(normalized);
      if (local) {
        local.books.forEach((book, index) => {
          const canonicalId = book.id >= 1 && book.id <= 66 ? book.id : index + 1;
          if (!names[canonicalId]) names[canonicalId] = book.name;
        });
      }
    }
  } catch {
    // Missing file / parse failure: the UI falls back to the dictionaries.
  }
  customBookNamesCache.set(normalized, names);
  return names;
}

/** Overall language label & id of the version, whatever is known about it. */
export async function getVersionMetaForBooks(
  versionId: string,
): Promise<VersionMetaForBooks> {
  const normalized = normalizeVersionId(versionId);
  const known = resolveKnownVersionMeta(normalized);
  let language = known?.languageName ?? '';
  let languageCode = known?.languageCode ?? '';
  try {
    const local = await readLocalBibleFile(normalized);
    if (local) {
      language = local.language || language;
      languageCode = local.languageCode || languageCode;
    }
  } catch {
    // Keep the dictionary values.
  }
  return { id: normalized, language, languageCode };
}

// ---------------------------------------------------------------------------
// On-device version registry (`@installed_bible_versions_v2`)
// ---------------------------------------------------------------------------

export const INSTALLED_REGISTRY_KEY = '@installed_bible_versions_v2';

/** Metadata for one Bible version installed on this device. */
export interface BibleVersionMeta {
  id: string;
  name: string;
  shortName: string;
  language: string;
  /** Storage format, e.g. "json". */
  format: string;
  /** ISO timestamp of the install, "" when unknown. */
  installedAt: string;
  /** ISO-ish language code ("tam", "eng"...) when known — styled UIs use it. */
  languageCode?: string;
}

/** Canonical display metadata of the bundled Tamil BSI. */
export const DEFAULT_TAMIL_BSI_META: BibleVersionMeta = {
  id: TAMIL_BSI_ID,
  name: 'பரிசுத்த வேதாகமம் (Tamil BSI)',
  shortName: 'தமிழ் BSI',
  language: 'Tamil (தமிழ்)',
  format: 'json',
  installedAt: '',
  languageCode: 'tam',
};

/**
 * Legacy file stem written by older builds (`bibles/tamil_bsi.json`).
 * The first-launch installer migrates it to the canonical `TAMIL_BSI.json`.
 */
const LEGACY_BUNDLED_STEM = 'tamil_bsi';

/**
 * Map a normalized version id onto its local file stem. Every offline Bible
 * lives at `bibles/<versionId>.json`; the bundled Tamil BSI is stored as the
 * canonical `bibles/TAMIL_BSI.json`.
 */
function fileStemForVersionId(versionId: string): string {
  return isBundledVersionId(versionId) ? TAMIL_BSI_ID : versionId;
}

let cachedTamilBsi: any = null;
let normalizedTamilBsi: LocalBibleFile | null = null;

function getCachedTamilBsi(): any {
  if (!cachedTamilBsi) {
    cachedTamilBsi = require('../../assets/bibles/tamil_bsi.json');
  }
  return cachedTamilBsi;
}

function getBundledTamilBsi(): LocalBibleFile {
  if (!normalizedTamilBsi) {
    const normalized = normalizeAnyBiblePayload(BUNDLED_VERSION_ID, getCachedTamilBsi());
    if (!normalized) {
      throw new Error('The bundled Tamil BSI Bible has an unsupported format.');
    }
    normalizedTamilBsi = normalized;
  }
  return normalizedTamilBsi;
}

/** Read one chapter from any supported full-Bible payload shape. */
function extractChapterVerses(
  rawData: unknown,
  bookId: number,
  chapterNum: number,
): ChapterVerse[] {
  if (!Number.isInteger(bookId) || bookId < 1 || bookId > 66 ||
    !Number.isInteger(chapterNum) || chapterNum < 1 || !rawData || typeof rawData !== 'object') {
    return [];
  }

  const data = rawData as {
    books?: unknown[];
    Book?: unknown[];
  };
  const bookIndex = bookId - 1;
  const chapterIndex = chapterNum - 1;
  const books = data.books ?? data.Book;
  const rawBook = Array.isArray(books) ? books[bookIndex] : undefined;
  const bookRecord = rawBook && typeof rawBook === 'object'
    ? rawBook as { chapters?: unknown; Chapter?: unknown }
    : undefined;
  const rawChapters = bookRecord?.chapters ?? bookRecord?.Chapter;
  const rawChapter = Array.isArray(rawChapters)
    ? rawChapters[chapterIndex]
    : rawChapters && typeof rawChapters === 'object'
      ? (rawChapters as Record<string, unknown>)[String(chapterNum)]
      : undefined;
  if (Array.isArray(rawChapter)) {
    return rawChapter
      .map((verse, index) => {
        const parsed = parseThiagobodrukVerse(verse, index + 1);
        return parsed ? { verse: parsed.verse, text: parsed.text } : null;
      })
      .filter((verse): verse is ChapterVerse => verse !== null);
  }
  if (rawChapter && typeof rawChapter === 'object') {
    const parsed = parseGodlytaliasChapter(rawChapter);
    if (parsed.length > 0) return parsed;
  }

  if (Array.isArray(rawData)) {
    const rawArrayBook = rawData[bookIndex];
    const thiagobodrukChapters = Array.isArray(rawArrayBook)
      ? rawArrayBook
      : rawArrayBook && typeof rawArrayBook === 'object'
        ? (rawArrayBook as { chapters?: unknown[] }).chapters
        : undefined;
    const thiagobodrukVerses = thiagobodrukChapters?.[chapterIndex];
    if (Array.isArray(thiagobodrukVerses)) {
      return thiagobodrukVerses
        .map((verse, index) => {
          const parsed = parseThiagobodrukVerse(verse, index + 1);
          return parsed ? { verse: parsed.verse, text: parsed.text } : null;
        })
        .filter((verse): verse is ChapterVerse => verse !== null);
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Paths & directory
// ---------------------------------------------------------------------------

export function biblesDirectoryPath(): string {
  return `${FileSystem.documentDirectory ?? ''}bibles/`;
}

function bibleFilePath(versionId: string): string {
  return `${biblesDirectoryPath()}${fileStemForVersionId(versionId)}.json`;
}

function chapterCachePath(versionId: string, bookId: number, chapter: number): string {
  return `${biblesDirectoryPath()}${fileStemForVersionId(versionId)}.chapter.${bookId}.${chapter}.json`;
}

/** Create the `bibles/` directory when missing (safe to call repeatedly). */
export async function ensureBiblesDirectory(): Promise<string> {
  const dir = biblesDirectoryPath();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/** Cheap check: does `bibles/TAMIL_BSI.json` exist with a full-Bible size? */
export async function isTamilBsiDiskReady(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(bibleFilePath(TAMIL_BSI_ID));
    return info.exists && (info.size ?? 0) > 1_000_000;
  } catch {
    return false;
  }
}

/** Structural validation for a normalized Tamil BSI payload. */
function validateBsiShape(normalized: LocalBibleFile): boolean {
  if (normalized.books.length !== 66) return false;
  let chapters = 0;
  let verses = 0;
  for (const book of normalized.books) {
    for (const chapterVerses of Object.values(book.chapters)) {
      chapters += 1;
      verses += chapterVerses.length;
    }
  }
  return chapters >= 1_189 && verses >= 30_000;
}

function assertValidTamilBsi(normalized: LocalBibleFile | null, source: string): LocalBibleFile {
  if (!normalized || !validateBsiShape(normalized)) {
    throw new Error(
      `The ${source} does not contain the complete 66-book / 1,189-chapter Tamil BSI Bible.`,
    );
  }
  return normalized;
}

/** Serialize a normalized BSI into the on-disk shape `{ version, books: [...] }`. */
function tamilBsiDiskPayload(normalized: LocalBibleFile): Record<string, unknown> {
  return {
    version: TAMIL_BSI_ID,
    versionName: DEFAULT_TAMIL_BSI_META.name,
    language: DEFAULT_TAMIL_BSI_META.language,
    languageCode: DEFAULT_TAMIL_BSI_META.languageCode,
    books: normalized.books.map((book) => ({
      bookId: book.id,
      name: book.name,
      chapters: Object.keys(book.chapters)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => book.chapters[key].map((verse) => verse.text)),
    })),
  };
}

/** Register the bundled Tamil BSI in the on-device version registry. */
async function registerTamilBsiFromDisk(): Promise<void> {
  await registerInstalledVersion({
    ...DEFAULT_TAMIL_BSI_META,
    installedAt: DEFAULT_TAMIL_BSI_META.installedAt || new Date().toISOString(),
  });
  // Drop the legacy seed copy now that the canonical file exists.
  await FileSystem.deleteAsync(`${biblesDirectoryPath()}${LEGACY_BUNDLED_STEM}.json`, {
    idempotent: true,
  });
}

/** Parse + validate any TAMIL_BSI json file from disk (size gate + shape check). */
async function isTamilBsiFileValid(path: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || (info.size ?? 0) <= 1_000_000) return false;
    const payload = await readJsonFile<unknown>(path);
    if (!payload) return false;
    const normalized = normalizeAnyBiblePayload(TAMIL_BSI_ID, payload);
    return normalized !== null && validateBsiShape(normalized);
  } catch {
    return false;
  }
}

let tamilInstallPromise: Promise<void> | null = null;
const tamilProgressListeners = new Set<(pct: number) => void>();

function emitTamilProgress(pct: number): void {
  for (const listener of tamilProgressListeners) listener(pct);
}

/**
 * First-launch auto-install of the complete Tamil BSI Bible.
 *
 * Idempotent and safe to call on every launch: when
 * `bibles/TAMIL_BSI.json` already exists and holds the full 66-book Bible
 * (>1MB), it only refreshes the `@installed_bible_versions_v2` registry.
 * Otherwise the full Bible is materialized from the bundled asset when its
 * JSON is >5MB, or downloaded from the godlytalias mirror, normalized to
 * `{ version: 'TAMIL_BSI', books: [...] }`, written to disk and registered.
 *
 * @param onProgress optional 0-100 percent callback (multiple listeners OK).
 */
export async function ensureDefaultTamilBsiInstalled(
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (onProgress) tamilProgressListeners.add(onProgress);
  try {
    if (!tamilInstallPromise) {
      tamilInstallPromise = runDefaultTamilBsiInstall().finally(() => {
        tamilInstallPromise = null;
        emitTamilProgress(100);
      });
    }
    await tamilInstallPromise;
  } finally {
    if (onProgress) tamilProgressListeners.delete(onProgress);
  }
}

async function runDefaultTamilBsiInstall(): Promise<void> {
  const canonicalPath = bibleFilePath(TAMIL_BSI_ID);

  emitTamilProgress(2);
  if (await isTamilBsiFileValid(canonicalPath)) {
    await registerTamilBsiFromDisk();
    emitTamilProgress(100);
    return;
  }

  // 1. Prefer the bundled full asset (>5MB) — no network and always complete.
  try {
    const rawAsset = getCachedTamilBsi();
    emitTamilProgress(20);
    const normalized = assertValidTamilBsi(
      normalizeAnyBiblePayload(TAMIL_BSI_ID, rawAsset),
      'bundled Tamil Bible asset',
    );
    emitTamilProgress(45);
    const diskPayload = tamilBsiDiskPayload(normalized);
    await ensureBiblesDirectory();
    emitTamilProgress(65);
    await FileSystem.writeAsStringAsync(canonicalPath, JSON.stringify(diskPayload), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    emitTamilProgress(85);
    await registerTamilBsiFromDisk();
    emitTamilProgress(100);
    return;
  } catch {
    // Bundled asset unreadable/invalid — fall through to the network copy.
  }

  // 2. Network fallback: the godlytalias Tamil whole-Bible JSON.
  emitTamilProgress(10);
  const response = await fetch(TAMIL_BSI_DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`Could not download the Tamil BSI Bible (HTTP ${response.status}).`);
  }
  emitTamilProgress(40);
  const rawText = await response.text();
  const parsed: unknown = JSON.parse(rawText);
  emitTamilProgress(60);
  const normalized = assertValidTamilBsi(
    normalizeAnyBiblePayload(TAMIL_BSI_ID, parsed),
    'downloaded Tamil Bible',
  );
  const diskPayload = tamilBsiDiskPayload(normalized);
  await ensureBiblesDirectory();
  emitTamilProgress(80);
  await FileSystem.writeAsStringAsync(canonicalPath, JSON.stringify(diskPayload), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  emitTamilProgress(95);
  await registerTamilBsiFromDisk();
  emitTamilProgress(100);
}

/**
 * DEPRECATED alias kept for older callers: first-launch seed of the bundled
 * Tamil BSI now routes through the full auto-installer.
 */
export async function ensureBundledBible(): Promise<void> {
  await ensureDefaultTamilBsiInstalled();
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** In-memory cache of parsed Bible files — one render-ready entry per version. */
const parsedBiblesCache = new Map<string, LocalBibleFile>();

/**
 * Read + normalize one stored Bible file. Accepts the local shape as well as
 * raw `godlytalias` / `thiagobodruk` / helloao payloads, so hand-imported or
 * legacy JSON always reads offline. Results are cached in memory so chapter
 * switching never re-reads or re-parses the file. Returns null when the file
 * is missing or unrecognized.
 */
async function readLocalBibleFile(versionId: string): Promise<LocalBibleFile | null> {
  const cached = parsedBiblesCache.get(versionId);
  if (cached) return cached;
  const raw = await readJsonFile<unknown>(bibleFilePath(versionId));
  if (!raw) return null;
  const normalized = normalizeAnyBiblePayload(versionId, raw);
  if (normalized) parsedBiblesCache.set(versionId, normalized);
  return normalized;
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

function helloaoVersionUrl(versionId: string): string {
  return `https://bible.helloao.org/api/${versionId}/complete.simple.json`;
}

function helloaoChapterUrl(versionId: string, bookId: number, chapter: number): string | null {
  const usfm = usfmForBookId(bookId);
  if (!usfm) return null;
  return `https://bible.helloao.org/api/${versionId}/${usfm}/${chapter}.simple.json`;
}

function usfmForBookId(bookId: number): string | null {
  return USFM_BY_BOOK_ID[bookId] ?? null;
}

/** Pull the helloao verse list out of a chapter `content` array. */
function extractHelloaoVerses(content: HelloaoContentItem[] | undefined): ChapterVerse[] {
  const verses: ChapterVerse[] = [];
  for (const item of content ?? []) {
    if (!item || item.type !== 'verse' || typeof item.number !== 'number') continue;
    const text = Array.isArray(item.content)
      ? item.content.filter((part): part is string => typeof part === 'string').join(' ')
      : item.text ?? (typeof item.content === 'string' ? item.content : '');
    verses.push({ verse: item.number, text: text.replace(/\s+/g, ' ').trim() });
  }
  return verses;
}

/** Convert a helloao `complete.simple.json` into the local file shape. */
function normalizePreNormalizedBible(
  versionId: string,
  payload: { books: unknown[]; versionName?: string; language?: string; languageCode?: string },
): LocalBibleFile {
  const books: LocalBibleBook[] = [];
  payload.books.forEach((rawBook, index) => {
    if (!rawBook || typeof rawBook !== 'object') return;
    const bookData = rawBook as { id?: unknown; bookId?: unknown; name?: unknown; chapters?: unknown };
    const rawId = bookData.id ?? bookData.bookId;
    const id = typeof rawId === 'number' && rawId >= 1 && rawId <= 66 ? rawId : index + 1;
    const chapters: Record<string, ChapterVerse[]> = {};
    if (Array.isArray(bookData.chapters)) {
      bookData.chapters.forEach((rawChapter, chapterIndex) => {
        if (!Array.isArray(rawChapter)) return;
        const verses = rawChapter
          .map((item, verseIndex) => parseThiagobodrukVerse(item, verseIndex + 1))
          .filter((verse): verse is ChapterVerse => verse !== null);
        if (verses.length > 0) chapters[String(chapterIndex + 1)] = verses;
      });
    }
    books.push({
      id,
      name: typeof bookData.name === 'string'
        ? bookData.name
        : getBookById(id)?.englishName ?? `Book ${id}`,
      helloaoBookId: USFM_BY_BOOK_ID[id],
      chapters,
    });
  });
  annotateCanonicalBookIds(books);
  return {
    versionId,
    versionName: payload.versionName ?? versionId,
    language: payload.language ?? '',
    languageCode: payload.languageCode ?? '',
    books,
  };
}

function normalizeHelloaoComplete(
  versionId: string,
  payload: HelloaoCompleteFile,
): LocalBibleFile {
  const books: LocalBibleBook[] = [];
  const rawBooks = payload.books ?? [];
  rawBooks.forEach((rawBook, index) => {
    const orderedId = typeof rawBook.order === 'number' ? rawBook.order : index + 1;
    const name = rawBook.name || rawBook.commonName || rawBook.id;
    const chapters: Record<string, ChapterVerse[]> = {};
    for (const rawChapter of rawBook.chapters ?? []) {
      const chapter = rawChapter.chapter;
      if (!chapter || typeof chapter.number !== 'number') continue;
      const verses = extractHelloaoVerses(chapter.content);
      if (verses.length > 0) chapters[String(chapter.number)] = verses;
    }
    books.push({ id: orderedId, name, helloaoBookId: rawBook.id, chapters });
  });
  annotateCanonicalBookIds(books);
  return {
    versionId,
    versionName: payload.translation?.englishName ||
      payload.translation?.shortName || versionId,
    language: payload.translation?.languageName ||
      payload.translation?.languageEnglishName || '',
    languageCode: payload.translation?.language || '',
    books,
  };
}

/** Add USFM codes back onto books found in the canonical 1-66 map. */
function annotateCanonicalBookIds(books: LocalBibleBook[]): void {
  for (const book of books) {
    const code = USFM_BY_BOOK_ID[book.id];
    if (code) {
      book.helloaoBookId = book.helloaoBookId ?? code;
    }
  }
}

function isLocalBibleFile(payload: unknown): payload is LocalBibleFile {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as Partial<LocalBibleFile>;
  return (
    typeof candidate.versionId === 'string' &&
    Array.isArray(candidate.books) &&
    candidate.books.every(
      (book) => book && typeof book.id === 'number' && typeof book.chapters === 'object' &&
        !Array.isArray(book.chapters),
    )
  );
}

// ---------------------------------------------------------------------------
// Raw payload normalization (godlytalias / thiagobodruk / helloao / local)
// ---------------------------------------------------------------------------

/** Pull verse strings out of one godlytalias chapter array. */
function parseGodlytaliasChapter(chapter: unknown): ChapterVerse[] {
  // A chapter may be an array of verse items, a single `{Verse: [...]}` object,
  // or (rarely) already an array of plain strings.
  let verseItems: unknown[] = [];
  if (Array.isArray(chapter)) {
    verseItems = chapter;
  } else if (chapter && typeof chapter === 'object') {
    const holder = chapter as { Verse?: unknown; verses?: unknown; Items?: unknown };
    verseItems = Array.isArray(holder.Verse)
      ? holder.Verse
      : Array.isArray(holder.verses)
        ? holder.verses
        : Array.isArray(holder.Items)
          ? holder.Items
          : [];
  }
  const verses: ChapterVerse[] = [];
  verseItems.forEach((item, verseIndex) => {
    let text = '';
    let number = verseIndex + 1;
    if (typeof item === 'string') {
      text = item;
    } else if (item && typeof item === 'object') {
      const verseItem = item as RawGodlytaliasVerse;
      text = typeof verseItem.Verse === 'string'
        ? verseItem.Verse
        : typeof verseItem.verse === 'string'
          ? verseItem.verse
          : '';
      if (typeof verseItem.VerseNumber === 'number') number = verseItem.VerseNumber;
      else if (typeof verseItem.VerseID === 'number') number = verseItem.VerseID;
    }
    if (!text.trim()) return;
    verses.push({ verse: number, text: text.replace(/\s+/g, ' ').trim() });
  });
  return verses;
}

/** Convert a `godlytalias` payload ({Book: ...}) into the local file shape. */
function normalizeGodlytalias(versionId: string, payload: RawGodlytaliasFile): LocalBibleFile {
  const rawBooks = Array.isArray(payload.Book) && payload.Book.length > 0
    ? payload.Book
    : Array.isArray(payload.books)
      ? payload.books
      : [];
  const books: LocalBibleBook[] = [];
  rawBooks.forEach((rawBook, index) => {
    const name = rawBook?.BookName || rawBook?.BookNameEN || rawBook?.book || rawBook?.name
      || `Book ${index + 1}`;
    const bookNumber = (rawBook as { BookNo?: unknown; bookNo?: unknown }).BookNo;
    const id = typeof bookNumber === 'number' && bookNumber >= 1 && bookNumber <= 66
      ? bookNumber
      : index + 1;
    const chapters: Record<string, ChapterVerse[]> = {};
    const rawChapters = (Array.isArray(rawBook?.Chapter) ? rawBook.Chapter
      : Array.isArray(rawBook?.chapters) ? rawBook.chapters : []) as unknown[];
    rawChapters.forEach((rawChapter, chapterIndex) => {
      const parsed = parseGodlytaliasChapter(rawChapter);
      if (parsed.length > 0) chapters[String(chapterIndex + 1)] = parsed;
    });
    books.push({ id, name, chapters });
  });
  annotateCanonicalBookIds(books);
  // godlytalias payloads ship for many languages. Only the bundled Tamil seed
  // carries the "Tamil BSI" branding — every other version keeps its real id
  // so downloaded Bibles never show a wrong "Tamil BSI (Offline Ready)" title.
  const bundled = isBundledVersionId(versionId);
  return {
    versionId,
    versionName: bundled ? 'Tamil BSI (Offline Ready)' : versionId,
    language: bundled ? 'Tamil' : '',
    languageCode: bundled ? 'tam' : '',
    books,
  };
}

/** Normalize one thiagobodruk verse item (string or {verse|Verse: text}). */
function parseThiagobodrukVerse(item: unknown, position: number): ChapterVerse | null {
  if (typeof item === 'string') {
    const text = item.replace(/\s+/g, ' ').trim();
    return text ? { verse: position, text } : null;
  }
  if (item && typeof item === 'object') {
    const holder = item as { Verse?: unknown; verse?: unknown; text?: unknown; Text?: unknown };
    const raw = holder.Verse ?? holder.verse ?? holder.text ?? holder.Text;
    if (typeof raw !== 'string') return null;
    const text = raw.replace(/\s+/g, ' ').trim();
    const numberInItem = (item as { VerseNumber?: unknown; verse_no?: unknown }).VerseNumber
      ?? (item as { verse_no?: unknown }).verse_no;
    const verseNumber = typeof numberInItem === 'number' ? numberInItem : position;
    return text ? { verse: verseNumber, text } : null;
  }
  return null;
}

/** Convert a `thiagobodruk` array/66-record payload into the local file shape. */
function normalizeThiagobodruk(
  versionId: string,
  payload: RawThiagobodrukFile,
): LocalBibleFile {
  const rawBooks: unknown[][] = Array.isArray(payload)
    ? (payload as unknown[][])
    : Object.keys(payload as Record<string, unknown[]>)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => (payload as Record<string, unknown[]>)[key]);
  const books: LocalBibleBook[] = [];
  rawBooks.forEach((rawBook, index) => {
    if (index >= 66) return;
    const id = index + 1;
    const chapters: Record<string, ChapterVerse[]> = {};
    if (Array.isArray(rawBook)) {
      rawBook.forEach((rawChapter, chapterIndex) => {
        if (!Array.isArray(rawChapter)) return;
        const verses = rawChapter
          .map((item, verseIndex) => parseThiagobodrukVerse(item, verseIndex + 1))
          .filter((verse): verse is ChapterVerse => verse !== null);
        if (verses.length > 0) chapters[String(chapterIndex + 1)] = verses;
      });
    }
    books.push({
      id,
      name: getBookById(id)?.englishName ?? `Book ${id}`,
      helloaoBookId: USFM_BY_BOOK_ID[id],
      chapters,
    });
  });
  return { versionId, versionName: versionId, language: '', languageCode: '', books };
}

/**
 * Parse ANY supported Bible payload into the local shape. Returns null for
 * unrecognized structures so callers can surface a clear error.
 */
export function normalizeAnyBiblePayload(
  versionId: string,
  payload: unknown,
): LocalBibleFile | null {
  if (!payload || typeof payload !== 'object') return null;

  // 1. Already the normalized local shape (bundled seed + re-downloads).
  if (isLocalBibleFile(payload)) return payload;

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.books) && record.books.length > 0) {
    const firstBook = record.books[0];
    if (firstBook && typeof firstBook === 'object' && 'chapters' in firstBook) {
      const wrapper = record as { books: unknown[]; versionName?: string; language?: string; languageCode?: string };
      if (record.versionName || record.versionId || record.version) {
        return normalizePreNormalizedBible(versionId, wrapper);
      }
      return normalizeGodlytalias(versionId, { books: record.books as RawGodlytaliasBook[] });
    }
  }

  // 2. helloao complete.simple.json.
  if (Array.isArray((payload as HelloaoCompleteFile).books)) {
    return normalizeHelloaoComplete(
      versionId,
      payload as Partial<HelloaoCompleteFile> & Record<string, unknown>,
    );
  }

  // 3. godlytalias: { Book: [{ BookName, Chapter: [[{ Verse: "..." }]] }] }.
  const bookArray = (payload as RawGodlytaliasFile).Book
    ?? (payload as RawGodlytaliasFile).books;
  if (Array.isArray(bookArray)) {
    const sample = bookArray.find((book) => book && typeof book === 'object');
    if (sample) {
      if (Array.isArray((sample as RawGodlytaliasBook).Chapter)) {
        return normalizeGodlytalias(versionId, payload as RawGodlytaliasFile);
      }
      if (typeof sample === 'object' && 'chapters' in sample && bookArray.length >= 60) {
        return normalizePreNormalizedBible(versionId, {
          ...record,
          books: bookArray,
        } as { books: unknown[]; versionName?: string; language?: string; languageCode?: string });
      }
    }
  }

  // 4. thiagobodruk: 66-entry array or numeric-keyed record of chapter arrays.
  if (Array.isArray(payload) && payload.length > 0) {
    return normalizeThiagobodruk(versionId, payload as unknown[]);
  }
  if (!record.Book && !record.books) {
    const numericKeys = Object.keys(record).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length >= 60 && Array.isArray(record[numericKeys[0]])) {
      return normalizeThiagobodruk(versionId, record as unknown as Record<string, unknown[]>);
    }
  }

  return null;
}

/**
 * Download a catalog version with live progress callbacks (0-100). The payload
 * lands as `bibles/<versionId>.json` in the app documents directory.
 */
export async function downloadBibleVersion(
  version: DownloadableVersion,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  if (version.source === 'bundled') {
    await ensureDefaultTamilBsiInstalled(
      (pct) => onProgress?.({
        versionId: version.id,
        percent: pct,
        bytesWritten: 0,
        totalBytes: 0,
      }),
    );
    return;
  }

  const url = version.source === 'json'
    ? version.downloadUrl
    : helloaoVersionUrl(version.id);
  if (!url) {
    throw new Error(`No download URL configured for version ${version.id}`);
  }

  await ensureBiblesDirectory();
  const tempPath = `${biblesDirectoryPath()}${version.id}.partial.json`;
  try {
    type FileSystemDownloadProgress = {
      totalBytesWritten: number;
      totalBytesExpectedToWrite: number;
    };
    const onDownloadProgress = (progressEvent: FileSystemDownloadProgress): void => {
      const { totalBytesWritten, totalBytesExpectedToWrite } = progressEvent;
      const percent = totalBytesWritten / Math.max(1, totalBytesExpectedToWrite);
      onProgress?.({
        versionId: version.id,
        percent: percent >= 1 ? 99 : Math.floor(percent * 100),
        bytesWritten: totalBytesWritten,
        totalBytes: totalBytesExpectedToWrite,
      });
    };
    const resumable = FileSystem.createDownloadResumable(url, tempPath, {}, onDownloadProgress);
    await resumable.downloadAsync();

    const raw = await FileSystem.readAsStringAsync(tempPath, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsed: unknown = JSON.parse(raw);

    const localFile = normalizeAnyBiblePayload(version.id, parsed);
    if (!localFile) {
      throw new Error(`Downloaded file for ${version.id} is not a supported Bible JSON.`);
    }

    const finalPath = bibleFilePath(version.id);
    await FileSystem.writeAsStringAsync(finalPath, JSON.stringify(localFile), {
      encoding: FileSystem.EncodingType.UTF8,
    });

    // Warm the parsed-Bible memory cache and register the full metadata in
    // the on-device registry — every downloader (Library, Progress,
    // VersePicker) gets registration for free from this single place.
    parsedBiblesCache.set(normalizeVersionId(version.id), localFile);
    const knownMeta = resolveKnownVersionMeta(version.id);
    await registerInstalledVersion({
      id: version.id,
      name: pickHumanVersionName(knownMeta?.name ?? version.name, localFile.versionName),
      shortName: knownMeta?.shortName || version.shortName,
      language: languageDisplayLabel(
        localFile.language || version.languageName || knownMeta?.languageName || '',
        localFile.languageCode || version.languageCode || knownMeta?.languageCode,
      ),
      format: 'json',
      installedAt: new Date().toISOString(),
      languageCode: localFile.languageCode || version.languageCode || knownMeta?.languageCode || '',
    });
    onProgress?.({ versionId: version.id, percent: 100, bytesWritten: 0, totalBytes: 0 });
  } finally {
    await FileSystem.deleteAsync(tempPath, { idempotent: true });
  }
}

/**
 * Fetch one helloao chapter and cache its payload under `bibles/` so the same
 * chapter reads offline afterwards.
 */
export async function downloadHelloaoChapter(
  versionId: string,
  bookId: number,
  chapter: number,
): Promise<ChapterVerse[]> {
  const url = helloaoChapterUrl(versionId, bookId, chapter);
  if (!url) {
    throw new Error(`Book ${bookId} has no helloao chapter API for ${versionId}.`);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`helloao returned HTTP ${response.status} for ${url}`);
  }
  const payload = (await response.json()) as HelloaoChapterPayload | null;
  const verses = extractHelloaoVerses(payload?.chapter?.content);
  if (verses.length === 0) {
    throw new Error(`No verses found for helloao ${versionId}/${bookId}/${chapter}.`);
  }

  await ensureBiblesDirectory();
  const cached: CachedChapterFile = { versionId, bookId, chapter, verses };
  await FileSystem.writeAsStringAsync(chapterCachePath(versionId, bookId, chapter), JSON.stringify(cached), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return verses;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function findBook(localFile: LocalBibleFile, bookId: number): LocalBibleBook | undefined {
  const usfm = usfmForBookId(bookId);
  return (
    localFile.books.find((book) => book.id === bookId) ??
    (usfm ? localFile.books.find((book) => book.helloaoBookId === usfm) : undefined)
  );
}

/**
 * Resolve a book reference that may be either a 1-based canonical book id
 * (1..66, matching `@/constants/books`) or a 0-based positional index
 * (0..65). The canonical-id interpretation always wins when a book with that
 * id exists; the positional list is the safe fallback so callers can never
 * go out of bounds.
 */
function resolveBookRef(localFile: LocalBibleFile, bookRef: number): LocalBibleBook | undefined {
  if (!Number.isInteger(bookRef) || bookRef < 0 || bookRef > 66) return undefined;
  const byId = findBook(localFile, bookRef);
  if (byId) return byId;
  if (bookRef <= 65) {
    const byIndex = localFile.books[bookRef];
    if (byIndex) return byIndex;
  }
  return undefined;
}

/** Helper: look up verses for one book/chapter inside a parsed local file. */
function versesIn(
  localFile: LocalBibleFile,
  bookRef: number,
  chapter: number,
): { book: LocalBibleBook; verses: ChapterVerse[] } | null {
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  const book = resolveBookRef(localFile, bookRef);
  if (!book) return null;
  const verses = book.chapters[String(chapter)];
  if (verses && verses.length > 0) return { book, verses };
  return null;
}

/**
 * Resolve verses for `versionId`, 100% offline first:
 * bundled Tamil BSI (in-memory) -> local `bibles/<id>.json` -> cached helloao
 * chapter -> (only when the version is a known helloao translation) an online
 * helloao fetch, cached for next time. The bundled id never touches the
 * network and never throws "not available offline" for its shipped chapters.
 */
export async function loadChapterVerses(
  versionId: string,
  bookRef: number,
  chapter: number,
): Promise<ChapterVerse[]> {
  const normalizedId = normalizeVersionId(versionId);

  // The bundled Tamil BSI stays in memory after its first read, so chapter
  // switches need no JSON parsing or filesystem access.
  if (normalizedId === TAMIL_BSI_ID) {
    const chapterVerses = extractChapterVerses(getCachedTamilBsi(), bookRef, chapter);
    if (chapterVerses.length > 0) return chapterVerses;
    const bundled = versesIn(getBundledTamilBsi(), bookRef, chapter);
    if (bundled) return bundled.verses;
    throw new Error('This chapter is not available in the selected Bible.');
  }

  const localFile = await readLocalBibleFile(normalizedId);
  if (localFile) {
    const found = versesIn(localFile, bookRef, chapter);
    if (found) return found.verses;
    const resolvedBookId = resolveBookRef(localFile, bookRef)?.id ?? bookRef;
    const cachedChapter = await readJsonFile<CachedChapterFile>(
      chapterCachePath(normalizedId, resolvedBookId, chapter),
    );
    if (cachedChapter?.verses?.length) return cachedChapter.verses;
  }

  // Known helloao translation: fetch just this chapter online and cache it.
  const helloaoId = findDefaultVersion(normalizedId)?.helloaoTranslationId;
  if (helloaoId === normalizedId) {
    return downloadHelloaoChapter(normalizedId, bookRef, chapter);
  }

  throw new Error(
    `Version "${normalizedId}" is not available offline. Download it from the Bibles tab first.`,
  );
}

// ---------------------------------------------------------------------------
// Active version & library management
// ---------------------------------------------------------------------------

export async function getActiveVersionId(): Promise<string> {
  try {
    return normalizeVersionId(
      (await AsyncStorage.getItem(ACTIVE_VERSION_KEY)) ?? BUNDLED_VERSION_ID,
    );
  } catch {
    return normalizeVersionId(BUNDLED_VERSION_ID);
  }
}

/**
 * Remember a reading version. Falls back to the bundled BSI when the chosen
 * file is not on disk (e.g. cleared app storage). Ids are normalized first so
 * stale spellings ("tamil bsi") never become the stored value.
 */
export async function setActiveVersionId(versionId: string): Promise<void> {
  const normalized = normalizeVersionId(versionId);
  const downloaded = await isVersionDownloaded(normalized);
  const safeId = downloaded ? normalized : BUNDLED_VERSION_ID;
  await AsyncStorage.setItem(ACTIVE_VERSION_KEY, safeId);
}

/** True when a full local copy exists in `bibles/<versionId>.json`. */
export async function isVersionDownloaded(versionId: string): Promise<boolean> {
  // The bundled Tamil BSI is ALWAYS available offline — it ships inside the
  // app bundle, so never touch the filesystem for it.
  if (isBundledVersionId(versionId)) return true;
  try {
    const info = await FileSystem.getInfoAsync(bibleFilePath(normalizeVersionId(versionId)));
    return info.exists;
  } catch {
    return false;
  }
}

/** All currently stored version ids (full files only, excludes chapter caches). */
export function getBookChapterCount(versionId: string, bookId: number): number {
  const canonicalCount = BIBLE_BOOKS.find((book) => book.id === bookId)?.chaptersCount;
  if (!canonicalCount) return 0;

  if (isBundledVersionId(versionId)) {
    const rawData = getCachedTamilBsi();
    const rawBook = Array.isArray(rawData.books)
      ? rawData.books[bookId - 1]
      : Array.isArray(rawData.Book)
        ? rawData.Book[bookId - 1]
        : undefined;
    const chapters = rawBook?.chapters ?? rawBook?.Chapter;
    const rawCount = Array.isArray(chapters)
      ? chapters.length
      : chapters && typeof chapters === 'object'
        ? Object.keys(chapters).filter((chapter) => /^\d+$/.test(chapter)).length
        : 0;
    return Math.max(canonicalCount, rawCount);
  }

  return canonicalCount;
}

/** Per-version cache of chapter verse totals, one entry per book. */
const chapterVerseCountsCache = new Map<string, number[]>();

/**
 * Verse totals for every chapter of one book in the version's own file, e.g.
 * `[31, 25, ...]` indexed by chapter-1. Chapter totals drive the verse-level
 * progress weighting in the Progress tab; chapters missing from the file fall
 * back to 0 and callers degrade to whole-chapter bookkeeping.
 */
export async function getBookChapterVerseCounts(
  versionId: string,
  bookId: number,
): Promise<number[]> {
  const normalized = normalizeVersionId(versionId);
  const cacheKey = `${normalized}:${bookId}`;
  const cached = chapterVerseCountsCache.get(cacheKey);
  if (cached) return cached;
  let counts: number[] = [];
  try {
    const local = await readLocalBibleFile(normalized);
    const book = local?.books.find((entry) => entry.id === bookId);
    if (book) {
      const maxChapter = Object.keys(book.chapters).reduce(
        (max, key) => Math.max(max, Number(key) || 0),
        0,
      );
      counts = Array.from({ length: Math.max(maxChapter, 0) }, (_, index) =>
        book.chapters[String(index + 1)]?.length ?? 0,
      );
    }
  } catch {
    // Missing/unrecognized file: callers fall back to the DB's own totals.
  }
  chapterVerseCountsCache.set(cacheKey, counts);
  return counts;
}

export async function getDownloadedVersionIds(): Promise<string[]> {
  try {
    const entries = await FileSystem.readDirectoryAsync(biblesDirectoryPath());
    return entries
      .filter((name) =>
        name.endsWith('.json') &&
        !name.startsWith('_') &&          // `_catalog_cache.json` is not a Bible
        !name.startsWith('.') &&          // hidden/OS files are not Bibles
        !name.toLowerCase().includes('cache') && // legacy cache copies excluded
        !name.includes('.chapter.') &&    // per-chapter payload caches excluded
        !name.endsWith('.partial.json'))  // in-flight downloads excluded
      .map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
}

/**
 * Remove a downloaded version and any cached chapter payloads for it. When the
 * deleted version was active, the reader falls back to the bundled Tamil BSI.
 */
export async function deleteBibleVersion(versionId: string): Promise<void> {
  if (isBundledVersionId(versionId)) {
    throw new Error('The bundled Tamil BSI sample cannot be deleted. Download another version instead.');
  }

  const normalizedId = normalizeVersionId(versionId);
  const stem = fileStemForVersionId(normalizedId);
  const dir = biblesDirectoryPath();
  try {
    const entries = await FileSystem.readDirectoryAsync(dir);
    for (const name of entries) {
      if (name === `${stem}.json` || name.startsWith(`${stem}.chapter.`)) {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
      }
    }
  } catch {
    // Failure to enumerate only matters when the dir itself is gone.
  }
  parsedBiblesCache.delete(normalizedId);
  await unregisterInstalledVersion(normalizedId);

  const activeId = await getActiveVersionId();
  if (normalizeVersionId(activeId) === normalizedId) {
    await setActiveVersionId(BUNDLED_VERSION_ID);
  }
}

// ---------------------------------------------------------------------------
// Version metadata for pickers & language-aware UI (Step 5)
// ---------------------------------------------------------------------------

export interface DownloadedVersionSummary {
  id: string;
  versionName: string;
  shortName: string;
  englishName: string;
  /** Human language name read from the local file ("Tamil", "English"...). */
  languageName: string;
  languageCode: string;
  /** True for the bundled seed (always present). */
  isBundledStyle: boolean;
}

// ---------------------------------------------------------------------------
// On-device registry helpers (`@installed_bible_versions_v2`)
// ---------------------------------------------------------------------------

/** Read the persisted installed-version registry (tolerates corrupt data). */
export async function readInstalledRegistry(): Promise<BibleVersionMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(INSTALLED_REGISTRY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as BibleVersionMeta[]).filter(
      (meta) => meta && typeof meta.id === 'string' && typeof meta.name === 'string',
    );
  } catch {
    return [];
  }
}

async function writeInstalledRegistry(entries: BibleVersionMeta[]): Promise<void> {
  await AsyncStorage.setItem(INSTALLED_REGISTRY_KEY, JSON.stringify(entries));
}

/** Insert or refresh one version's metadata in the on-device registry. */
export async function registerInstalledVersion(meta: BibleVersionMeta): Promise<void> {
  const entries = await readInstalledRegistry();
  const next = entries.filter((entry) => entry.id !== meta.id);
  next.push(meta);
  await writeInstalledRegistry(next);
}

/** Remove one version's metadata from the on-device registry. */
export async function unregisterInstalledVersion(versionId: string): Promise<void> {
  const entries = await readInstalledRegistry();
  const next = entries.filter((entry) => entry.id !== versionId);
  if (next.length !== entries.length) await writeInstalledRegistry(next);
}

function registryEntryToSummary(meta: BibleVersionMeta): DownloadedVersionSummary {
  return {
    id: meta.id,
    versionName: meta.name,
    shortName: meta.shortName,
    englishName: meta.name,
    languageName: meta.language,
    languageCode: meta.languageCode ?? '',
    isBundledStyle: isBundledVersionId(meta.id),
  };
}

/** Build registry metadata from metadata already known for a disk version. */
function summaryToRegistryEntry(summary: DownloadedVersionSummary): BibleVersionMeta {
  return {
    id: summary.id,
    name: summary.versionName,
    shortName: summary.shortName,
    language: languageDisplayLabel(summary.languageName, summary.languageCode),
    format: 'json',
    installedAt: new Date().toISOString(),
    languageCode: summary.languageCode,
  };
}

/** Build registry metadata for a downloaded file that was never registered. */
async function registryEntryForDiskVersion(versionId: string): Promise<BibleVersionMeta> {
  const summary = await readVersionSummary(versionId);
  return summaryToRegistryEntry(summary);
}

/**
 * True when a registry entry still carries the godlytalias seed labels —
 * `id` is NOT the bundled Tamil BSI but its name/language brags "Tamil BSI".
 * These are exactly the entries the repair routine rewrites below.
 */
function isMislabelledVersionMeta(meta: BibleVersionMeta): boolean {
  if (isBundledVersionId(meta.id)) return false;
  return /tamil\s*bsi/i.test(meta.name) || /offline\s*ready/i.test(meta.name);
}

/**
 * Rebuild the TRUE metadata `{ id, name, shortName, language }` for one
 * mislabelled installed version:
 *
 * 1. `POPULAR_BIBLE_VERSIONS` (curated catalog) lookup by id.
 * 2. The cached online helloao catalog (disk cache only — never a network
 *    stall inside `getInstalledVersions`).
 * 3. The built-in raw-id dictionary (`eng_bbe` -> "Bible in Basic English").
 * 4. Fallback: derive a clean human name from the version id itself.
 */
async function buildRepairedVersionMeta(meta: BibleVersionMeta): Promise<BibleVersionMeta> {
  const searchedId = normalizeVersionId(meta.id);

  let name = '';
  let shortName = '';
  let language = '';
  let languageCode = '';

  const known = resolveKnownVersionMeta(searchedId);
  if (known) {
    name = known.name;
    shortName = known.shortName;
    language = languageDisplayLabel(known.languageName, known.languageCode);
    languageCode = known.languageCode;
  }

  if (!name) {
    try {
      const online = await loadCachedOnlineCatalog();
      const match = online.find(
        (version) =>
          version.id === searchedId ||
          version.id.trim().toLowerCase() === searchedId.toLowerCase(),
      );
      if (match) {
        name = match.name;
        shortName = match.shortName;
        language = languageDisplayLabel(match.languageName, match.languageCode);
        languageCode = match.languageCode;
      }
    } catch {
      // Catalog cache unavailable — fall through to the id-derived name.
    }
  }

  if (!name) {
    // Last resort: "tam_irv" -> "Tam Irv" style humanization of the raw id.
    const humanized = meta.id.replace(/[\s_-]+/g, ' ').trim();
    name = humanized || searchedId;
    shortName = shortName || humanized || searchedId;
    language = language || languageDisplayLabel('', languageCode);
  }

  return {
    ...meta,
    name,
    shortName,
    language: language || meta.language,
    format: 'json',
    languageCode: languageCode || meta.languageCode,
  };
}

/**
 * Every Bible version installed on this device, verified against the files
 * actually present in `bibles/`. The bundled `TAMIL_BSI` entry is always
 * included and always first. Home, Library, Progress and the Verse Picker
 * render from this so their lists always match reality.
 */
export async function getInstalledVersions(): Promise<BibleVersionMeta[]> {
  const [entries, diskIds] = await Promise.all([
    readInstalledRegistry(),
    getDownloadedVersionIds(),
  ]);

  const verified: BibleVersionMeta[] = [];
  const seenIds = new Set<string>();
  let bundledSeen = false;

  for (const meta of entries) {
    if (!isBundledVersionId(meta.id)) {
      try {
        const info = await FileSystem.getInfoAsync(bibleFilePath(meta.id));
        if (!info.exists) continue;
      } catch {
        continue;
      }
    }
    if (seenIds.has(meta.id)) continue;
    seenIds.add(meta.id);
    if (isBundledVersionId(meta.id)) bundledSeen = true;
    verified.push({
      ...meta,
      installedAt: meta.installedAt || new Date().toISOString(),
    });
  }

  // Unregistered disk copies (older builds / restored backups) still count.
  for (const rawId of diskIds) {
    const id = normalizeVersionId(rawId);
    if (seenIds.has(id)) continue;
    if (isBundledVersionId(id)) {
      seenIds.add(id);
      bundledSeen = true;
      continue;
    }
    seenIds.add(id);
    verified.push(await registryEntryForDiskVersion(id));
  }

  if (!bundledSeen) {
    verified.unshift({ ...DEFAULT_TAMIL_BSI_META, installedAt: new Date().toISOString() });
  }

  // Repair routine: any installed entry that still shows the godlytalias
  // "Tamil BSI (Offline Ready)" branding but is NOT the bundled Tamil BSI
  // gets its true name / shortName / language / file size rebuilt, and the
  // fixed set is persisted back into `@installed_bible_versions_v2`.
  let registryDirty = false;
  for (let index = 0; index < verified.length; index += 1) {
    const meta = verified[index];
    if (!isMislabelledVersionMeta(meta) && !hasRawVersionIdName(meta)) continue;
    try {
      verified[index] = await buildRepairedVersionMeta(meta);
      registryDirty = true;
    } catch {
      // Repair failures never remove the version from the list.
    }
  }
  if (registryDirty) {
    void writeInstalledRegistry(verified).catch(() => undefined);
  }

  // Bundled BSI first, then alphabetical by short name.
  verified.sort((a, b) => {
    const aBundled = isBundledVersionId(a.id);
    const bBundled = isBundledVersionId(b.id);
    if (aBundled !== bBundled) return aBundled ? -1 : 1;
    return a.shortName.localeCompare(b.shortName);
  });
  return verified;
}

/** Display metadata for the always-offline bundled Tamil BSI. */
function bundledVersionSummary(): DownloadedVersionSummary {
  const meta = DEFAULT_TAMIL_BSI_META;
  return {
    id: meta.id,
    versionName: meta.name,
    shortName: meta.shortName,
    englishName: 'Tamil BSI',
    languageName: meta.language,
    languageCode: meta.languageCode ?? 'tam',
    isBundledStyle: true,
  };
}

/** Read the stored display metadata out of one local Bible file. */
async function readVersionSummary(rawId: string): Promise<DownloadedVersionSummary> {
  const versionId = normalizeVersionId(rawId);
  if (isBundledVersionId(versionId)) return bundledVersionSummary();
  const knownMeta = resolveKnownVersionMeta(versionId);
  const fallback: DownloadedVersionSummary = {
    id: versionId,
    versionName: knownMeta?.name ?? versionId,
    shortName: knownMeta?.shortName ?? versionId,
    englishName: knownMeta?.name ?? versionId,
    languageName: languageDisplayLabel(knownMeta?.languageName ?? '', knownMeta?.languageCode ?? ''),
    languageCode: knownMeta?.languageCode ?? '',
    isBundledStyle: false,
  };
  try {
    const local = await readLocalBibleFile(versionId);
    if (!local) return fallback;
    return {
      id: versionId,
      versionName: pickHumanVersionName(knownMeta?.name, local.versionName),
      shortName: knownMeta?.shortName || local.versionName || versionId,
      englishName: knownMeta?.name || local.versionName || versionId,
      languageName: languageDisplayLabel(local.language || fallback.languageName, local.languageCode || fallback.languageCode),
      languageCode: local.languageCode || fallback.languageCode,
      isBundledStyle: false,
    };
  } catch {
    return fallback;
  }
}

/**
 * Metadata for every offline-downloaded version plus the bundled seed — the
 * bundled entry is ALWAYS present and ALWAYS first, so the Home quick
 * switcher and the Verse Picker never show an empty offline shelf.
 */
/**
 * Metadata for every offline-downloaded version plus the bundled seed — the
 * bundled entry is ALWAYS present and ALWAYS first, so the Home quick
 * switcher and the Verse Picker never show an empty offline shelf.
 *
 * Registry-backed: verified `@installed_bible_versions_v2` entries first
 * (name/language always surfaced correctly), then any unregistered disk
 * copies, then everything falls back to self-describing local file headers.
 */
export async function getDownloadedVersionSummaries(): Promise<DownloadedVersionSummary[]> {
  const [registry, diskIds] = await Promise.all([
    readInstalledRegistry().catch(() => [] as BibleVersionMeta[]),
    getDownloadedVersionIds(),
  ]);

  const summaries: DownloadedVersionSummary[] = [bundledVersionSummary()];
  const seenIds = new Set<string>([TAMIL_BSI_ID]);

  for (const meta of registry) {
    if (seenIds.has(meta.id)) continue;
    if (!isBundledVersionId(meta.id)) {
      try {
        const info = await FileSystem.getInfoAsync(bibleFilePath(meta.id));
        if (!info.exists) continue;
      } catch {
        continue;
      }
    }
    seenIds.add(meta.id);
    summaries.push(registryEntryToSummary(meta));
  }

  // Unregistered disk copies (older builds) — self-describe from the file.
  for (const rawId of diskIds) {
    const id = normalizeVersionId(rawId);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    summaries.push(await readVersionSummary(id));
  }

  // Bundled seed first, then alphabetical by short name.
  summaries.sort((a, b) => {
    if (a.isBundledStyle !== b.isBundledStyle) return a.isBundledStyle ? -1 : 1;
    return a.shortName.localeCompare(b.shortName);
  });
  return summaries;
}

/** Fuzzy filter over downloaded versions — typos still resolve ("tamli"). */
export function searchDownloadedVersionsFuzzy(
  query: string,
  summaries: DownloadedVersionSummary[],
): DownloadedVersionSummary[] {
  const q = query.trim();
  if (!q) return summaries;
  const scored = summaries
    .map((summary) => ({
      summary,
      score: Math.max(
        fuzzyMatchScore(q, summary.shortName),
        fuzzyMatchScore(q, summary.versionName),
        fuzzyMatchScore(q, summary.languageName),
        fuzzyMatchScore(q, summary.id),
      ),
    }))
    .filter((entry) => entry.score >= 100);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.summary);
}

/**
 * Metadata of the active version (falls back to the bundled seed). Used by the
 * Progress tab to render book names in the active version's language.
 */
export async function getActiveVersionSummary(): Promise<DownloadedVersionSummary> {
  return readVersionSummary(await getActiveVersionId());
}
