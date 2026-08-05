import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

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

export default function LogScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [day, setDay] = useState(todayKey());
  const [calendarOpen, setCalendarOpen] = useState(false);

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

  /**
   * Long-press action sheet (PLAN §8: long-press → duplicate; delete also
   * lives here since v1 has no swipe-to-delete gesture). "Copy to today"
   * covers the "copy yesterday's breakfast" flow: browse to yesterday,
   * long-press, copy — the duplicate keeps the original snapshot verbatim.
   */
  const entryActions = (entry: LogEntry) => {
    const copyTargetDay = todayKey();
    Alert.alert(entry.name, undefined, [
      {
        text: day === copyTargetDay ? 'Duplicate' : `Copy to today (${entry.meal})`,
        onPress: () => {
          duplicateEntry(entry.id, copyTargetDay, entry.meal);
          refresh();
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteEntry(entry.id);
          refresh();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
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
              <Pressable
                key={e.id}
                onPress={() =>
                  router.push({ pathname: '/log-entry/[id]', params: { id: String(e.id) } })
                }
                onLongPress={() => entryActions(e)}
                style={styles.entryRow}
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
        Tap an entry to edit it · long-press to copy or delete.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  hint: { textAlign: 'center' },
});
