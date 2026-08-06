import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { healthDaysSince, workoutsSince } from '@/db/queries/health';
import type { HealthDay, HealthWorkout } from '@/db/schema';
import { useDbData } from '@/hooks/use-db-data';
import { useHealthSync } from '@/hooks/use-health-sync';
import { useTheme } from '@/hooks/use-theme';
import {
  formatDistance,
  formatDuration,
  formatKcal,
  formatSteps,
  formatWorkoutDuration,
} from '@/lib/activity-format';
import { addDays, dayLabel, todayKey } from '@/lib/dates';
import { useSettings } from '@/state/settings';

const BLUE = '#3c87f7';
const ORANGE = '#f2a33c';
const PURPLE = '#8b5cf6';

const RANGES = [
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/**
 * Activity (PLAN Part 3): everything MacroChef reads out of Apple Health —
 * today's rings-style numbers, steps/energy/sleep history, and the workout
 * list. Read-only: nothing here writes back to Health.
 */
export default function HealthScreen() {
  const theme = useTheme();
  const { settings } = useSettings();
  const { width: windowWidth } = useWindowDimensions();
  const health = useHealthSync({ auto: true });
  const [range, setRange] = useState<RangeKey>('1W');

  const days = RANGES.find((r) => r.key === range)!.days;
  const today = todayKey();
  const fromDay = addDays(today, -(days - 1));

  const { data, refresh } = useDbData(
    () => ({
      days: healthDaysSince(fromDay),
      workouts: workoutsSince(fromDay),
    }),
    [fromDay],
  );

  // A sync that lands while this screen is already open must repaint it —
  // useDbData only re-queries on focus, and the sync finishes after focus.
  useEffect(() => {
    if (health.lastResult) refresh();
  }, [health.lastResult, refresh]);

  const chartWidth = windowWidth - Spacing.three * 4 - 44;
  const byDay = new Map(data.days.map((d) => [d.day, d]));
  const todayRow = byDay.get(today);

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect Apple Health',
      'MacroChef stops syncing and forgets the cached steps, energy, sleep and workouts. Weigh-ins already imported into your weight history are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            health.disconnect();
            refresh();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      {/* Connection */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          APPLE HEALTH
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {health.availability.reason}
        </ThemedText>

        {health.availability.available && !health.enabled && (
          <Pressable
            style={[styles.primaryButton, { opacity: health.syncing ? 0.5 : 1 }]}
            disabled={health.syncing}
            onPress={() => health.connect()}
          >
            <ThemedText style={styles.primaryButtonText}>Connect Apple Health</ThemedText>
          </Pressable>
        )}

        {health.enabled && (
          <>
            <View style={styles.syncRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {health.syncing
                  ? 'Syncing…'
                  : health.lastSyncAt
                    ? `Last synced ${new Date(health.lastSyncAt).toLocaleString()}`
                    : 'Not synced yet'}
              </ThemedText>
              {health.syncing && <ActivityIndicator size="small" color={BLUE} />}
            </View>
            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.secondaryButton, { opacity: health.syncing ? 0.5 : 1 }]}
                disabled={health.syncing}
                onPress={() => health.sync()}
              >
                <ThemedText type="smallBold" style={{ color: BLUE }}>
                  Sync now
                </ThemedText>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={confirmDisconnect}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Disconnect
                </ThemedText>
              </Pressable>
            </View>
          </>
        )}

        {health.error && (
          <ThemedText type="small" style={{ color: '#e4573d' }}>
            {health.error}
          </ThemedText>
        )}
        {/* HealthKit never reveals a read denial — an empty sync is the only
            signal the user turned categories off in the Health app. */}
        {health.lastResult?.empty && (
          <ThemedText type="small" themeColor="textSecondary">
            Synced, but Apple Health returned nothing. Check Health app → Sharing → Apps →
            MacroChef and turn the categories on.
          </ThemedText>
        )}
      </View>

      {/* Today */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          TODAY
        </ThemedText>
        <View style={styles.statGrid}>
          <Stat
            label="Steps"
            value={todayRow?.steps != null ? formatSteps(todayRow.steps) : '—'}
            color={BLUE}
          />
          <Stat
            label="Active energy"
            value={
              todayRow?.activeEnergyKcal != null ? formatKcal(todayRow.activeEnergyKcal) : '—'
            }
            color={ORANGE}
          />
          <Stat
            label="Exercise"
            value={
              todayRow?.exerciseMinutes != null ? formatDuration(todayRow.exerciseMinutes) : '—'
            }
            color={ORANGE}
          />
          <Stat
            label="Sleep last night"
            value={todayRow?.sleepMinutes != null ? formatDuration(todayRow.sleepMinutes) : '—'}
            color={PURPLE}
          />
        </View>
        {todayRow?.basalEnergyKcal != null && (
          <ThemedText type="small" themeColor="textSecondary">
            Resting energy {formatKcal(todayRow.basalEnergyKcal)} · total burn{' '}
            {formatKcal(todayRow.basalEnergyKcal + (todayRow.activeEnergyKcal ?? 0))}
          </ThemedText>
        )}
      </View>

      {/* Range selector, shared by the three history charts */}
      <View style={styles.segmentRow}>
        {RANGES.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => setRange(r.key)}
            style={[
              styles.segment,
              {
                backgroundColor:
                  range === r.key ? theme.backgroundSelected : theme.backgroundElement,
              },
            ]}
          >
            <ThemedText type={range === r.key ? 'smallBold' : 'small'}>{r.key}</ThemedText>
          </Pressable>
        ))}
      </View>

      <HistoryCard
        title="STEPS"
        rows={data.days}
        fromDay={fromDay}
        toDay={today}
        pick={(d) => d.steps}
        color={BLUE}
        width={chartWidth}
        summary={(vals) => `${formatSteps(average(vals))} / day average`}
      />
      <HistoryCard
        title="ACTIVE ENERGY"
        rows={data.days}
        fromDay={fromDay}
        toDay={today}
        pick={(d) => d.activeEnergyKcal}
        color={ORANGE}
        width={chartWidth}
        summary={(vals) => `${formatKcal(average(vals))} / day average`}
      />
      <HistoryCard
        title="SLEEP"
        rows={data.days}
        fromDay={fromDay}
        toDay={today}
        // Hours read better than minutes on a y-axis.
        pick={(d) => (d.sleepMinutes == null ? null : d.sleepMinutes / 60)}
        color={PURPLE}
        width={chartWidth}
        summary={(vals) => `${formatDuration(average(vals) * 60)} / night average`}
      />

      {/* Workouts */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          WORKOUTS
        </ThemedText>
        {data.workouts.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No workouts in this period.
          </ThemedText>
        ) : (
          data.workouts.map((w) => (
            <WorkoutRow key={w.uuid} workout={w} unitWeight={settings.unitWeight} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText style={[styles.statValue, { color }]}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * One metric's history. Days with no data are rendered as gaps at zero via
 * the calendar fill — same reasoning as the Calories card: skipping them
 * would compress time and misrepresent consistency.
 */
function HistoryCard({
  title,
  rows,
  fromDay,
  toDay,
  pick,
  color,
  width,
  summary,
}: {
  title: string;
  rows: HealthDay[];
  fromDay: string;
  toDay: string;
  pick: (day: HealthDay) => number | null;
  color: string;
  width: number;
  summary: (values: number[]) => string;
}) {
  const theme = useTheme();
  const byDay = new Map(rows.map((r) => [r.day, r]));

  const series: number[] = [];
  const present: number[] = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    const row = byDay.get(d);
    const value = row ? pick(row) : null;
    series.push(value ?? 0);
    if (value != null) present.push(value);
  }

  const barWidth = Math.max(3, Math.floor(width / Math.max(1, series.length)) - 4);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {title}
      </ThemedText>
      {present.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing synced for this period.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small">{summary(present)}</ThemedText>
          <BarChart
            data={series.map((value) => ({ value, frontColor: color }))}
            width={width}
            height={140}
            adjustToWidth
            barWidth={barWidth}
            spacing={4}
            barBorderRadius={2}
            noOfSections={3}
            maxValue={Math.max(...series) * 1.1 || 1}
            yAxisColor="transparent"
            xAxisColor={theme.backgroundSelected}
            yAxisTextStyle={{ color: theme.textSecondary, fontSize: 11 }}
            hideRules
            disableScroll
          />
        </>
      )}
    </View>
  );
}

function WorkoutRow({
  workout,
  unitWeight,
}: {
  workout: HealthWorkout;
  unitWeight: 'lb' | 'kg';
}) {
  const detail = [
    formatWorkoutDuration(workout.durationSec),
    workout.energyKcal != null ? formatKcal(workout.energyKcal) : null,
    workout.distanceM ? formatDistance(workout.distanceM, unitWeight) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.workoutRow}>
      <View style={styles.workoutMain}>
        <ThemedText type="smallBold">{workout.activity}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {dayLabel(workout.day)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.three },
  stat: { width: '50%', gap: 2 },
  statValue: { fontSize: 20, fontWeight: '700' },
  segmentRow: { flexDirection: 'row', gap: Spacing.two },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  buttonRow: { flexDirection: 'row', gap: Spacing.two },
  primaryButton: {
    backgroundColor: BLUE,
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two },
  workoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  workoutMain: { flex: 1, gap: 2 },
});
