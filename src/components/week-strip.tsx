import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, parseDayKey, startOfWeek, todayKey, weekDays } from '@/lib/dates';

/**
 * MacroFactor-style week strip (PLAN Part 2.1): 7 day chips, swipeable
 * between weeks via a paging FlatList, selected day highlighted, and a
 * small dot under days that have log entries.
 *
 * Architecture choices:
 *  - Pure/controlled component: it renders `selected` and calls
 *    `onSelect(day)`; the Log screen owns the day state (which already
 *    existed pre-strip), so the strip, the arrows, and the calendar picker
 *    are all just different setters of the same state and can't disagree.
 *  - Paging is a fixed window of week offsets around today rather than an
 *    infinite list: FlatList needs a stable item count for
 *    getItemLayout/initialScrollIndex, and ±2 years of weeks (~104 items of
 *    7 lightweight chips) is far more history than a food log needs to
 *    reach by swiping — anything older is what the calendar picker is for.
 *  - The strip measures its own width via onLayout instead of assuming the
 *    window width, so the parent can pad/inset it freely.
 */

const WEEKS_BACK = 104; // ~2 years of swipe-reachable history
const WEEKS_FORWARD = 4; // a few weeks ahead for pre-logging

interface Props {
  selected: string;
  onSelect: (day: string) => void;
  /** Days (in any loaded range) that have at least one log entry. */
  loggedDays: Set<string>;
}

export function WeekStrip({ selected, onSelect, loggedDays }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const listRef = useRef<FlatList<string>>(null);

  // The window is anchored to *today's* week so item indices never shift
  // between renders; index i = week starting (i - WEEKS_BACK) weeks from now.
  const anchor = startOfWeek(todayKey());
  const weekStarts = Array.from({ length: WEEKS_BACK + 1 + WEEKS_FORWARD }, (_, i) =>
    addDays(anchor, (i - WEEKS_BACK) * 7),
  );
  const indexOfWeek = (day: string) => {
    const target = startOfWeek(day);
    const diffDays =
      (parseDayKey(target).getTime() - parseDayKey(anchor).getTime()) / 86_400_000;
    return Math.min(
      weekStarts.length - 1,
      Math.max(0, WEEKS_BACK + Math.round(diffDays / 7)),
    );
  };

  // When the selected day changes from outside the strip (arrows, calendar
  // jump, "today" tap), bring its week into view. scrollToIndex is safe here
  // because every item has an identical measured width (getItemLayout).
  const selectedIndex = indexOfWeek(selected);
  useEffect(() => {
    if (width > 0) {
      listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
    }
  }, [selectedIndex, width]);

  const renderWeek = useCallback(
    ({ item: weekStart }: { item: string }) => (
      <View style={[styles.week, { width }]}>
        {weekDays(weekStart).map((day) => {
          const isSelected = day === selected;
          const isToday = day === todayKey();
          const date = parseDayKey(day);
          return (
            <Pressable
              key={day}
              onPress={() => onSelect(day)}
              style={[
                styles.chip,
                isSelected && { backgroundColor: '#3c87f7' },
                !isSelected && isToday && { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <ThemedText
                type="small"
                style={isSelected ? styles.selectedText : undefined}
                themeColor={isSelected ? undefined : 'textSecondary'}
              >
                {'SMTWTFS'[date.getDay()]}
              </ThemedText>
              <ThemedText
                type="smallBold"
                style={isSelected ? styles.selectedText : undefined}
              >
                {date.getDate()}
              </ThemedText>
              {/* Logged-day dot; hidden while selected — the filled chip already says "look here". */}
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
    ),
    [width, selected, onSelect, loggedDays, theme],
  );

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <FlatList
          ref={listRef}
          data={weekStarts}
          keyExtractor={(w) => w}
          renderItem={renderWeek}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={selectedIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          // Only a couple of pages are ever mounted; the rest are blank
          // space, which keeps the 100+ item window free.
          windowSize={3}
          initialNumToRender={1}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row', gap: Spacing.one },
  chip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: Spacing.one + 2,
    gap: 1,
  },
  selectedText: { color: '#fff' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
});
