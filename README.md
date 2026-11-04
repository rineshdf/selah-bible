# Selah Bible

[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2058-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-expo--sqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://docs.expo.dev/versions/latest/sdk/sqlite/)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://reactnative.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

> **Offline-first, zero-latency multilingual Bible reader, sermon notebook, daily devotion journal, and reading progress tracker built with React Native & Expo.**

---

## 📲 Download Release APK

Get the latest standalone Android APK directly from GitHub Releases:

📦 **[Download Selah-Bible-v1.0.0.apk](../../releases/latest)**

*Simply download the APK to your Android device, tap to install, and enjoy a completely offline, ad-free spiritual study experience.*

---

## ✨ Key Features

### 1. Offline-First Multilingual Bible Library
- **Pre-installed Tamil BSI**: Ships with the complete, unabridged 66-book Tamil Bible Society of India (BSI) text (1,189 chapters, 31,102 verses) ready out of the box with zero internet required.
- **1,000+ Downloadable Translations**: Download high-quality public domain and open-access Bibles in hundreds of languages via `bible.helloao.org`, `godlytalias`, `thiagobodruk`, and `getbible`.
- **Canonical 1–66 USFM Mapping**: Every translation is dynamically normalized to standard book IDs, preserving localized book titles and Old / New Testament divisions.
- **Instant Version Switching**: Compare verses across translations with zero reload delay.

### 2. High-Contrast Verse Highlighting & Context Reader
- **5 Adaptive Highlight Palettes**: Soft, accessible pastel shades designed for readability in both light and dark themes (Warm Sand, Sage Green, Soft Sky, Dusty Rose, Muted Lavender).
- **Interactive Full-Chapter Modal**: Tap any verse to open the full chapter context modal with automatic smooth scrolling to the target verse.
- **Color Filtering & Sorting**: Filter your highlighted verses by date or color tag.

### 3. Daily Walk Spiritual Journal
- **Structured Sections**:
  - *Rhema — Word from God*: Capture prophetic promises and scripture impressions with color badges.
  - *Daily Devotion*: Document insights and personal applications from daily reading.
  - *Prayer & Worship*: Dedicated space for worship notes, thanksgiving, and communion.
  - *Prayer Points*: Interactive prayer requests with answered checkboxes, dates, and linked thanksgiving scriptures.
- **7-Day Week Strip & Calendar Modal**: Seamless day-by-day navigation with an inline `↺ Today` jump button.
- **Collapsible Rewind Past Days**: Full-text instant search across all your historic journal entries, verses, and prayer notes.

### 4. Preached Messages Notebook
- **Structured Sermon Notes**: Organize message notes with serial-numbered blocks, headings, bullet lists, and reflection points.
- **Inline Multi-Version Scripture Cards**: Attach scripture citations directly into message blocks across any installed Bible translation.
- **Preacher & Date Metadata**: Filter and find past sermons quickly by speaker, topic, or date.

### 5. Real-Time Reading Progress Tracker
- **Canonical Book & Chapter Tracking**: Mark chapters or individual verses as read directly from the reader or progress grid.
- **Dynamic OT / NT Completion**: Live visual progress bars showing your Old Testament, New Testament, and whole-Bible completion percentages.
- **Verse-Aware Chapter Grids**: Instant 0ms optimistic chapter toggles powered by synchronous SQLite indexing.

### 6. DCIM Backup & Restore
- **Organized JSON Backups**: Full journal exports saved directly under `DCIM/SelahBible/<YYYY-MM-DD>/SelahBible_Backup_<YYYY-MM-DD>_<HH-mm-ss>.json`.
- **4-Stage Sandbox-Safe Reader**: Reliable restore pipeline (`fetch(uri)` → `XMLHttpRequest` → `StorageAccessFramework` → `FileSystem`) that overcomes Android SAF and content URI sandbox restrictions.
- **Zero Data Lock-in**: Your data belongs to you—export, backup, and restore anytime.

---

## 🏗️ Architecture & Directory Structure

```text
selah-bible/
├── android/                   # Native Android project (continuous native generation)
├── assets/                    # Icons, adaptive icons, splashes & bundled Bible database
│   ├── bibles/
│   │   └── tamil_bsi.json     # Bundled 66-book Tamil BSI Bible
│   ├── images/
│   │   └── selah-bible-icon.svg
│   ├── android-icon-*.png
│   └── icon.png
├── src/
│   ├── app/                   # Expo Router navigators and screen routes
│   │   ├── _layout.tsx        # Root navigator & ThemeProvider
│   │   └── (tabs)/
│   │       ├── index.tsx      # Tab 1: Bible Reader & Verse Viewer
│   │       ├── highlights.tsx # Tab 2: Verse Highlights Manager
│   │       ├── messages.tsx   # Tab 3: Preached Messages Notebook
│   │       ├── daily-walk.tsx # Tab 4: Daily Walk Spiritual Journal
│   │       ├── progress.tsx   # Tab 5: 66-Book Reading Progress Tracker
│   │       └── bibles.tsx     # Tab 6: Bible Library, Downloader & Backups
│   ├── components/            # Reusable UI components
│   │   ├── AppHeader.tsx      # Universal top navigation bar
│   │   ├── ScalePressable.tsx # Smooth-touch micro-interaction wrapper
│   │   └── SvgIcons.tsx       # Vector icon collection
│   ├── constants/             # App themes, colors & Bible book metadata
│   │   ├── books.ts           # 66 Bible books with multilingual name mappings
│   │   ├── colors.ts          # Minimal 5-color highlight palette & dark/light themes
│   │   ├── ThemeContext.tsx   # React Theme Context
│   │   └── versionCatalog.ts  # Downloadable catalog & API search helper
│   └── db/                    # Local storage & SQLite database layer
│       ├── database.ts        # user_journal.db schema & queries
│       ├── bibleLoader.ts     # Offline Bible storage & JSON parser
│       └── backupManager.ts   # DCIM JSON export & 4-stage SAF restore engine
├── app.json                   # Expo application configuration
├── package.json               # Dependencies and build scripts
└── tsconfig.json              # TypeScript configuration
```

---

## 🛠️ Local Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [npm](https://www.npmjs.com/) or [bun](https://bun.sh/)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [Android Studio](https://developer.android.com/studio) (for native Android builds)

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/rinesh-df/selah-bible.git
   cd selah-bible
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npx expo start -c
   ```
   Press `a` to open in Android Emulator or scan the QR code with the Expo Go app.

---

## 📦 Building the Standalone Release APK Locally

To build a standalone production APK on your machine:

1. **Generate native Android project files:**
   ```bash
   npx expo prebuild --platform android
   ```

2. **Compile the release APK using Gradle:**
   - **On Windows (PowerShell):**
     ```powershell
     cd android
     .\gradlew.bat assembleRelease
     cd ..
     ```
   - **On macOS / Linux (Bash):**
     ```bash
     cd android
     ./gradlew assembleRelease
     cd ..
     ```

3. **Locate the generated APK:**
   The compiled APK will be created at:
   `android/app/build/outputs/apk/release/app-release.apk`

---

## 🤝 Contributing

Contributions, bug reports, and feature suggestions are warmly welcomed! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) guide for details on our code style, TypeScript checks, and pull request workflow.

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

Copyright (c) 2026 **Rinesh D F**.
