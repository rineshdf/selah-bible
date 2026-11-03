This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`; the tab group lives at `src/app/(tabs)/` (e.g. `index.tsx`, `bibles.tsx`).
- Imports from the `src/` tree use the `@/*` path alias (configured in `tsconfig.json`): `@/db/...`, `@/constants/...`, `@/components/...`. Do not write relative paths like `../../db/...` in screens.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## FileSystem API — legacy import is mandatory for old-style APIs

In this SDK (58), the main `expo-file-system` package exports only the new object API: `File`, `Directory`, `Paths`. Legacy functions callable against the main entry (e.g. `FileSystem.documentDirectory`, `FileSystem.createDownloadResumable`, `readAsStringAsync`, `writeAsStringAsync`, `deleteAsync`, ...) are deprecation stubs that **throw at runtime**.

- Old API needed (paths, resumable downloads, string-based read/write)? Import it from the documented legacy subpath: `import * as FileSystem from 'expo-file-system/legacy';` — `FileSystem.documentDirectory` and `FileSystem.createDownloadResumable` are exported there.
- New code that only reads/writes/moves/copies files should prefer the new API instead: `import { File, Directory, Paths } from 'expo-file-system';`
- Never "fix" a missing legacy export by using the main package — the import specifier itself must be `expo-file-system/legacy`.
- Docs: https://docs.expo.dev/versions/v58.0.0/sdk/filesystem.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- **Never overwrite `assets/bibles/tamil_bsi.json` with sample data.** It contains the complete pre-installed Tamil BSI Bible (66 books, 1,189 chapters, 31,102 verses); preserve its full contents.
- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
## Tamil Bible App Architecture & API Rules

### 1. Path & Package Rules (Strict)
- All Expo Router screens live inside `src/app/` and `src/app/(tabs)/`.
- Always use the `@/*` path alias (mapped to `./src/*`) for imports (e.g., `import { initDatabase } from '@/db/database'`).
- **SQLite Rule:** Use the synchronous API from `expo-sqlite`:
  `import * as SQLite from 'expo-sqlite';`
  `const db = SQLite.openDatabaseSync('user_journal.db');`
- **FileSystem Rule (SDK 58):** For `documentDirectory`, `getInfoAsync`, `makeDirectoryAsync`, `readAsStringAsync`, `writeAsStringAsync`, and `createDownloadResumable`, you MUST import from legacy:
  `import * as FileSystem from 'expo-file-system/legacy';`
- After finishing any task, ALWAYS run `npx tsc --noEmit` and `npx expo lint` and fix any errors before stopping.

### 2. Minimal 5-Color Highlight Palette (`@/constants/colors.ts`)
- Warm Sand: `#FDE68A`
- Sage Green: `#A7F3D0`
- Soft Sky: `#BAE6FD`
- Dusty Rose: `#FECDD3`
- Muted Lavender: `#DDD6FE`

### 3. Target File Map
- `assets/bibles/tamil_bsi.json` -> Full bundled Tamil BSI Bible (66 books, 1,189 chapters, 31,102 verses)
- `src/constants/colors.ts` -> 5 minimal pastel highlight colors + dark/light theme colors
- `src/constants/books.ts` -> 66 Bible books (`id`, `tamilName`, `englishName`, `testament`, `chaptersCount`)
- `src/constants/versionCatalog.ts` -> Downloadable JSON Bible catalog + live `bible.helloao.org` search helper
- `src/db/database.ts` -> `user_journal.db` with 6 tables (`highlights`, `messages`, `message_blocks`, `daily_devotions`, `prayer_points`, `reading_progress`)
- `src/db/bibleLoader.ts` -> Offline Bible file manager in `FileSystem.documentDirectory + 'bibles/'`
- `src/db/backupManager.ts` -> JSON export/import of all 6 SQLite tables via `expo-sharing` and `expo-document-picker`
- `src/app/(tabs)/index.tsx` -> Tab 1: Front-page Bible Viewer
- `src/app/(tabs)/highlights.tsx` -> Tab 2: Date-sorted Highlights
- `src/app/(tabs)/messages.tsx` -> Tab 3: Sermon Messages with serial numbering (`1.`, `2.`), optional headings, and verse notes
- `src/app/(tabs)/daily-walk.tsx` -> Tab 4: Daily Devotion, Worship, Rhema Word & Prayer Points by date
- `src/app/(tabs)/progress.tsx` -> Tab 5: 66-Book Reading Progress Tracker
- `src/app/(tabs)/bibles.tsx` -> Tab 6 / Manager: Online Language & Version Search + Offline Downloader + Backup/Restore