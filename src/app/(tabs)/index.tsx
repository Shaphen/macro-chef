import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MacroBars } from '@/components/macro-bars';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dailyCaloriesSince, dayTotals } from '@/db/queries/log';
import { allWeightsAsc } from '@/db/queries/weight';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';
import { addDays, todayKey } from '@/lib/dates';
import { computeTrend } from '@/lib/trend';
import { formatWeight } from '@/lib/units';
import { useSettings } from '@/state/settings';

export default function DashboardScreen() {
  const theme = useTheme();
  const { settings } = useSettings();

  const { data } = useDbData(() => {
    const today = todayKey();
    const weights = allWeightsAsc();
    return {
      totals: dayTotals(today),
      trend: computeTrend(weights),
      week: dailyCaloriesSince(addDays(today, -6)),
    };
  });

  const latest = data.trend.length ? data.trend[data.trend.length - 1] : null;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      {/* Today */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          TODAY
        </ThemedText>
        <MacroBars totals={data.totals} />
        <Link href="/add-food" asChild>
          <Pressable style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>+ Add food</ThemedText>
          </Pressable>
        </Link>
      </View>

      {/* Weight */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          WEIGHT
        </ThemedText>
        {latest ? (
          <View>
            <ThemedText type="subtitle">
              {formatWeight(latest.trendKg, settings.unitWeight)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              trend · last weigh-in {formatWeight(latest.weightKg, settings.unitWeight)}
              {settings.targetWeightKg
                ? ` · goal ${formatWeight(settings.targetWeightKg, settings.unitWeight)}`
                : ''}
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No weigh-ins yet — log your first to start the trend line.
          </ThemedText>
        )}
        <Link href="/weight" asChild>
          <Pressable style={styles.secondaryButton}>
            <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
              Log weight
            </ThemedText>
          </Pressable>
        </Link>
      </View>

      {/* Calories, last 7 days */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          CALORIES · LAST 7 DAYS
        </ThemedText>
        <WeekBars
          week={data.week}
          target={settings.calorieTarget}
          barColor="#3c87f7"
          trackColor={theme.backgroundSelected}
        />
      </View>
    </ScrollView>
  );
}

/** Placeholder mini-chart; Phase 3 swaps in react-native-gifted-charts with timeframes. */
function WeekBars({
  week,
  target,
  barColor,
  trackColor,
}: {
  week: { day: string; calories: number }[];
  target: number | null;
  barColor: string;
  trackColor: string;
}) {
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const byDay = new Map(week.map((w) => [w.day, w.calories]));
  const max = Math.max(target ?? 0, ...days.map((d) => byDay.get(d) ?? 0), 1);

  return (
    <View style={styles.weekRow}>
      {days.map((d) => {
        const kcal = byDay.get(d) ?? 0;
        const over = target != null && target > 0 && kcal > target;
        return (
          <View key={d} style={styles.weekCol}>
            <View style={[styles.weekTrack, { backgroundColor: trackColor }]}>
              <View
                style={{
                  height: `${(kcal / max) * 100}%`,
                  backgroundColor: over ? '#e4573d' : barColor,
                  borderRadius: 3,
                }}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {d.slice(8)}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.three },
  primaryButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { alignItems: 'center', paddingVertical: Spacing.one },
  weekRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  weekCol: { flex: 1, alignItems: 'center', gap: Spacing.one },
  weekTrack: {
    height: 96,
    width: '100%',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
});
