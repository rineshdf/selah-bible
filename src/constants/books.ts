/**
 * Canonical list of the 66 Bible books, ids 1-66 in traditional order.
 *
 * Tamil names are the BSI Tamil O.V. (பரிசுத்த வேதாகமம் O.V., YouVersion
 * version 339 "TAOVBSI") headings, verified book-by-book against
 * https://www.bible.com/bible/339/<BOOK>.1.TAOVBSI.
 *
 * `id` is the stable primary key shared with `highlights.book_id`,
 * `reading_progress.book_id`, and bundled scripture assets.
 */

export type Testament = 'OT' | 'NT';

export interface BibleBook {
  /** Stable canonical id: 1-66 in traditional book order. */
  id: number;
  /** BSI Tamil O.V. name, e.g. ஆதியாகமம், 1 சாமுவேல். */
  tamilName: string;
  /** English name, e.g. Genesis, 1 Samuel. */
  englishName: string;
  /** Compact English label, e.g. Gen, 1 Sam, Rev ("" until populated below). */
  shortEnglishName?: string;
  testament: Testament;
  /** Canonical chapter count (1189 chapters across all 66 books). */
  chaptersCount: number;
}

export const BIBLE_BOOKS: BibleBook[] = [
  { id: 1, tamilName: 'ஆதியாகமம்', englishName: 'Genesis', testament: 'OT', chaptersCount: 50 },
  { id: 2, tamilName: 'யாத்திராகமம்', englishName: 'Exodus', testament: 'OT', chaptersCount: 40 },
  { id: 3, tamilName: 'லேவியராகமம்', englishName: 'Leviticus', testament: 'OT', chaptersCount: 27 },
  { id: 4, tamilName: 'எண்ணாகமம்', englishName: 'Numbers', testament: 'OT', chaptersCount: 36 },
  { id: 5, tamilName: 'உபாகமம்', englishName: 'Deuteronomy', testament: 'OT', chaptersCount: 34 },
  { id: 6, tamilName: 'யோசுவா', englishName: 'Joshua', testament: 'OT', chaptersCount: 24 },
  { id: 7, tamilName: 'நியாயாதிபதிகள்', englishName: 'Judges', testament: 'OT', chaptersCount: 21 },
  { id: 8, tamilName: 'ரூத்', englishName: 'Ruth', testament: 'OT', chaptersCount: 4 },
  { id: 9, tamilName: '1 சாமுவேல்', englishName: '1 Samuel', testament: 'OT', chaptersCount: 31 },
  { id: 10, tamilName: '2 சாமுவேல்', englishName: '2 Samuel', testament: 'OT', chaptersCount: 24 },
  { id: 11, tamilName: '1 இராஜாக்கள்', englishName: '1 Kings', testament: 'OT', chaptersCount: 22 },
  { id: 12, tamilName: '2 இராஜாக்கள்', englishName: '2 Kings', testament: 'OT', chaptersCount: 25 },
  { id: 13, tamilName: '1 நாளாகமம்', englishName: '1 Chronicles', testament: 'OT', chaptersCount: 29 },
  { id: 14, tamilName: '2 நாளாகமம்', englishName: '2 Chronicles', testament: 'OT', chaptersCount: 36 },
  { id: 15, tamilName: 'எஸ்றா', englishName: 'Ezra', testament: 'OT', chaptersCount: 10 },
  { id: 16, tamilName: 'நெகேமியா', englishName: 'Nehemiah', testament: 'OT', chaptersCount: 13 },
  { id: 17, tamilName: 'எஸ்தர்', englishName: 'Esther', testament: 'OT', chaptersCount: 10 },
  { id: 18, tamilName: 'யோபு', englishName: 'Job', testament: 'OT', chaptersCount: 42 },
  { id: 19, tamilName: 'சங்கீதம்', englishName: 'Psalms', testament: 'OT', chaptersCount: 150 },
  { id: 20, tamilName: 'நீதிமொழிகள்', englishName: 'Proverbs', testament: 'OT', chaptersCount: 31 },
  { id: 21, tamilName: 'பிரசங்கி', englishName: 'Ecclesiastes', testament: 'OT', chaptersCount: 12 },
  { id: 22, tamilName: 'உன்னதப்பாட்டு', englishName: 'Song of Songs', testament: 'OT', chaptersCount: 8 },
  { id: 23, tamilName: 'ஏசாயா', englishName: 'Isaiah', testament: 'OT', chaptersCount: 66 },
  { id: 24, tamilName: 'எரேமியா', englishName: 'Jeremiah', testament: 'OT', chaptersCount: 52 },
  { id: 25, tamilName: 'புலம்பல்', englishName: 'Lamentations', testament: 'OT', chaptersCount: 5 },
  { id: 26, tamilName: 'எசேக்கியேல்', englishName: 'Ezekiel', testament: 'OT', chaptersCount: 48 },
  { id: 27, tamilName: 'தானியேல்', englishName: 'Daniel', testament: 'OT', chaptersCount: 12 },
  { id: 28, tamilName: 'ஓசியா', englishName: 'Hosea', testament: 'OT', chaptersCount: 14 },
  { id: 29, tamilName: 'யோவேல்', englishName: 'Joel', testament: 'OT', chaptersCount: 3 },
  { id: 30, tamilName: 'ஆமோஸ்', englishName: 'Amos', testament: 'OT', chaptersCount: 9 },
  { id: 31, tamilName: 'ஒபதியா', englishName: 'Obadiah', testament: 'OT', chaptersCount: 1 },
  { id: 32, tamilName: 'யோனா', englishName: 'Jonah', testament: 'OT', chaptersCount: 4 },
  { id: 33, tamilName: 'மீகா', englishName: 'Micah', testament: 'OT', chaptersCount: 7 },
  { id: 34, tamilName: 'நாகூம்', englishName: 'Nahum', testament: 'OT', chaptersCount: 3 },
  { id: 35, tamilName: 'ஆபகூக்', englishName: 'Habakkuk', testament: 'OT', chaptersCount: 3 },
  { id: 36, tamilName: 'செப்பனியா', englishName: 'Zephaniah', testament: 'OT', chaptersCount: 3 },
  { id: 37, tamilName: 'ஆகாய்', englishName: 'Haggai', testament: 'OT', chaptersCount: 2 },
  { id: 38, tamilName: 'சகரியா', englishName: 'Zechariah', testament: 'OT', chaptersCount: 14 },
  { id: 39, tamilName: 'மல்கியா', englishName: 'Malachi', testament: 'OT', chaptersCount: 4 },
  { id: 40, tamilName: 'மத்தேயு', englishName: 'Matthew', testament: 'NT', chaptersCount: 28 },
  { id: 41, tamilName: 'மாற்கு', englishName: 'Mark', testament: 'NT', chaptersCount: 16 },
  { id: 42, tamilName: 'லூக்கா', englishName: 'Luke', testament: 'NT', chaptersCount: 24 },
  { id: 43, tamilName: 'யோவான்', englishName: 'John', testament: 'NT', chaptersCount: 21 },
  { id: 44, tamilName: 'அப்போஸ்தலர்', englishName: 'Acts', testament: 'NT', chaptersCount: 28 },
  { id: 45, tamilName: 'ரோமர்', englishName: 'Romans', testament: 'NT', chaptersCount: 16 },
  { id: 46, tamilName: '1 கொரிந்தியர்', englishName: '1 Corinthians', testament: 'NT', chaptersCount: 16 },
  { id: 47, tamilName: '2 கொரிந்தியர்', englishName: '2 Corinthians', testament: 'NT', chaptersCount: 13 },
  { id: 48, tamilName: 'கலாத்தியர்', englishName: 'Galatians', testament: 'NT', chaptersCount: 6 },
  { id: 49, tamilName: 'எபேசியர்', englishName: 'Ephesians', testament: 'NT', chaptersCount: 6 },
  { id: 50, tamilName: 'பிலிப்பியர்', englishName: 'Philippians', testament: 'NT', chaptersCount: 4 },
  { id: 51, tamilName: 'கொலோசெயர்', englishName: 'Colossians', testament: 'NT', chaptersCount: 4 },
  { id: 52, tamilName: '1 தெசலோனிக்கேயர்', englishName: '1 Thessalonians', testament: 'NT', chaptersCount: 5 },
  { id: 53, tamilName: '2 தெசலோனிக்கேயர்', englishName: '2 Thessalonians', testament: 'NT', chaptersCount: 3 },
  { id: 54, tamilName: '1 தீமோத்தேயு', englishName: '1 Timothy', testament: 'NT', chaptersCount: 6 },
  { id: 55, tamilName: '2 தீமோத்தேயு', englishName: '2 Timothy', testament: 'NT', chaptersCount: 4 },
  { id: 56, tamilName: 'தீத்து', englishName: 'Titus', testament: 'NT', chaptersCount: 3 },
  { id: 57, tamilName: 'பிலேமோன்', englishName: 'Philemon', testament: 'NT', chaptersCount: 1 },
  { id: 58, tamilName: 'எபிரெயர்', englishName: 'Hebrews', testament: 'NT', chaptersCount: 13 },
  { id: 59, tamilName: 'யாக்கோபு', englishName: 'James', testament: 'NT', chaptersCount: 5 },
  { id: 60, tamilName: '1 பேதுரு', englishName: '1 Peter', testament: 'NT', chaptersCount: 5 },
  { id: 61, tamilName: '2 பேதுரு', englishName: '2 Peter', testament: 'NT', chaptersCount: 3 },
  { id: 62, tamilName: '1 யோவான்', englishName: '1 John', testament: 'NT', chaptersCount: 5 },
  { id: 63, tamilName: '2 யோவான்', englishName: '2 John', testament: 'NT', chaptersCount: 1 },
  { id: 64, tamilName: '3 யோவான்', englishName: '3 John', testament: 'NT', chaptersCount: 1 },
  { id: 65, tamilName: 'யூதா', englishName: 'Jude', testament: 'NT', chaptersCount: 1 },
  { id: 66, tamilName: 'வெளிப்படுத்தின விசேஷம்', englishName: 'Revelation', testament: 'NT', chaptersCount: 22 },
];

const BIBLE_BOOK_BY_ID: ReadonlyMap<number, BibleBook> = new Map(
  BIBLE_BOOKS.map((book) => [book.id, book]),
);

/** Look a book up by its canonical id (1-66). Returns undefined for unknown ids. */
export function getBookById(id: number): BibleBook | undefined {
  return BIBLE_BOOK_BY_ID.get(id);
}

/** Books of one testament, in canonical order. */
export function getBooksByTestament(testament: Testament): BibleBook[] {
  return BIBLE_BOOKS.filter((book) => book.testament === testament);
}

/** True when `chapter` exists in `book` (1-based). */
export function isValidChapter(book: BibleBook, chapter: number): boolean {
  return chapter >= 1 && chapter <= book.chaptersCount;
}

// ---------------------------------------------------------------------------
// Compact English labels (secondary line for English-reading UIs)
// ---------------------------------------------------------------------------

const BOOK_SHORT_ENGLISH_NAMES: Record<number, string> = {
  1: 'Gen', 2: 'Exod', 3: 'Lev', 4: 'Num', 5: 'Deut', 6: 'Josh', 7: 'Judg',
  8: 'Ruth', 9: '1 Sam', 10: '2 Sam', 11: '1 Kgs', 12: '2 Kgs', 13: '1 Chr',
  14: '2 Chr', 15: 'Ezra', 16: 'Neh', 17: 'Esth', 18: 'Job', 19: 'Ps',
  20: 'Prov', 21: 'Eccles', 22: 'Song', 23: 'Isa', 24: 'Jer', 25: 'Lam',
  26: 'Ezek', 27: 'Dan', 28: 'Hos', 29: 'Joel', 30: 'Amos', 31: 'Obad',
  32: 'Jonah', 33: 'Mic', 34: 'Nah', 35: 'Hab', 36: 'Zeph', 37: 'Hag',
  38: 'Zech', 39: 'Mal', 40: 'Matt', 41: 'Mark', 42: 'Luke', 43: 'John',
  44: 'Acts', 45: 'Rom', 46: '1 Cor', 47: '2 Cor', 48: 'Gal', 49: 'Eph',
  50: 'Phil', 51: 'Col', 52: '1 Thess', 53: '2 Thess', 54: '1 Tim',
  55: '2 Tim', 56: 'Titus', 57: 'Phlm', 58: 'Heb', 59: 'Jas', 60: '1 Pet',
  61: '2 Pet', 62: '1 John', 63: '2 John', 64: '3 John', 65: 'Jude',
  66: 'Rev',
};

for (const book of BIBLE_BOOKS) {
  book.shortEnglishName = BOOK_SHORT_ENGLISH_NAMES[book.id] ?? '';
}

// ---------------------------------------------------------------------------
// Native book names for the offline IRV languages
//
// Verified 2026-11-03 against the bible.helloao.org `books.json` payloads of
// mal_irv / HINIRV / tel_irv / kan_irv (eBible IRV). Books without a native
// entry fall back to the version's own parsed JSON or the English name.
// ---------------------------------------------------------------------------

/** മലയാളം (Malayalam IRV). */
const MALAYALAM_BOOK_NAMES: string[] = [
  'ഉല്‍പത്തി', 'പുറപ്പാട്', 'ലേവ്യപുസ്തകം', 'സംഖ്യാപുസ്തകം', 'ആവർത്തനപുസ്തകം',
  'യോശുവ', 'ന്യായാധിപന്മാർ', 'രൂത്ത്', '1 ശമൂവേൽ', '2 ശമൂവേൽ',
  '1 രാജാക്കന്മാർ', '2 രാജാക്കന്മാർ', '1 ദിനവൃത്താന്തം', '2 ദിനവൃത്താന്തം',
  'എസ്രാ', 'നെഹെമ്യാവ്', 'എസ്ഥേർ', 'ഇയ്യോബ്', 'സങ്കീർത്തനങ്ങൾ',
  'സദൃശവാക്യങ്ങൾ', 'സഭാപ്രസംഗി', 'ഉത്തമഗീതം', 'യെശയ്യാവ്', 'യിരെമ്യാവ്',
  'വിലാപങ്ങൾ', 'യെഹെസ്കേൽ', 'ദാനീയേൽ', 'ഹോശേയ', 'യോവേൽ', 'ആമോസ്',
  'ഓബദ്യാവ്', 'യോനാ', 'മീഖാ', 'നഹൂം', 'ഹബക്കൂക്ക്', 'സെഫന്യാവ്',
  'ഹഗ്ഗായി', 'സെഖര്യാവ്', 'മലാഖി', 'മത്തായി', 'മർക്കൊസ്', 'ലൂക്കോസ്',
  'യോഹന്നാന്‍', 'അപ്പൊസ്തലന്മാരുടെ പ്രവൃത്തികൾ', 'റോമർ', '1 കൊരിന്ത്യർ',
  '2 കൊരിന്ത്യർ', 'ഗലാത്യർ', 'എഫെസ്യർ', 'ഫിലിപ്പ്യര്‍', 'കൊലൊസ്സൃര്‍',
  '1 തെസ്സലൊനീക്യർ', '2 തെസ്സലൊനീക്യർ', '1 തിമൊഥെയൊസ്', '2 തിമൊഥെയൊസ്',
  'തീത്തൊസ്', 'ഫിലേമോൻ', 'എബ്രായർ', 'യാക്കോബ്', '1 പത്രൊസ്', '2 പത്രൊസ്',
  '1 യോഹന്നാൻ', '2 യോഹന്നാൻ', '3 യോഹന്നാൻ', 'യൂദാ', 'വെളിപ്പാട്',
];

/** हिंदी (Hindi IRV). */
const HINDI_BOOK_NAMES: string[] = [
  'उत्पत्ति', 'निर्गमन', 'लैव्यव्यवस्था', 'गिनती', 'व्यवस्थाविवरण', 'यहोशू',
  'न्यायियों', 'रूत', '1 शमूएल', '2 शमूएल', '1 राजाओं', '2 राजाओं', '1 इतिहास',
  '2 इतिहास', 'एज्रा', 'नहेम्याह', 'एस्तेर', 'अय्यूब', 'भजन संहिता', 'नीतिवचन',
  'सभोपदेशक', 'श्रेष्ठगीत', 'यशायाह', 'यिर्मयाह', 'विलापगीत', 'यहेजकेल',
  'दानिय्येल', 'होशे', 'योएल', 'आमोस', 'ओबद्याह', 'योना', 'मीका', 'नहूम',
  'हबक्कूक', 'सपन्याह', 'हाग्गै', 'जकर्याह', 'मलाकी', 'मत्ती', 'मरकुस',
  'लूका', 'यूहन्ना', 'प्रेरितों के काम', 'रोमियों', '1 कुरिन्थियों',
  '2 कुरिन्थियों', 'गलातियों', 'इफिसियों', 'फिलिप्पियों', 'कुलुस्सियों',
  '1 थिस्सलुनीकियों', '2 थिस्सलुनीकियों', '1 तीमुथियुस', '2 तीमुथियुस',
  'तीतुस', 'फिलेमोन', 'इब्रानियों', 'याकूब', '1 पतरस', '2 पतरस', '1 यूहन्ना',
  '2 यूहन्ना', '3 यूहन्ना', 'यहूदा', 'प्रकाशितवाक्य',
];

/** తెలుగు (Telugu IRV). */
const TELUGU_BOOK_NAMES: string[] = [
  'ఆదికాండం', 'నిర్గమకాండం', 'లేవీకాండం', 'సంఖ్యాకాండం',
  'ద్వితీయోపదేశ కాండము', 'యెహోషువా', 'న్యాయాధిపతులు', 'రూతు',
  '1 సమూయేలు', '2 సమూయేలు', '1 రాజులు', '2 రాజులు', '1 దినవృత్తాంతాలు',
  '2 దినవృత్తాంతాలు', 'ఎజ్రా', 'నెహెమ్యా', 'ఎస్తేరు', 'యోబు', 'కీర్తనలు',
  'సామెతలు', 'ప్రసంగి', 'పరమ గీతము', 'యెషయా', 'యిర్మీయా',
  'విలాప వాక్యములు', 'యెహెజ్కేలు', 'దానియేలు', 'హోషేయ', 'యోవేలు', 'ఆమోసు',
  'ఓబద్యా', 'యోనా', 'మీకా', 'నహూము', 'హబక్కూకు', 'జెఫన్యా', 'హగ్గయి',
  'జెకర్యా', 'మలాకీ', 'మత్తయి రాసిన సువార్త', 'మార్కు రాసిన సువార్త',
  'లూకా రాసిన సువార్త', 'యోహాను రాసిన సువార్త', 'అపోస్తలుల కార్యములు',
  'రోమీయులకు రాసిన పత్రిక', 'కొరింతీయులకు రాసిన మొదటి పత్రిక',
  'కొరింతీయులకు రాసిన రెండవ పత్రిక', 'గలతీయులకు రాసిన పత్రిక',
  'ఎఫెసీయులకు రాసిన పత్రిక', 'ఫిలిప్పీయులకు రాసిన పత్రిక',
  'కొలస్సయులకు రాసిన పత్రిక', 'తెస్సలోనీకయులకు రాసిన మొదటి పత్రిక',
  'తెస్సలోనీకయులకు రాసిన రెండవ పత్రిక', 'తిమోతికి రాసిన మొదటి పత్రిక',
  'తిమోతికి రాసిన రెండవ పత్రిక', 'తీతుకు రాసిన పత్రిక',
  'ఫిలేమోనుకు రాసిన పత్రిక', 'హెబ్రీయులకు రాసిన పత్రిక',
  'యాకోబు రాసిన పత్రిక', 'పేతురు రాసిన మొదటి పత్రిక',
  'పేతురు రాసిన రెండవ పత్రిక', 'యోహాను రాసిన మొదటి పత్రిక',
  'యోహాను రాసిన రెండవ పత్రిక', 'యోహాను రాసిన మూడవ పత్రిక',
  'యూదా రాసిన పత్రిక', 'యోహాను రాసిన ప్రకటన గ్రంథం',
];

/** ಕನ್ನಡ (Kannada IRV). */
const KANNADA_BOOK_NAMES: string[] = [
  'ಆದಿಕಾಂಡ', 'ವಿಮೋಚನಕಾಂಡ', 'ಯಾಜಕಕಾಂಡ', 'ಅರಣ್ಯಕಾಂಡ', 'ಧರ್ಮೋಪದೇಶಕಾಂಡ',
  'ಯೆಹೋಶುವನು', 'ನ್ಯಾಯಸ್ಥಾಪಕರು', 'ರೂತಳು', '1 ಸಮುವೇಲನು', '2 ಸಮುವೇಲನು',
  '1 ಅರಸುಗಳು', '2 ಅರಸುಗಳು', '1 ಪೂರ್ವಕಾಲವೃತ್ತಾಂತ', '2 ಪೂರ್ವಕಾಲವೃತ್ತಾಂತ',
  'ಎಜ್ರನು', 'ನೆಹೆಮೀಯನು', 'ಎಸ್ತೇರಳು', 'ಯೋಬನು', 'ಕೀರ್ತನೆಗಳು', 'ಜ್ಞಾನೋಕ್ತಿಗಳು',
  'ಪ್ರಸಂಗಿ', 'ಪರಮಗೀತೆ', 'ಯೆಶಾಯನು', 'ಯೆರೆಮೀಯನು', 'ಪ್ರಲಾಪಗಳು', 'ಯೆಹೆಜ್ಕೇಲನು',
  'ದಾನಿಯೇಲನು', 'ಹೋಶೇಯನು', 'ಯೋವೇಲನು', 'ಆಮೋಸನು', 'ಓಬದ್ಯನು', 'ಯೋನನು',
  'ಮೀಕನು', 'ನಹೂಮನು', 'ಹಬಕ್ಕೂಕನು', 'ಚೆಫನ್ಯನು', 'ಹಗ್ಗಾಯನು', 'ಜೆಕರ್ಯನು',
  'ಮಲಾಕಿಯನು', 'ಮತ್ತಾಯನು', 'ಮಾರ್ಕನು', 'ಲೂಕನು', 'ಯೋಹಾನನು', 'ಅಪೊಸ್ತಲರ ಕೃತ್ಯಗಳು',
  'ರೋಮಾಪುರದವರಿಗೆ', '1 ಕೊರಿಂಥದವರಿಗೆ', '2 ಕೊರಿಂಥದವರಿಗೆ', 'ಗಲಾತ್ಯದವರಿಗೆ',
  'ಎಫೆಸದವರಿಗೆ', 'ಫಿಲಿಪ್ಪಿಯವರಿಗೆ', 'ಕೊಲೊಸ್ಸೆಯವರಿಗೆ', '1 ಥೆಸಲೋನಿಕದವರಿಗೆ',
  '2 ಥೆಸಲೋನಿಕದವರಿಗೆ', '1 ತಿಮೊಥೆಯನಿಗೆ', '2 ತಿಮೊಥೆಯನಿಗೆ', 'ತೀತನಿಗೆ',
  'ಫಿಲೆಮೋನನಿಗೆ', 'ಇಬ್ರಿಯರಿಗೆ', 'ಯಾಕೋಬನು', '1 ಪೇತ್ರನು', '2 ಪೇತ್ರನು',
  '1 ಯೋಹಾನನು', '2 ಯೋಹಾನನು', '3 ಯೋಹಾನನು', 'ಯೂದನು', 'ಪ್ರಕಟಣೆ',
];

/** Language code -> canonical-id-indexed native book-name list. */
export const NATIVE_BOOK_NAMES: Readonly<Record<string, readonly string[]>> = {
  mal: MALAYALAM_BOOK_NAMES,
  hin: HINDI_BOOK_NAMES,
  tel: TELUGU_BOOK_NAMES,
  kan: KANNADA_BOOK_NAMES,
};

// ---------------------------------------------------------------------------
// Localized book-name resolution per active Bible version
// ---------------------------------------------------------------------------

/** Minimal version-metadata shape accepted by `getLocalizedBookName`. */
export interface BookLanguageVersionMeta {
  id: string;
  language: string;
  languageCode?: string;
}

/** Localized book labels resolved against the active version's language. */
export interface LocalizedBookName {
  /** Native name shown first (book list rows, headers, selectors). */
  primaryName: string;
  /** English or transliterated helper name shown second. */
  secondaryName: string;
  /** Old Testament section header, e.g. "Old Testament • பழைய ஏற்பாடு". */
  otLabel: string;
  /** New Testament section header, e.g. "New Testament • புதிய ஏற்பாடு". */
  ntLabel: string;
}

/**
 * Resolve the display names for one canonical book under the active Bible
 * version's language:
 *
 * - Tamil versions → BSI Tamil primary / English secondary, bilingual OT/NT
 *   labels.
 * - English versions → full English primary / compact abbreviation secondary.
 * - Every other language (Malayalam, Hindi, Telugu, Kannada, ...) → the
 *   version's own native book name when the parsed JSON carries one
 *   (`customBookNames`), otherwise the built-in IRV dictionary above, with
 *   English as the secondary name and plain OT/NT labels.
 */
export function getLocalizedBookName(
  bookId: number,
  versionMeta?: BookLanguageVersionMeta | null,
  customBookNames?: Record<number, string> | null,
): LocalizedBookName {
  const book = getBookById(bookId) ?? BIBLE_BOOKS[0];
  const id = (versionMeta?.id ?? '').trim();
  const language = (versionMeta?.language ?? '').trim();
  const code = (versionMeta?.languageCode ?? '').trim().toLowerCase();

  const isTamil =
    id === 'TAMIL_BSI' ||
    /tamil/i.test(language) ||
    code === 'tam';
  if (isTamil) {
    return {
      primaryName: book.tamilName,
      secondaryName: book.englishName,
      otLabel: 'Old Testament • பழைய ஏற்பாடு',
      ntLabel: 'New Testament • புதிய ஏற்பாடு',
    };
  }

  const isEnglish =
    /english/i.test(language) ||
    code === 'eng' ||
    id.startsWith('eng_') ||
    id.startsWith('EN_');
  if (isEnglish) {
    return {
      primaryName: book.englishName,
      secondaryName: book.shortEnglishName || '',
      otLabel: 'Old Testament',
      ntLabel: 'New Testament',
    };
  }

  const nativeList = NATIVE_BOOK_NAMES[code];
  const native =
    customBookNames?.[book.id] ??
    (nativeList ? nativeList[book.id - 1] : undefined) ??
    book.englishName;
  return {
    primaryName: native,
    secondaryName: book.englishName,
    otLabel: 'Old Testament',
    ntLabel: 'New Testament',
  };
}
