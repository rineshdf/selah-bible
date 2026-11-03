import * as SQLite from 'expo-sqlite';

/**
 * Shared SQLite module. The file name is fixed by the blueprint (claude.md):
 * `user_journal.db`. `openDatabaseSync` creates the file on first open, and
 * all helpers run synchronously via `runSync` / `getAllSync` / `getFirstSync`
 * (SDK 58 API — verified against the expo-sqlite docs).
 *
 * Call `initDatabase()` once from the root layout before using any helper;
 * it is idempotent and keyed on `PRAGMA user_version`.
 */
export const db = SQLite.openDatabaseSync('user_journal.db');

const DATABASE_VERSION = 5;

/** Version id under which installed progress rows were tracked before v4. */
export const DEFAULT_PROGRESS_VERSION = 'TAMIL_BSI';

// ---------------------------------------------------------------------------
// Row & input types
// ---------------------------------------------------------------------------

export interface HighlightRow {
  id: number;
  version_id: number;
  version_key: string | null;
  book_id: number;
  book_name: string;
  chapter: number;
  verse: number;
  verse_text: string;
  color_hex: string;
  /** Local day, 'YYYY-MM-DD'. */
  created_date: string;
}
export type HighlightInput = Omit<HighlightRow, 'id' | 'created_date' | 'version_key'> & {
  version_key?: string | null;
  created_date?: string;
};

export interface MessageRow {
  id: number;
  title: string;
  preacher: string | null;
  message_date: string | null;
  created_at: string;
}
export type MessageInput = Omit<MessageRow, 'id' | 'created_at'> & {
  created_at?: string;
};

export type MessageBlockType = 'heading' | 'point' | 'verse';

export interface MessageBlockRow {
  id: number;
  message_id: number;
  serial_no: number;
  block_type: MessageBlockType;
  content: string;
  verse_ref: string | null;
  verse_note: string | null;
  highlight_color: string | null;
}
export type MessageBlockInput = Omit<MessageBlockRow, 'id'>;

export interface DailyDevotionRow {
  /** Local day, 'YYYY-MM-DD' (primary key: one devotion per day). */
  entry_date: string;
  worship_prayer: string | null;
  god_spoke_word: string | null;
  /** Hex color the user picked in the "God spoke" section (e.g. #FDE68A). */
  god_spoke_color: string | null;
  understanding_today: string | null;
  updated_at: string;
}
export type DailyDevotionInput = Omit<DailyDevotionRow, 'updated_at'> & {
  updated_at?: string;
};

export interface PrayerPointRow {
  id: number;
  /** Local day, 'YYYY-MM-DD'. */
  entry_date: string;
  request_text: string;
  /** 0 = pending, 1 = answered. */
  is_answered: number;
  answered_date: string | null;
  /** Attached scripture promise reference (e.g. "John 3:16"), nullable for legacy rows. */
  verse_ref: string | null;
  /** Attached scripture promise text. */
  verse_text: string | null;
  /** User note on the attached verse. */
  verse_note: string | null;
  /** Version id the verse text was loaded from ('tamil_bsi', 'eng_kjv'...). */
  verse_version_id: string | null;
}
export type PrayerPointInput = Omit<
  PrayerPointRow,
  'id' | 'is_answered' | 'verse_ref' | 'verse_text' | 'verse_note' | 'verse_version_id'
> & {
  is_answered?: number;
  verse_ref?: string | null;
  verse_text?: string | null;
  verse_note?: string | null;
  verse_version_id?: string | null;
};

export type DailyEntrySection = 'rhema' | 'devotion' | 'worship';

export interface DailyEntryRow {
  id: number;
  /** Local day, 'YYYY-MM-DD'. */
  entry_date: string;
  section: DailyEntrySection;
  /** 1-based order inside (entry_date, section). */
  serial_no: number;
  content: string;
  /** Pastel hex chosen by the user (5-color palette), or null. */
  highlight_color: string | null;
  /** Supporting scripture reference attached to this point (nullable). */
  verse_ref: string | null;
  /** Supporting scripture text attached to this point (nullable). */
  verse_text: string | null;
  /** User note on the attached scripture (nullable). */
  verse_note: string | null;
  /** Version id the attached scripture came from (nullable). */
  verse_version_id: string | null;
  created_at: string;
}
export type DailyEntryInput = Omit<
  DailyEntryRow,
  'id' | 'serial_no' | 'created_at' | 'highlight_color' | 'verse_ref' | 'verse_text' | 'verse_note' | 'verse_version_id'
> & {
  serial_no?: number;
  highlight_color?: string | null;
  verse_ref?: string | null;
  verse_text?: string | null;
  verse_note?: string | null;
  verse_version_id?: string | null;
  created_at?: string;
};

export type DailyVerseSection = DailyEntrySection | 'prayer';

export interface DailyVerseRow {
  id: number;
  /** Local day, 'YYYY-MM-DD'. */
  entry_date: string;
  section: DailyVerseSection;
  /** Display reference, e.g. "John 3:16" or "யோவான் 3:16". */
  verse_ref: string;
  verse_text: string;
  /** Optional quick sub-note on the verse. */
  note: string | null;
  /** Version id the text came from ('tamil_bsi', 'eng_kjv'...). */
  version_id: string | null;
  /** Version short name for display (kept for offline rendering). */
  version_short_name: string | null;
  created_at: string;
}
export type DailyVerseInput = Omit<DailyVerseRow, 'id' | 'created_at'>;

export interface ReadingProgressRow {
  book_id: number;
  chapter: number;
  /** Local day the chapter was last marked read, 'YYYY-MM-DD'. */
  read_date: string;
}

/** State of read-verse tracking for one chapter. */
export interface ChapterReadState {
  /** True when every verse of the chapter is read (or the chapter was
   * marked read as a whole). */
  isChapterRead: boolean;
  /** 1-based verse numbers marked read, ascending. */
  readVerses: number[];
}

/** Per-book progress snapshot used by the Progress tab. */
export interface BookProgressSummary {
  /** Chapters fully read under this version, ascending. */
  readChapters: number[];
  /** Chapters with SOME but not all verses read -> read-verse count. */
  partialVerseCounts: Record<number, number>;
  /** Total verses recorded on each partially-read chapter's own row. */
  partialTotalVerseCounts: Record<number, number>;
}

/** Raw `reading_progress_v2` row including the v5 verse-tracking columns. */
interface ReadingProgressV2Row {
  version_id: string;
  book_id: number;
  chapter: number;
  read_date: string;
  read_verses: string | null;
  total_verses: number | null;
  is_read: number | null;
}

// ---------------------------------------------------------------------------
// Internal date helpers (device-local day / ISO timestamp)
// ---------------------------------------------------------------------------

function isoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoTimestamp(date = new Date()): string {
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL,
    version_key TEXT,
    book_id INTEGER NOT NULL,
    book_name TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    verse_text TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    created_date TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_highlights_version ON highlights (version_id);
  CREATE INDEX IF NOT EXISTS idx_highlights_passage ON highlights (book_id, chapter, verse);
  CREATE INDEX IF NOT EXISTS idx_highlights_created ON highlights (created_date);

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    preacher TEXT,
    message_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_date ON messages (message_date);

  CREATE TABLE IF NOT EXISTS message_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    serial_no INTEGER NOT NULL,
    block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'point', 'verse')),
    content TEXT NOT NULL,
    verse_ref TEXT,
    verse_note TEXT,
    highlight_color TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_message_blocks_message ON message_blocks (message_id, serial_no);

  CREATE TABLE IF NOT EXISTS daily_devotions (
    entry_date TEXT PRIMARY KEY,
    worship_prayer TEXT,
    god_spoke_word TEXT,
    god_spoke_color TEXT,
    understanding_today TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prayer_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    request_text TEXT NOT NULL,
    is_answered INTEGER NOT NULL DEFAULT 0,
    answered_date TEXT,
    verse_ref TEXT,
    verse_text TEXT,
    verse_note TEXT,
    verse_version_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_prayer_points_date ON prayer_points (entry_date);

  CREATE TABLE IF NOT EXISTS daily_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    section TEXT NOT NULL CHECK (section IN ('rhema', 'devotion', 'worship')),
    serial_no INTEGER NOT NULL,
    content TEXT NOT NULL,
    highlight_color TEXT,
    verse_ref TEXT,
    verse_text TEXT,
    verse_note TEXT,
    verse_version_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_daily_entries_date ON daily_entries (entry_date, section, serial_no);

  CREATE TABLE IF NOT EXISTS daily_verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    section TEXT NOT NULL CHECK (section IN ('rhema', 'devotion', 'worship', 'prayer')),
    verse_ref TEXT NOT NULL,
    verse_text TEXT NOT NULL,
    note TEXT,
    version_id TEXT,
    version_short_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_daily_verses_date ON daily_verses (entry_date, section);

  CREATE TABLE IF NOT EXISTS reading_progress (
    book_id INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    read_date TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter)
  );
  CREATE INDEX IF NOT EXISTS idx_reading_progress_date ON reading_progress (read_date);

  CREATE TABLE IF NOT EXISTS reading_progress_v2 (
    version_id TEXT NOT NULL DEFAULT 'TAMIL_BSI',
    book_id INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    read_date TEXT NOT NULL,
    read_verses TEXT,
    total_verses INTEGER,
    is_read INTEGER DEFAULT 0,
    PRIMARY KEY (version_id, book_id, chapter)
  );
  CREATE INDEX IF NOT EXISTS idx_reading_progress_v2_date ON reading_progress_v2 (read_date);
`;

/**
 * Create the tables and indexes when they do not exist yet, run safe
 * column migrations for older databases, and raise
 * `PRAGMA user_version` to DATABASE_VERSION. Idempotent: safe to call on
 * every cold start.
 */
export function initDatabase(): void {
  db.execSync('PRAGMA foreign_keys = ON;');
  db.runSync('PRAGMA journal_mode = WAL;');

  // CREATE TABLE IF NOT EXISTS is idempotent, so the schema always runs.
  db.execSync(SCHEMA);
  migrateColumns();
  migrateVerseReadColumns();
  migrateReadingProgressToVersioned();

  const versionRow = db.getFirstSync<{ user_version: number }>('PRAGMA user_version;');
  if (versionRow && versionRow.user_version >= DATABASE_VERSION) {
    return;
  }
  db.runSync(`PRAGMA user_version = ${DATABASE_VERSION};`);
}

/** Not-null legacy columns were added in v2 via ALTER TABLE (guard: PRAGMA). */
function migrateColumns(): void {
  ensureColumn('highlights', 'version_key', 'TEXT');
  ensureColumn('prayer_points', 'verse_ref', 'TEXT');
  ensureColumn('prayer_points', 'verse_text', 'TEXT');
  ensureColumn('prayer_points', 'verse_note', 'TEXT');
  ensureColumn('prayer_points', 'verse_version_id', 'TEXT');
  // Point-level scripture attachment for Rhema / Devotion / Worship entries.
  ensureColumn('daily_entries', 'verse_ref', 'TEXT');
  ensureColumn('daily_entries', 'verse_text', 'TEXT');
  ensureColumn('daily_entries', 'verse_note', 'TEXT');
  ensureColumn('daily_entries', 'verse_version_id', 'TEXT');
  // v5 verse-level read tracking on the versioned progress table.
  ensureColumn('reading_progress_v2', 'read_verses', 'TEXT');
  ensureColumn('reading_progress_v2', 'total_verses', 'INTEGER');
  ensureColumn('reading_progress_v2', 'is_read', 'INTEGER DEFAULT 0');
}

/**
 * Stamp the legacy full-chapter rows (written before verse-level tracking,
 * which stored no `read_verses` array) as completely read. Verse-level rows
 * always persist a JSON array (`[]` minimum), so NULL here unambiguously
 * means "chapter marked read as a whole".
 */
function migrateVerseReadColumns(): void {
  db.runSync(
    'UPDATE reading_progress_v2 SET is_read = 1 WHERE read_verses IS NULL AND is_read IS NULL;',
  );
}

/** ALTER TABLE ... ADD COLUMN when `column` is missing from `table`. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table});`);
  if (columns.some((info) => info.name === column)) return;
  db.runSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

/**
 * Preserve legacy per-chapter progress rows: copy every `reading_progress`
 * row into the versioned `reading_progress_v2` table under 'TAMIL_BSI' the
 * first time (only when the versioned table is still empty). The original
 * rows stay untouched.
 */
function migrateReadingProgressToVersioned(): void {
  const existing = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM reading_progress_v2;',
  );
  if (!existing || existing.n > 0) return;
  db.runSync(
    `INSERT OR IGNORE INTO reading_progress_v2 (version_id, book_id, chapter, read_date)
     SELECT '${DEFAULT_PROGRESS_VERSION}', book_id, chapter, read_date FROM reading_progress;`,
  );
}

// ---------------------------------------------------------------------------
// highlights
// ---------------------------------------------------------------------------

export function addHighlight(input: HighlightInput): number {
  const result = db.runSync(
    `INSERT INTO highlights (version_id, version_key, book_id, book_name, chapter, verse, verse_text, color_hex, created_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.version_id,
      input.version_key ?? null,
      input.book_id,
      input.book_name,
      input.chapter,
      input.verse,
      input.verse_text,
      input.color_hex,
      input.created_date ?? isoDate(),
    ],
  );
  return result.lastInsertRowId;
}

export function getHighlight(id: number): HighlightRow | null {
  return db.getFirstSync<HighlightRow>('SELECT * FROM highlights WHERE id = ?;', [id]);
}

/** Every highlight within one chapter (any translation), ordered for reading. */
export function getHighlightsForPassage(versionId: number, bookId: number, chapter: number): HighlightRow[] {
  return db.getAllSync<HighlightRow>(
    'SELECT * FROM highlights WHERE version_id = ? AND book_id = ? AND chapter = ? ORDER BY verse, id;',
    [versionId, bookId, chapter],
  );
}

/** Recent-first historyfeed of everything the user highlighted. */
export function getAllHighlights(): HighlightRow[] {
  return db.getAllSync<HighlightRow>(
    'SELECT * FROM highlights ORDER BY created_date DESC, id DESC;',
  );
}

export function updateHighlightColor(id: number, colorHex: string): void {
  db.runSync(
    'UPDATE highlights SET color_hex = ? WHERE id = ?;',
    [colorHex, id],
  );
}

export function deleteHighlight(id: number): void {
  db.runSync('DELETE FROM highlights WHERE id = ?;', [id]);
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

export function createMessage(input: MessageInput): number {
  const result = db.runSync(
    'INSERT INTO messages (title, preacher, message_date, created_at) VALUES (?, ?, ?, ?);',
    [
      input.title,
      input.preacher ?? null,
      input.message_date ?? null,
      input.created_at ?? isoTimestamp(),
    ],
  );
  return result.lastInsertRowId;
}

export function getMessage(id: number): MessageRow | null {
  return db.getFirstSync<MessageRow>('SELECT * FROM messages WHERE id = ?;', [id]);
}

/** Dated messages first (newest), undated ones after, both newest-first. */
export function getAllMessages(): MessageRow[] {
  return db.getAllSync<MessageRow>(
    'SELECT * FROM messages ORDER BY (message_date IS NULL), message_date DESC, id DESC;',
  );
}

export interface MessageUpdate {
  title?: string;
  preacher?: string | null;
  message_date?: string | null;
}

export function updateMessage(id: number, fields: MessageUpdate): void {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (fields.title !== undefined) {
    sets.push('title = ?');
    params.push(fields.title);
  }
  if (fields.preacher !== undefined) {
    sets.push('preacher = ?');
    params.push(fields.preacher);
  }
  if (fields.message_date !== undefined) {
    sets.push('message_date = ?');
    params.push(fields.message_date);
  }
  if (sets.length === 0) {
    return;
  }
  params.push(String(id));
  db.runSync(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?;`, params);
}

export function deleteMessage(id: number): void {
  // ON DELETE CASCADE on message_blocks.message_id removes its blocks too.
  db.runSync('DELETE FROM messages WHERE id = ?;', [id]);
}

// ---------------------------------------------------------------------------
// message_blocks
// ---------------------------------------------------------------------------

export function addMessageBlock(input: MessageBlockInput): number {
  const result = db.runSync(
    `INSERT INTO message_blocks (message_id, serial_no, block_type, content, verse_ref, verse_note, highlight_color)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      input.message_id,
      input.serial_no,
      input.block_type,
      input.content,
      input.verse_ref ?? null,
      input.verse_note ?? null,
      input.highlight_color ?? null,
    ],
  );
  return result.lastInsertRowId;
}

export function getMessageBlocks(messageId: number): MessageBlockRow[] {
  return db.getAllSync<MessageBlockRow>(
    'SELECT * FROM message_blocks WHERE message_id = ? ORDER BY serial_no, id;',
    [messageId],
  );
}

export interface MessageBlockUpdate {
  serial_no?: number;
  block_type?: MessageBlockType;
  content?: string;
  verse_ref?: string | null;
  verse_note?: string | null;
  highlight_color?: string | null;
}

export function updateMessageBlock(id: number, fields: MessageBlockUpdate): void {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.serial_no !== undefined) {
    sets.push('serial_no = ?');
    params.push(fields.serial_no);
  }
  if (fields.block_type !== undefined) {
    sets.push('block_type = ?');
    params.push(fields.block_type);
  }
  if (fields.content !== undefined) {
    sets.push('content = ?');
    params.push(fields.content);
  }
  if (fields.verse_ref !== undefined) {
    sets.push('verse_ref = ?');
    params.push(fields.verse_ref);
  }
  if (fields.verse_note !== undefined) {
    sets.push('verse_note = ?');
    params.push(fields.verse_note);
  }
  if (fields.highlight_color !== undefined) {
    sets.push('highlight_color = ?');
    params.push(fields.highlight_color);
  }
  if (sets.length === 0) {
    return;
  }
  params.push(String(id));
  db.runSync(`UPDATE message_blocks SET ${sets.join(', ')} WHERE id = ?;`, params);
}

export function deleteMessageBlock(id: number): void {
  db.runSync('DELETE FROM message_blocks WHERE id = ?;', [id]);
}

export function deleteMessageBlocksForMessage(messageId: number): void {
  db.runSync('DELETE FROM message_blocks WHERE message_id = ?;', [messageId]);
}

// ---------------------------------------------------------------------------
// daily_devotions
// ---------------------------------------------------------------------------

export function upsertDailyDevotion(input: DailyDevotionInput): void {
  db.runSync(
    `INSERT INTO daily_devotions (entry_date, worship_prayer, god_spoke_word, god_spoke_color, understanding_today, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (entry_date) DO UPDATE SET
       worship_prayer = excluded.worship_prayer,
       god_spoke_word = excluded.god_spoke_word,
       god_spoke_color = excluded.god_spoke_color,
       understanding_today = excluded.understanding_today,
       updated_at = excluded.updated_at;`,
    [
      input.entry_date,
      input.worship_prayer ?? null,
      input.god_spoke_word ?? null,
      input.god_spoke_color ?? null,
      input.understanding_today ?? null,
      input.updated_at ?? isoTimestamp(),
    ],
  );
}

export function getDailyDevotion(entryDate: string): DailyDevotionRow | null {
  return db.getFirstSync<DailyDevotionRow>(
    'SELECT * FROM daily_devotions WHERE entry_date = ?;',
    [entryDate],
  );
}

/** Partial update of the legacy devotion row columns (creates the row lazily). */
export function updateDailyDevotionFields(
  entryDate: string,
  fields: {
    worship_prayer?: string | null;
    god_spoke_word?: string | null;
    god_spoke_color?: string | null;
    understanding_today?: string | null;
  },
): void {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const columns: (keyof typeof fields)[] = [
    'worship_prayer',
    'god_spoke_word',
    'god_spoke_color',
    'understanding_today',
  ];
  for (const column of columns) {
    const value = fields[column];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  const exists = getDailyDevotion(entryDate);
  if (!exists) {
    db.runSync(
      `INSERT INTO daily_devotions (entry_date, worship_prayer, god_spoke_word, god_spoke_color, understanding_today, updated_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        entryDate,
        fields.worship_prayer ?? null,
        fields.god_spoke_word ?? null,
        fields.god_spoke_color ?? null,
        fields.understanding_today ?? null,
        isoTimestamp(),
      ],
    );
    return;
  }
  params.push(entryDate);
  db.runSync(`UPDATE daily_devotions SET ${sets.join(', ')}, updated_at = ? WHERE entry_date = ?;`, [
    ...params,
    isoTimestamp(),
  ]);
}

export function getAllDailyDevotions(): DailyDevotionRow[] {
  return db.getAllSync<DailyDevotionRow>(
    'SELECT * FROM daily_devotions ORDER BY entry_date DESC;',
  );
}

/** Every date that contains saved Daily Walk content, newest first. */
export function getSavedDailyWalkDates(): string[] {
  return db.getAllSync<{ entry_date: string }>(
    `SELECT entry_date FROM daily_devotions
     UNION SELECT entry_date FROM daily_entries
     UNION SELECT entry_date FROM daily_verses
     UNION SELECT entry_date FROM prayer_points
     ORDER BY entry_date DESC;`,
  ).map((row) => row.entry_date);
}

// ---------------------------------------------------------------------------
// prayer_points
// ---------------------------------------------------------------------------

export function addPrayerPoint(input: PrayerPointInput): number {
  const result = db.runSync(
    `INSERT INTO prayer_points (entry_date, request_text, is_answered, answered_date, verse_ref, verse_text, verse_note, verse_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.entry_date,
      input.request_text,
      input.is_answered ?? 0,
      input.answered_date ?? null,
      input.verse_ref ?? null,
      input.verse_text ?? null,
      input.verse_note ?? null,
      input.verse_version_id ?? null,
    ],
  );
  return result.lastInsertRowId;
}

export interface PrayerPointUpdate {
  request_text?: string;
  verse_ref?: string | null;
  verse_text?: string | null;
  verse_note?: string | null;
  verse_version_id?: string | null;
}

export function updatePrayerPoint(id: number, fields: PrayerPointUpdate): void {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const columns: (keyof PrayerPointUpdate)[] = [
    'request_text',
    'verse_ref',
    'verse_text',
    'verse_note',
    'verse_version_id',
  ];
  for (const column of columns) {
    const value = fields[column];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  params.push(String(id));
  db.runSync(`UPDATE prayer_points SET ${sets.join(', ')} WHERE id = ?;`, params);
}

export function getPrayerPoint(id: number): PrayerPointRow | null {
  return db.getFirstSync<PrayerPointRow>('SELECT * FROM prayer_points WHERE id = ?;', [id]);
}

export function getPrayerPointsForDate(entryDate: string): PrayerPointRow[] {
  return db.getAllSync<PrayerPointRow>(
    'SELECT * FROM prayer_points WHERE entry_date = ? ORDER BY id;',
    [entryDate],
  );
}

export function getAllPrayerPoints(): PrayerPointRow[] {
  return db.getAllSync<PrayerPointRow>(
    'SELECT * FROM prayer_points ORDER BY entry_date DESC, id DESC;',
  );
}

export function setPrayerPointAnswered(id: number, isAnswered: boolean, answeredDate?: string | null): void {
  db.runSync(
    'UPDATE prayer_points SET is_answered = ?, answered_date = ? WHERE id = ?;',
    [isAnswered ? 1 : 0, isAnswered ? answeredDate ?? isoDate() : null, id],
  );
}

export function deletePrayerPoint(id: number): void {
  db.runSync('DELETE FROM prayer_points WHERE id = ?;', [id]);
}

// ---------------------------------------------------------------------------
// reading_progress (per-version, v2 table; legacy rows keep 'TAMIL_BSI')
// ---------------------------------------------------------------------------

export function markChapterRead(
  bookId: number,
  chapter: number,
  readDate?: string,
  versionId: string = DEFAULT_PROGRESS_VERSION,
): void {
  db.runSync(
    `INSERT INTO reading_progress_v2 (version_id, book_id, chapter, read_date) VALUES (?, ?, ?, ?)
     ON CONFLICT (version_id, book_id, chapter) DO UPDATE SET read_date = excluded.read_date;`,
    [versionId, bookId, chapter, readDate ?? isoDate()],
  );
}

export function unmarkChapterRead(
  bookId: number,
  chapter: number,
  versionId: string = DEFAULT_PROGRESS_VERSION,
): void {
  db.runSync(
    'DELETE FROM reading_progress_v2 WHERE version_id = ? AND book_id = ? AND chapter = ?;',
    [versionId, bookId, chapter],
  );
}

/** The day a chapter was last marked read, or null when never read. */
export function getChapterReadDate(
  bookId: number,
  chapter: number,
  versionId: string = DEFAULT_PROGRESS_VERSION,
): string | null {
  const row = db.getFirstSync<Pick<ReadingProgressRow, 'read_date'>>(
    'SELECT read_date FROM reading_progress_v2 WHERE version_id = ? AND book_id = ? AND chapter = ?;',
    [versionId, bookId, chapter],
  );
  return row ? row.read_date : null;
}

export function getBookReadingProgress(
  bookId: number,
  versionId: string = DEFAULT_PROGRESS_VERSION,
): ReadingProgressRow[] {
  return db.getAllSync<ReadingProgressRow>(
    'SELECT * FROM reading_progress_v2 WHERE version_id = ? AND book_id = ? ORDER BY chapter;',
    [versionId, bookId],
  );
}

/** Reading history for one version (metadata rows shaped like the legacy ones). */
export function getAllReadingProgress(
  versionId: string = DEFAULT_PROGRESS_VERSION,
): ReadingProgressRow[] {
  return db.getAllSync<ReadingProgressRow>(
    `SELECT book_id, chapter, read_date FROM reading_progress_v2
     WHERE version_id = ? ORDER BY read_date DESC, book_id, chapter;`,
    [versionId],
  );
}

// ---------------------------------------------------------------------------
// Verse-level mark-read tracking (v5)
// ---------------------------------------------------------------------------

function parseReadVerses(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function readVersesRow(
  versionId: string,
  bookId: number,
  chapter: number,
): ReadingProgressV2Row | null {
  return db.getFirstSync<ReadingProgressV2Row>(
    `SELECT version_id, book_id, chapter, read_date, read_verses, total_verses, is_read
     FROM reading_progress_v2 WHERE version_id = ? AND book_id = ? AND chapter = ?;`,
    [versionId, bookId, chapter],
  );
}

/**
 * Read state of one chapter for one version: the distinct verses marked read
 * plus whether the chapter counts as fully read (every verse read, or the
 * chapter was marked read as a whole before verse-level tracking existed).
 */
export async function getChapterReadState(
  versionId: string,
  bookId: number,
  chapter: number,
): Promise<ChapterReadState> {
  const row = readVersesRow(versionId, bookId, chapter);
  if (!row) return { isChapterRead: false, readVerses: [] };
  const readVerses = parseReadVerses(row.read_verses);
  // Legacy full-chapter mark: no array recorded but the row exists.
  if (readVerses.length === 0 && row.read_verses === null) {
    return { isChapterRead: true, readVerses: [] };
  }
  const total = row.total_verses ?? 0;
  const isChapterRead = row.is_read === 1 || (total > 0 && readVerses.length >= total);
  return { isChapterRead, readVerses };
}

/** Insert/refresh one chapter row with a raw verse set. */
function writeChapterReadState(
  versionId: string,
  bookId: number,
  chapter: number,
  readVerses: number[],
  totalVersesInChapter: number,
): void {
  const total = Math.max(
    Number.isFinite(totalVersesInChapter) ? Math.max(0, Math.floor(totalVersesInChapter)) : 0,
    readVerses.length,
  );
  const isRead = total > 0 && readVerses.length >= total ? 1 : 0;
  db.runSync(
    `INSERT INTO reading_progress_v2 (version_id, book_id, chapter, read_date, read_verses, total_verses, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (version_id, book_id, chapter) DO UPDATE SET
       read_date = excluded.read_date,
       read_verses = excluded.read_verses,
       total_verses = CASE
         WHEN reading_progress_v2.total_verses IS NULL THEN excluded.total_verses
         ELSE MAX(reading_progress_v2.total_verses, excluded.total_verses)
       END,
       is_read = excluded.is_read;`,
    [versionId, bookId, chapter, isoDate(), JSON.stringify(readVerses), total, isRead],
  );
}

/**
 * Mark the given verses read for one chapter (merging with any verses already
 * read). When the merged set covers every verse of the chapter the row flips
 * to a fully-read chapter, so the Progress tab percentage advances.
 */
export async function markVersesRead(
  versionId: string,
  bookId: number,
  chapter: number,
  verseNumbers: number[],
  totalVersesInChapter: number,
): Promise<void> {
  const valid = [...new Set(verseNumbers)].filter(
    (verse) => Number.isInteger(verse) && verse >= 1,
  );
  if (valid.length === 0) return;
  const existing = parseReadVerses(readVersesRow(versionId, bookId, chapter)?.read_verses ?? null);
  const merged = [...new Set([...existing, ...valid])].sort((a, b) => a - b);
  writeChapterReadState(versionId, bookId, chapter, merged, totalVersesInChapter);
}

/**
 * Unmark the given verses for one chapter. When nothing stays read the row
 * disappears entirely so the chapter counts as unread again.
 */
export async function unmarkVersesRead(
  versionId: string,
  bookId: number,
  chapter: number,
  verseNumbers: number[],
): Promise<void> {
  const existing = parseReadVerses(readVersesRow(versionId, bookId, chapter)?.read_verses ?? null);
  if (existing.length === 0 && verseNumbers.length === 0) return;
  const remove = new Set(verseNumbers.filter(Number.isInteger));
  const remaining = existing.filter((verse) => !remove.has(verse));
  if (remaining.length === 0) {
    db.runSync(
      'DELETE FROM reading_progress_v2 WHERE version_id = ? AND book_id = ? AND chapter = ?;',
      [versionId, bookId, chapter],
    );
    return;
  }
  const row = readVersesRow(versionId, bookId, chapter);
  writeChapterReadState(
    versionId,
    bookId,
    chapter,
    remaining,
    row?.total_verses ?? remaining[remaining.length - 1],
  );
}

/**
 * Flip the read state of an entire chapter:
 * - fully read  -> unmarked (row deleted) and the helper returns `false`;
 * - not fully read -> every verse 1..totalVersesInChapter marked read and
 *   the helper returns `true`.
 */
export async function toggleChapterRead(
  versionId: string,
  bookId: number,
  chapter: number,
  totalVersesInChapter: number,
): Promise<boolean> {
  const { isChapterRead, readVerses } = await getChapterReadState(versionId, bookId, chapter);
  const total = Math.max(Number.isFinite(totalVersesInChapter) ? totalVersesInChapter : 0, readVerses.length);
  if (isChapterRead || (total > 0 && readVerses.length >= total)) {
    db.runSync(
      'DELETE FROM reading_progress_v2 WHERE version_id = ? AND book_id = ? AND chapter = ?;',
      [versionId, bookId, chapter],
    );
    return false;
  }
  const all = Array.from({ length: Math.max(total, 1) }, (_, index) => index + 1);
  writeChapterReadState(versionId, bookId, chapter, all, all.length);
  return true;
}

/**
 * Progress snapshot for one version: fully-read chapter numbers per book id
 * plus the count of individually read verses per partially-read book, so the
 * Progress tab reflects both complete chapters and verse chunks marked in
 * the reader.
 */
export async function getVersionProgressSummary(
  versionId: string,
): Promise<Record<number, BookProgressSummary>> {
  const rows = db.getAllSync<ReadingProgressV2Row>(
    `SELECT version_id, book_id, chapter, read_date, read_verses, total_verses, is_read
     FROM reading_progress_v2 WHERE version_id = ? ORDER BY book_id, chapter;`,
    [versionId],
  );
  const summary: Record<number, BookProgressSummary> = {};
  for (const row of rows) {
    const book = summary[row.book_id] ??
      { readChapters: [], partialVerseCounts: {}, partialTotalVerseCounts: {} };
    const readVerses = parseReadVerses(row.read_verses);
    const total = row.total_verses ?? 0;
    // Legacy full-chapter mark: no array recorded but the row exists.
    const complete =
      row.is_read === 1 ||
      (total > 0 && readVerses.length >= total) ||
      (readVerses.length === 0 && row.read_verses === null);
    if (complete) {
      if (!book.readChapters.includes(row.chapter)) book.readChapters.push(row.chapter);
      delete book.partialVerseCounts[row.chapter];
      delete book.partialTotalVerseCounts[row.chapter];
    } else if (readVerses.length > 0) {
      book.partialVerseCounts[row.chapter] = readVerses.length;
      book.partialTotalVerseCounts[row.chapter] = total;
    }
    summary[row.book_id] = book;
  }
  for (const book of Object.values(summary)) book.readChapters.sort((a, b) => a - b);
  return summary;
}

// ---------------------------------------------------------------------------
// daily_entries (serial-numbered Rhema / Devotion / Worship points)
// ---------------------------------------------------------------------------

/** Sections in display order (cards 1-3 of the Daily Walk). */
export const DAILY_ENTRY_SECTIONS: readonly DailyEntrySection[] = ['rhema', 'devotion', 'worship'];

export function addDailyEntry(input: DailyEntryInput): number {
  // Append at the end of the section: next serial = max + 1.
  const maxRow = db.getFirstSync<{ next_serial: number }>(
    `SELECT COALESCE(MAX(serial_no), 0) + 1 AS next_serial FROM daily_entries
     WHERE entry_date = ? AND section = ?;`,
    [input.entry_date, input.section],
  );
  const serial = input.serial_no ?? maxRow?.next_serial ?? 1;
  const result = db.runSync(
    `INSERT INTO daily_entries (entry_date, section, serial_no, content, highlight_color, verse_ref, verse_text, verse_note, verse_version_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.entry_date,
      input.section,
      serial,
      input.content,
      input.highlight_color ?? null,
      input.verse_ref ?? null,
      input.verse_text ?? null,
      input.verse_note ?? null,
      input.verse_version_id ?? null,
      input.created_at ?? isoTimestamp(),
    ],
  );
  return result.lastInsertRowId;
}

export function getDailyEntriesForDate(entryDate: string): DailyEntryRow[] {
  return db.getAllSync<DailyEntryRow>(
    'SELECT * FROM daily_entries WHERE entry_date = ? ORDER BY section, serial_no, id;',
    [entryDate],
  );
}

export interface DailyEntryUpdate {
  content?: string;
  highlight_color?: string | null;
  verse_ref?: string | null;
  verse_text?: string | null;
  verse_note?: string | null;
  verse_version_id?: string | null;
}

export function updateDailyEntry(id: number, fields: DailyEntryUpdate): void {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const columns: (keyof DailyEntryUpdate)[] = [
    'content',
    'highlight_color',
    'verse_ref',
    'verse_text',
    'verse_note',
    'verse_version_id',
  ];
  for (const column of columns) {
    const value = fields[column];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  params.push(String(id));
  db.runSync(`UPDATE daily_entries SET ${sets.join(', ')} WHERE id = ?;`, params);
}

/** Delete one entry and close the serial gap for everything after it. */
export function deleteDailyEntry(id: number, entryDate: string, section: DailyEntrySection): void {
  const target = db.getFirstSync<{ serial_no: number }>(
    'SELECT serial_no FROM daily_entries WHERE id = ?;',
    [id],
  );
  db.runSync('DELETE FROM daily_entries WHERE id = ?;', [id]);
  if (!target) return;
  db.runSync(
    `UPDATE daily_entries SET serial_no = serial_no - 1
     WHERE entry_date = ? AND section = ? AND serial_no > ?;`,
    [entryDate, section, target.serial_no],
  );
}

// ---------------------------------------------------------------------------
// daily_verses (embedded scripture cards per Daily Walk section)
// ---------------------------------------------------------------------------

export function addDailyVerse(input: DailyVerseInput): number {
  const result = db.runSync(
    `INSERT INTO daily_verses (entry_date, section, verse_ref, verse_text, note, version_id, version_short_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.entry_date,
      input.section,
      input.verse_ref,
      input.verse_text,
      input.note ?? null,
      input.version_id ?? null,
      input.version_short_name ?? null,
      isoTimestamp(),
    ],
  );
  return result.lastInsertRowId;
}

export function getDailyVersesForDate(entryDate: string): DailyVerseRow[] {
  return db.getAllSync<DailyVerseRow>(
    'SELECT * FROM daily_verses WHERE entry_date = ? ORDER BY section, id;',
    [entryDate],
  );
}

export function updateDailyVerseNote(id: number, note: string): void {
  db.runSync('UPDATE daily_verses SET note = ? WHERE id = ?;', [note]);
}

export function deleteDailyVerse(id: number): void {
  db.runSync('DELETE FROM daily_verses WHERE id = ?;', [id]);
}
