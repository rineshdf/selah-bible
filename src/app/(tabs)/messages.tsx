/**
 * Tab 3: Sermon messages.
 *
 * Screen 1 — list of saved preached messages sorted by date, with a compact
 * top bar (theme toggle right, calendar date filter) and "+ New Message".
 *
 * Screen 2 — message editor. Title / Preacher / Date inputs; the date
 * defaults to today and a calendar button beside it opens the
 * PremiumCalendarModal (year selector). Ordered blocks from `message_blocks`:
 *   '+ Heading'  → optional bold section heading (never numbered)
 *   '+ Point'    → serial point auto-numbered `1.` `2.` `3.` across the whole
 *                  message (numbering survives deletions), tap-to-highlight
 *                  in one of the five minimal pastel colors
 *   '+ Add Bible Verse' → the universal VersePickerModal
 *                  (Version → Book → Chapter → Verse + quick sub-note)
 *                  inserting the scripture text via `loadChapterVerses()`
 *                  plus a dedicated note box underneath the block.
 *
 * `serial_no` stores the physical order of every block; point numbers shown
 * are derived by counting only `point` blocks, so headings and verses can be
 * deleted without breaking the sequence.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAppTheme } from '@/constants/ThemeContext';
import { HIGHLIGHT_COLORS, getHighlightStyle, type AppTheme } from '@/constants/colors';
import {
  addMessageBlock,
  createMessage,
  deleteMessage,
  deleteMessageBlock,
  getAllMessages,
  getMessage,
  getMessageBlocks,
  updateMessage,
  updateMessageBlock,
  type MessageBlockRow,
  type MessageRow,
} from '@/db/database';
import AppHeader from '@/components/AppHeader';
import AnimatedCard from '@/components/AnimatedCard';
import PremiumCalendarModal, { todayIsoDate } from '@/components/PremiumCalendarModal';
import VersePickerModal, { type VersePickResult } from '@/components/VersePickerModal';
import { ParsedVerseRows, formatVersesForStorage } from '@/components/VerseRows';
import { isRtlVersionLabel } from '@/constants/books';
import { CalendarSvg, SermonNotesSvg } from '@/components/SvgIcons';
import SerialBadge from '@/components/SerialBadge';
import { ScalePressable } from '@/components/ScalePressable';

/** Points are numbered like Bible verses: only sibling points count. */
function pointNumberOf(blocks: MessageBlockRow[], block: MessageBlockRow): number {
  let number = 0;
  for (const row of blocks) {
    if (row.block_type !== 'point') continue;
    number += 1;
    if (row.id === block.id) return number;
  }
  return number;
}

/** Format a saved message date ('YYYY-MM-DD' or ISO timestamp) into a clean localized date. */
function formatMessageDate(rawDate?: string | null): string {
  if (!rawDate) return '—';
  const clean = rawDate.split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const dateObj = new Date(year, month, day);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }
  const dateObj = new Date(rawDate);
  if (!isNaN(dateObj.getTime())) {
    return dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return rawDate;
}

export default function MessagesScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);

  const [editingId, setEditingId] = useState<number | null>(null);
  /** Bumped on every tab focus so the list reloads after edits elsewhere. */
  const [refreshTick, setRefreshTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setRefreshTick((tick) => tick + 1);
      if (editingId !== null) {
        // The edited message may have been deleted from elsewhere.
        if (!getMessage(editingId)) setEditingId(null);
      }
    }, [editingId]),
  );

  if (editingId !== null) {
    return (
      <MessageEditorScreen
        key={`${editingId}-${refreshTick}`}
        messageId={editingId}
        theme={theme}
        styles={styles}
        onClose={() => setEditingId(null)}
      />
    );
  }

  return (
    <MessagesListScreen
      theme={theme}
      styles={styles}
      onOpenMessage={setEditingId}
    />
  );
}

// ---------------------------------------------------------------------------
// Screen 1: message list
// ---------------------------------------------------------------------------

function MessagesListScreen({
  theme,
  styles,
  onOpenMessage,
}: {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  onOpenMessage: (id: number) => void;
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  /** null = All Dates; otherwise filter by message_date. */
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const reload = useCallback(() => {
    setMessages(getAllMessages());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const handleNewMessage = useCallback(() => {
    const newId = createMessage({
      title: 'New Message',
      preacher: null,
      message_date: todayIsoDate(),
    });
    onOpenMessage(newId);
  }, [onOpenMessage]);

  const handleDeleteMessage = useCallback(
    (message: MessageRow) => {
      Alert.alert(
        'Delete message?',
        `${message.title}${message.message_date ? ` · ${message.message_date}` : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              deleteMessage(message.id);
              reload();
            },
          },
        ],
      );
    },
    [reload],
  );

  const filtered = useMemo(
    () => (filterDate ? messages.filter((m) => m.message_date === filterDate) : messages),
    [filterDate, messages],
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: theme.background },
      ]}
    >
      <AppHeader
        title="Preached Messages"
        right={
          <ScalePressable
            style={[styles.headerIconButton, filterDate ? styles.headerIconButtonActive : null]}
            onPress={() => setCalendarOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Filter messages by date"
          >
            <CalendarSvg
              size={18}
              color={filterDate ? theme.primaryForeground : theme.primary}
            />
          </ScalePressable>
        }
      />

      {filterDate ? (
        <View style={styles.datedFilterBar}>
          <Text numberOfLines={1} style={styles.datedFilterLabel}>Showing: {filterDate}</Text>
          <ScalePressable
            onPress={() => setFilterDate(null)}
            accessibilityRole="button"
            accessibilityLabel="Show all dates"
          >
            <Text style={styles.datedFilterClear}>All Dates ✕</Text>
          </ScalePressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.listContent}>
        <ScalePressable
          style={styles.newButtonWide}
          onPress={handleNewMessage}
          accessibilityRole="button"
          accessibilityLabel="Create a new message"
        >
          <Text style={styles.newButtonWideText}>+ New Message</Text>
        </ScalePressable>

        {filtered.length === 0 ? (
          <AnimatedCard>
            <View style={styles.emptyCard}>
              <SermonNotesSvg size={72} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyMessage}>
                Tap “+ New Message” to start taking sermon notes with points,
                headings and scripture verses.
              </Text>
            </View>
          </AnimatedCard>
        ) : (
          filtered.map((message) => (
            <View key={message.id} style={styles.messageCard}>
              <ScalePressable
                style={styles.messageCardBody}
                onPress={() => onOpenMessage(message.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open message ${message.title}`}
              >
                <Text numberOfLines={1} style={styles.messageTitle}>
                  {message.title}
                </Text>
                <View style={styles.messageMetaRow}>
                  <Text numberOfLines={1} style={styles.messageMeta}>
                    {message.preacher ? `👤 ${message.preacher}` : '👤 —'}
                  </Text>
                  <View style={styles.messageDateMeta}>
                    <CalendarSvg size={14} color={theme.textMuted} />
                    <Text numberOfLines={1} style={styles.messageDateText}>
                      {formatMessageDate((message as any).date || message.message_date || message.created_at)}
                    </Text>
                  </View>
                </View>
              </ScalePressable>
              <Pressable
                style={styles.messageDelete}
                hitSlop={8}
                onPress={() => handleDeleteMessage(message)}
                accessibilityRole="button"
                accessibilityLabel={`Delete message ${message.title}`}
              >
                <Text style={styles.messageDeleteIcon}>✕</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <PremiumCalendarModal
        visible={calendarOpen}
        selectedDate={filterDate ?? todayIsoDate()}
        onSelectDate={(iso) => setFilterDate(iso)}
        onClose={() => setCalendarOpen(false)}
        markedDates={messages
          .map((message) => message.message_date)
          .filter((date): date is string => typeof date === 'string')}
        title="Filter Messages by Date"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen 2: message editor
// ---------------------------------------------------------------------------

function MessageEditorScreen({
  messageId,
  theme,
  styles,
  onClose,
}: {
  messageId: number;
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  onClose: () => void;
}) {
  const initial = getMessage(messageId);

  const [title, setTitle] = useState(initial?.title ?? 'New Message');
  const [preacher, setPreacher] = useState(initial?.preacher ?? '');
  const [messageDate, setMessageDate] = useState(initial?.message_date ?? todayIsoDate());
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [blocks, setBlocks] = useState<MessageBlockRow[]>(getMessageBlocks(messageId));
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);
  const [versePickerOpen, setVersePickerOpen] = useState(false);

  /** Commit the current title / preacher / date into the messages table. */
  const commitHeaderFields = useCallback((): void => {
    updateMessage(messageId, {
      title: title.trim() === '' ? 'New Message' : title.trim(),
      preacher: preacher.trim() === '' ? null : preacher.trim(),
      message_date: messageDate.trim() === '' ? null : messageDate.trim(),
    });
  }, [messageDate, messageId, preacher, title]);

  const commitBlockContent = useCallback(
    (block: MessageBlockRow, content: string) => {
      setBlocks((previous) => previous.map((row) => (
        row.id === block.id ? { ...row, content } : row
      )));
      updateMessageBlock(block.id, { content });
    },
    [],
  );

  const commitBlockNote = useCallback((block: MessageBlockRow, note: string) => {
    setBlocks((previous) => previous.map((row) => (
      row.id === block.id ? { ...row, verse_note: note } : row
    )));
    updateMessageBlock(block.id, { verse_note: note });
  }, []);

  /** Append a block at the end and renumber every following serial. */
  const appendBlock = useCallback(
    (type: 'heading' | 'point', content = '') => {
      const nextSerial = blocks.reduce((max, row) => Math.max(max, row.serial_no), 0) + 1;
      const newId = addMessageBlock({
        message_id: messageId,
        serial_no: nextSerial,
        block_type: type,
        content,
        verse_ref: null,
        verse_note: null,
        highlight_color: null,
      });
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setBlocks(getMessageBlocks(messageId));
      setSelectedBlockId(type === 'point' ? newId : selectedBlockId);
    },
    [blocks, messageId, selectedBlockId],
  );

  /** Insert verse text picked in the universal modal as a fresh block. */
  const insertVerseResult = useCallback(
    (draft: VersePickResult) => {
      const nextSerial = blocks.reduce((max, row) => Math.max(max, row.serial_no), 0) + 1;
      addMessageBlock({
        message_id: messageId,
        serial_no: nextSerial,
        block_type: 'verse',
        // Tagged per-verse text ([1] … \n[2] …) so verse blocks render as
        // badge rows; plain text is the legacy fallback shape.
        content: draft.verses.length > 0
          ? formatVersesForStorage(draft.verses)
          : draft.text,
        verse_ref: `${draft.bookName} ${draft.chapter}:${draft.verse} · ${draft.versionShortName}`,
        verse_note: draft.note,
        highlight_color: null,
      });
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setBlocks(getMessageBlocks(messageId));
      setVersePickerOpen(false);
    },
    [blocks, messageId],
  );

  const removeBlock = useCallback(
    (block: MessageBlockRow) => {
      // Only renumber blocks after the deleted one — a single UPDATE per row.
      const after = blocks.filter((row) => row.serial_no > block.serial_no);
      deleteMessageBlock(block.id);
      for (const row of after) {
        updateMessageBlock(row.id, { serial_no: row.serial_no - 1 });
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const next = blocks
        .filter((row) => row.id !== block.id)
        .map((row) => (row.serial_no > block.serial_no ? { ...row, serial_no: row.serial_no - 1 } : row));
      setBlocks(next);
      setSelectedBlockId((current) => (current === block.id ? null : current));
    },
    [blocks],
  );

  /** Ordered cycle: unhighlight → next color → … → unhighlight. */
  const highlightPoint = useCallback(
    (block: MessageBlockRow, colorHex: string) => {
      const nextColor = block.highlight_color === colorHex ? null : colorHex;
      updateMessageBlock(block.id, { highlight_color: nextColor });
      setBlocks((previous) => previous.map((row) => (
        row.id === block.id ? { ...row, highlight_color: nextColor } : row
      )));
    },
    [],
  );

  // Deleted elsewhere before this render — bounce back to the list.
  if (!initial) {
    return (
      <View style={styles.screen}>
        <Text>Message no longer exists.</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: theme.background },
      ]}
    >
      {/* Editor top bar with the global theme toggle on the right */}
      <AppHeader
        title="Message Editor"
        left={
          <Pressable
            onPress={() => {
              commitHeaderFields();
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to messages list"
          >
            <Text style={styles.editorBackText}>{'‹ Messages'}</Text>
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.editorContent}>
        {/* Header fields: title / preacher / date with calendar selector */}
        <AnimatedCard style={styles.headerCard}>
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.fieldInput}
            value={title}
            onChangeText={setTitle}
            onBlur={commitHeaderFields}
            placeholder="Message title"
            placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
          />
          <Text style={styles.fieldLabel}>Preacher</Text>
          <TextInput
            style={styles.fieldInput}
            value={preacher}
            onChangeText={setPreacher}
            onBlur={commitHeaderFields}
            placeholder="Preacher name"
            placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
          />
          <Text style={styles.fieldLabel}>Date</Text>
          <View style={styles.dateRow}>
            <TextInput
              style={[styles.fieldInput, styles.dateInput, { color: theme.isDark ? '#F8FAFC' : '#0F172A' }]}
              value={messageDate}
              onChangeText={setMessageDate}
              onBlur={commitHeaderFields}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
            />
            <ScalePressable
              style={styles.datePickerButton}
              onPress={() => setDateModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open calendar to change the message date"
            >
              <CalendarSvg size={18} color={theme.primary} />
            </ScalePressable>
          </View>
        </AnimatedCard>

        {/* Ordered blocks */}
        <View style={styles.blocksSection}>
          {blocks.map((block) => {
            const selected = selectedBlockId === block.id;
            const colorDef = block.highlight_color
              ? getHighlightStyle(block.highlight_color, theme.isDark)
              : null;

            if (block.block_type === 'heading') {
              return (
                <View key={block.id} style={styles.headingBlock}>
                  <TextInput
                    style={styles.headingInput}
                    value={block.content}
                    onChangeText={(text) => commitBlockContent(block, text)}
                    placeholder="Section heading (optional)"
                    placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
                    multiline
                  />
                  <Pressable
                    style={styles.blockRemoveCircle}
                    hitSlop={8}
                    onPress={() => removeBlock(block)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete heading ${block.content}`}
                  >
                    <Text style={styles.blockRemoveCircleText}>✕</Text>
                  </Pressable>
                </View>
              );
            }

            if (block.block_type === 'point') {
              return (
                <View key={block.id}>
                  <View
                    style={[
                      styles.pointBlock,
                      selected ? styles.pointBlockSelected : null,
                      colorDef
                        ? {
                            backgroundColor: colorDef.backgroundColor,
                            borderLeftColor: colorDef.borderColor,
                            borderLeftWidth: 3,
                          }
                        : null,
                    ]}
                  >
                    <ScalePressable
                      style={styles.pointNumber}
                      onPress={() => setSelectedBlockId(selected ? null : block.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Select point ${pointNumberOf(blocks, block)}`}
                    >
                      <SerialBadge
                        number={pointNumberOf(blocks, block)}
                        color={block.highlight_color ?? undefined}
                      />
                    </ScalePressable>
                    <TextInput
                      style={styles.pointInput}
                      value={block.content}
                      onChangeText={(text) => commitBlockContent(block, text)}
                      placeholder={`Point ${pointNumberOf(blocks, block)}`}
                      placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
                      multiline
                    />
                    <Pressable
                      style={styles.blockRemoveCircle}
                      hitSlop={8}
                      onPress={() => removeBlock(block)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete point ${pointNumberOf(blocks, block)}`}
                    >
                      <Text style={styles.blockRemoveCircleText}>✕</Text>
                    </Pressable>
                  </View>
                  {selected ? (
                    <View style={styles.pointPalette}>
                      {HIGHLIGHT_COLORS.map((color) => {
                        const active = block.highlight_color === color.hex;
                        return (
                          <ScalePressable
                            key={color.key}
                            style={[
                              styles.pointPaletteDot,
                              { backgroundColor: color.hex },
                              active ? styles.pointPaletteDotActive : null,
                            ]}
                            onPress={() => highlightPoint(block, color.hex)}
                            accessibilityRole="button"
                            accessibilityLabel={`Highlight point ${pointNumberOf(blocks, block)} in ${color.englishName}`}
                          >
                            <Text style={styles.pointPaletteCheck}>
                              {active ? '✓' : ''}
                            </Text>
                          </ScalePressable>
                        );
                      })}
                      <ScalePressable
                        style={styles.pointPaletteDone}
                        onPress={() => setSelectedBlockId(null)}
                        accessibilityRole="button"
                        accessibilityLabel="Done highlighting point"
                      >
                        <Text style={styles.pointPaletteDoneText}>Done</Text>
                      </ScalePressable>
                    </View>
                  ) : null}
                </View>
              );
            }

            // verse block: scripture text + a dedicated note box underneath
            return (
              <View key={block.id} style={styles.verseBlock}>
                <View style={styles.verseBlockHeader}>
                  <View style={styles.verseRefPill}>
                    <Text numberOfLines={1} style={styles.verseRefText}>
                      {block.verse_ref ?? 'Verse'}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.blockRemove}
                    hitSlop={8}
                    onPress={() => removeBlock(block)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete verse ${block.verse_ref ?? ''}`}
                  >
                    <Text style={styles.blockRemoveText}>✕</Text>
                  </Pressable>
                </View>
                <View style={styles.verseContentWrap}>
                  <ParsedVerseRows
                    text={block.content}
                    rtl={isRtlVersionLabel(block.verse_ref ?? '')}
                  />
                </View>
                <TextInput
                  style={styles.verseNoteInput}
                  value={block.verse_note ?? ''}
                  onChangeText={(text) => commitBlockNote(block, text)}
                  placeholder="Note on this scripture..."
                  placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
                  multiline
                />
              </View>
            );
          })}
        </View>

        {/* Block append actions */}
        <View style={styles.addActionRow}>
          <ScalePressable
            style={styles.addButton}
            onPress={() => appendBlock('heading')}
            accessibilityRole="button"
            accessibilityLabel="Append a heading block"
          >
            <Text style={styles.addButtonText}>+ Heading</Text>
          </ScalePressable>
          <ScalePressable
            style={styles.addButton}
            onPress={() => appendBlock('point')}
            accessibilityRole="button"
            accessibilityLabel="Append a numbered point"
          >
            <Text style={styles.addButtonText}>+ Point</Text>
          </ScalePressable>
          <ScalePressable
            style={styles.addButton}
            onPress={() => setVersePickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a Bible verse"
          >
            <Text style={styles.addButtonText}>+ Add Bible Verse</Text>
          </ScalePressable>
        </View>
      </ScrollView>

      {/* Date selector (PremiumCalendarModal with year picker) */}
      <PremiumCalendarModal
        visible={dateModalOpen}
        selectedDate={messageDate || todayIsoDate()}
        onSelectDate={(iso) => {
          setMessageDate(iso);
          updateMessage(messageId, { message_date: iso });
          setDateModalOpen(false);
        }}
        onClose={() => setDateModalOpen(false)}
        title="Message Date"
      />

      {/* Universal 4-step verse picker */}
      <VersePickerModal
        visible={versePickerOpen}
        onInsert={insertVerseResult}
        onClose={() => setVersePickerOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1 },
    // ------------------------------------------------------------------
    // Screen 1: list
    // ------------------------------------------------------------------
    headerIconButton: {
      width: 34,
      height: 34,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerIconButtonActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    datedFilterBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: theme.surfaceMuted,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    datedFilterLabel: { color: theme.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    datedFilterClear: { color: theme.primary, fontSize: 13, fontWeight: '700', flexShrink: 0 },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 32,
    },
    newButtonWide: {
      borderRadius: 12,
      backgroundColor: theme.primary,
      alignItems: 'center',
      paddingVertical: 12,
      marginBottom: 12,
    },
    newButtonWideText: {
      color: theme.primaryForeground,
      fontSize: 15,
      fontWeight: '700',
    },
    emptyCard: {
      marginTop: 32,
      alignItems: 'center',
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 24,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '700',
    },
    emptyMessage: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    messageCard: {
      flexDirection: 'row',
      alignItems: 'stretch',
      marginBottom: 10,
      gap: 4,
    },
    messageCardBody: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      gap: 8,
    },
    messageCardPressed: { opacity: 0.8 },
    messageTitle: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
    },
    messageMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    messageMeta: {
      flex: 1,
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '500',
    },
    messageDateMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    messageDateText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textMuted,
    },
    messageDelete: {
      width: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    messageDeleteIcon: {
      color: theme.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    // ------------------------------------------------------------------
    // Screen 2: editor
    // ------------------------------------------------------------------
    editorBackText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    editorContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 48,
    },
    headerCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      gap: 6,
    },
    fieldLabel: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 6,
    },
    fieldInput: {
      backgroundColor: theme.isDark ? '#1E293B' : '#F1F5F9',
      borderColor: theme.isDark ? '#334155' : '#CBD5E1',
      borderWidth: 1,
      color: theme.isDark ? '#F8FAFC' : '#0F172A',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 15,
      lineHeight: 22,
    },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dateInput: { flex: 1 },
    datePickerButton: {
      width: 40,
      height: 40,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    blocksSection: { gap: 8, marginTop: 16 },
    // Point / Heading card recipe (spec): row container, vertically centered
    // children, numbered badge left, input middle, round ✕ right.
    headingBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
    },
    headingInput: {
      flex: 1,
      color: theme.isDark ? '#F8FAFC' : '#0F172A',
      fontSize: 16,
      fontWeight: '700',
      paddingHorizontal: 0,
      paddingVertical: 4,
    },
    // The verse block keeps the plain inline ✕; Point/Heading use the round one.
    blockRemove: { paddingHorizontal: 8, paddingVertical: 6 },
    // Round 30×30 delete button, vertically centred in the middle row.
    blockRemoveCircle: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      alignSelf: 'center',
    },
    blockRemoveCircleText: {
      color: theme.textMuted,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 16,
      includeFontPadding: false,
    },
    blockRemoveText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    pointBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    pointBlockSelected: {
      borderColor: theme.primary,
      borderWidth: 2,
    },
    // 26×26 rounded badge wrapper (tapping it opens the highlight palette).
    pointNumber: {
      width: 26,
      height: 26,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    pointInput: {
      flex: 1,
      color: theme.isDark ? '#F8FAFC' : '#0F172A',
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 22,
      paddingVertical: 4,
      paddingHorizontal: 0,
    },
    pointPalette: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    pointPaletteDot: {
      width: 28,
      height: 28,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pointPaletteDotActive: {
      borderColor: theme.text,
      borderWidth: 2,
    },
    pointPaletteCheck: {
      color: '#1B1F27',
      fontSize: 13,
      fontWeight: '800',
    },
    pointPaletteDone: {
      marginLeft: 'auto',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    pointPaletteDoneText: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '700',
    },
    verseBlock: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.readingBackground,
      padding: 12,
      gap: 8,
    },
    verseBlockHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    verseRefPill: {
      flex: 1,
      alignSelf: 'flex-start',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    verseRefText: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '700',
    },
    verseContentWrap: { marginTop: 2 },
    verseNoteInput: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.isDark ? '#334155' : '#CBD5E1',
      backgroundColor: theme.isDark ? '#1E293B' : '#F1F5F9',
      color: theme.isDark ? '#F8FAFC' : '#0F172A',
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
      minHeight: 42,
    },
    addActionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 16,
    },
    addButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: theme.surface,
      minHeight: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButtonText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 22,
    },
  });
}
