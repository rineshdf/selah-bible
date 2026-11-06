# Changelog

All notable changes to **Selah Bible** are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] — 2026-11-06

### Added
- **Daily Walk — Rewind Past Days**: every Rewind card now shows its section's
  symmetrical vector icon in a uniform badge (replacing raw emoji tags), and
  Prayer cards display an **Answered / Not Answered** status pill with the
  exact date, plus a subtle `Requested → Answered` timeline footer on answered
  prayers.
- **Prayer timeline tracking**: new `answered_at` column on `prayer_points`
  stores the `YYYY-MM-DD` date a request was marked answered (mirrors
  `answered_date`), and is included in backups/restore.
- Structured scripture rendering (`VerseRows`): per-verse numbered badge rows
  everywhere scripture text is shown, including Rewind verse blocks.

### Changed
- Redesigned the four Daily Walk section icons (Rhema star, open-book
  Devotion, Heart-to-God worship, Prayer Points tablet) as mathematically
  symmetrical vectors, aligned in identical 32×32 rounded badges.
- Highlights full-chapter reader modal: removed the dead gap above the header
  on Android by drawing the modal below the status bar (`statusBarTranslucent`
  false) with tight header padding; audited every other modal for the same
  issue.
- Selah-themed app icon, adaptive monochrome icon, splash assets and
  launcher icons refreshed; splash background unified to `#0F172A`.
- 5-color pastel highlight palette now available across all four Daily Walk
  sections and Rewind archives; `prayer_points.color` and `daily_entries`
  verse attachments persist highlight colors and scripture notes.
- Reading progress screen: compact version dropdown with animated chevron;
  Bibles header backup button no longer overlaps the title; modal header
  insets polished app-wide.

### Fixed
- Section headings in Daily Walk accordion sections no longer clip.
- Verse notes and scripture blocks inside Rewind render with correct spacing
  and structured verse rows instead of one unreadable blob.
