import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { loggedDaysBetween } from '@/db/queries/log';
import { useTheme } from '@/hooks/use-theme';
import { monthGrid, monthLabel, parseDayKey, todayKey } from '@/lib/dates';

/**
 * Full-month jump-to-date picker (PLAN Part 2.1): the week strip only
 * reaches nearby weeks quickly, so the calendar icon opens this modal to
 * reach any date. Deliberately a hand-rolled grid rather than a calendar
 * dependency — PLAN Part 2.1 requires pure JS for Expo Go compatibility,
 * and a month grid is ~40 lines, cheaper than auditing a library for it.
 *
 * Logged-day dots query one month at a time (`loggedDaysBetween` over the
 * visible month) right at render; the DISTINCT-over-index query is
 * microseconds on-device, so no caching layer is warranted.
 */

interface Props {
  visible: boolean;
  selected: string;
  onSelect: (day: string) => void;
  onClose: () => void;
}

export function MonthCalendar({ visible, selected, onSelect, onClose }: Props) {
  const theme = useTheme();
  const selectedDate = parseDayKey(selected);
  const [year, setYear] = useState(selectedDate.getFullYear());
  const [month, setMonth] = useState(selectedDate.getMonth() + 1); // 1-based

  // Re-anchor to the currently-selected day each time the modal opens —
  // otherwise a picker opened, browsed to 2024, and closed would reopen
  // showing 2024 instead of where the user actually is.
  useEffect(() => {
    if (visible) {
      const d = parseDayKey(selected);
      setYear(d.getFullYear());
      setMonth(d.getMonth() + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const shiftMonth = (delta: number) => {
    // Date handles year rollover for us: month is 1-based here, 0-based in Date.
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const rows = monthGrid(year, month);
  const firstDay = rows[0].find((d) => d !== null)!;
  const lastRow = rows[rows.length - 1];
  const lastDay = [...lastRow].reverse().find((d) => d !== null)!;
  const loggedDays = visible ? loggedDaysBetween(firstDay, lastDay) : new Set<string>();
  const today = todayKey();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop tap closes; the card itself swallows presses. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: theme.backgroundElement }]} onPress={() => {}}>
          <View style={styles.header}>
            <Pressable hitSlop={12} onPress={() => shiftMonth(-1)}>
              <Ionicons name="chevron-back" size={22} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold">{monthLabel(year, month)}</ThemedText>
            <Pressable hitSlop={12} onPress={() => shiftMonth(1)}>
              <Ionicons name="chevron-forward" size={22} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.weekdays}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
              <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.cellText}>
                {w}
              </ThemedText>
            ))}
          </View>

          {rows.map((row, i) => (
            <View key={i} style={styles.row}>
              {row.map((day, j) => {
                if (!day) return <View key={j} style={styles.cell} />;
                const isSelected = day === selected;
                const isToday = day === today;
                return (
                  <Pressable
                    key={j}
                    style={[
                      styles.cell,
                      isSelected && { backgroundColor: '#3c87f7', borderRadius: 10 },
                      !isSelected && isToday && {
                        backgroundColor: theme.backgroundSelected,
                        borderRadius: 10,
                      },
                    ]}
                    onPress={() => {
                      onSelect(day);
                      onClose();
                    }}
                  >
                    <ThemedText
                      type={isSelected || isToday ? 'smallBold' : 'small'}
                      style={isSelected ? { color: '#fff' } : undefined}
                    >
                      {parseDayKey(day).getDate()}
                    </ThemedText>
                    <View
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            loggedDays.has(day) && !isSelected ? '#3c87f7' : 'transparent',
                        },
                      ]}
                    />
                  </Pressable>
                );
              })}
            </View>
          ))}

          <Pressable
            style={styles.todayButton}
            onPress={() => {
              onSelect(today);
              onClose();
            }}
          >
            <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
              Jump to today
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekdays: { flexDirection: 'row' },
  row: { flexDirection: 'row' },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one + 2,
    gap: 1,
  },
  cellText: { flex: 1, textAlign: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  todayButton: { alignItems: 'center', paddingVertical: Spacing.one },
});
