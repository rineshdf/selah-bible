/**
 * Tab 6: Bible Library manager.
 *
 * "Installed on Device" lists every version registered in
 * `@installed_bible_versions_v2` (language tag, full title, Use / Active, ✕
 * delete). Below it, "Available Bibles" shows the popular catalog by default
 * and synchronously filters the merged catalog (`POPULAR_BIBLE_VERSIONS` +
 * the one-flight `bibles/_catalog_cache.json`) whenever the user types — no
 * debounced network search. The header carries a Backup pill opening the
 * export/restore sheet.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import type { AppTheme } from '@/constants/colors';
import {
  POPULAR_BIBLE_VERSIONS,
  filterVersions,
  groupVersionsByLanguage,
  getMergedCatalogVersions,
  type DownloadableVersion,
} from '@/constants/versionCatalog';
import {
  deleteBibleVersion,
  downloadBibleVersion,
  getActiveVersionId,
  getInstalledVersions,
  isVersionDownloaded,
  normalizeVersionId,
  setActiveVersionId,
  TAMIL_BSI_ID,
  type BibleVersionMeta,
} from '@/db/bibleLoader';
import {
  exportBackup,
  listLocalBackups,
  restoreBackupFromPicker,
  restoreBackupFromUri,
  type SavedBackupItem,
} from '@/db/backupManager';
import AppHeader from '@/components/AppHeader';
import { ScalePressable } from '@/components/ScalePressable';
import { BackupCloudSvg } from '@/components/SvgIcons';

type VersionRow =
  | { kind: 'section'; key: string; label: string; totalCount?: number; onExpandAll?: () => void; onCollapseAll?: () => void }
  | { kind: 'group'; key: string; label: string; count: number; groupKey: string }
  | { kind: 'installed-group'; key: string; label: string; count: number; groupKey: string }
  | { kind: 'installed'; key: string; meta: BibleVersionMeta; active: boolean }
  | { kind: 'version'; key: string; version: DownloadableVersion }
  | { kind: 'empty'; key: string; label: string };

/** Normalize `Tamil (தமிழ்)` -> `tamil` so one language is one group. */
function languageGroupKey(language: string | undefined): string {
  const base = (language ?? '').split('(')[0].trim();
  return (base || 'unknown').toLowerCase();
}

interface LibraryRowProps {
  item: VersionRow;
  styles: ReturnType<typeof makeStyles>;
  activeId: string;
  downloaded: Record<string, boolean>;
  progress: Record<string, number>;
  expandedAvailableLangs: Record<string, boolean>;
  onToggleGroup: (groupKey: string) => void;
  onToggleInstalledGroup: (groupKey: string) => void;
  onSwitch: (versionId: string) => void;
  onDelete: (meta: BibleVersionMeta) => void;
  onDownload: (version: DownloadableVersion) => void;
  /** Busy-button spinner/text accent from the active theme (primitive). */
  accent: string;
}

/**
 * Memoized library row: section heading, collapsible language header,
 * installed-version card or catalog card. Unchanged rows are skipped by the
 * FlatList whenever another row's download percent ticks.
 */
const LibraryRow = memo(function LibraryRow({
  item,
  styles,
  activeId,
  downloaded,
  progress,
  expandedAvailableLangs,
  onToggleGroup,
  onToggleInstalledGroup,
  onSwitch,
  onDelete,
  onDownload,
  accent,
}: LibraryRowProps) {
  if (item.kind === 'section') {
    return (
      <View style={styles.sectionHeading}>
        <View style={styles.sectionHeadingRow}>
          <Text style={styles.sectionHeadingText}>{item.label}</Text>
          {item.totalCount !== undefined && (
            <View style={styles.sectionCountBadge}>
              <Text style={styles.sectionCountBadgeText}>{item.totalCount}</Text>
            </View>
          )}
          {item.onExpandAll || item.onCollapseAll ? (
            <View style={styles.sectionActions}>
              {item.onExpandAll && (
                <ScalePressable
                  style={styles.expandAllPill}
                  onPress={item.onExpandAll}
                  accessibilityRole="button"
                  accessibilityLabel="Expand all language groups"
                >
                  <Text style={styles.expandAllPillText}>Expand All</Text>
                </ScalePressable>
              )}
              {item.onCollapseAll && (
                <ScalePressable
                  style={styles.collapseAllPill}
                  onPress={item.onCollapseAll}
                  accessibilityRole="button"
                  accessibilityLabel="Collapse all language groups"
                >
                  <Text style={styles.collapseAllPillText}>Collapse All</Text>
                </ScalePressable>
              )}
            </View>
          ) : null}
        </View>
      </View>
    );
  }
  if (item.kind === 'empty') {
    return <Text style={styles.emptyText}>{item.label}</Text>;
  }
  if (item.kind === 'installed-group') {
    const isCollapsed = Boolean(expandedAvailableLangs[item.groupKey] === false);
    return (
      <ScalePressable
        style={styles.installedGroupHeader}
        onPress={() => onToggleInstalledGroup(item.groupKey)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !isCollapsed }}
        accessibilityLabel={`${!isCollapsed ? 'Collapse' : 'Expand'} ${item.label}`}
      >
        <Text numberOfLines={1} style={styles.installedGroupTitle}>{item.label}</Text>
        <View style={styles.groupHeaderRight}>
          <View style={styles.installedGroupBadge}>
            <Text style={styles.installedGroupBadgeText}>{item.count}</Text>
          </View>
          <Text style={styles.groupChevron}>{!isCollapsed ? '▾' : '▸'}</Text>
        </View>
      </ScalePressable>
    );
  }
  if (item.kind === 'group') {
    const isCollapsed = Boolean(expandedAvailableLangs[item.groupKey] === false);
    return (
      <ScalePressable
        style={styles.languageHeader}
        onPress={() => onToggleGroup(item.groupKey)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !isCollapsed }}
        accessibilityLabel={`${!isCollapsed ? 'Collapse' : 'Expand'} ${item.label}`}
      >
        <Text numberOfLines={1} style={styles.languageHeaderText}>{item.label}</Text>
        <View style={styles.groupHeaderRight}>
          <View style={styles.languageGroupBadge}>
            <Text style={styles.languageGroupBadgeText}>{item.count}</Text>
          </View>
          <Text style={styles.groupChevron}>{!isCollapsed ? '▾' : '▸'}</Text>
        </View>
      </ScalePressable>
    );
  }

  if (item.kind === 'installed') {
    const { meta, active } = item;
    const isBundled = normalizeVersionId(meta.id) === TAMIL_BSI_ID;
    return (
      <View style={styles.versionCard}>
        <View style={styles.installedRow}>
          {/* FIX 1 — title + short code on the left, actions right-aligned. */}
          <View style={styles.installedInfo}>
            <Text style={styles.installedTitle} numberOfLines={2}>{meta.name}</Text>
            <Text numberOfLines={1} style={styles.installedCode}>
              {meta.shortName}
              {isBundled ? ' · Included' : ''}
            </Text>
          </View>
          <View style={styles.installedActions}>
            {active ? (
              <View style={styles.activeChip}>
                <Text style={styles.activeChipText}>Active ✓</Text>
              </View>
            ) : (
              <ScalePressable
                style={styles.useChip}
                onPress={() => onSwitch(meta.id)}
                accessibilityRole="button"
                accessibilityLabel={`Read with ${meta.shortName}`}
              >
                <Text style={styles.useChipText}>Use</Text>
              </ScalePressable>
            )}
            {!isBundled ? (
              <ScalePressable
                style={styles.deleteXButton}
                onPress={() => onDelete(meta)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${meta.shortName}`}
              >
                <Text style={styles.deleteXText}>✕</Text>
              </ScalePressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const version = item.version;
  const isActive = normalizeVersionId(activeId) === normalizeVersionId(version.id);
  const isDownloaded = downloaded[version.id] === true;
  const percent = progress[version.id];
  return (
    <View style={styles.versionCard}>
      <View style={styles.versionHeader}>
        <View style={styles.versionMeta}>
          <Text style={styles.versionName} numberOfLines={2}>{version.name}</Text>
          <Text style={styles.versionSub}>
            {version.languageName} · {version.shortName}{version.source === 'bundled' ? ' · Included' : ''}
          </Text>
        </View>
        {isActive ? <Text style={styles.activeBadgeText}>Active ✓</Text> : null}
      </View>
      {percent !== undefined ? (
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{percent}%</Text>
        </View>
      ) : null}
      <View style={styles.actionRow}>
        {isDownloaded ? (
          <>
            {!isActive ? (
              <ScalePressable
                style={[styles.actionButton, styles.switchButton]}
                onPress={() => onSwitch(version.id)}
                accessibilityRole="button"
              >
                <Text style={styles.switchText}>Use this Bible</Text>
              </ScalePressable>
            ) : null}
            <Text style={styles.installedText}>On this device</Text>
          </>
        ) : (
          <ScalePressable
            style={[styles.actionButton, styles.downloadButton, percent !== undefined ? styles.buttonBusy : null]}
            onPress={() => onDownload(version)}
            disabled={percent !== undefined}
            accessibilityRole="button"
            accessibilityLabel={`Download ${version.shortName}`}
          >
            {percent !== undefined ? <ActivityIndicator size="small" color={accent} /> : null}
            <Text style={styles.downloadText}>{percent !== undefined ? 'Downloading…' : 'Download'}</Text>
          </ScalePressable>
        )}
      </View>
    </View>
  );
});

export default function BiblesScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  /**
   * Guaranteed top inset for the Backup & Restore <Modal>. Android
   * edge-to-edge can draw the floating card under the status bar and camera
   * cutout, so the backdrop never lets it rise above the platform status bar
   * height + a 36px floor.
   */
  const topModalInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0,
    36,
  );

  const [backupOpen, setBackupOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<DownloadableVersion[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [activeId, setActive] = useState('');
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [installedMetas, setInstalledMetas] = useState<BibleVersionMeta[]>([]);
  const [backupBusy, setBackupBusy] = useState<string | null>(null);
  const [lastSavedBackupPath, setLastSavedBackupPath] = useState<{
    dateFolder: string;
    fileName: string;
    displayPath: string;
  } | null>(null);
  const [savedBackups, setSavedBackups] = useState<SavedBackupItem[]>([]);
  const [loadingSavedBackups, setLoadingSavedBackups] = useState(false);
  const [expandedAvailableLangs, setExpandedAvailableLangs] = useState<Record<string, boolean>>({});

  const refreshSavedBackups = useCallback(async () => {
    setLoadingSavedBackups(true);
    try {
      const list = await listLocalBackups();
      setSavedBackups(list);
    } catch {
      setSavedBackups([]);
    } finally {
      setLoadingSavedBackups(false);
    }
  }, []);

  useEffect(() => {
    if (!backupOpen) return;
    const timer = setTimeout(() => {
      void refreshSavedBackups();
    }, 0);
    return () => clearTimeout(timer);
  }, [backupOpen, refreshSavedBackups]);

  /** One-flight fetch of the merged catalog (popular + online, deduped). */
  useEffect(() => {
    const timer = setTimeout(() => {
      void getMergedCatalogVersions()
        .then((versions) => setCatalog(versions))
        .catch(() => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const refresh = useCallback(async () => {
    setActive(await getActiveVersionId());
    const metas = await getInstalledVersions();
    setInstalledMetas(metas);
    const downloadedMap: Record<string, boolean> = {};
    await Promise.all(
      [...POPULAR_BIBLE_VERSIONS.map((version) => version.id), ...metas.map((meta) => meta.id)]
        .map(async (id) => {
          downloadedMap[id] = await isVersionDownloaded(id);
        }),
    );
    setDownloaded(downloadedMap);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  /** Popular catalog first, then the online catalog — deduped by version id. */
  const searchSource = useMemo<DownloadableVersion[]>(() => {
    const byId = new Map<string, DownloadableVersion>();
    for (const version of [...POPULAR_BIBLE_VERSIONS, ...catalog]) {
      const key = normalizeVersionId(version.id);
      if (!byId.has(key)) byId.set(key, version);
    }
    return [...byId.values()];
  }, [catalog]);

  // Expand/Collapse all for installed groups - toggles keys in the single
  // expandedAvailableLangs state object (true = expanded, false = collapsed).
  const expandAllInstalled = useCallback(() => {
    setExpandedAvailableLangs((previous) => {
      const next = { ...previous };
      for (const meta of installedMetas) {
        const key = `installed-group:${languageGroupKey(meta.language)}`;
        next[key] = true;
      }
      return next;
    });
  }, [installedMetas]);

  const collapseAllInstalled = useCallback(() => {
    setExpandedAvailableLangs((previous) => {
      const next = { ...previous };
      for (const meta of installedMetas) {
        const key = `installed-group:${languageGroupKey(meta.language)}`;
        next[key] = false;
      }
      return next;
    });
  }, [installedMetas]);

  // Expand/Collapse all for available groups. Expand All builds `next` from
  // the displayed available groups (all true); Collapse All clears them.
  const expandAllAvailable = useCallback(() => {
    setExpandedAvailableLangs((previous) => {
      const installedIds = new Set(installedMetas.map((meta) => normalizeVersionId(meta.id)));
      const source = query.trim() ? filterVersions(query.trim(), searchSource) : POPULAR_BIBLE_VERSIONS;
      const matchingAvailable = source.filter((version) => !installedIds.has(normalizeVersionId(version.id)));
      const availableGroups = groupVersionsByLanguage(matchingAvailable);
      const next = { ...previous };
      availableGroups.forEach((group) => {
        next[group.language.trim()] = true;
      });
      return next;
    });
  }, [installedMetas, query, searchSource]);

  const collapseAllAvailable = useCallback(() => {
    setExpandedAvailableLangs((previous) => {
      const installedIds = new Set(installedMetas.map((meta) => normalizeVersionId(meta.id)));
      const source = query.trim() ? filterVersions(query.trim(), searchSource) : POPULAR_BIBLE_VERSIONS;
      const matchingAvailable = source.filter((version) => !installedIds.has(normalizeVersionId(version.id)));
      const availableGroups = groupVersionsByLanguage(matchingAvailable);
      const next = { ...previous };
      availableGroups.forEach((group) => {
        delete next[group.language.trim()];
      });
      return next;
    });
  }, [installedMetas, query, searchSource]);

  // Auto-expand available groups when searching; reset available expansion
  // when the search is cleared. Deferred via setTimeout so the state update
  // isn't synchronous in the effect body (avoids cascading renders).
  useEffect(() => {
    const timer = setTimeout(() => {
      const normalizedQuery = query.trim();
      if (!normalizedQuery.length) {
        setExpandedAvailableLangs({});
        return;
      }
      setExpandedAvailableLangs((previous) => {
        const installedIds = new Set(installedMetas.map((meta) => normalizeVersionId(meta.id)));
        const source = filterVersions(normalizedQuery, searchSource);
        const matchingAvailable = source.filter((version) => !installedIds.has(normalizeVersionId(version.id)));
        const availableGroups = groupVersionsByLanguage(matchingAvailable);
        const next = { ...previous };
        availableGroups.forEach((group) => {
          next[group.language.trim()] = true;
        });
        return next;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [query, installedMetas, searchSource]);

  const rows = useMemo<VersionRow[]>(() => {
    const rows: VersionRow[] = [];
    const normalizedQuery = query.trim();
    const isSearching = normalizedQuery.length > 0;

    // Installed on Device section
    const installedGroups = new Map<string, { label: string; metas: BibleVersionMeta[] }>();
    for (const meta of installedMetas) {
      const key = languageGroupKey(meta.language);
      const group = installedGroups.get(key);
      if (group) {
        group.metas.push(meta);
      } else {
        installedGroups.set(key, { label: meta.language?.trim() || 'Unknown', metas: [meta] });
      }
    }
    const activeNormalized = normalizeVersionId(activeId);
    const activeMeta = installedMetas.find(
      (meta) => normalizeVersionId(meta.id) === activeNormalized,
    );
    const activeLanguageKey = languageGroupKey(
      activeMeta?.language?.trim() || 'Tamil',
    );
    const orderedInstalledGroups = [...installedGroups.entries()].sort(([keyA], [keyB]) => {
      if (keyA === activeLanguageKey && keyB !== activeLanguageKey) return -1;
      if (keyB === activeLanguageKey && keyA !== activeLanguageKey) return 1;
      return keyA.localeCompare(keyB);
    });

    rows.push({
      kind: 'section',
      key: 'installed-section',
      label: 'Installed on Device',
      totalCount: installedMetas.length,
      onExpandAll: expandAllInstalled,
      onCollapseAll: collapseAllInstalled,
    });

    if (installedMetas.length === 0) {
      rows.push({
        kind: 'empty',
        key: 'installed-empty',
        label: 'The Tamil BSI ships pre-installed with the app.',
      });
    } else {
      for (const [languageKey, group] of orderedInstalledGroups) {
        const groupKey = `installed-group:${languageKey}`;
        rows.push({
          kind: 'installed-group',
          key: groupKey,
          groupKey,
          label: group.label,
          count: group.metas.length,
        });
        const isCollapsed = Boolean(expandedAvailableLangs[groupKey] === false);
        if (isCollapsed) continue;
        for (const meta of group.metas) {
          rows.push({
            kind: 'installed',
            key: `installed:${meta.id}`,
            meta,
            active: normalizeVersionId(meta.id) === activeNormalized,
          });
        }
      }
    }

    // Available Bibles / Search Results section
    const installedIds = new Set(installedMetas.map((meta) => normalizeVersionId(meta.id)));
    const source = isSearching ? filterVersions(normalizedQuery, searchSource) : POPULAR_BIBLE_VERSIONS;
    const matchingAvailable = source.filter((version) => !installedIds.has(normalizeVersionId(version.id)));
    const availableGroups = groupVersionsByLanguage(matchingAvailable);

    const sectionLabel = isSearching ? `Search Results (${matchingAvailable.length})` : 'Available Bibles';
    rows.push({
      kind: 'section',
      key: 'available-section',
      label: sectionLabel,
      onExpandAll: availableGroups.length > 0 ? expandAllAvailable : undefined,
      onCollapseAll: availableGroups.length > 0 ? collapseAllAvailable : undefined,
    });

    if (availableGroups.length === 0) {
      rows.push({
        kind: 'empty',
        key: 'available-empty',
        label: isSearching ? 'No other Bibles match your search.' : 'No other Bibles are available right now.',
      });
    }
    for (const group of availableGroups) {
      const groupKey = group.language.trim();
      rows.push({
        kind: 'group',
        key: groupKey,
        groupKey,
        label: group.label,
        count: group.versions.length,
      });
      if (!!expandedAvailableLangs[groupKey] === false) continue;
      for (const version of group.versions) {
        rows.push({ kind: 'version', key: `${groupKey}:${version.id}`, version });
      }
    }
    return rows;
  }, [
    activeId,
    expandedAvailableLangs,
    installedMetas,
    query,
    searchSource,
    expandAllInstalled,
    collapseAllInstalled,
    expandAllAvailable,
    collapseAllAvailable,
  ]);

  const handleDownload = useCallback(async (version: DownloadableVersion) => {
    if (progress[version.id] !== undefined) return;
    setProgress((previous) => ({ ...previous, [version.id]: 0 }));
    try {
      await downloadBibleVersion(version, (event) => {
        setProgress((previous) => ({
          ...previous,
          [version.id]: Math.max(previous[version.id] ?? 0, event.percent),
        }));
      });
      // Flip the row's state immediately (no spinner flicker) while `refresh`
      // re-verifies the installed list from disk.
      setDownloaded((previous) => ({ ...previous, [version.id]: true }));
      await refresh();
    } catch (error) {
      Alert.alert('Download failed', error instanceof Error ? error.message : `Could not download ${version.shortName}.`);
    } finally {
      setProgress((previous) => {
        const next = { ...previous };
        delete next[version.id];
        return next;
      });
    }
  }, [progress, refresh]);

  const handleSwitch = useCallback(async (versionId: string) => {
    await setActiveVersionId(versionId);
    setActive(await getActiveVersionId());
  }, []);

  const handleDelete = useCallback((meta: BibleVersionMeta) => {
    Alert.alert(
      'Delete Bible',
      `Remove the downloaded copy of “${meta.shortName}”? You can download it again anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteBibleVersion(meta.id)
              .then(() => refresh())
              .catch((error: unknown) => {
                Alert.alert('Delete failed', error instanceof Error ? error.message : 'Could not delete this Bible.');
              });
          },
        },
      ],
    );
  }, [refresh]);

  const handleExportBackup = useCallback(async () => {
    setBackupBusy('export');
    try {
      const res = await exportBackup();
      setLastSavedBackupPath({
        dateFolder: res.dateFolder,
        fileName: res.fileName,
        displayPath: res.displayPath,
      });
      Alert.alert('Backup Saved', `Saved in:\nDCIM/SelahBible/${res.dateFolder}/${res.fileName}`);
      void refreshSavedBackups();
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not create the backup file.');
    } finally {
      setBackupBusy(null);
    }
  }, [refreshSavedBackups]);

  const handleRestoreBackup = useCallback(async () => {
    setBackupBusy('restore');
    try {
      const result = await restoreBackupFromPicker();
      if (result) {
        Alert.alert('Backup restored', `${result.total} saved items restored.`);
        void refreshSavedBackups();
        void refresh();
      }
    } catch (error) {
      Alert.alert('Restore failed', error instanceof Error ? error.message : 'Could not restore the backup.');
    } finally {
      setBackupBusy(null);
    }
  }, [refresh, refreshSavedBackups]);

  const handleRestoreSavedItem = useCallback((item: SavedBackupItem) => {
    Alert.alert(
      'Restore Backup',
      `Restore all saved items from "${item.fileName}"?\n\nThis will restore your highlights, messages, daily walk entries, and reading progress.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: () => {
            void (async () => {
              setBackupBusy(`restore_${item.uri}`);
              try {
                const result = await restoreBackupFromUri(item.uri);
                Alert.alert('Backup restored', `${result.total} saved items restored.`);
                void refreshSavedBackups();
                void refresh();
              } catch (error) {
                Alert.alert('Restore failed', error instanceof Error ? error.message : 'Could not restore the backup.');
              } finally {
                setBackupBusy(null);
              }
            })();
          },
        },
      ],
    );
  }, [refresh, refreshSavedBackups]);

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedAvailableLangs((previous) => ({ ...previous, [groupKey]: !previous[groupKey] }));
  }, []);

  const toggleInstalledGroup = useCallback((groupKey: string) => {
    setExpandedAvailableLangs((previous) => ({ ...previous, [groupKey]: !previous[groupKey] }));
  }, []);

  /** Rows feed the memoized `LibraryRow`; every prop stays a stable ref. */
  const renderItem = useCallback(({ item }: { item: VersionRow }) => (
    <LibraryRow
      item={item}
      styles={styles}
      activeId={activeId}
      downloaded={downloaded}
      progress={progress}
      expandedAvailableLangs={expandedAvailableLangs}
      onToggleGroup={toggleGroup}
      onToggleInstalledGroup={toggleInstalledGroup}
      onSwitch={handleSwitch}
      onDelete={handleDelete}
      onDownload={handleDownload}
      accent={theme.primaryForeground}
    />
  ), [activeId, downloaded, expandedAvailableLangs, handleDelete, handleDownload, handleSwitch, progress, styles, theme.primaryForeground, toggleGroup, toggleInstalledGroup]);

  /** Stable row keys across version/status changes. */
  const rowKey = useCallback((item: VersionRow) => item.key, []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <AppHeader
        title="Bible Library"
        right={(
          <ScalePressable
            style={styles.backupPill}
            onPress={() => setBackupOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open backup and restore"
          >
            <BackupCloudSvg size={18} color={theme.primary} />
            <Text style={styles.backupPillText}>Backup</Text>
          </ScalePressable>
        )}
      />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        extraData={expandedAvailableLangs}
        keyExtractor={rowKey}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        ListHeaderComponent={(
          <View style={styles.searchWrapper}>
            <View style={styles.searchInputRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by language or Bible name…"
                placeholderTextColor={theme.textMuted}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <Pressable
                  style={styles.searchClearBtn}
                  onPress={() => setQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.searchClearText}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No Bibles match your search.</Text>}
        renderItem={renderItem}
      />
      <Modal visible={backupOpen} transparent animationType="fade" onRequestClose={() => setBackupOpen(false)}>
        <View style={[styles.modalBackdrop, { paddingTop: Math.max(22, topModalInset) }]}>
          <View style={styles.backupModal}>
            <View style={styles.modalHeading}>
              <BackupCloudSvg size={24} color={theme.primary} />
              <Text style={styles.modalTitle}>Backup & Restore</Text>
            </View>
            <Text style={styles.modalHint}>Keep a copy of your highlights, messages, journal entries, and reading progress.</Text>
            <ScrollView
              style={styles.backupModalScroll}
              contentContainerStyle={styles.backupModalScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {lastSavedBackupPath ? (
                <View style={styles.savedConfirmationCard}>
                  <Text style={styles.savedConfirmationTitle}>✓ Backup Saved Successfully</Text>
                  <Text style={styles.savedConfirmationDetail}>
                    <Text style={styles.savedConfirmationLabel}>Folder: </Text>
                    DCIM / SelahBible / {lastSavedBackupPath.dateFolder}
                  </Text>
                  <Text style={styles.savedConfirmationDetail}>
                    <Text style={styles.savedConfirmationLabel}>File: </Text>
                    {lastSavedBackupPath.fileName}
                  </Text>
                </View>
              ) : null}

              <ScalePressable
                style={[styles.backupButton, styles.exportButton]}
                onPress={() => void handleExportBackup()}
                disabled={backupBusy !== null}
                accessibilityRole="button"
                accessibilityLabel="Save Backup to DCIM"
              >
                {backupBusy === 'export' ? (
                  <ActivityIndicator size="small" color={theme.primaryForeground} />
                ) : (
                  <Text style={styles.exportButtonText}>Save Backup to DCIM</Text>
                )}
              </ScalePressable>

              <ScalePressable
                style={styles.backupButton}
                onPress={() => void handleRestoreBackup()}
                disabled={backupBusy !== null}
                accessibilityRole="button"
                accessibilityLabel="Browse File from Storage (DCIM)"
              >
                {backupBusy === 'restore' ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Text style={styles.restoreButtonText}>Browse File from Storage (DCIM)</Text>
                )}
              </ScalePressable>

              <View style={styles.savedBackupsSection}>
                <Text style={styles.savedBackupsHeader}>Saved Backups on Device</Text>
                {loadingSavedBackups ? (
                  <ActivityIndicator size="small" color={theme.primary} style={styles.savedBackupsSpinner} />
                ) : savedBackups.length === 0 ? (
                  <Text style={styles.noBackupsText}>No previous backups found in SelahBible folder.</Text>
                ) : (
                  <View style={styles.savedBackupsList}>
                    {savedBackups.map((item) => {
                      const isRestoring = backupBusy === `restore_${item.uri}`;
                      return (
                        <View key={item.uri} style={styles.savedBackupRow}>
                          <View style={styles.savedBackupMeta}>
                            <Text numberOfLines={1} style={styles.savedBackupFilename}>
                              {item.fileName}
                            </Text>
                            <Text style={styles.savedBackupDate}>
                              {item.dateFolder ? `Folder: ${item.dateFolder}` : 'SelahBible'}
                            </Text>
                          </View>
                          <ScalePressable
                            style={styles.savedBackupRestoreBtn}
                            onPress={() => handleRestoreSavedItem(item)}
                            disabled={backupBusy !== null}
                            accessibilityRole="button"
                            accessibilityLabel={`Restore ${item.fileName}`}
                          >
                            {isRestoring ? (
                              <ActivityIndicator size="small" color={theme.primaryForeground} />
                            ) : (
                              <Text style={styles.savedBackupRestoreText}>Restore</Text>
                            )}
                          </ScalePressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScrollView>

            <Pressable style={styles.modalClose} onPress={() => setBackupOpen(false)} accessibilityRole="button">
              <Text style={styles.modalCloseText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    list: { flex: 1 },
    listContent: { paddingHorizontal: 16, paddingBottom: 32 },
    backupPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      marginRight: 12,
      backgroundColor: theme.surfaceMuted,
    },
    backupPillText: { color: theme.primary, fontSize: 13, fontWeight: '700' },
    searchWrapper: { marginTop: 10 },
    searchInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      paddingHorizontal: 10,
      minHeight: 44,
    },
    searchInput: {
      flex: 1,
      color: theme.text,
      paddingVertical: 10,
      paddingHorizontal: 4,
      fontSize: 15,
    },
    searchClearBtn: {
      padding: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    searchClearText: {
      color: theme.textMuted,
      fontSize: 14,
      fontWeight: '700',
    },
    // Section heading with optional count badge and expand/collapse all actions
    sectionHeading: { marginTop: 18, marginBottom: 4 },
    sectionHeadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    sectionHeadingText: { color: theme.text, fontSize: 17, fontWeight: '800', flex: 1 },
    sectionCountBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    sectionCountBadgeText: { color: theme.primaryForeground, fontSize: 11, fontWeight: '800' },
    sectionActions: { flexDirection: 'row', gap: 6, flexShrink: 0 },
    expandAllPill: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    expandAllPillText: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    collapseAllPill: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    collapseAllPillText: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    // FIX 1 — installed language group header with its count badge and chevron.
    installedGroupHeader: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingHorizontal: 4,
      marginTop: 8,
      marginBottom: 6,
    },
    installedGroupTitle: {
      flex: 1,
      color: theme.primary,
      fontSize: 15,
      fontWeight: '800',
    },
    groupHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
    },
    installedGroupBadge: {
      minWidth: 24,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    installedGroupBadgeText: { color: theme.primary, fontSize: 12, fontWeight: '800' },
    groupChevron: { color: theme.primary, fontSize: 15, fontWeight: '700' },
    languageHeader: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    languageHeaderText: {
      flex: 1,
      color: theme.primary,
      fontSize: 15,
      fontWeight: '800',
    },
    languageGroupBadge: {
      minWidth: 24,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    languageGroupBadgeText: { color: theme.primary, fontSize: 12, fontWeight: '800' },
    versionCard: {
      marginTop: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      gap: 10,
    },
    // FIX 1 — installed card: text block left, action pills right.
    installedRow: { flexDirection: 'row', alignItems: 'center' },
    installedInfo: { flex: 1, paddingRight: 10, gap: 3 },
    installedTitle: { color: theme.text, fontSize: 16, fontWeight: '600', lineHeight: 21 },
    installedCode: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
    installedActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      flexShrink: 0,
    },
    activeChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: '#16A34A',
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    activeChipText: { color: '#16A34A', fontSize: 12, fontWeight: '700' },
    versionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    versionMeta: { flex: 1, gap: 2 },
    useChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    useChipText: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    activeBadgeText: { color: '#16A34A', fontSize: 12, fontWeight: '700' },
    versionName: { color: theme.text, fontSize: 16, fontWeight: '600', lineHeight: 21 },
    versionSub: { color: theme.textMuted, fontSize: 13, flex: 1 },
    installedText: { color: '#16A34A', fontSize: 13, fontWeight: '700', alignSelf: 'center' },
    deleteXButton: {
      width: 30,
      height: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteXText: { color: '#DC2626', fontSize: 14, fontWeight: '700', lineHeight: 16 },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    progressTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.surfaceMuted, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: theme.primary },
    progressLabel: { width: 44, textAlign: 'right', color: theme.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    actionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, minHeight: 36 },
    buttonBusy: { opacity: 0.7 },
    downloadButton: { backgroundColor: theme.primary },
    downloadText: { color: theme.primaryForeground, fontWeight: '600', fontSize: 14 },
    switchButton: { backgroundColor: theme.surfaceMuted },
    switchText: { color: theme.primary, fontWeight: '600', fontSize: 14 },
    emptyText: { marginTop: 24, textAlign: 'center', color: theme.textMuted, fontSize: 14 },
    modalBackdrop: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: 'rgba(0,0,0,0.48)' },
    backupModal: {
      borderRadius: 18,
      padding: 18,
      gap: 10,
      backgroundColor: theme.surface,
      maxHeight: '86%',
    },
    modalHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    modalTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
    modalHint: { color: theme.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 2 },
    backupModalScroll: {
      flexGrow: 0,
      maxHeight: 380,
    },
    backupModalScrollContent: {
      gap: 10,
      paddingBottom: 4,
    },
    savedConfirmationCard: {
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: '#10B981',
      backgroundColor: theme.isDark ? 'rgba(16, 185, 129, 0.16)' : '#ECFDF5',
      gap: 3,
      marginBottom: 2,
    },
    savedConfirmationTitle: {
      color: '#059669',
      fontSize: 13.5,
      fontWeight: '800',
      marginBottom: 2,
    },
    savedConfirmationDetail: {
      color: theme.text,
      fontSize: 12,
      lineHeight: 17,
    },
    savedConfirmationLabel: {
      fontWeight: '700',
      color: theme.textMuted,
    },
    backupButton: {
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    exportButton: { backgroundColor: theme.primary, borderColor: 'transparent' },
    exportButtonText: { color: theme.primaryForeground, fontWeight: '700', fontSize: 14 },
    restoreButtonText: { color: theme.primary, fontWeight: '700', fontSize: 14 },
    savedBackupsSection: {
      marginTop: 6,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      gap: 8,
    },
    savedBackupsHeader: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '700',
    },
    savedBackupsSpinner: {
      marginVertical: 10,
    },
    noBackupsText: {
      color: theme.textMuted,
      fontSize: 12,
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 6,
    },
    savedBackupsList: {
      gap: 8,
    },
    savedBackupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.surfaceMuted,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    savedBackupMeta: {
      flex: 1,
      marginRight: 10,
      gap: 2,
    },
    savedBackupFilename: {
      color: theme.text,
      fontSize: 12,
      fontWeight: '700',
    },
    savedBackupDate: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '500',
    },
    savedBackupRestoreBtn: {
      backgroundColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
    },
    savedBackupRestoreText: {
      color: theme.primaryForeground,
      fontSize: 12,
      fontWeight: '700',
    },
    modalClose: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 6 },
    modalCloseText: { color: theme.textMuted, fontWeight: '700', fontSize: 14 },
  });
}