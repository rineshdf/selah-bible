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
  fallbackJsonEndpoints,
  findDefaultVersion,
  fuzzyMatchScore,
  languageDisplayLabel,
  loadCachedOnlineCatalog,
  markVersionFailed,
  clearFailedVersion,
  POPULAR_BIBLE_VERSIONS,
  TAMIL_BSI_DOWNLOAD_URL,
  type DownloadableVersion,
} from '@/constants/versionCatalog';
import {
  BIBLE_BOOKS,
  getBookById,
  getBookIdFromBookName,
  getBookIdFromUsfm,
  getUsfmBookCode,
  isUsfmLikeBookName,
  localizedBookNameFor,
  USFM_BOOK_CODES,
  type VersionBookMeta,
} from '@/constants/books';

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
  /** helloao `commonName` (English-ish cross-version label) when known. */
  commonName?: string;
  /**
   * FIX 4 — the version's own chapter count for this book (28 for Matthew,
   * 16 for Mark...). Captured at normalization time so partial versions keep
   * their true counts even when a skeleton file carries no chapter text.
   */
  totalChapters?: number;
  /** Chapter number (as string key) -> verses in reading order. */
  chapters: Record<string, ChapterVerse[]>;
}

export interface LocalBibleFile {
  versionId: string;
  versionName: string;
  language: string;
  languageCode: string;
  books: LocalBibleBook[];
  /** Version books keyed by TRUE canonical id (1..66), from USFM codes. */
  booksById?: Record<number, VersionBookMeta>;
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

/** Canonical book id -> USFM code, e.g. 1 -> GEN, 43 -> JHN. */
const USFM_BY_BOOK_ID: Record<number, string> = Object.fromEntries(
  USFM_BOOK_CODES.map((code, index) => [index + 1, code]),
);

/**
 * Canonical 66-book USFM map (`GEN` = 1 ... `REV` = 66). Every loader path
 * assigns `bookId` through THIS table — never through array position — so
 * NT-only (27-book) and OT-only (39-book) payloads keep their true canonical
 * grid: Matthew is ALWAYS book 40 and Hebrews is ALWAYS book 58.
 */
export const USFM_TO_BOOK_ID: Readonly<Record<string, number>> = Object.freeze({
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8,
  '1SA': 9, '2SA': 10, '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14,
  EZR: 15, NEH: 16, EST: 17, JOB: 18, PSA: 19, PRO: 20, ECC: 21, SNG: 22,
  ISA: 23, JER: 24, LAM: 25, EZK: 26, DAN: 27, HOS: 28, JOL: 29, AMO: 30,
  OBA: 31, JON: 32, MIC: 33, NAM: 34, HAB: 35, ZEP: 36, HAG: 37, ZEC: 38,
  MAL: 39, MAT: 40, MRK: 41, LUK: 42, JHN: 43, ACT: 44, ROM: 45,
  '1CO': 46, '2CO': 47, GAL: 48, EPH: 49, PHP: 50, COL: 51,
  '1TH': 52, '2TH': 53, '1TI': 54, '2TI': 55, TIT: 56, PHM: 57,
  HEB: 58, JAS: 59, '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63,
  '3JN': 64, JUD: 65, REV: 66,
});

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
  'spa_pdt': { name: 'Palabra de Dios para Todos', shortName: 'PDT', languageName: 'Spanish', languageCode: 'spa' },
  'spa_rvr': { name: 'Reina Valera 1909', shortName: 'RVR', languageName: 'Spanish', languageCode: 'spa' },
  'spa_rvr1960': { name: 'Reina Valera 1960', shortName: 'RVR1960', languageName: 'Spanish', languageCode: 'spa' },
  'spa_rvg': { name: 'Reina Valera Godoy', shortName: 'RVG', languageName: 'Spanish', languageCode: 'spa' },
  'heb_mas': { name: 'Masoretic Hebrew Text', shortName: 'MAS', languageName: 'Hebrew', languageCode: 'heb' },
  'heb_wlc': { name: 'Hebrew Westminster Leningrad Codex', shortName: 'WLC', languageName: 'Hebrew', languageCode: 'heb' },
  'grc_gtr': { name: 'Greek New Testament — Textus Receptus', shortName: 'GTR', languageName: 'Greek', languageCode: 'grc' },
  'eng_asv': { name: 'American Standard Version', shortName: 'ASV', languageName: 'English', languageCode: 'eng' },
  'eng_bsb': { name: 'Berean Study Bible', shortName: 'BSB', languageName: 'English', languageCode: 'eng' },
  'PDT': { name: 'Palabra de Dios para Todos', shortName: 'PDT', languageName: 'Spanish', languageCode: 'spa' },
  'RVR': { name: 'Reina Valera 1909', shortName: 'RVR', languageName: 'Spanish', languageCode: 'spa' },
  'MAS': { name: 'Masoretic Hebrew Text', shortName: 'MAS', languageName: 'Hebrew', languageCode: 'heb' },
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
 * parsed Bible JSON, keyed by TRUE canonical book id. Books map through their
 * USFM codes — never by array index — so NT-only versions (where Mark sits at
 * position 0) still record 'മർക്കൊസ്' under id 41. Results are cached.
 */
const customBookNamesCache = new Map<string, Record<number, string>>();

export async function getVersionBookNames(
  versionId: string,
): Promise<Record<number, string>> {
  const normalized = normalizeVersionId(versionId);
  const booksById = await getVersionBooksById(normalized);
  const names: Record<number, string> = {};
  for (const [rawId, entry] of Object.entries(booksById)) {
    names[Number(rawId)] = entry.commonName || entry.name;
  }
  return names;
}

/**
 * Version books keyed by TRUE canonical id (1..66) with USFM codes, native
 * and common names and chapter counts. Parsed straight from the stored JSON
 * (or the bundled Tamil BSI asset) — the single lookup that keeps partial
 * versions (NT-only, single-book Bibles) aligned with the canonical grid.
 */
const versionBooksByIdCache = new Map<string, Record<number, VersionBookMeta>>();

export async function getVersionBooksById(
  versionId: string,
): Promise<Record<number, VersionBookMeta>> {
  const normalized = normalizeVersionId(versionId);
  const cached = versionBooksByIdCache.get(normalized);
  if (cached) return cached;
  let lookup: Record<number, VersionBookMeta> = {};
  try {
    if (isBundledVersionId(normalized)) {
      lookup = bookLookupFromLocalFile(getBundledTamilBsi());
    } else {
      const local = await readLocalBibleFile(normalized);
      if (local) lookup = bookLookupFromLocalFile(local);
    }
  } catch {
    // Missing file / parse failure: the UI falls back to the dictionaries.
  }
  versionBooksByIdCache.set(normalized, lookup);
  return lookup;
}

export function clearVersionCaches(versionId?: string): void {
  if (versionId === undefined) {
    versionBooksByIdCache.clear();
    chapterMemoryCache.clear();
    return;
  }
  const normalized = normalizeVersionId(versionId);
  // FIX 3 — the chapter memory cache is keyed `versionId::bookId::chapter`,
  // so purging one version means dropping every key with its prefix.
  for (const key of [...chapterMemoryCache.keys()]) {
    if (key.startsWith(`${normalized}::`)) chapterMemoryCache.delete(key);
  }
  versionBooksByIdCache.delete(normalized);
  customBookNamesCache.delete(normalized);
  parsedBiblesCache.delete(normalized);
  versionCoverageCache.delete(normalized);
  versionManifestCache.delete(normalized);
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

/**
 * File-safe stem for any version id. The case-sensitive helloao ids
 * (`spa_pdt`, `hin_irv`, `HINIRV`, `bgu_bt`...) are preserved EXACTLY as-is —
 * only characters illegal in filenames (`/ \ : space .` ...) collapse to `_`.
 * Spellings of the bundled Tamil BSI ("tamil bsi" | "tamil_bsi" | "TAMIL_BSI")
 * all normalize to the canonical `TAMIL_BSI` stem.
 */
function safeFileStem(versionId: string): string {
  return normalizeVersionId(versionId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Single source of truth for a version's offline JSON location:
 * `${FileSystem.documentDirectory}bibles/<safeStem>.json`. Used identically by
 * `downloadBibleVersion`, `getInstalledVersions` and `loadChapterVerses`.
 */
export function getVersionFileUri(versionId: string): string {
  return `${biblesDirectoryPath()}${safeFileStem(versionId)}.json`;
}

/** Internal alias — every read/write route through `getVersionFileUri`. */
function bibleFilePath(versionId: string): string {
  return getVersionFileUri(versionId);
}

function chapterCachePath(versionId: string, bookId: number, chapter: number): string {
  return `${biblesDirectoryPath()}${safeFileStem(versionId)}.chapter.${bookId}.${chapter}.json`;
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
  if (normalized) {
    // Legacy stored NT-only files may carry positional 1..27 ids — repair
    // BEFORE anything reads `booksById` / coverage so every consumer sees the
    // true New Testament grid (40..66).
    repairStoredLocalBookIds(normalized);
    withBooksById(normalized);
    parsedBiblesCache.set(versionId, normalized);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

function helloaoVersionUrl(versionId: string): string {
  return `https://bible.helloao.org/api/${versionId}/complete.simple.json`;
}

function usfmForBookId(bookId: number): string | null {
  return USFM_BY_BOOK_ID[bookId] ?? null;
}

/**
 * Replace USFM-code book names (`MAT`, `2PE`, `GEN`, ...) with human display
 * names: the version's language dictionary when it has one (Tamil, Spanish,
 * Hebrew, German, French, Portuguese, ...), then the canonical English name.
 * Real titles pass through untouched.
 */
function resolveBookDisplayName(
  bookId: number,
  rawName: string | undefined | null,
  languageCode?: string | null,
): string {
  const name = (rawName ?? '').trim();
  if (name && !isUsfmLikeBookName(name)) return name;
  const localized = localizedBookNameFor(languageCode ?? '', bookId);
  if (localized) return localized;
  const canonical = getBookById(bookId);
  return name || canonical?.englishName || `Book ${bookId}`;
}

// ---------------------------------------------------------------------------
// Version coverage — which canonical books/chapters a version actually has
// ---------------------------------------------------------------------------

/** Cached book/chapter coverage for one installed version. */
export interface VersionCoverage {
  /** Canonical 1..66 book ids present in this version (ascending). */
  bookIds: number[];
  /** Known chapter count per canonical book id (0 = unknown). */
  chapterCounts: Record<number, number>;
  /** True when the coverage is the complete 66-book canon. */
  complete: boolean;
}

const versionCoverageCache = new Map<string, VersionCoverage>();

/** Build a coverage record from `{ id, chapters }` entries. */
function coverageFromEntries(
  entries: { id: number; chapters: number | null }[],
): VersionCoverage | null {
  if (entries.length === 0) return null;
  const sorted = [...entries.map((entry) => entry.id)].sort((a, b) => a - b);
  const bookIds = sorted.filter((id, index) => index === 0 || sorted[index - 1] !== id);
  const chapterCounts: Record<number, number> = {};
  for (const entry of entries) chapterCounts[entry.id] = entry.chapters ?? 0;
  return { bookIds, chapterCounts, complete: bookIds.length >= 66 };
}

/** Canonical coverage of the full 66-book canon (bundled BSI / unknown ids). */
function canonicalCoverage(): VersionCoverage {
  const bookIds: number[] = [];
  const chapterCounts: Record<number, number> = {};
  for (const book of BIBLE_BOOKS) {
    bookIds.push(book.id);
    chapterCounts[book.id] = book.chaptersCount;
  }
  return { bookIds, chapterCounts, complete: true };
}

/** Highest chapter with verses inside one parsed local book (0 = skeleton). */
function maxChapterInLocalBook(book: LocalBibleBook | undefined): number {
  if (!book) return 0;
  let max = 0;
  for (const key of Object.keys(book.chapters)) {
    const chapter = Number(key);
    if (Number.isFinite(chapter) && book.chapters[key].length > 0) {
      max = Math.max(max, chapter);
    }
  }
  return max;
}

/** Read a helloao `books.json` payload into coverage (null when unusable). */
function coverageFromHelloaoBooks(payload: unknown): VersionCoverage | null {
  if (!payload || typeof payload !== 'object') return null;
  const books = (payload as { books?: unknown }).books;
  if (!Array.isArray(books)) return null;
  const entries: { id: number; chapters: number | null }[] = [];
  for (const raw of books) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const bookId = getBookIdFromUsfm(String(entry.id ?? '').toUpperCase());
    if (!bookId) continue;
    const rawCount = entry.numberOfChapters ?? entry.numberOfSections ?? entry.chapterCount ?? null;
    const chapters = typeof rawCount === 'number' && rawCount > 0 ? Math.floor(rawCount) : null;
    entries.push({ id: bookId, chapters });
  }
  return coverageFromEntries(entries);
}

/** Fetch `https://bible.helloao.org/api/{translation}/books.json` coverage. */
async function fetchHelloaoCoverage(rawTranslationId: string): Promise<VersionCoverage | null> {
  try {
    const response = await fetch(`https://bible.helloao.org/api/${rawTranslationId}/books.json`);
    if (!response.ok) return null;
    return coverageFromHelloaoBooks(await response.json());
  } catch {
    return null;
  }
}

/** Union two coverage snapshots; the richer chapter counts win per book. */
function mergeCoverage(local: VersionCoverage | null, online: VersionCoverage): VersionCoverage {
  if (!local) return online;
  const mergedIds = new Set<number>([...local.bookIds, ...online.bookIds]);
  const bookIds = [...mergedIds].sort((a, b) => a - b);
  const chapterCounts: Record<number, number> = { ...local.chapterCounts };
  for (const [rawId, onlineCount] of Object.entries(online.chapterCounts)) {
    const countId = Number(rawId);
    const existing = chapterCounts[countId] ?? 0;
    if (onlineCount > existing) chapterCounts[countId] = onlineCount;
  }
  return { bookIds, chapterCounts, complete: bookIds.length >= 66 };
}

/**
 * Coverage for one version, resolved 100% locally when possible: the bundled
 * BSI and local `bibles/<id>.json` files never touch the network. Only a
 * version without a local file falls back to its helloao `books.json`.
 * Cached in memory so pickers resolve availability synchronously afterwards.
 */
async function getVersionCoverage(versionId: string): Promise<VersionCoverage> {
  const normalizedId = normalizeVersionId(versionId);
  const cached = versionCoverageCache.get(normalizedId);
  if (cached) return cached;
  if (isBundledVersionId(normalizedId)) {
    const bundledCoverage = canonicalCoverage();
    versionCoverageCache.set(normalizedId, bundledCoverage);
    return bundledCoverage;
  }

  let coverage: VersionCoverage | null = null;
  try {
    const local = await readLocalBibleFile(normalizedId);
    if (local && local.books.length > 0) {
      coverage = coverageFromEntries(
        local.books
          .filter((book) => book.id >= 1 && book.id <= 66)
          .map((book) => ({ id: book.id, chapters: maxChapterInLocalBook(book) })),
      );
    }
  } catch {
    // Broken local file: fall through to the online catalog.
  }

  // helloao `books.json` knows the true book/chapter grid for skeleton files.
  const rawTranslationId =
    findDefaultVersion(normalizedId)?.helloaoTranslationId ||
    findDefaultVersion(versionId)?.helloaoTranslationId ||
    (!isBundledVersionId(normalizedId) ? normalizedId : null);
  if (rawTranslationId) {
    const online = await fetchHelloaoCoverage(rawTranslationId);
    if (online) coverage = mergeCoverage(coverage, online);
  }

  // Unknown ids are assumed to carry the complete canon (no false redirect).
  if (!coverage) coverage = canonicalCoverage();
  versionCoverageCache.set(normalizedId, coverage);
  return coverage;
}

/**
 * Canonical book ids (1..66) available in a version: the full canon for
 * complete Bibles, the exact subset for partial versions (NT-only,
 * single-book downloads, ...).
 */
export async function getAvailableBooksForVersion(versionId: string): Promise<number[]> {
  const normalizedId = normalizeVersionId(versionId);
  if (isBundledVersionId(normalizedId)) {
    return BIBLE_BOOKS.map((book) => book.id);
  }
  return (await getVersionCoverage(versionId)).bookIds;
}

/** One available book of a version with its native (localized) display name. */
export interface VersionBookEntry {
  /** Canonical id 1..66 */
  bookId: number;
  /** Native name in the version's own script (nativeName). */
  nativeName: string;
  /** Canonical USFM code, e.g. HEB. */
  usfm: string;
}

/**
 * FIX 2 — exact inventory of one installed version: the canonical `bookId`s
 * it actually carries (1..66) together with each book's `nativeName`
 * (`nativeName = commonName || name`), keyed strictly through the USFM map.
 * Book pickers split this list into OT (`1..39`) / NT (`40..66`) and pair
 * `nativeName` with `BIBLE_BOOKS[bookId - 1].englishName` — so Odia
 * `Hebrews` always sits next to `Hebrews`, never `Psalms`.
 */
export async function getAvailableBookEntriesForVersion(
  versionId: string,
): Promise<VersionBookEntry[]> {
  const normalizedId = normalizeVersionId(versionId);
  const [bookIds, booksById] = await Promise.all([
    getAvailableBooksForVersion(normalizedId),
    getVersionBooksById(normalizedId),
  ]);
  return bookIds
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 66)
    .map((bookId) => ({
      bookId,
      usfm: booksById[bookId]?.usfm?.trim() || getUsfmBookCode(bookId),
      nativeName:
        booksById[bookId]?.commonName?.trim() ||
        booksById[bookId]?.name?.trim() ||
        getBookById(bookId)?.englishName ||
        `Book ${bookId}`,
    }))
    .sort((a, b) => a.bookId - b.bookId);
}

/** One available book of a version with native name + true chapter count. */
export interface VersionBookManifestEntry {
  /** Canonical id 1..66. */
  bookId: number;
  /** Name in the version's own language/script (e.g. `Matthäus`). */
  nativeName: string;
  /** Canonical English name (`Matthew`). */
  englishName: string;
  /** The version's own chapter count for this book (28 for Matthew...). */
  chapters: number;
  /** Testament section derived from the canonical id. */
  testament: 'OT' | 'NT';
}

const versionManifestCache = new Map<string, VersionBookManifestEntry[]>();

/**
 * FIX 4 — the EXACT book inventory of a version: only books that version
 * actually carries, in canonical order, each with its own native name, the
 * canonical English name and its TRUE chapter count.
 *
 * `[]` when a non-bundled version has no readable local file — never the
 * canonical 66-book filler list.
 */
export async function getVersionBooksManifest(
  versionId: string,
): Promise<VersionBookManifestEntry[]> {
  const normalized = normalizeVersionId(versionId);
  const cached = versionManifestCache.get(normalized);
  if (cached) return cached;

  let local: LocalBibleFile | null = null;
  try {
    local = isBundledVersionId(normalized)
      ? getBundledTamilBsi()
      : await readLocalBibleFile(normalized);
  } catch {
    local = null;
  }

  if (!local || local.books.length === 0) {
    versionManifestCache.set(normalized, []);
    return [];
  }

  const seen = new Set<number>();
  const bundled = isBundledVersionId(normalized);
  const manifest: VersionBookManifestEntry[] = [];
  for (const book of local.books) {
    if (!Number.isInteger(book.id) || book.id < 1 || book.id > 66 || seen.has(book.id)) {
      continue;
    }
    seen.add(book.id);
    const canonical = getBookById(book.id);
    const liveMax = maxChapterInLocalBook(book);
    const declared = book.totalChapters && book.totalChapters > 0 ? book.totalChapters : 0;
    // TRUE chapter count from the version itself: its declared count or the
    // highest chapter physically present. The canonical count is only a last
    // resort for files that carry no chapter information at all, so a version
    // that really has fewer chapters is never inflated.
    const observed = Math.max(declared, liveMax);
    const chapters = observed > 0 ? observed : canonical?.chaptersCount ?? 0;
    // The bundled asset stores ids only, so its native names come from the
    // canonical Tamil dictionary; other versions keep their own `name` —
    // except raw USFM codes (`GEN`, `1SA`), which are replaced with the
    // localized display name for the version's language.
    const nativeName = bundled
      ? canonical?.tamilName || book.name?.trim() || canonical?.englishName || `Book ${book.id}`
      : resolveBookDisplayName(
          book.id,
          book.commonName?.trim() || book.name?.trim(),
          local.languageCode,
        );
    manifest.push({
      bookId: book.id,
      nativeName,
      englishName:
        canonical?.englishName ||
        book.commonName?.trim() ||
        book.name?.trim() ||
        `Book ${book.id}`,
      chapters,
      testament: book.id <= 39 ? 'OT' : 'NT',
    });
  }

  manifest.sort((a, b) => a.bookId - b.bookId);
  versionManifestCache.set(normalized, manifest);
  return manifest;
}

/** True for helloao nodes that never carry scripture text (headers, footnotes, bare note references). */
function isSkippedHelloaoNode(item: Record<string, unknown>): boolean {
  const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
  if (type === 'heading' || type === 'footnote' || type === 'note') return true;
  // Note-reference nodes (`{ noteId: "..." }` with no text) must stay silent.
  if (
    item.noteId !== undefined && item.noteId !== null &&
    item.text === undefined && item.content === undefined && item.items === undefined
  ) {
    return true;
  }
  // Bookkeeping nodes (`{ lineBreak: true }`) — layout only. Poetry markers
  // (`{ text: "...", poem: 1 }`) are NOT skipped: they carry the verse text.
  if (item.lineBreak === true && typeof item.text !== 'string') return true;
  return false;
}

/** Verse number carried by a helloao node (`{ type: "verse", number: 16 }` etc.). */
function helloaoVerseMarker(item: Record<string, unknown>): number | null {
  const raw = item.number ?? item.verseNumber;
  const numeric = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
  return type === 'verse' || type === '' ? numeric : null;
}

/**
 * Pull the helloao verse list out of a chapter payload. Accepts a
 * `chapter.content` tree (strings, arrays, nested paragraph/span nodes), a
 * flat `chapter.verses` array (`{ number, text }` items or plain strings)
 * and a top-level `data.verses` payload. Explicit verse markers win; when a
 * payload carries no markers at all, the text stream is numbered 1..n.
 */
function extractHelloaoVerses(content: unknown): ChapterVerse[] {
  const verseMap = new Map<number, string[]>();
  /** Text found before the first explicit verse marker, in reading order. */
  const headerlessStream: string[] = [];
  let sawVerseMarker = false;

  function pushText(text: string, verseNum: number | null): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (verseNum === null) {
      headerlessStream.push(trimmed);
      return;
    }
    if (!verseMap.has(verseNum)) verseMap.set(verseNum, []);
    verseMap.get(verseNum)!.push(trimmed);
  }

  function walk(node: unknown, currentVerse: number | null): void {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') {
      pushText(String(node), currentVerse);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, currentVerse);
      return;
    }
    if (typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    if (isSkippedHelloaoNode(item)) return;
    let nextVerse = currentVerse;
    const marker = helloaoVerseMarker(item);
    if (marker !== null) {
      sawVerseMarker = true;
      nextVerse = marker;
      if (!verseMap.has(marker)) verseMap.set(marker, []);
    }
    if (typeof item.text === 'string') pushText(item.text, nextVerse);
    const nested = item.content ?? item.items;
    if (nested !== undefined && nested !== null) walk(nested, nextVerse);
  }

  walk(content, null);

  const verses: ChapterVerse[] = [];
  if (!sawVerseMarker && headerlessStream.length > 0) {
    headerlessStream.forEach((text, index) => {
      verses.push({ verse: index + 1, text: text.replace(/\s+/g, ' ').trim() });
    });
    return verses;
  }
  for (const [verse, parts] of verseMap.entries()) {
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      verses.push({ verse, text });
    }
  }
  verses.sort((a, b) => a.verse - b.verse);
  return verses;
}

/** Normalize an already-local-shaped `{ books: [...] }` payload (ids + chapter maps). */
function normalizePreNormalizedBible(
  versionId: string,
  payload: { books: unknown[]; versionName?: string; language?: string; languageCode?: string },
): LocalBibleFile {
  const books: LocalBibleBook[] = [];
  payload.books.forEach((rawBook, index) => {
    if (!rawBook || typeof rawBook !== 'object') return;
    const bookData = rawBook as { id?: unknown; bookId?: unknown; name?: unknown; chapters?: unknown };
    // FIX 4 — names beat positional ids (`Matthäus` is ALWAYS 40), USFM codes
    // stay authoritative when the name is unknown.
    const id = resolveCanonicalBookId(bookData, index, payload.books.length);
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
      totalChapters: Array.isArray(bookData.chapters) && bookData.chapters.length > 0
        ? bookData.chapters.length
        : undefined,
      chapters,
    });
  });
  repairPartialLocalBookIds(books);
  annotateCanonicalBookIds(books);
  const local: LocalBibleFile = {
    versionId,
    versionName: payload.versionName ?? versionId,
    language: payload.language ?? '',
    languageCode: payload.languageCode ?? '',
    books,
  };
  local.booksById = buildBooksById(books, local.languageCode);
  return local;
}

/**
 * helloao books always carry a USFM 3-letter code. It is the ONLY reliable
 * key: many translations (Bangubangu `bgu_bt`, Greek `grc_sr`, ...) include
 * New Testament books only, so array position / `order` puts Mark at position
 * 0 — positional mapping would brand it bookId 1 (Genesis) and the reader
 * shows "MALAKO 27" against Genesis metadata. Always map by USFM code
 * (MAT=40, MRK=41, ..., REV=66).
 */
function canonicalBookIdFromUsfm(usfm: string | undefined, fallbackId: number): number {
  const canonical = getBookIdFromUsfm(String(usfm ?? '').toUpperCase());
  return canonical && canonical >= 1 && canonical <= 66 ? canonical : fallbackId;
}

// ---------------------------------------------------------------------------
// FIX 4 — canonical id resolution for partial / positional payloads
// ---------------------------------------------------------------------------

/** Strip accents and punctuation so `Matthäus` -> `matthaus`. */
function normalizeBookNameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[äàáâã]/g, 'a')
    .replace(/[ëèéê]/g, 'e')
    .replace(/[ïìíî]/g, 'i')
    .replace(/[öòóôõ]/g, 'o')
    .replace(/[üùúû]/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ñ/g, 'n')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, ' ')
    .trim();
}

/**
 * Gospel book names across the languages this app ships. A four-book payload
 * (`BTD`, German) uses `Matthäus / Markus / Lukas / Johannes`; without this
 * matcher those books were branded Genesis-Numbers by array position.
 */
const GOSPEL_NAME_KEYS: readonly { bookId: number; keys: readonly string[] }[] = [
  {
    bookId: 40,
    keys: ['matthew', 'matt', 'matthaus', 'matthaeus', 'matthieu', 'mateo', 'matteo', 'matvey', 'матфей', 'матфея', 'матф'],
  },
  {
    bookId: 41,
    keys: ['mark', 'markus', 'marcus', 'marcos', 'marc', 'марк', 'марка'],
  },
  {
    bookId: 42,
    keys: ['luke', 'lukas', 'lucas', 'luca', 'luk', 'лук', 'лука', 'луки'],
  },
  {
    bookId: 43,
    keys: ['john', 'johannes', 'johannen', 'juan', 'jean', 'giovanni', 'иоанн', 'иоанна'],
  },
];

/** True for the four canonical Gospel ids (40-43). */
function isGospelBookId(id: number): boolean {
  return id >= 40 && id <= 43;
}

/** Canonical Gospel id from a book title (`Matthäus`, `Juan`, `От Иоанна`). */
function matchGospelBookId(name: string): number | null {
  const key = normalizeBookNameKey(name);
  if (!key) return null;
  // `1 John` / `2 Johannes` are epistles, never the Gospel.
  if (/^\d/.test(key)) return null;
  for (const entry of GOSPEL_NAME_KEYS) {
    if (entry.keys.some((needle) => key === needle || key.includes(needle))) {
      return entry.bookId;
    }
  }
  return null;
}

/** Every human-readable book name carried by a raw payload object. */
function rawBookNameCandidates(rawBook: unknown): string[] {
  if (!rawBook || typeof rawBook !== 'object') return [];
  const record = rawBook as Record<string, unknown>;
  const names: string[] = [];
  for (const field of ['name', 'title', 'commonName', 'BookName', 'BookNameEN', 'book'] as const) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() && !names.includes(value.trim())) {
      names.push(value.trim());
    }
  }
  return names;
}

/** Canonical id from any recognizable book name (English/Tamil exact + Gospels). */
function canonicalIdFromBookNames(names: readonly string[]): number | null {
  for (const name of names) {
    const exact = getBookIdFromBookName(name);
    if (exact) return exact;
    const gospel = matchGospelBookId(name);
    if (gospel) return gospel;
  }
  return null;
}

/**
 * FIX 4 — resolve the TRUE canonical book id of one raw book entry.
 *
 * Resolution order (positional payload ids must never beat real book names):
 *   1. A recognized book name (`Matthäus` -> 40, `Hebreos` -> 58).
 *   2. USFM code (`id|usfm|abbr|code|book_id|helloaoBookId`), unless a known
 *      name clearly contradicts a stale positional stamp (legacy BTD files
 *      carry `GEN..NUM` on the four Gospels).
 *   3. Verified numeric `bookId` / `nr` (1..66) that agrees with the name.
 *   4. Testament-count positional fallback: 27 books -> 40..66,
 *      39 books -> 1..39, 4 Gospels -> 40..43.
 *   5. The stored numeric id, then the array position.
 */
export function resolveCanonicalBookId(
  rawBook: unknown,
  index: number,
  totalBooks: number,
): number {
  const record = rawBook && typeof rawBook === 'object'
    ? rawBook as Record<string, unknown>
    : {};
  const names = rawBookNameCandidates(rawBook);
  const nameId = canonicalIdFromBookNames(names);

  let usfmId: number | null = null;
  for (const field of ['id', 'usfm', 'abbr', 'code', 'book_id', 'helloaoBookId'] as const) {
    const value = record[field];
    if (typeof value !== 'string') continue;
    const code = value.trim().toUpperCase();
    if (!code || /^\d+$/.test(code)) continue;
    const canonical = USFM_TO_BOOK_ID[code];
    if (canonical) {
      usfmId = canonical;
      break;
    }
  }

  if (usfmId !== null) {
    // A stale positional stamp (e.g. GEN on `Matthäus`) must lose to a name
    // that resolves inside the Gospels while the code does not.
    if (nameId !== null && isGospelBookId(nameId) && !isGospelBookId(usfmId)) {
      return nameId;
    }
    if (nameId !== null && nameId !== usfmId && totalBooks <= 4) return nameId;
    return usfmId;
  }
  if (nameId !== null) return nameId;

  // Verified numeric ids: only trust them when the name agrees or is absent.
  for (const field of ['bookId', 'nr', 'number', 'BookNo', 'bookNo'] as const) {
    const raw = record[field];
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 66) continue;
    if (names.length === 0 || nameId === numeric) return numeric;
    if (totalBooks >= 60) return numeric;
  }

  if (totalBooks === 27) return index + 40;
  if (totalBooks === 39) return index + 1;
  if (totalBooks === 4) return index + 40;

  const storedNumeric = record.id;
  if (typeof storedNumeric === 'number' && Number.isInteger(storedNumeric) &&
    storedNumeric >= 1 && storedNumeric <= 66) {
    return storedNumeric;
  }
  return index + 1;
}

/**
 * Repair pass for PARTIAL local payloads that arrive without usable USFM
 * codes (godlytalias / pre-normalized JSON). Resolution goes through
 * `resolveCanonicalBookId`, which prefers names over positional ids and
 * applies the 27/39/4-book positional fallbacks.
 */
function repairPartialLocalBookIds(books: LocalBibleBook[]): void {
  if (books.length === 0 || books.length >= 66) return;
  books.forEach((book, index) => {
    const resolved = resolveCanonicalBookId(book, index, books.length);
    if (!Number.isInteger(resolved) || resolved < 1 || resolved > 66) return;
    book.id = resolved;
    // Re-stamp USFM codes from the resolved id so stale positional stamps
    // (`GEN` on `Matthäus`) never contradict the canonical book.
    book.helloaoBookId = USFM_BY_BOOK_ID[resolved];
    if (!book.commonName?.trim()) book.commonName = book.name;
  });
}

/**
 * One-time repair for stored local files written by older builds: partial
 * payloads saved with positional ids (`Matthäus` stored as id 1, `Markus`
 * as id 2...) are re-mapped to their true canonical ids, and any stale
 * `booksById` metadata map is dropped so it rebuilds on the true grid.
 */
function repairStoredLocalBookIds(local: LocalBibleFile): LocalBibleFile {
  if (local.books.length === 0 || local.books.length >= 66) return local;
  const positional27 =
    local.books.length === 27 &&
    local.books.every((book, index) => book.id === index + 1);
  if (positional27) {
    // Legacy NT-only files carry positional 1..27 ids AND positional USFM
    // stamps (GEN..HOS), so neither ids nor codes can be trusted: the true
    // New Testament grid is position-based (Matthew 40 ... Revelation 66).
    local.books.forEach((book, index) => {
      book.id = index + 40;
      book.helloaoBookId = USFM_BY_BOOK_ID[book.id];
      if (!book.commonName?.trim()) book.commonName = book.name;
    });
  } else {
    repairPartialLocalBookIds(local.books);
  }
  // Always rebuild the id-keyed metadata map for partial files: legacy saves
  // may carry a map built on positional ids even when the ids now agree.
  local.booksById = undefined;
  withBooksById(local);
  return local;
}

/** Build the canonical-id-keyed book metadata map for one version. */
export function buildBooksById(
  books: LocalBibleBook[],
  languageCode?: string | null,
): Record<number, VersionBookMeta> {
  const byId: Record<number, VersionBookMeta> = {};
  for (const book of books) {
    if (!Number.isInteger(book.id) || book.id < 1 || book.id > 66) continue;
    if (byId[book.id]) continue;
    const chapterNumbers = Object.keys(book.chapters)
      .map(Number)
      .filter((num) => Number.isFinite(num) && num >= 1 && book.chapters[String(num)]?.length > 0);
    const liveChapterCount = chapterNumbers.length;
    const firstChapter = liveChapterCount > 0 ? Math.min(...chapterNumbers) : 1;
    // Highest recorded chapter wins so callers can clamp reading position;
    // skeleton books fall back to the version's declared count, then canon.
    const maxChapter =
      chapterNumbers.length > 0
        ? Math.max(...chapterNumbers)
        : book.totalChapters && book.totalChapters > 0
          ? book.totalChapters
          : getBookById(book.id)?.chaptersCount ?? 0;
    const declaredChapters = book.totalChapters && book.totalChapters > 0
      ? Math.max(book.totalChapters, maxChapter)
      : liveChapterCount > 0
        ? liveChapterCount
        : maxChapter;
    // Raw USFM-code names (`GEN`, `1SA`) are never display titles: resolve
    // them to the version-language book dictionary name.
    const resolvedName = resolveBookDisplayName(book.id, book.name, languageCode);
    const resolvedCommonName = resolveBookDisplayName(
      book.id,
      book.commonName?.trim() || book.name,
      languageCode,
    );
    byId[book.id] = {
      usfm: book.helloaoBookId?.trim() || getUsfmBookCode(book.id),
      name: resolvedName,
      commonName: resolvedCommonName,
      numberOfChapters: declaredChapters,
      firstChapterNumber: firstChapter,
    };
  }
  return byId;
}

function bookLookupFromLocalFile(local: LocalBibleFile): Record<number, VersionBookMeta> {
  return local.booksById ?? buildBooksById(local.books, local.languageCode);
}

function withBooksById(local: LocalBibleFile): LocalBibleFile {
  if (!local.booksById) local.booksById = buildBooksById(local.books, local.languageCode);
  return local;
}

/** Convert a helloao `complete.simple.json` into the local file shape. */
function normalizeHelloaoComplete(
  versionId: string,
  payload: HelloaoCompleteFile,
): LocalBibleFile {
  const books: LocalBibleBook[] = [];
  const rawBooks = payload.books ?? [];
  rawBooks.forEach((rawBook, index) => {
    if (!rawBook || typeof rawBook !== 'object') return;
    const bookData = rawBook as {
      id?: unknown;
      name?: unknown;
      commonName?: unknown;
      order?: unknown;
      chapters?: { chapter?: unknown }[];
    };
    const usfm = typeof bookData.id === 'string' ? bookData.id : String(bookData.id ?? '');
    // TRUE canonical id from the USFM code — never the array index or the
    // collection-relative `order`.
    const fallbackId =
      typeof bookData.order === 'number' && bookData.order >= 1 && bookData.order <= 66
        ? bookData.order
        : index + 1;
    const canonicalId = canonicalBookIdFromUsfm(usfm, fallbackId);
    // USFM-code name guard: some payloads ship books without `name`/
    // `commonName`, leaving the raw `MAT`/`2PE` code as the only label.
    const languageCode = typeof payload.translation?.language === 'string' ? payload.translation.language : '';
    const name = resolveBookDisplayName(
      canonicalId,
      typeof bookData.name === 'string' && bookData.name.trim()
        ? bookData.name
        : typeof bookData.commonName === 'string' && bookData.commonName.trim()
          ? bookData.commonName
          : (usfm || `Book ${canonicalId}`),
      languageCode,
    );
    const commonName =
      typeof bookData.commonName === 'string' && bookData.commonName.trim() &&
      !isUsfmLikeBookName(bookData.commonName)
        ? bookData.commonName.trim()
        : name;
    const chapters: Record<string, ChapterVerse[]> = {};
    for (const rawChapter of bookData.chapters ?? []) {
      const chapter = rawChapter.chapter as { number?: number; content?: unknown } | undefined;
      if (!chapter || typeof chapter.number !== 'number') continue;
      const verses = extractHelloaoVerses(chapter.content);
      if (verses.length > 0) chapters[String(chapter.number)] = verses;
    }
    books.push({
      id: canonicalId,
      name,
      commonName,
      helloaoBookId: usfm,
      totalChapters: Array.isArray(bookData.chapters) && bookData.chapters.length > 0
        ? bookData.chapters.length
        : undefined,
      chapters,
    });
  });
  annotateCanonicalBookIds(books);
  const local: LocalBibleFile = {
    versionId,
    versionName: payload.translation?.englishName ||
      payload.translation?.shortName || versionId,
    language: payload.translation?.languageName ||
      payload.translation?.languageEnglishName || '',
    languageCode: payload.translation?.language || '',
    books,
  };
  local.booksById = buildBooksById(books, local.languageCode);
  return local;
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
    // FIX 4 — German `Matthäus` (positional 1) resolves to Matthew (40).
    const id = resolveCanonicalBookId(rawBook, index, rawBooks.length);
    const chapters: Record<string, ChapterVerse[]> = {};
    const rawChapters = (Array.isArray(rawBook?.Chapter) ? rawBook.Chapter
      : Array.isArray(rawBook?.chapters) ? rawBook.chapters : []) as unknown[];
    rawChapters.forEach((rawChapter, chapterIndex) => {
      const parsed = parseGodlytaliasChapter(rawChapter);
      if (parsed.length > 0) chapters[String(chapterIndex + 1)] = parsed;
    });
    books.push({
      id,
      name,
      totalChapters: rawChapters.length > 0 ? rawChapters.length : undefined,
      chapters,
    });
  });
  repairPartialLocalBookIds(books);
  annotateCanonicalBookIds(books);
  // godlytalias payloads ship for many languages. Only the bundled Tamil seed
  // carries the "Tamil BSI" branding — every other version keeps its real id
  // so downloaded Bibles never show a wrong "Tamil BSI (Offline Ready)" title.
  const bundled = isBundledVersionId(versionId);
  const local: LocalBibleFile = {
    versionId,
    versionName: bundled ? 'Tamil BSI (Offline Ready)' : versionId,
    language: bundled ? 'Tamil' : '',
    languageCode: bundled ? 'tam' : '',
    books,
  };
  local.booksById = buildBooksById(books, local.languageCode);
  return local;
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

/**
 * Convert a `thiagobodruk` whole-Bible payload into the local file shape.
 * Two storage variants exist in the mirror:
 * - classic: a 66-entry array of chapter arrays (each chapter an array of
 *   verse strings), or a numeric-keyed record of them;
 * - current: an array of `{ abbrev, chapters: [[text, ...]] }` book records.
 *
 * Positional ids follow the canon grids: 27 entries map to the New Testament
 * (40..66, e.g. `grc_grctr`), 39 entries to the Old Testament (1..39, e.g.
 * `he_wlc`), everything else to Genesis..Revelation (1..66).
 */
function normalizeThiagobodruk(
  versionId: string,
  payload: RawThiagobodrukFile,
): LocalBibleFile {
  const rawBooks: unknown[] = Array.isArray(payload)
    ? (payload as unknown[])
    : Object.keys(payload as Record<string, unknown[]>)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => (payload as Record<string, unknown[]>)[key]);
  const idForIndex = (index: number): number => {
    if (rawBooks.length === 27) return index + 40;
    return index + 1;
  };
  const books: LocalBibleBook[] = [];
  rawBooks.forEach((rawBook, index) => {
    if (index >= 66) return;
    const id = idForIndex(index);
    const chapters: Record<string, ChapterVerse[]> = {};
    const record = rawBook && typeof rawBook === 'object'
      ? rawBook as { chapters?: unknown; Chapter?: unknown }
      : undefined;
    const chapterSource = Array.isArray(rawBook)
      ? rawBook
      : record && Array.isArray(record.chapters)
        ? record.chapters
        : record && Array.isArray(record.Chapter)
          ? record.Chapter
          : null;
    if (chapterSource) {
      chapterSource.forEach((rawChapter, chapterIndex) => {
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
      totalChapters: chapterSource ? chapterSource.length : undefined,
      chapters,
    });
  });
  repairPartialLocalBookIds(books);
  annotateCanonicalBookIds(books);
  const local: LocalBibleFile = {
    versionId,
    versionName: versionId,
    language: '',
    languageCode: '',
    books,
  };
  local.booksById = buildBooksById(books, local.languageCode);
  return local;
}

/** One verse inside a `getbible` chapter (`{ chapter, verse, name, text }`). */
interface RawGetbibleVerse {
  chapter?: unknown;
  verse?: unknown;
  name?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

/** One chapter inside a `getbible` book (`{ chapter, name, verses }`). */
interface RawGetbibleChapter {
  chapter?: unknown;
  name?: unknown;
  verses?: unknown;
  [key: string]: unknown;
}

/**
 * `getbible` v2 whole-Bible payload (`api.getbible.net/v2/<abbr>.json`):
 * `{ translation, abbreviation, lang, language, books: [{ nr, name,
 * chapters: [{ chapter, name, verses: [{ verse, text }] }] }] }`.
 */
interface RawGetbibleFile {
  translation?: unknown;
  abbreviation?: unknown;
  lang?: unknown;
  language?: unknown;
  books?: unknown;
  [key: string]: unknown;
}

/** Convert a `getbible` payload into the local file shape. */
function normalizeGetbible(versionId: string, payload: RawGetbibleFile): LocalBibleFile {
  const rawBooks = Array.isArray(payload.books) ? payload.books : [];
  const books: LocalBibleBook[] = [];
  rawBooks.forEach((rawBook, index) => {
    if (!rawBook || typeof rawBook !== 'object') return;
    const bookRecord = rawBook as Record<string, unknown>;
    // Names resolve to canonical ids (`Genesis` -> 1, `Song of Solomon` -> 22
    // via the canonical grid when the exact match misses); `nr` mirrors the
    // canonical numbering, and NT-only mirrors fall back positionally.
    const id = resolveCanonicalBookId(bookRecord, index, rawBooks.length);
    const chapters: Record<string, ChapterVerse[]> = {};
    if (Array.isArray(bookRecord.chapters)) {
      (bookRecord.chapters as unknown[]).forEach((rawChapter) => {
        if (!rawChapter || typeof rawChapter !== 'object') return;
        const chapter = rawChapter as RawGetbibleChapter;
        const chapterNumber = typeof chapter.chapter === 'number'
          ? chapter.chapter
          : parseInt(String(chapter.chapter ?? ''), 10);
        if (!Number.isFinite(chapterNumber) || chapterNumber < 1) return;
        const verses: ChapterVerse[] = [];
        const verseList = Array.isArray(chapter.verses) ? chapter.verses : [];
        verseList.forEach((item, verseIndex) => {
          if (!item || typeof item !== 'object') return;
          const verse = item as RawGetbibleVerse;
          if (typeof verse.text !== 'string' || !verse.text.trim()) return;
          const number = typeof verse.verse === 'number'
            ? verse.verse
            : parseInt(String(verse.verse ?? ''), 10);
          verses.push({
            verse: Number.isFinite(number) && number > 0 ? number : verseIndex + 1,
            text: verse.text.replace(/\s+/g, ' ').trim(),
          });
        });
        if (verses.length > 0) chapters[String(chapterNumber)] = verses;
      });
    }
    books.push({
      id,
      name: resolveBookDisplayName(
        id,
        typeof bookRecord.name === 'string' ? bookRecord.name : undefined,
      ),
      helloaoBookId: USFM_BY_BOOK_ID[id],
      totalChapters: Array.isArray(bookRecord.chapters) ? bookRecord.chapters.length : undefined,
      chapters,
    });
  });
  repairPartialLocalBookIds(books);
  annotateCanonicalBookIds(books);
  const local: LocalBibleFile = {
    versionId,
    versionName: typeof payload.translation === 'string' && payload.translation
      ? payload.translation
      : typeof payload.abbreviation === 'string' && payload.abbreviation
        ? payload.abbreviation
        : versionId,
    language: typeof payload.language === 'string' ? payload.language : '',
    languageCode: typeof payload.lang === 'string' ? payload.lang : '',
    books,
  };
  local.booksById = buildBooksById(books, local.languageCode);
  return local;
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
  if (isLocalBibleFile(payload)) return withBooksById(payload);

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.books) && record.books.length > 0) {
    const firstBook = record.books[0] as Record<string, unknown>;
    // helloao `complete.simple.json`: `{ translation, books: [{ id: 'MAT',
    // chapters: [{ chapter: { number, content } }] }] }`. Detect it BEFORE the
    // godlytalias branch, whose chapter parser would silently drop every
    // chapter of this shape.
    const isHelloaoComplete =
      (record.translation !== null && typeof record.translation === 'object') ||
      (typeof firstBook?.id === 'string' &&
        /^[A-Z0-9]{3}$/.test(firstBook.id) &&
        !('BookName' in firstBook));
    if (isHelloaoComplete) {
      return normalizeHelloaoComplete(
        versionId,
        payload as Partial<HelloaoCompleteFile> & Record<string, unknown>,
      );
    }
    // `getbible` v2 (api.getbible.net/v2/<abbr>.json): `translation` is a
    // plain string and each book carries `{ nr, name, chapters }` records
    // with `{ chapter, verses }` children — a shape the godlytalias chapter
    // parser would silently drop every verse of.
    if (typeof record.translation === 'string' && record.books.length > 10) {
      const sampleBook = record.books.find(
        (entry) => entry && typeof entry === 'object',
      ) as Record<string, unknown> | undefined;
      const hasGetbibleChapters = sampleBook
        ? Array.isArray(sampleBook.chapters) &&
          sampleBook.chapters.some(
            (node) => node && typeof node === 'object' && !Array.isArray(node),
          )
        : false;
      if (sampleBook && ('nr' in sampleBook || hasGetbibleChapters)) {
        return normalizeGetbible(versionId, payload as RawGetbibleFile);
      }
    }
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

  const rawTranslationId = version.helloaoTranslationId || version.id;

  // Task 7 — multi-source fallback chain: the helloao (or curated JSON)
  // endpoint first, then getbible / thiagobodruk / godlytalias mirrors
  // registered for this version. Every payload shape is handled by
  // `normalizeAnyBiblePayload`.
  const primaryUrl = version.source === 'json'
    ? version.downloadUrl
    : helloaoVersionUrl(rawTranslationId);
  const candidateUrls: string[] = [];
  if (primaryUrl) candidateUrls.push(primaryUrl);
  for (const url of fallbackJsonEndpoints(version.id, version.helloaoTranslationId ?? rawTranslationId)) {
    if (!candidateUrls.includes(url)) candidateUrls.push(url);
  }

  await ensureBiblesDirectory();
  const tempPath = `${biblesDirectoryPath()}${safeFileStem(version.id)}.partial.json`;

  let localFile: LocalBibleFile | null = null;
  let sawHttpResponse = false;

  type FileSystemDownloadProgress = {
    totalBytesWritten: number;
    totalBytesExpectedToWrite: number;
  };
  const onDownloadProgress = (progressEvent: FileSystemDownloadProgress): void => {
    const { totalBytesWritten, totalBytesExpectedToWrite } = progressEvent;
    const percent = totalBytesWritten / Math.max(1, totalBytesExpectedToWrite);
    onProgress?.({
      versionId: version.id,
      percent: percent >= 1 ? 95 : Math.floor(percent * 95),
      bytesWritten: totalBytesWritten,
      totalBytes: totalBytesExpectedToWrite,
    });
  };

  for (const [urlIndex, url] of candidateUrls.entries()) {
    if (candidateUrls.length > 1) {
      onProgress?.({
        versionId: version.id,
        percent: Math.min(35, 5 + urlIndex * 10),
        bytesWritten: 0,
        totalBytes: 0,
      });
    }
    try {
      const resumable = FileSystem.createDownloadResumable(url, tempPath, {}, onDownloadProgress);
      const res = await resumable.downloadAsync();
      sawHttpResponse = sawHttpResponse || (res !== undefined && res !== null);
      if (res && res.status >= 200 && res.status < 300) {
        const raw = await FileSystem.readAsStringAsync(tempPath, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const parsed: unknown = JSON.parse(raw);
        const normalized = normalizeAnyBiblePayload(version.id, parsed);
        if (normalized && normalized.books.length > 0) {
          localFile = normalized;
          break;
        }
      }
    } catch {
      // Source unavailable or unparsable; the next candidate (then the
      // on-demand skeleton below) takes over.
    } finally {
      await FileSystem.deleteAsync(tempPath, { idempotent: true });
    }
  }

  // If no source produced a parseable full-Bible payload, create a skeleton
  // Bible file from the helloao `books.json` grid (helloao-backed versions
  // only) so partial installs keep their on-demand chapter fetching.
  if (!localFile || !localFile.books.length) {
    onProgress?.({ versionId: version.id, percent: 50, bytesWritten: 0, totalBytes: 0 });
    const skeletonTranslationId = version.source === 'json'
      ? version.helloaoTranslationId ?? null
      : rawTranslationId;
    let booksPayload: any = null;
    if (skeletonTranslationId) {
      try {
        const resp = await fetch(`https://bible.helloao.org/api/${skeletonTranslationId}/books.json`);
        if (resp.ok) {
          booksPayload = await resp.json();
        }
      } catch {
        // network error
      }
    }

    const isOtOnly = /heb|mas/i.test(version.id) || /hebrew/i.test(version.languageName);
    const maxBook = isOtOnly ? 39 : 66;
    const skeletonBooks: LocalBibleBook[] = [];

    if (booksPayload?.books && Array.isArray(booksPayload.books)) {
      // Cache the version's true book/chapter coverage for the pickers.
      const coverage = coverageFromHelloaoBooks(booksPayload);
      if (coverage) versionCoverageCache.set(normalizeVersionId(version.id), coverage);
      for (const b of booksPayload.books) {
        const usfm = (b.id || '').toUpperCase();
        const bookId = getBookIdFromUsfm(usfm);
        if (bookId && (!isOtOnly || bookId <= 39)) {
          const declaredChapters = Number(
            b.numberOfChapters ?? b.numberOfSections ?? b.chapterCount ?? 0,
          );
          skeletonBooks.push({
            id: bookId,
            // USFM-code name guard — `2PE` style labels become localized names.
            name: resolveBookDisplayName(
              bookId,
              typeof b.name === 'string' && b.name ? b.name : (b.commonName || usfm),
              booksPayload?.translation?.language || version.languageCode,
            ),
            helloaoBookId: usfm,
            totalChapters:
              Number.isFinite(declaredChapters) && declaredChapters > 0
                ? Math.floor(declaredChapters)
                : undefined,
            chapters: {},
          });
        }
      }
    }

    if (skeletonBooks.length === 0) {
      for (let i = 1; i <= maxBook; i++) {
        const usfm = getUsfmBookCode(i);
        skeletonBooks.push({
          id: i,
          name: resolveBookDisplayName(i, usfm, version.languageCode),
          helloaoBookId: usfm,
          totalChapters: getBookById(i)?.chaptersCount,
          chapters: {},
        });
      }
    }

    // Dead source + no helloao on-demand grid ⇒ nothing can ever be read:
    // blacklist the id so lists stop offering it and let the caller show the
    // download failure.
    const hasData = skeletonBooks.some((book) => Object.keys(book.chapters).length > 0);
    if (!skeletonTranslationId && !hasData) {
      if (sawHttpResponse) {
        void markVersionFailed(version.id);
      }
      throw new Error(
        `Could not download “${version.name}” — every mirror for this translation is unreachable.`,
      );
    }

    localFile = {
      versionId: version.id,
      versionName: booksPayload?.translation?.englishName || version.name || version.englishName,
      language: booksPayload?.translation?.languageName || version.languageName,
      languageCode: booksPayload?.translation?.language || version.languageCode,
      books: skeletonBooks,
    };
  }

  const finalPath = bibleFilePath(version.id);
  await FileSystem.writeAsStringAsync(finalPath, JSON.stringify(localFile), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // Warm the parsed-Bible memory cache and register in device registry
  parsedBiblesCache.set(normalizeVersionId(version.id), localFile);
  // A successful install un-blacklists the id (it may only have failed once —
  // e.g. a transient mirror glitch recorded by a probe).
  void clearFailedVersion(version.id);
  // Invalidate derived caches: a re-download can change ids/names/chapters,
  // and a missing version cached `[]` before this install.
  customBookNamesCache.delete(normalizeVersionId(version.id));
  versionBooksByIdCache.delete(normalizeVersionId(version.id));
  versionManifestCache.delete(normalizeVersionId(version.id));
  // Warm the book/chapter coverage cache so pickers resolve availability.
  void getVersionCoverage(version.id);
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
}

/**
 * Fetch one helloao chapter and cache its payload under `bibles/` so the same
 * chapter reads offline afterwards.
 */
export async function downloadHelloaoChapter(
  translationId: string,
  bookId: number,
  chapter: number,
  saveAsVersionId?: string,
): Promise<ChapterVerse[]> {
  const usfm = usfmForBookId(bookId);
  if (!usfm) {
    throw new Error(`Book ${bookId} has no helloao chapter API.`);
  }

  // Try standard helloao endpoints: .json, then .simple.json
  const candidateUrls = [
    `https://bible.helloao.org/api/${translationId}/${usfm}/${chapter}.json`,
    `https://bible.helloao.org/api/${translationId}/${usfm}/${chapter}.simple.json`,
  ];

  let lastError: Error | null = null;
  for (const url of candidateUrls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const payload = (await response.json()) as any;
      const content =
        payload?.chapter?.content ?? payload?.content ??
        payload?.chapter?.verses ?? payload?.verses;
      const verses = extractHelloaoVerses(content);
      if (verses.length > 0) {
        await ensureBiblesDirectory();
        const vId = saveAsVersionId || translationId;
        const cached: CachedChapterFile = { versionId: vId, bookId, chapter, verses };
        await FileSystem.writeAsStringAsync(
          chapterCachePath(vId, bookId, chapter),
          JSON.stringify(cached),
          { encoding: FileSystem.EncodingType.UTF8 },
        );
        return verses;
      }
    } catch (e: any) {
      lastError = e;
    }
  }

  throw lastError ?? new Error(`No verses found for helloao ${translationId}/${bookId}/${chapter}.`);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * True when a canonical book (1..66) is available in the given version.
 * Warmed coverage (see `getAvailableBooksForVersion`) answers exactly for
 * partial versions (NT-only, single-book, ...); cold ids fall back to the
 * OT-only heuristic for Hebrew/Masoretic versions.
 */
export function isBookAvailableInVersion(versionId: string, bookId: number): boolean {
  if (!(bookId >= 1 && bookId <= 66)) return false;
  const normalizedId = normalizeVersionId(versionId);
  if (isBundledVersionId(normalizedId)) return true;
  const coverage = versionCoverageCache.get(normalizedId);
  if (coverage) return coverage.bookIds.includes(bookId);
  const lower = normalizedId.toLowerCase();
  if (lower.includes('mas') || lower.includes('heb')) {
    return bookId <= 39;
  }
  return true;
}

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

/** Result of `loadChapterVerses` — includes redirect bookkeeping for the caller. */
export interface ChapterLoadResult {
  verses: ChapterVerse[];
  /** Book actually served (canonical 1..66 id) — equals the request when valid. */
  actualBookId: number;
  /** Chapter actually served — equals the request when valid. */
  actualChapter: number;
  /** Normalized id of the version actually served (FIX 3 request tracing). */
  versionId: string;
}

/**
 * FIX 3 — in-memory chapter cache keyed strictly by
 * `${versionId}::${bookId}::${chapter}`. A version switch can never meet a
 * stale chapter from another version because no key omits `versionId` and
 * nothing is shared across versions.
 */
const chapterMemoryCache = new Map<string, ChapterVerse[]>();

function chapterMemoryKey(versionId: string, bookId: number, chapter: number): string {
  return `${versionId}::${bookId}::${chapter}`;
}

/**
 * Read verses for one book/chapter: local file -> standalone chapter cache ->
 * helloao on-demand fetch (result cached to disk for offline re-reads).
 */
async function fetchChapterVerses(
  normalizedId: string,
  localFile: LocalBibleFile | null,
  rawTranslationId: string,
  bookId: number,
  chapter: number,
): Promise<ChapterVerse[] | null> {
  if (localFile) {
    const found = versesIn(localFile, bookId, chapter);
    if (found && found.verses.length > 0) {
      chapterMemoryCache.set(chapterMemoryKey(normalizedId, found.book.id, chapter), found.verses);
      return found.verses;
    }
  }
  // FIX 3 — versioned in-memory chapter cache: hits only when the SAME
  // version asked for the SAME book/chapter before.
  const memoryKey = chapterMemoryKey(normalizedId, bookId, chapter);
  const cachedVerses = chapterMemoryCache.get(memoryKey);
  if (cachedVerses && cachedVerses.length > 0) return cachedVerses;
  // Check the standalone chapter cache even when no file is parsed yet.
  const cachedChapter = await readJsonFile<CachedChapterFile>(
    chapterCachePath(normalizedId, bookId, chapter),
  );
  if (cachedChapter?.verses?.length) {
    chapterMemoryCache.set(memoryKey, cachedChapter.verses);
    return cachedChapter.verses;
  }
  try {
    const verses = await downloadHelloaoChapter(rawTranslationId, bookId, chapter, normalizedId);
    if (verses.length > 0) {
      chapterMemoryCache.set(memoryKey, verses);
      if (localFile) {
        const book = resolveBookRef(localFile, bookId);
        if (book) {
          book.chapters[String(chapter)] = verses;
        }
      }
      return verses;
    }
  } catch {
    // On-demand fetch failed — redirect/clamp handling below decides next.
  }
  return null;
}

/**
 * Resolve verses for `versionId`, 100% offline first:
 * bundled Tamil BSI (in-memory) -> local `bibles/<id>.json` -> cached helloao
 * chapter -> (only when the version is a known helloao translation) an online
 * helloao fetch, cached for next time. The bundled id never touches the
 * network.
 *
 * Partial versions never fail on a missing request: a book the version does
 * not carry redirects to the FIRST available book (e.g. 40 → Matthew on
 * NT-only translations) and an overcounted chapter clamps back to 1. The
 * returned `actualBookId` / `actualChapter` tell callers what was
 * actually served so the reader UI can re-sync its state.
 */
export async function loadChapterVerses(
  versionId: string,
  bookRef: number,
  chapter: number,
): Promise<ChapterLoadResult> {
  const normalizedId = normalizeVersionId(versionId);

  // FIX 3 — the versioned memory cache also serves the bundled BSI, so no
  // reader path can ever receive another version's cached verses.
  const bundledMemoryKey = chapterMemoryKey(normalizedId, bookRef, chapter);
  const bundledMemory = chapterMemoryCache.get(bundledMemoryKey);
  if (bundledMemory && bundledMemory.length > 0) {
    return { verses: bundledMemory, actualBookId: bookRef, actualChapter: chapter, versionId: normalizedId };
  }

  // The bundled Tamil BSI stays in memory after its first read, so chapter
  // switches need no JSON parsing or filesystem access.
  // NOTE (FIX 3): the bundled BSI is ONLY ever served when the request asks
  // for the bundled id itself — no other version may fall back to it.
  if (normalizedId === TAMIL_BSI_ID) {
    const chapterVerses = extractChapterVerses(getCachedTamilBsi(), bookRef, chapter);
    if (chapterVerses.length > 0) {
      chapterMemoryCache.set(bundledMemoryKey, chapterVerses);
      return { verses: chapterVerses, actualBookId: bookRef, actualChapter: chapter, versionId: normalizedId };
    }
    const bundled = versesIn(getBundledTamilBsi(), bookRef, chapter);
    if (bundled && bundled.verses.length > 0) {
      chapterMemoryCache.set(bundledMemoryKey, bundled.verses);
      return { verses: bundled.verses, actualBookId: bundled.book.id, actualChapter: chapter, versionId: normalizedId };
    }
    throw new Error('This chapter is not available in the selected Bible.');
  }

  const localFile = await readLocalBibleFile(normalizedId);
  const directBookId = localFile ? (resolveBookRef(localFile, bookRef)?.id ?? bookRef) : bookRef;
  const rawTranslationId =
    findDefaultVersion(normalizedId)?.helloaoTranslationId ||
    findDefaultVersion(versionId)?.helloaoTranslationId ||
    normalizedId;

  const direct = await fetchChapterVerses(
    normalizedId, localFile, rawTranslationId, directBookId, chapter,
  );
  if (direct) {
    return { verses: direct, actualBookId: directBookId, actualChapter: chapter, versionId: normalizedId };
  }

  // The requested book or chapter may not exist in a partial version (NT-only
  // translation, single-book download, ...). Redirect to the first available
  // book and clamp an overcounted chapter back to chapter 1.
  const coverage = await getVersionCoverage(normalizedId);
  let effectiveBookId = directBookId;
  let effectiveChapter = chapter;
  let redirected = false;

  if (
    !coverage.complete &&
    coverage.bookIds.length > 0 &&
    !coverage.bookIds.includes(directBookId)
  ) {
    effectiveBookId = Math.min(...coverage.bookIds);
    redirected = true;
  }

  const canonChapters = BIBLE_BOOKS.find((book) => book.id === effectiveBookId)?.chaptersCount ?? 0;
  const localMax = localFile ? maxChapterInLocalBook(findBook(localFile, effectiveBookId)) : 0;
  const effectiveMax = Math.max(
    coverage.chapterCounts[effectiveBookId] ?? 0,
    canonChapters,
    localMax,
  );
  if (
    effectiveMax > 0 &&
    !(Number.isInteger(effectiveChapter) && effectiveChapter >= 1 && effectiveChapter <= effectiveMax)
  ) {
    effectiveChapter = 1;
    redirected = true;
  }

  if (redirected) {
    const fallback = await fetchChapterVerses(
      normalizedId, localFile, rawTranslationId, effectiveBookId, effectiveChapter,
    );
    if (fallback) {
      const finalBookId = localFile
        ? (resolveBookRef(localFile, effectiveBookId)?.id ?? effectiveBookId)
        : effectiveBookId;
      return {
        verses: fallback,
        actualBookId: finalBookId,
        actualChapter: effectiveChapter,
        // `versionId` always stays the REQUESTED version — a redirect never
        // swaps a partial version for the bundled Tamil BSI.
        versionId: normalizedId,
      };
    }
  }

  throw new Error('This chapter is not available in the selected Bible.');
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

/** Chapter count a version carries for one canonical book (skeleton files fall back to the canon totals). */
export function getBookChapterCount(versionId: string, bookId: number): number {
  const normalizedId = normalizeVersionId(versionId);
  if (!isBookAvailableInVersion(normalizedId, bookId)) return 0;
  const canonicalCount = BIBLE_BOOKS.find((book) => book.id === bookId)?.chaptersCount;
  if (!canonicalCount) return 0;

  if (isBundledVersionId(normalizedId)) {
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

  // Partial helloao versions list only chapters that exist in the catalog.
  const coverage = versionCoverageCache.get(normalizedId);
  const knownCount = coverage?.chapterCounts[bookId] ?? 0;
  if (knownCount > 0 && knownCount < canonicalCount) return knownCount;
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
  const stem = safeFileStem(normalizedId);
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
  customBookNamesCache.delete(normalizedId);
  versionBooksByIdCache.delete(normalizedId);
  versionCoverageCache.delete(normalizedId);
  versionManifestCache.delete(normalizedId);
  for (const key of [...chapterMemoryCache.keys()]) {
    if (key.startsWith(`${normalizedId}::`)) chapterMemoryCache.delete(key);
  }
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
        // Exists-only gate: any real file on disk counts as installed (no size
        // threshold) so partial/testament downloads are never hidden.
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
