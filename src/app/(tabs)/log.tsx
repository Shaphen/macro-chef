import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { MacroBars } from '@/components/macro-bars';
import { MonthCalendar } from '@/components/month-calendar';
import { ThemedText } from '@/components/themed-text';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import {
  deleteEntry,
  duplicateEntry,
  entriesForDay,
  dayTotals,
  loggedDaysBetween,
  restoreEntry,
} from '@/db/queries/log';
import type { LogEntry, Meal } from '@/db/schema';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';
import { addDays, dayLabel, todayKey } from '@/lib/dates';

const MEALS: { key: Meal; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
];

/** How long the undo snackbar lingers before the delete becomes final. */
const UNDO_MS = 5000;

export default function LogScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [day, setDay] = useState(todayKey());
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Duplicate flow (PLAN §8 "duplicate to today/another meal"): long-press →
  // meal via action sheet → day via the same MonthCalendar used for date
  // navigation. Both set → the picker is visible.
  const [dupEntry, setDupEntry] = useState<LogEntry | null>(null);
  const [dupMeal, setDupMeal] = useState<Meal | null>(null);

  // Undo snackbar state (PLAN §8 "swipe row → delete (undo snackbar)"):
  // deletes apply immediately and the deleted row is parked here so Undo can
  // re-insert its snapshot verbatim.
  const [undoEntry, setUndoEntry] = useState<LogEntry | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  // One focus-refreshing read per day change: the day's entries + totals,
  // plus logged-day dots for the strip. The dot range is the selected day
  // ±10 weeks — wide enough that a few strip swipes in either direction
  // show dots without re-querying, and re-anchored automatically whenever
  // the selected day moves beyond it (day is in the deps).
  const { data, refresh } = useDbData(
    () => ({
      entries: entriesForDay(day),
      totals: dayTotals(day),
      loggedDays: loggedDaysBetween(addDays(day, -70), addDays(day, 70)),
    }),
    [day],
  );

  const byMeal = new Map<Meal, LogEntry[]>();
  for (const e of data.entries) {
    byMeal.set(e.meal, [...(byMeal.get(e.meal) ?? []), e]);
  }

  const performDelete = (entry: LogEntry) => {
    deleteEntry(entry.id);
    refresh();
    setUndoEntry(entry);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoEntry(null), UNDO_MS);
  };

  const undoDelete = () => {
    if (!undoEntry) return;
    restoreEntry(undoEntry);
    setUndoEntry(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    refresh();
  };

  /** Step 2 of duplicating: pick the target meal, then the calendar opens. */
  const pickDuplicateMeal = (entry: LogEntry) => {
    Alert.alert('Duplicate to…', 'Pick a meal, then a day.', [
      ...MEALS.map((m) => ({
        text: m.label,
        onPress: () => {
          setDupEntry(entry);
          setDupMeal(m.key);
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const closeDuplicate = () => {
    setDupEntry(null);
    setDupMeal(null);
  };

  /**
   * Long-press action sheet (PLAN §8): duplicate to any day/meal, or delete
   * (also available via swipe). Deletes are undoable, so no confirm step.
   */
  const entryActions = (entry: LogEntry) => {
    Alert.alert(entry.name, undefined, [
      { text: 'Duplicate…', onPress: () => pickDuplicateMeal(entry) },
      { text: 'Delete', style: 'destructive', onPress: () => performDelete(entry) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Date navigation: arrows + label + calendar icon, above the week strip */}
        <View style={styles.dateRow}>
          <Pressable hitSlop={12} onPress={() => setDay(addDays(day, -1))}>
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <Pressable onPress={() => setDay(todayKey())}>
            <ThemedText type="smallBold">{dayLabel(day)}</ThemedText>
          </Pressable>
          <View style={styles.dateRowRight}>
            <Pressable hitSlop={12} onPress={() => setDay(addDays(day, 1))}>
              <Ionicons name="chevron-forward" size={22} color={theme.text} />
            </Pressable>
            <Pressable hitSlop={12} onPress={() => setCalendarOpen(true)}>
              <Ionicons name="calendar-outline" size={22} color={theme.text} />
            </Pressable>
          </View>
        </View>

        <WeekStrip selected={day} onSelect={setDay} loggedDays={data.loggedDays} />

        <MonthCalendar
          visible={calendarOpen}
          selected={day}
          onSelect={setDay}
          onClose={() => setCalendarOpen(false)}
        />

        {/* Day picker for the duplicate flow — same calendar, different verb:
            tapping a day copies the entry there ("Jump to today" = copy to today). */}
        <MonthCalendar
          visible={dupEntry !== null && dupMeal !== null}
          selected={day}
          onSelect={(targetDay) => {
            if (dupEntry && dupMeal) {
              duplicateEntry(dupEntry.id, targetDay, dupMeal);
              refresh();
            }
          }}
          onClose={closeDuplicate}
        />

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <MacroBars totals={data.totals} compact />
        </View>

        {MEALS.map(({ key, label }) => {
          const entries = byMeal.get(key) ?? [];
          const kcal = Math.round(entries.reduce((s, e) => s + e.calories, 0));
          return (
            <View key={key} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.mealHeader}>
                <ThemedText type="smallBold">{label}</ThemedText>
                <View style={styles.mealHeaderRight}>
                  {entries.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {kcal} kcal
                    </ThemedText>
                  )}
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      router.push({ pathname: '/add-food', params: { day, meal: key } })
                    }
                  >
                    <Ionicons name="add-circle" size={24} color="#3c87f7" />
                  </Pressable>
                </View>
              </View>
              {entries.map((e) => (
                <ReanimatedSwipeable
                  key={e.id}
                  friction={2}
                  rightThreshold={32}
                  renderRightActions={() => (
                    <Pressable style={styles.deleteAction} onPress={() => performDelete(e)}>
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                      <ThemedText type="smallBold" style={styles.deleteActionText}>
                        Delete
                      </ThemedText>
                    </Pressable>
                  )}
                >
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: '/log-entry/[id]', params: { id: String(e.id) } })
                    }
                    onLongPress={() => entryActions(e)}
                    style={[styles.entryRow, { backgroundColor: theme.backgroundElement }]}
                  >
                    <View style={styles.entryText}>
                      <ThemedText type="small" numberOfLines={1}>
                        {e.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {e.amount && e.amountUnit ? `${e.amount} ${e.amountUnit} · ` : ''}
                        P {Math.round(e.protein)} · C {Math.round(e.carbs)} · F {Math.round(e.fat)}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold">{Math.round(e.calories)}</ThemedText>
                  </Pressable>
                </ReanimatedSwipeable>
              ))}
              {entries.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Nothing logged.
                </ThemedText>
              )}
            </View>
          );
        })}
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Tap an entry to edit · swipe left to delete · long-press to duplicate.
        </ThemedText>
      </ScrollView>

      {undoEntry && (
        <View style={styles.snackbar}>
          <ThemedText type="small" style={styles.snackbarText} numberOfLines={1}>
            Deleted “{undoEntry.name}”
          </ThemedText>
          <Pressable hitSlop={8} onPress={undoDelete}>
            <ThemedText type="smallBold" style={{ color: '#7db4ff' }}>
              Undo
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateRowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mealHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  entryText: { flex: 1, gap: 1 },
  deleteAction: {
    backgroundColor: '#e4573d',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    marginLeft: Spacing.two,
    flexDirection: 'row',
    gap: Spacing.one,
  },
  deleteActionText: { color: '#fff' },
  hint: { textAlign: 'center' },
  snackbar: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    backgroundColor: '#26292e',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  snackbarText: { color: '#fff', flex: 1 },
});
