# CLAUDE.md - Tamil Bible & Devotion App Blueprint

## 1. Technical Stack & Rules
- React Native (Expo SDK 52/53) with Expo Router.
- **CRITICAL SQLITE:** Use modern synchronous/async `expo-sqlite`:
  ```ts
  import * as SQLite from 'expo-sqlite';
  const db = SQLite.openDatabaseSync('user_journal.db');