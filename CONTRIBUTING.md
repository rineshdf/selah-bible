# Contributing to Selah Bible

Thank you for your interest in contributing to **Selah Bible**! We welcome bug fixes, translation improvements, feature proposals, and code contributions from the open-source community.

---

## Code of Conduct

Please help us keep this project welcoming, encouraging, and respectful for everyone. Be constructive in issues and pull requests, and uphold open-source collaboration best practices.

---

## Development Workflow

### 1. Fork & Branch
- Fork the repository on GitHub.
- Clone your fork locally:
  ```bash
  git clone https://github.com/<your-username>/selah-bible.git
  cd selah-bible
  ```
- Create a dedicated feature branch from `main`:
  ```bash
  git checkout -b feat/your-feature-name
  ```

### 2. Environment Setup
- Ensure you have **Node.js 20+** and **npm** installed.
- Install project dependencies:
  ```bash
  npm install
  ```
- Start the Expo Metro bundler:
  ```bash
  npx expo start -c
  ```

### 3. Architecture & Coding Conventions
- **Routing**: All screens and tabs live under `src/app/` using Expo Router.
- **Path Aliases**: Always use `@/*` for internal imports (e.g., `import { db } from '@/db/database'`).
- **SQLite Database**: Use modern synchronous and asynchronous `expo-sqlite` APIs:
  ```typescript
  import * as SQLite from 'expo-sqlite';
  const db = SQLite.openDatabaseSync('user_journal.db');
  ```
- **File System**: For legacy operations like `documentDirectory`, `getInfoAsync`, and `readAsStringAsync`, import strictly from legacy:
  ```typescript
  import * as FileSystem from 'expo-file-system/legacy';
  ```
- **Light & Dark Themes**: Ensure every component or UI modification is tested in both Light and Dark modes. Use `useAppTheme()` from `@/constants/ThemeContext` and avoid hardcoded black or white text colors.
- **Safe-Area Insets**: Always respect system notches, status bars, and navigation bars using `react-native-safe-area-context`.
- **Bundled Asset Protection**: Never modify or truncate `assets/bibles/tamil_bsi.json`.

---

## Static Checks & Quality Gates

Before submitting any Pull Request, you must verify that all static checks pass cleanly with zero warnings or errors:

1. **TypeScript Verification**:
   ```bash
   npx tsc --noEmit
   ```
2. **ESLint Static Analysis**:
   ```bash
   npx expo lint
   ```
3. **Expo Configuration Diagnostic**:
   ```bash
   npx expo-doctor
   ```

Both `npx tsc --noEmit` and `npx expo lint` must exit with return code `0`.

---

## Submitting Pull Requests

1. Commit your changes with clear, semantic commit messages (e.g., `feat: add swipe-to-delete for prayer points`, `fix: resolve dark mode contrast in chapter picker`).
2. Push your branch to your GitHub fork:
   ```bash
   git push origin feat/your-feature-name
   ```
3. Open a Pull Request against the `main` branch of the official repository.
4. Describe your changes clearly, including screenshots or screen recordings for UI updates.
5. Ensure CI builds and tests pass.

Thank you for helping make Selah Bible better for everyone around the world!
