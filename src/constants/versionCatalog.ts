/**
 * Catalog of downloadable full-Bible JSON versions + a live search helper
 * against the free `bible.helloao.org` translation mirror.
 *
 * Versions come from two sources:
 * - `helloao`: full payload at HELLOAO_API_BASE/<id>/complete.simple.json
 *   (verified against https://bible.helloao.org/api/available_translations.json)
 * - `json`: any direct full-Bible JSON file with a stable public URL
 * - `bundled`: shipped inside the app bundle (no download needed)
 */

import * as FileSystem from 'expo-file-system/legacy';

export const HELLOAO_API_BASE = 'https://bible.helloao.org/api';

export const AVAILABLE_TRANSLATIONS_URL = `${HELLOAO_API_BASE}/available_translations.json`;

/**
 * Free whole-Bible JSON mirrors used as multi-source download fallbacks
 * (verified 2026-11-05):
 * - `thiagobodruk` — 66-book canonical-order volumes `{abbrev, chapters: [[text...]]}`
 * - `getbible` — `{translation, books: [{nr, name, chapters: [{chapter, verses: [{verse, text}]}]}]}`
 * - `godlytalias` — `{Book: [{BookName, Chapter: [[{Verse: "..."}]]}]}` (Indian languages)
 */
export const THIAGOBODRUK_JSON_BASE =
  'https://raw.githubusercontent.com/thiagobodruk/bible/master/json';
export const GETBIBLE_API_BASE = 'https://api.getbible.net/v2';
export const GODLYTALIAS_BASE =
  'https://raw.githubusercontent.com/godlytalias/Bible-Database/master';

/** Whole-Bible Tamil JSON mirror used to materialize the first-launch copy. */
export const TAMIL_BSI_DOWNLOAD_URL =
  'https://raw.githubusercontent.com/godlytalias/Bible-Database/master/Tamil/bible.json';

/** The bundled Tamil BSI sample Bible (Genesis 1, John 1 & 3 ships in the app). */
export const BUNDLED_VERSION_ID = 'tamil_bsi';

/**
 * TTL for the cached available-translations list; the catalog is large and
 * changes rarely, so one refresh per day is plenty.
 */
const TRANSLATIONS_CACHE_KEY = 'bible.helloaoTranslationsCache.v1';
const TRANSLATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type VersionSource = 'bundled' | 'helloao' | 'json';

export interface DownloadableVersion {
  /** Stable version id; also the local file name inside `bibles/`. */
  id: string;
  /** Display name as known in its language (falls back to `englishName`). */
  name: string;
  shortName: string;
  englishName: string;
  /** Human language name, e.g. "Tamil", "English", "Hindi". */
  languageName: string;
  /** ISO-ish language code as used by helloao (`tam`, `eng`, `hin`...). */
  languageCode: string;
  source: VersionSource;
  /** Direct JSON URL for `json` source versions. */
  downloadUrl?: string;
  licenseName?: string;
  /** Only present for online search results, when the version id exists in the helloao mirror. */
  helloaoTranslationId?: string;
}

/** Raw helloao available_translations entry (subset we consume). */
export interface HelloaoTranslationInfo {
  id: string;
  name: string;
  shortName: string;
  englishName: string;
  language: string;
  languageName?: string;
  languageEnglishName?: string;
}

function helloaoVersion(info: HelloaoTranslationInfo): DownloadableVersion {
  return {
    id: info.id,
    name: info.name || info.englishName || info.shortName,
    shortName: info.shortName || info.id,
    englishName: info.englishName || info.name || info.shortName,
    languageName: info.languageName || info.languageEnglishName || info.language,
    languageCode: info.language,
    source: 'helloao',
    helloaoTranslationId: info.id,
  };
}

/**
 * Curated default catalog verified against the live helloao API
 * (translation ids checked on 2026-11-02).
 */
export const DEFAULT_VERSIONS: DownloadableVersion[] = [
  {
    id: BUNDLED_VERSION_ID,
    name: 'பரிசுத்த வேதாகமம் (Tamil BSI)',
    shortName: 'தமிழ் BSI',
    englishName: 'Tamil BSI O.V.',
    languageName: 'Tamil',
    languageCode: 'tam',
    source: 'bundled',
  },
  {
    id: 'tam_irv',
    name: 'இண்டியன் ரிவைஸ்டு வெர்ஸன் (IRV) - தமிழ்',
    shortName: 'Tamil IRV',
    englishName: 'Tamil Indian Revised Version Bible',
    languageName: 'Tamil',
    languageCode: 'tam',
    source: 'helloao',
    helloaoTranslationId: 'tam_irv',
  },
  {
    id: 'eng_kjv',
    name: 'King James Version',
    shortName: 'KJV',
    englishName: 'King James Version',
    languageName: 'English',
    languageCode: 'eng',
    source: 'helloao',
    helloaoTranslationId: 'eng_kjv',
  },
  {
    id: 'ENGWEBP',
    name: 'World English Bible',
    shortName: 'WEB',
    englishName: 'World English Bible',
    languageName: 'English',
    languageCode: 'eng',
    source: 'helloao',
    helloaoTranslationId: 'ENGWEBP',
  },
  {
    id: 'eng_bbe',
    name: 'Bible in Basic English',
    shortName: 'BBE',
    englishName: 'Bible in Basic English',
    languageName: 'English',
    languageCode: 'eng',
    source: 'helloao',
    helloaoTranslationId: 'eng_bbe',
  },
  {
    id: 'eng_asv',
    name: 'American Standard Version',
    shortName: 'ASV',
    englishName: 'American Standard Version',
    languageName: 'English',
    languageCode: 'eng',
    source: 'helloao',
    helloaoTranslationId: 'eng_asv',
  },
  {
    id: 'eng_bsb',
    name: 'Berean Study Bible',
    shortName: 'BSB',
    englishName: 'Berean Study Bible',
    languageName: 'English',
    languageCode: 'eng',
    source: 'json',
    downloadUrl: `${THIAGOBODRUK_JSON_BASE}/en_bsb.json`,
  },
  {
    id: 'HINIRV',
    name: 'Hindi IRV Bible',
    shortName: 'Hindi IRV',
    englishName: 'Hindi Indian Revised Version Bible',
    languageName: 'Hindi',
    languageCode: 'hin',
    source: 'helloao',
    helloaoTranslationId: 'HINIRV',
  },
  {
    id: 'mal_irv',
    name: 'Malayalam IRV Bible',
    shortName: 'Malayalam IRV',
    englishName: 'Malayalam Indian Revised Version Bible',
    languageName: 'Malayalam',
    languageCode: 'mal',
    source: 'helloao',
    helloaoTranslationId: 'mal_irv',
  },
  {
    id: 'tel_irv',
    name: 'Telugu IRV Bible',
    shortName: 'Telugu IRV',
    englishName: 'Telugu Indian Revised Version Bible',
    languageName: 'Telugu',
    languageCode: 'tel',
    source: 'helloao',
    helloaoTranslationId: 'tel_irv',
  },
  {
    id: 'kan_irv',
    name: 'Kannada IRV Bible',
    shortName: 'Kannada IRV',
    englishName: 'Kannada Indian Revised Version Bible',
    languageName: 'Kannada',
    languageCode: 'kan',
    source: 'helloao',
    helloaoTranslationId: 'kan_irv',
  },
  {
    id: 'spa_pdt',
    name: 'Palabra de Dios para Todos',
    shortName: 'PDT',
    englishName: 'Spanish Holy Bible: PDT',
    languageName: 'Spanish',
    languageCode: 'spa',
    source: 'helloao',
    helloaoTranslationId: 'spa_pdt',
  },
  {
    /**
     * Reina-Valera has NO helloao mirror id (`spa_rvr` is dead — bible.helloao.org
     * returns 404 for it), so it downloads from the thiagobodruk full-Bible
     * JSON with a getbible.net fallback (see `FALLBACK_JSON_SOURCES`).
     */
    id: 'spa_rvr1960',
    name: 'Reina Valera 1960',
    shortName: 'RVR1960',
    englishName: 'Reina Valera 1960',
    languageName: 'Spanish',
    languageCode: 'spa',
    source: 'json',
    downloadUrl: `${THIAGOBODRUK_JSON_BASE}/es_rvr1960.json`,
  },
  {
    id: 'spa_rvg',
    name: 'Reina Valera Godoy',
    shortName: 'RVG',
    englishName: 'Reina Valera Godoy Bible',
    languageName: 'Spanish',
    languageCode: 'spa',
    source: 'helloao',
    helloaoTranslationId: 'spa_rvg',
  },
  {
    /** Masoretic Hebrew via the Westminster Leningrad Codex (verified helloao id). */
    id: 'heb_wlc',
    name: 'תנ״ך Masoretic Hebrew (WLC)',
    shortName: 'WLC',
    englishName: 'Hebrew Westminster Leningrad Codex',
    languageName: 'Hebrew',
    languageCode: 'heb',
    source: 'helloao',
    helloaoTranslationId: 'heb_wlc',
  },
  {
    /** Aleppo Codex (unpointed Hebrew OT) via the verified getbible v2 mirror. */
    id: 'heb_aleppo',
    name: 'כתר ארם־צובה — Aleppo Codex',
    shortName: 'Aleppo',
    englishName: 'Hebrew Aleppo Codex (OT)',
    languageName: 'Hebrew',
    languageCode: 'heb',
    source: 'json',
    downloadUrl: `${GETBIBLE_API_BASE}/aleppo.json`,
  },
  {
    /** Modern Hebrew Bible via the verified getbible v2 mirror. */
    id: 'heb_modern',
    name: 'Modern Hebrew Bible',
    shortName: 'ModHeb',
    englishName: 'Modern Hebrew Bible',
    languageName: 'Hebrew',
    languageCode: 'heb',
    source: 'json',
    downloadUrl: `${GETBIBLE_API_BASE}/modernhebrew.json`,
  },
  {
    /** Greek New Testament: Textus Receptus (verified helloao id `grc_gtr`). */
    id: 'grc_gtr',
    name: 'Greek New Testament — Textus Receptus',
    shortName: 'GTR',
    englishName: 'Greek NT Textus Receptus',
    languageName: 'Greek',
    languageCode: 'grc',
    source: 'helloao',
    helloaoTranslationId: 'grc_gtr',
  },
];

/** Popular shortlist rendered before the (possibly huge) online catalog. */
export const POPULAR_BIBLE_VERSIONS = DEFAULT_VERSIONS;

// ---------------------------------------------------------------------------
// Language display labels
// ---------------------------------------------------------------------------

/** Native-script labels keyed by ISO-ish language code. */
const NATIVE_BY_LANGUAGE_CODE: Record<string, string> = {
  tam: 'தமிழ்',
  eng: 'English',
  hin: 'हिंदी',
  mal: 'മലയാളം',
  tel: 'తెలుగు',
  kan: 'ಕನ್ನಡ',
  ben: 'বাংলা',
  guj: 'ગુજરાતી',
  pan: 'ਪੰਜਾਬੀ',
  mar: 'मराठी',
  ory: 'ଓଡ଼ିଆ',
  urd: 'اردو',
  spa: 'Español',
  es: 'Español',
  heb: 'עברית',
  hbo: 'עברית',
};

/**
 * Human-ready language label, e.g. "Tamil (தமிழ்)" — falls back to the
 * language code or "Unknown". Used for language badges on cards and pills.
 */
export function languageDisplayLabel(languageName: string, languageCode?: string): string {
  const human = (languageName ?? '').trim();
  const code = (languageCode ?? '').trim().toLowerCase();
  if (!human) return code ? code.toUpperCase() : 'Unknown';
  const native = LANGUAGE_NATIVE_NAMES[human] ?? (code ? NATIVE_BY_LANGUAGE_CODE[code] : undefined);
  return native && native !== human ? `${human} (${native})` : human;
}

// ---------------------------------------------------------------------------
// Typo-tolerant fuzzy matching
// ---------------------------------------------------------------------------

/** Remove vowels + lowercase, so "Englsih" ~ "englsih" ~ "english" score alike. */
function stripVowels(text: string): string {
  return text.toLowerCase().replace(/[aeiou]/g, '');
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Levenshtein edit distance between two strings (iterative, two-row DP).
 * Small strings only — inputs here are query words and short labels.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** 1 - normalized edit distance; 1 = identical, 0 = totally different. */
function levenshteinSimilarity(query: string, target: string): number {
  const longer = Math.max(query.length, target.length);
  if (longer === 0) return 1;
  return clamp01(1 - levenshteinDistance(query, target) / longer);
}

/** Sørensen–Dice bigram overlap in [0, 1]. */
function bigramDice(query: string, target: string): number {
  if (query.length < 2 || target.length < 2) {
    return query[0] === target[0] ? 0.5 : 0;
  }
  const bigramsOf = (text: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
    return set;
  };
  const a = bigramsOf(query);
  const b = bigramsOf(target);
  let overlap = 0;
  for (const gram of a) {
    if (b.has(gram)) overlap += 1;
  }
  return clamp01((2 * overlap) / (a.size + b.size));
}

/** All characters of `query` appear in `target` in order ("subsequence"). */
function isSubsequence(query: string, target: string): boolean {
  let cursor = 0;
  for (const char of target) {
    if (char === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return cursor === query.length;
}

/**
 * Typo-tolerant relevance score between a user query and a target label.
 * Blends exact/prefix/substring hits, a vowel-stripped (phonetic-ish) match,
 * a Levenshtein similarity, a bigram Dice coefficient, and an in-order
 * subsequence bonus. Returns 0 when the label is unrelated to the query.
 *
 * Guaranteed to rank with every query in the spec's typo list:
 *   "taml", "tamli", "kjvv", "englsih", "malyalam", "telgu", "hind",
 *   "amplifed", "bsi" — and to return 0 info for real mismatches.
 */
export function fuzzyMatchScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (!q || !t) return 0;

  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 + t.length * 0.1;
  if (t.includes(q)) return 600;

  const qStripped = stripVowels(q);
  const tStripped = stripVowels(t);
  let score = 0;

  // Vowel-stripped fallthrough (phonetic skeleton match).
  if (qStripped.length > 0 && tStripped.includes(qStripped)) {
    score = Math.max(score, 500);
  } else if (qStripped.length > 1 && tStripped.startsWith(qStripped)) {
    score = Math.max(score, 450);
  }

  // Blended edit-distance + n-gram score.
  const similarity = 0.5 * levenshteinSimilarity(q, t) + 0.5 * bigramDice(q, t);
  if (similarity >= 0.72) {
    score = Math.max(score, 100 + similarity * 300);
  }

  // Vowel-stripped edit similarity for heavier typos ("malyalam"→"malayalam").
  const strippedSimilarity = 0.5 * levenshteinSimilarity(qStripped, tStripped)
    + 0.5 * bigramDice(qStripped, tStripped);
  if (strippedSimilarity >= 0.72) {
    score = Math.max(score, 80 + strippedSimilarity * 260);
  }

  // Subsequence bonus ("amplifed" keeps letters in order).
  if (score === 0 && isSubsequence(q, t) && q.length >= 3) {
    score = 110;
  }

  return Math.round(score);
}

/**
 * Native script labels for each language so headers display e.g.
 * "Tamil (தமிழ்)" and fuzzy queries ("tamil", "taml") match across scripts.
 */
export const LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  Tamil: 'தமிழ்',
  English: 'English',
  Malayalam: 'മലയാളം',
  Hindi: 'हिंदी',
  Telugu: 'తెలుగు',
  Kannada: 'ಕನ್ನಡ',
  Gujarati: 'ગુજરાતી',
  Punjabi: 'ਪੰਜਾਬੀ',
  Bengali: 'বাংলা',
  Marathi: 'मराठी',
  Odia: 'ଓଡ଼ିଆ',
  Urdu: 'اردو',
  Spanish: 'Español',
  Hebrew: 'עברית',
};

/**
 * All searchable text variants for one version, including the native-script
 * language label, so a language query ("tamil") matches even when the stored
 * field is "Language: Tamil" vs "தமிழ்".
 */
function searchableFields(version: DownloadableVersion): string[] {
  const native = LANGUAGE_NATIVE_NAMES[version.languageName] ?? '';
  return [
    version.id,
    version.name,
    version.shortName,
    version.englishName,
    version.languageName,
    version.languageCode,
    native,
  ];
}

/**
 * Typo-tolerant search across id, names, languages and native-script labels.
 * Every version gets its best field score; results above the relevance floor
 * come back sorted best-first, so misspelled queries like "taml", "kjvv" or
 * "malyalam" still return the optimal language + version matches.
 */
export function filterVersions(query: string, versions: DownloadableVersion[]): DownloadableVersion[] {
  const q = query.trim();
  if (!q) return versions;
  const scored: { version: DownloadableVersion; score: number }[] = [];
  for (const version of versions) {
    let best = 0;
    for (const field of searchableFields(version)) {
      const score = fuzzyMatchScore(q, field);
      if (score > best) best = score;
    }
    // Fuzzy results need a floor: anything under ~100 is noise, not a typo.
    if (best >= 100) scored.push({ version, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.version);
}

/** One language section of grouped results. */
export interface VersionLanguageGroup {
  /** Language name key, e.g. "Tamil". */
  language: string;
  /** Display header, e.g. "Tamil (தமிழ்)"; unknown languages render as-is. */
  label: string;
  versions: DownloadableVersion[];
}

const PRIORITIZED_LANGUAGES = ['Tamil', 'English', 'Malayalam', 'Hindi', 'Telugu', 'Kannada'];

/**
 * Group versions under human language section headers for both the
 * Downloaded list and Online Search results. Well-known Indian languages
 * come first in display order; the rest collect under "Other Languages".
 */
export function groupVersionsByLanguage(versions: DownloadableVersion[]): VersionLanguageGroup[] {
  const byLanguage = new Map<string, DownloadableVersion[]>();
  for (const version of versions) {
    const key = version.languageName?.trim() || 'Other Languages';
    const bucket = byLanguage.get(key);
    if (bucket) bucket.push(version);
    else byLanguage.set(key, [version]);
  }

  const groups: VersionLanguageGroup[] = [];
  const pushGroup = (language: string) => {
    const bucket = byLanguage.get(language);
    if (!bucket || bucket.length === 0) return;
    const native = LANGUAGE_NATIVE_NAMES[language];
    groups.push({
      language,
      label: native && native !== language ? `${language} (${native})` : language,
      versions: bucket,
    });
    byLanguage.delete(language);
  };

  for (const language of PRIORITIZED_LANGUAGES) pushGroup(language);
  for (const [language] of [...byLanguage.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    pushGroup(language);
  }
  pushGroup('Other Languages');
  return groups;
}


let helloaoCache: { at: number; versions: DownloadableVersion[] } | null = null;
let helloaoInFlight: Promise<DownloadableVersion[]> | null = null;

// ---------------------------------------------------------------------------
// Online catalog cache (memory + `<cacheDirectory>/helloao_catalog_cache.json`)
// ---------------------------------------------------------------------------

let onlineCatalogMemory: DownloadableVersion[] | null = null;

/** Extract the DownloadableVersion list out of an available_translations payload. */
function parseHelloaoTranslations(payload: unknown): DownloadableVersion[] {
  const list = payload && typeof payload === 'object' && 'translations' in payload
    ? (payload as { translations?: unknown }).translations
    : payload;
  if (!Array.isArray(list)) {
    throw new Error('helloao available_translations.json had an unexpected shape');
  }
  return (list as HelloaoTranslationInfo[])
    .filter((info) => info && typeof info.id === 'string')
    .map(helloaoVersion);
}

/** Path of the on-disk catalog cache OUTSIDE the `bibles/` folder, so the
 * version-listing code never mistakes it for a downloaded Bible. */
async function catalogCachePath(): Promise<string> {
  // cacheDirectory needs no manual creation and is wiped by the OS.
  return `${FileSystem.cacheDirectory ?? ''}helloao_catalog_cache.json`;
}

/** Remove the legacy in-`bibles/` cache file that older builds wrote. */
export async function cleanupLegacyCatalogCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(
      `${FileSystem.documentDirectory ?? ''}bibles/_catalog_cache.json`,
      { idempotent: true },
    );
  } catch {
    // Never block search on a cache-file cleanup.
  }
}

/** In-memory -> `<cacheDirectory>/helloao_catalog_cache.json` read (instant when warm). */
export async function loadCachedOnlineCatalog(): Promise<DownloadableVersion[]> {
  void cleanupLegacyCatalogCache();
  if (onlineCatalogMemory) return onlineCatalogMemory;
  try {
    const path = await catalogCachePath();
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return [];
    } catch {
      return [];
    }
    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const versions = (parsed as DownloadableVersion[]).filter(
      (version) => version && typeof version.id === 'string' && typeof version.name === 'string',
    );
    onlineCatalogMemory = versions;
    return versions;
  } catch {
    return [];
  }
}

/**
 * Fetch the helloao available-translations list once and persist it to
 * `helloao_catalog_cache.json` + memory. Concurrent callers share one fetch.
 */
export async function refreshOnlineCatalog(): Promise<DownloadableVersion[]> {
  if (!helloaoInFlight) {
    helloaoInFlight = (async () => {
      const response = await fetch(AVAILABLE_TRANSLATIONS_URL);
      if (!response.ok) {
        throw new Error(`helloao returned ${response.status} for available translations`);
      }
      const payload = (await response.json()) as unknown;
      const versions = parseHelloaoTranslations(payload);
      try {
        await FileSystem.writeAsStringAsync(
          await catalogCachePath(),
          JSON.stringify(versions),
          { encoding: FileSystem.EncodingType.UTF8 },
        );
      } catch {
        // Cache write failures must never break searching.
      }
      return versions;
    })().catch((error: unknown) => {
      helloaoInFlight = null;
      throw error;
    });
    helloaoInFlight.then(
      (versions) => {
        onlineCatalogMemory = versions;
      },
      () => undefined,
    );
  }
  return helloaoInFlight;
}

/**
 * The merged searchable catalog: `[...POPULAR_BIBLE_VERSIONS, ...online]`.
 * When the cached catalog file exists the call returns instantly (typing in
 * search fields filters synchronously against this list); otherwise the
 * catalog is fetched once, cached to disk, and returned. A background
 * refresh keeps the on-disk copy current for the next launch.
 */
export async function getMergedCatalogVersions(): Promise<DownloadableVersion[]> {
  const cached = await loadCachedOnlineCatalog();
  let online = cached;
  if (cached.length > 0) {
    // Refresh once in the background; callers keep filtering the warm copy.
    void refreshOnlineCatalog().catch(() => undefined);
  } else {
    try {
      online = await refreshOnlineCatalog();
    } catch {
      online = [];
    }
  }
  const merged = new Map<string, DownloadableVersion>();
  for (const version of POPULAR_BIBLE_VERSIONS) merged.set(version.id, version);
  for (const version of online) {
    if (!merged.has(version.id)) merged.set(version.id, version);
  }
  // Pre-filter: dead/failed ids and endpoint-less entries never render.
  return filterKnownFailedVersions([...merged.values()]);
}

/** AsyncStorage read/write helpers — isolated so tests can stub them. */
async function loadHelloaoCache(): Promise<{ at: number; versions: DownloadableVersion[] } | null> {
  if (helloaoCache) return helloaoCache;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(TRANSLATIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; versions?: unknown };
    if (typeof parsed.at !== 'number' || !Array.isArray(parsed.versions)) return null;
    helloaoCache = { at: parsed.at, versions: parsed.versions as DownloadableVersion[] };
    return helloaoCache;
  } catch {
    return null;
  }
}

async function saveHelloaoCache(versions: DownloadableVersion[]): Promise<void> {
  helloaoCache = { at: Date.now(), versions };
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(TRANSLATIONS_CACHE_KEY, JSON.stringify(helloaoCache));
  } catch {
    // Storage failures should never break searching.
  }
}

/**
 * Live search over the helloao mirror: users can query by any language
 * ("Tamil", "Hindi", "Kannada"...) or version name ("KJV", "BSI"...).
 *
 * Order of operations: warm stale cache renders immediately, the live list
 * refreshes, then the filter runs over the freshest set.
 */
export async function searchOnlineTranslations(query: string): Promise<DownloadableVersion[]> {
  const cached = await loadHelloaoCache();
  if (cached && Date.now() - cached.at < TRANSLATIONS_CACHE_TTL_MS) {
    const usable = await filterKnownFailedVersions(cached.versions);
    return filterVersions(query, usable);
  }

  let versions: DownloadableVersion[];
  try {
    // Shared one-flight fetcher — also refreshes the cached catalog file.
    versions = await refreshOnlineCatalog();
    await saveHelloaoCache(versions);
    versions = await filterKnownFailedVersions(versions);
  } catch {
    if (cached) {
      const usable = await filterKnownFailedVersions(cached.versions);
      return filterVersions(query, usable);
    }
    throw new Error('Online translation search failed. Check your internet connection.');
  }
  return filterVersions(query, versions);
}

/** Look one known version up in the curated default catalog. */
export function findDefaultVersion(id: string): DownloadableVersion | undefined {
  const normalized = id.toLowerCase().replace(/[\s_.-]+/g, '');
  return DEFAULT_VERSIONS.find((version) => {
    const versionId = version.id.toLowerCase().replace(/[\s_.-]+/g, '');
    return versionId === normalized || (version.id === BUNDLED_VERSION_ID && normalized === 'bsi');
  });
}

// ---------------------------------------------------------------------------
// Multi-source download fallback endpoints
// ---------------------------------------------------------------------------

/**
 * Alternate whole-Bible JSON mirrors per version id (and its legacy ids), so a
 * redirected dead helloao translation can still be materialized: the
 * downloader walks helloao `complete.simple.json` first, then every fallback
 * URL, then the on-demand skeleton. All shapes are parsed by
 * `normalizeAnyBiblePayload` (getbible / thiagobodruk / godlytalias).
 */
export const FALLBACK_JSON_SOURCES: Readonly<Record<string, readonly string[]>> = {
  // English — KJV / WEB / BSB / ASV / BBE
  eng_kjv: [
    `${GETBIBLE_API_BASE}/kjv.json`,
    `${THIAGOBODRUK_JSON_BASE}/en_kjv.json`,
    `${GODLYTALIAS_BASE}/English/bible.json`,
  ],
  eng_asv: [`${GETBIBLE_API_BASE}/asv.json`, `${THIAGOBODRUK_JSON_BASE}/en_asv.json`],
  ENGWEBP: [`${GETBIBLE_API_BASE}/web.json`, `${THIAGOBODRUK_JSON_BASE}/en_web.json`],
  eng_web: [`${GETBIBLE_API_BASE}/web.json`, `${THIAGOBODRUK_JSON_BASE}/en_web.json`],
  eng_bbe: [`${GETBIBLE_API_BASE}/basicenglish.json`, `${THIAGOBODRUK_JSON_BASE}/en_bbe.json`],
  eng_bsb: [`${THIAGOBODRUK_JSON_BASE}/en_bsb.json`],
  // Spanish RVR
  spa_rvr1960: [`${GETBIBLE_API_BASE}/valera.json`],
  spa_rvr: [`${GETBIBLE_API_BASE}/valera.json`, `${THIAGOBODRUK_JSON_BASE}/es_rvr1960.json`],
  // Hebrew WLC / Greek Textus Receptus
  heb_wlc: [
    `${THIAGOBODRUK_JSON_BASE}/he_wlc.json`,
    `${GETBIBLE_API_BASE}/codex.json`,
    `${GETBIBLE_API_BASE}/aleppo.json`,
    `${GETBIBLE_API_BASE}/modernhebrew.json`,
  ],
  heb_mas: [`${THIAGOBODRUK_JSON_BASE}/he_wlc.json`, `${GETBIBLE_API_BASE}/codex.json`],
  // Additional verified Hebrew codices (GetBible v2, both RTL Hebrew)
  heb_aleppo: [`${GETBIBLE_API_BASE}/aleppo.json`, `${GETBIBLE_API_BASE}/codex.json`],
  heb_modern: [`${GETBIBLE_API_BASE}/modernhebrew.json`, `${GETBIBLE_API_BASE}/codex.json`],
  grc_gtr: [`${THIAGOBODRUK_JSON_BASE}/grc_grctr.json`],
  // Indian IRV languages reinstallable from the godlytalias mirror
  tam_irv: [`${GODLYTALIAS_BASE}/Tamil/bible.json`],
  HINIRV: [`${GODLYTALIAS_BASE}/Hindi/bible.json`],
  hin_irv: [`${GODLYTALIAS_BASE}/Hindi/bible.json`],
  mal_irv: [`${GODLYTALIAS_BASE}/Malayalam/bible.json`],
  tel_irv: [`${GODLYTALIAS_BASE}/Telugu/bible.json`],
  kan_irv: [`${GODLYTALIAS_BASE}/Kannada/bible.json`],
  ben_irv: [`${GODLYTALIAS_BASE}/Bengali/bible.json`],
  guj_irv: [`${GODLYTALIAS_BASE}/Gujarati/bible.json`],
  mar_irv: [`${GODLYTALIAS_BASE}/Marathi/bible.json`],
  ory_irv: [`${GODLYTALIAS_BASE}/Oriya/bible.json`],
  pan_irv: [`${GODLYTALIAS_BASE}/Punjabi/bible.json`],
};

/**
 * Fallback whole-Bible JSON URLs for a version id, helloao translation id and
 * legacy id spellings, ordered most-canonical first.
 */
export function fallbackJsonEndpoints(
  versionId: string,
  helloaoTranslationId?: string,
): string[] {
  const ids = [versionId, helloaoTranslationId ?? ''];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const id of ids) {
    for (const url of FALLBACK_JSON_SOURCES[id] ?? []) {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

/**
 * Quick structural gate for catalog rendering: a downloadable entry must
 * carry at least one usable endpoint (helloao translation id or direct JSON
 * URL); the bundled seed always passes.
 */
export function hasUsableDownloadEndpoint(version: DownloadableVersion): boolean {
  if (version.source === 'bundled') return true;
  if (version.source === 'json') return Boolean(version.downloadUrl);
  return Boolean(version.helloaoTranslationId);
}

// ---------------------------------------------------------------------------
// Failed versions (`@selah_invalid_versions`) + health probes
// ---------------------------------------------------------------------------

/**
 * Persisted set of translation ids that were verified (or attempted) and are
 * dead — dead helloao ids (`spa_rvr` returned 404), endpoint-less catalogs and
 * downloads that produced zero books. Victims are removed from every version
 * list the app renders.
 */
export const FAILED_VERSIONS_STORAGE_KEY = '@selah_invalid_versions';

let failedVersionIdsMem: Set<string> | null = null;
let failedVersionIdsLoad: Promise<Set<string>> | null = null;

/** Load the persisted failure set (memory-cached, tolerates corrupt data). */
export async function loadFailedVersionIds(): Promise<Set<string>> {
  if (failedVersionIdsMem) return failedVersionIdsMem;
  if (!failedVersionIdsLoad) {
    failedVersionIdsLoad = (async () => {
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const raw = await AsyncStorage.getItem(FAILED_VERSIONS_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        failedVersionIdsMem = Array.isArray(parsed)
          ? new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))
          : new Set<string>();
        return failedVersionIdsMem;
      } catch {
        failedVersionIdsMem = new Set<string>();
        return failedVersionIdsMem;
      }
    })().catch(() => {
      failedVersionIdsMem = new Set<string>();
      return failedVersionIdsMem;
    }).finally(() => {
      failedVersionIdsLoad = null;
    });
  }
  const resolved = await failedVersionIdsLoad;
  return resolved ?? failedVersionIdsMem ?? new Set<string>();
}

function addFailedVersionId(id: string): void {
  const set = failedVersionIdsMem ?? new Set<string>();
  set.add(id);
  failedVersionIdsMem = set;
}

/** Remember a dead translation id so lists stop offering it. */
export async function markVersionFailed(versionId: string): Promise<void> {
  if (!versionId?.trim() || versionId === BUNDLED_VERSION_ID) return;
  addFailedVersionId(versionId);
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(
      FAILED_VERSIONS_STORAGE_KEY,
      JSON.stringify([...(failedVersionIdsMem ?? new Set<string>())]),
    );
  } catch {
    // Persistence failures must never break the render path.
  }
}

/** Un-blacklist a version id (used when an install later succeeds). */
export async function clearFailedVersion(versionId: string): Promise<void> {
  const set = failedVersionIdsMem ?? (await loadFailedVersionIds());
  if (!set.delete(versionId)) return;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(FAILED_VERSIONS_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Ignore.
  }
}

/** Drop entries whose id is persisted as failed, or which have no endpoint. */
export async function filterKnownFailedVersions(
  versions: DownloadableVersion[],
): Promise<DownloadableVersion[]> {
  const failed = await loadFailedVersionIds();
  return versions.filter(
    (version) =>
      version.source === 'bundled' ||
      (hasUsableDownloadEndpoint(version) && !failed.has(version.id)),
  );
}

// ---------------------------------------------------------------------------
// Health probe — `verifyVersionLoadable`
// ---------------------------------------------------------------------------

/** Probe verdict TTL: a healthy/dead answer is trusted for a day. */
const LOADABILITY_PROBE_TTL_MS = 24 * 60 * 60 * 1000;
/** Search screens render at most the first N probes per query refresh. */
export const MAX_LOADABILITY_PROBES = 24;
const probeConcurrency = 4;

const loadabilityProbeCache = new Map<string, { ok: boolean; definitive: boolean; at: number }>();

/**
 * Health probe for one downloadable version: helloao ids read
 * `books.json` and demand `numberOfBooks > 0`; JSON mirrors answer a HEAD
 * request. Diagnostic 404/410s persist the id into `@selah_invalid_versions`
 * so the UI auto-drops it; transient network errors never blacklist.
 */
export async function verifyVersionLoadable(version: DownloadableVersion): Promise<boolean> {
  if (version.source === 'bundled') return true;
  const id = version.id;
  const cached = loadabilityProbeCache.get(id);
  if (cached && Date.now() - cached.at < LOADABILITY_PROBE_TTL_MS) return cached.ok;

  const failed = await loadFailedVersionIds();
  if (failed.has(id)) {
    loadabilityProbeCache.set(id, { ok: false, definitive: true, at: Date.now() });
    return false;
  }

  let ok = false;
  let definitive = false;
  try {
    if (version.source === 'json' && version.downloadUrl) {
      const response = await fetch(version.downloadUrl, { method: 'HEAD' });
      if (response.ok) {
        ok = true;
      } else if (response.status === 404 || response.status === 410) {
        definitive = true;
      }
    } else {
      const rawId = version.helloaoTranslationId || version.id;
      const response = await fetch(`${HELLOAO_API_BASE}/${rawId}/books.json`);
      if (response.ok) {
        const payload = (await response.json()) as {
          numberOfBooks?: unknown;
          books?: unknown[];
        };
        const count = typeof payload.numberOfBooks === 'number'
          ? payload.numberOfBooks
          : Array.isArray(payload.books)
            ? payload.books.length
            : 0;
        ok = count > 0;
      } else if (response.status === 404 || response.status === 410) {
        definitive = true;
      }
    }
  } catch {
    // Network error → not available right now, never blacklist.
  }

  loadabilityProbeCache.set(id, { ok, definitive, at: Date.now() });
  if (!ok && definitive) await markVersionFailed(id);
  return ok;
}

/**
 * Health-probe a render-ready version list, preserving order, keeping at most
 * `maxProbes` (default 24) network checks and dropping probing-confirmed
 * dead ids. Entries beyond the probe cap pass through unverified so long
 * result batches never stall the screen.
 */
export async function dropFailingVersions(
  versions: DownloadableVersion[],
  maxProbes: number = MAX_LOADABILITY_PROBES,
): Promise<DownloadableVersion[]> {
  if (versions.length === 0) return versions;
  const targets = versions.slice(0, Math.max(0, maxProbes));
  const verdicts: boolean[] = new Array(targets.length).fill(false);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      try {
        verdicts[index] = await verifyVersionLoadable(targets[index]);
      } catch {
        verdicts[index] = true; // probe errors keep the card renderable.
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(probeConcurrency, targets.length); index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return versions.filter((_, index) => index < maxProbes ? verdicts[index] : true);
}
