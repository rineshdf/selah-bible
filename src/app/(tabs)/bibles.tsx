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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  LayoutAnimation,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import SelahAppIconSvg from '@/components/SelahAppIconSvg';
import { exportBackup, restoreBackupFromPicker } from '@/db/backupManager';
import AppHeader from '@/components/AppHeader';
import { ScalePressable } from '@/components/ScalePressable';
import { BackupCloudSvg } from '@/components/SvgIcons';

type VersionRow =
  | { kind: 'section'; key: string; label: string }
  | { kind: 'group'; key: string; label: string; groupKey: string }
  | { kind: 'installed'; key: string; meta: BibleVersionMeta; active: boolean }
  | { kind: 'version'; key: string; version: DownloadableVersion }
  | { kind: 'empty'; key: string; label: string };

/** Registry metadata shares the catalog row shape for filtering & totals. */
function metaAsVersion(meta: BibleVersionMeta): DownloadableVersion {
  return {
    id: meta.id,
    name: meta.name,
    shortName: meta.shortName,
    englishName: meta.name,
    languageName: meta.language,
    languageCode: meta.languageCode ?? '',
    source: normalizeVersionId(meta.id) === TAMIL_BSI_ID ? 'bundled' : 'json',
  };
}

export default function BiblesScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();

  const [backupOpen, setBackupOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<DownloadableVersion[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [activeId, setActive] = useState('');
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [installedMetas, setInstalledMetas] = useState<BibleVersionMeta[]>([]);
  const [backupBusy, setBackupBusy] = useState<'export' | 'restore' | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

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

  const rows = useMemo<VersionRow[]>(() => {
    const rows: VersionRow[] = [];
    const normalizedQuery = query.trim();

    rows.push({ kind: 'section', key: 'installed-section', label: 'Installed on Device' });
    const installedVersions = installedMetas.map(metaAsVersion);
    const matchingInstalled = normalizedQuery
      ? filterVersions(normalizedQuery, installedVersions)
      : installedVersions;
    if (matchingInstalled.length === 0) {
      rows.push({
        kind: 'empty',
        key: 'installed-empty',
        label: normalizedQuery
          ? 'No saved Bibles match your search.'
          : 'The Tamil BSI ships pre-installed with the app.',
      });
    }
    const activeNormalized = normalizeVersionId(activeId);
    for (const version of matchingInstalled) {
      const meta = installedMetas.find((entry) => normalizeVersionId(entry.id) === normalizeVersionId(version.id));
      if (!meta) continue;
      rows.push({
        kind: 'installed',
        key: `installed:${meta.id}`,
        meta,
        active: normalizeVersionId(meta.id) === activeNormalized,
      });
    }

    const installedIds = new Set(installedMetas.map((meta) => normalizeVersionId(meta.id)));
    const source = normalizedQuery ? filterVersions(normalizedQuery, searchSource) : POPULAR_BIBLE_VERSIONS;
    const matchingAvailable = source.filter((version) => !installedIds.has(normalizeVersionId(version.id)));
    rows.push({ kind: 'section', key: 'available-section', label: 'Available Bibles' });
    const availableGroups = groupVersionsByLanguage(matchingAvailable);
    if (availableGroups.length === 0) {
      rows.push({
        kind: 'empty',
        key: 'available-empty',
        label: normalizedQuery ? 'No other Bibles match your search.' : 'No other Bibles are available right now.',
      });
    }
    for (const group of availableGroups) {
      const groupKey = `available:${group.language}`;
      rows.push({ kind: 'group', key: groupKey, groupKey, label: group.label });
      if (collapsedGroups[groupKey]) continue;
      for (const version of group.versions) {
        rows.push({ kind: 'version', key: `${groupKey}:${version.id}`, version });
      }
    }
    return rows;
  }, [activeId, collapsedGroups, installedMetas, query, searchSource]);

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
      await exportBackup();
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not create the backup file.');
    } finally {
      setBackupBusy(null);
    }
  }, []);

  const handleRestoreBackup = useCallback(async () => {
    setBackupBusy('restore');
    try {
      const result = await restoreBackupFromPicker();
      if (result) Alert.alert('Backup restored', `${result.total} saved items restored.`);
    } catch (error) {
      Alert.alert('Restore failed', error instanceof Error ? error.message : 'Could not restore the backup.');
    } finally {
      setBackupBusy(null);
    }
  }, []);

  const renderItem = useCallback(({ item }: { item: VersionRow }) => {
    if (item.kind === 'section') {
      return (
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionHeadingText}>{item.label}</Text>
        </View>
      );
    }
    if (item.kind === 'empty') {
      return <Text style={styles.emptyText}>{item.label}</Text>;
    }
    if (item.kind === 'group') {
      const expanded = !collapsedGroups[item.groupKey];
      return (
        <ScalePressable
          style={styles.languageHeader}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setCollapsedGroups((previous) => ({ ...previous, [item.groupKey]: expanded }));
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${item.label}`}
        >
          <Text style={styles.languageHeaderText}>{item.label}</Text>
          <Text style={styles.groupChevron}>{expanded ? '−' : '+'}</Text>
        </ScalePressable>
      );
    }

    if (item.kind === 'installed') {
      const { meta, active } = item;
      const isBundled = normalizeVersionId(meta.id) === TAMIL_BSI_ID;
      return (
        <View style={styles.versionCard}>
          <View style={styles.versionHeader}>
            <View style={styles.languageTag}>
              <Text numberOfLines={1} style={styles.languageTagText}>
                {meta.language || '—'}
              </Text>
            </View>
            {active ? (
              <Text style={styles.activeBadgeText}>Active ✓</Text>
            ) : (
              <ScalePressable
                style={styles.useChip}
                onPress={() => void handleSwitch(meta.id)}
                accessibilityRole="button"
                accessibilityLabel={`Read with ${meta.shortName}`}
              >
                <Text style={styles.useChipText}>Use</Text>
              </ScalePressable>
            )}
          </View>
          <Text style={styles.versionName} numberOfLines={2}>{meta.name}</Text>
          <View style={styles.actionRow}>
            <Text numberOfLines={1} style={styles.versionSub}>
              {meta.shortName}
              {isBundled ? ' · Included' : ''}
            </Text>
            {!isBundled ? (
              <ScalePressable
                style={styles.deleteXButton}
                onPress={() => handleDelete(meta)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${meta.shortName}`}
              >
                <Text style={styles.deleteXText}>✕</Text>
              </ScalePressable>
            ) : null}
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
            <Text style={styles.versionSub} numberOfLines={1}>
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
                  onPress={() => void handleSwitch(version.id)}
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
              onPress={() => void handleDownload(version)}
              disabled={percent !== undefined}
              accessibilityRole="button"
              accessibilityLabel={`Download ${version.shortName}`}
            >
              {percent !== undefined ? <ActivityIndicator size="small" color={theme.primaryForeground} /> : null}
              <Text style={styles.downloadText}>{percent !== undefined ? 'Downloading…' : 'Download'}</Text>
            </ScalePressable>
          )}
        </View>
      </View>
    );
  }, [activeId, collapsedGroups, downloaded, handleDelete, handleDownload, handleSwitch, progress, styles, theme.primaryForeground]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <AppHeader
        title="Bible Library"
        left={<SelahAppIconSvg size={21} color={theme.primary} />}
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
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.searchWrapper}>
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
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No Bibles match your search.</Text>}
        renderItem={renderItem}
      />
      <Modal visible={backupOpen} transparent animationType="fade" onRequestClose={() => setBackupOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.backupModal}>
            <View style={styles.modalHeading}>
              <BackupCloudSvg size={24} color={theme.primary} />
              <Text style={styles.modalTitle}>Backup &amp; Restore</Text>
            </View>
            <Text style={styles.modalHint}>Keep a copy of your highlights, messages, journal entries, and reading progress.</Text>
            <ScalePressable
              style={[styles.backupButton, styles.exportButton]}
              onPress={() => void handleExportBackup()}
              disabled={backupBusy !== null}
              accessibilityRole="button"
            >
              {backupBusy === 'export' ? <ActivityIndicator size="small" color={theme.primaryForeground} /> : <Text style={styles.exportButtonText}>Save a backup</Text>}
            </ScalePressable>
            <ScalePressable
              style={styles.backupButton}
              onPress={() => void handleRestoreBackup()}
              disabled={backupBusy !== null}
              accessibilityRole="button"
            >
              {backupBusy === 'restore' ? <ActivityIndicator size="small" color={theme.primary} /> : <Text style={styles.restoreButtonText}>Restore a backup</Text>}
            </ScalePressable>
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
    searchWrapper: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    searchInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      color: theme.text,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
    },
    sectionHeading: { marginTop: 18, marginBottom: 4 },
    sectionHeadingText: { color: theme.text, fontSize: 17, fontWeight: '800' },
    languageHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    languageHeaderText: { color: theme.primary, fontSize: 14, fontWeight: '800' },
    groupChevron: { color: theme.primary, fontSize: 19, fontWeight: '700', paddingHorizontal: 8 },
    versionCard: {
      marginTop: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      gap: 10,
    },
    versionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    versionMeta: { flex: 1, gap: 2 },
    languageTag: {
      alignSelf: 'flex-start',
      flexShrink: 1,
      maxWidth: '60%',
      borderRadius: 6,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    languageTagText: { color: theme.textMuted, fontSize: 11, fontWeight: '600' },
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
    backupModal: { borderRadius: 18, padding: 20, gap: 12, backgroundColor: theme.surface },
    modalHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    modalTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
    modalHint: { color: theme.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 4 },
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
    modalClose: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 8 },
    modalCloseText: { color: theme.textMuted, fontWeight: '700', fontSize: 14 },
  });
}
