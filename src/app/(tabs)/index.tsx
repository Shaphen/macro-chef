import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { BarChart, LineChart } from 'react-native-gifted-charts';

import { MacroBars } from '@/components/macro-bars';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { healthDay } from '@/db/queries/health';
import { dailyCaloriesSince, dayTotals } from '@/db/queries/log';
import type { HealthDay } from '@/db/schema';
import { allWeightsAsc } from '@/db/queries/weight';
import { useDbData } from '@/hooks/use-db-data';
import { useHealthSync } from '@/hooks/use-health-sync';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, formatKcal, formatSteps } from '@/lib/activity-format';
import { addDays, dayLabel, todayKey } from '@/lib/dates';
import {
  computeTrend,
  downsample,
  rollingAverage,
  TIMEFRAMES,
  type TimeframeKey,
  type TrendPoint,
} from '@/lib/trend';
import { formatWeight, kgToLb } from '@/lib/units';
import { useSettings } from '@/state/settings';

const BLUE = '#3c87f7';
const ORANGE = '#f2a33c';
const RED = '#e4573d';

/**
 * Dashboard (PLAN §6): the 3 v1 cards — Today (MacroBars), Weight (trend
 * chart), Calories (intake bars) — with ONE timeframe selector shared by
 * the two chart cards, exactly as specced ("Timeframe selector shared by
 * cards"). Chart data is recomputed per focus via useDbData, so weigh-ins
 * and log entries made in modals appear immediately on return.
 */
export default function DashboardScreen() {
  const theme = useTheme();
  const { settings } = useSettings();
  const { width: windowWidth } = useWindowDimensions();
  const [timeframe, setTimeframe] = useState<TimeframeKey>('1M');

  const days = TIMEFRAMES.find((t) => t.key === timeframe)!.days;
  // null days = "All": use a from-key smaller than any real day key so the
  // string-compare queries/filters pass everything through.
  const fromDay = days ? addDays(todayKey(), -(days - 1)) : '0000-00-00';

  // Apple Health (PLAN Part 3): the Dashboard is the first screen after
  // launch, so it owns the foreground auto-sync; the Activity screen does the
  // same and a module-level guard keeps the two from overlapping.
  const health = useHealthSync({ auto: true });

  const { data, refresh } = useDbData(() => {
    const today = todayKey();
    return {
      totals: dayTotals(today),
      trendAll: computeTrend(allWeightsAsc()),
      calories: dailyCaloriesSince(fromDay),
      activity: healthDay(today),
    };
  }, [fromDay]);

  // A sync finishing while the Dashboard is open must repaint it (useDbData
  // only re-queries on focus, and the sync resolves after focus).
  useEffect(() => {
    if (health.lastResult) refresh();
  }, [health.lastResult, refresh]);

  // Usable width for chart bodies: window minus screen padding, card
  // padding, and the y-axis label gutter the library reserves.
  const chartWidth = windowWidth - Spacing.three * 4 - 44;

  const trendVisible = data.trendAll.filter((p) => p.day >= fromDay);
  const latest = data.trendAll.length ? data.trendAll[data.trendAll.length - 1] : null;

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

      {/* Activity (Apple Health, PLAN Part 3) */}
      <ActivityCard
        row={data.activity}
        available={health.availability.available}
        enabled={health.enabled}
      />

      {/* Shared timeframe selector */}
      <View style={styles.segmentRow}>
        {TIMEFRAMES.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTimeframe(t.key)}
            style={[
              styles.segment,
              {
                backgroundColor:
                  timeframe === t.key ? theme.backgroundSelected : theme.backgroundElement,
              },
            ]}
          >
            <ThemedText type={timeframe === t.key ? 'smallBold' : 'small'}>{t.key}</ThemedText>
          </Pressable>
        ))}
      </View>

      {/* Weight */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          WEIGHT
        </ThemedText>
        <WeightSummary latest={latest} visible={trendVisible} />
        <WeightChart points={trendVisible} width={chartWidth} />
        <Link href="/weight" asChild>
          <Pressable style={styles.secondaryButton}>
            <ThemedText type="smallBold" style={{ color: BLUE }}>
              Log weight
            </ThemedText>
          </Pressable>
        </Link>
      </View>

      {/* Calories */}
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          CALORIES
        </ThemedText>
        <CaloriesChart
          logged={data.calories}
          fromDay={days ? fromDay : data.calories[0]?.day ?? todayKey()}
          target={settings.calorieTarget}
          width={chartWidth}
          trackColor={theme.backgroundSelected}
        />
      </View>
    </ScrollView>
  );
}

/**
 * Today's Apple Health numbers, linking through to the Activity screen.
 * Hidden entirely when HealthKit can't be used (Expo Go, Android) — an
 * always-visible "unavailable" card would be noise on every launch.
 */
function ActivityCard({
  row,
  available,
  enabled,
}: {
  row: HealthDay | undefined;
  available: boolean;
  enabled: boolean;
}) {
  const theme = useTheme();
  if (!available) return null;

  return (
    <Link href="/health" asChild>
      <Pressable style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          ACTIVITY
        </ThemedText>
        {!enabled ? (
          <ThemedText type="smallBold" style={{ color: BLUE }}>
            Connect Apple Health →
          </ThemedText>
        ) : (
          <View style={styles.activityRow}>
            <ActivityStat
              label="Steps"
              value={row?.steps != null ? formatSteps(row.steps) : '—'}
            />
            <ActivityStat
              label="Active"
              value={row?.activeEnergyKcal != null ? formatKcal(row.activeEnergyKcal) : '—'}
            />
            <ActivityStat
              label="Sleep"
              value={row?.sleepMinutes != null ? formatDuration(row.sleepMinutes) : '—'}
            />
          </View>
        )}
      </Pressable>
    </Link>
  );
}

function ActivityStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.activityStat}>
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/** Headline numbers above the weight chart: trend now, Δ over timeframe, vs goal. */
function WeightSummary({
  latest,
  visible,
}: {
  latest: TrendPoint | null;
  visible: TrendPoint[];
}) {
  const { settings } = useSettings();
  if (!latest) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No weigh-ins yet — log your first to start the trend line.
      </ThemedText>
    );
  }
  // Δ over the visible window uses trend values (not raw weigh-ins) so
  // water-weight noise on the endpoint days doesn't fabricate progress.
  const delta = visible.length >= 2 ? latest.trendKg - visible[0].trendKg : null;
  const unit = settings.unitWeight;
  const deltaDisplay =
    delta === null ? null : (unit === 'lb' ? kgToLb(delta) : delta).toFixed(1);
  return (
    <View>
      <ThemedText type="subtitle">{formatWeight(latest.trendKg, unit)}</ThemedText>
      {/* The headline is the smoothed trend, which lags real weigh-ins by
          design (EWMA) — spelling out the latest actual number stops that
          gap from reading as wrong data. */}
      <ThemedText type="small">
        Last weigh-in {formatWeight(latest.weightKg, unit)} · {dayLabel(latest.day)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        trend
        {deltaDisplay !== null
          ? ` · ${delta! >= 0 ? '+' : ''}${deltaDisplay} ${unit} this period`
          : ''}
        {settings.targetWeightKg
          ? ` · goal ${formatWeight(settings.targetWeightKg, unit)}`
          : ''}
      </ThemedText>
    </View>
  );
}

/**
 * Weight card chart (PLAN §6 card 2): bold trend line, raw weigh-ins as
 * faint dots (data2 with an invisible connecting line — only its points
 * render), goal weight as a dashed reference rule. Y axis starts just below
 * the series minimum (yAxisOffset) because body weight far from zero would
 * otherwise flatten the line into the top 5% of the chart.
 */
function WeightChart({ points, width }: { points: TrendPoint[]; width: number }) {
  const theme = useTheme();
  const { settings } = useSettings();
  if (points.length < 2) {
    return points.length === 0 ? null : (
      <ThemedText type="small" themeColor="textSecondary">
        Chart appears after a second weigh-in.
      </ThemedText>
    );
  }

  const unit = settings.unitWeight;
  const toDisplay = (kg: number) => (unit === 'lb' ? kgToLb(kg) : kg);
  const sampled = downsample(points);

  // `day`/`raw` ride along on the data items so the long-press tooltip can
  // report the actual weigh-in behind a point, not just the smoothed value.
  const trendData = sampled.map((p) => ({
    value: toDisplay(p.trendKg),
    day: p.day,
    raw: toDisplay(p.weightKg),
  }));
  const rawData = sampled.map((p) => ({ value: toDisplay(p.weightKg) }));
  const goal = settings.targetWeightKg ? toDisplay(settings.targetWeightKg) : null;

  const values = [
    ...trendData.map((d) => d.value),
    ...rawData.map((d) => d.value),
    ...(goal ? [goal] : []),
  ];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(1, (max - min) * 0.15);
  const yOffset = Math.floor(min - pad);

  return (
    <LineChart
      data={trendData}
      data2={rawData}
      width={width}
      height={160}
      adjustToWidth
      // Trend line: bold, no per-point markers.
      color1={BLUE}
      thickness1={2.5}
      hideDataPoints1
      curved
      // Raw weigh-ins: transparent line so only the faint dots show.
      color2="transparent"
      dataPointsColor2="rgba(60,135,247,0.35)"
      dataPointsRadius2={3}
      yAxisOffset={yOffset}
      maxValue={Math.ceil(max + pad) - yOffset}
      noOfSections={4}
      yAxisColor="transparent"
      xAxisColor={theme.backgroundSelected}
      yAxisTextStyle={{ color: theme.textSecondary, fontSize: 11 }}
      hideRules
      disableScroll
      // Long-press then drag to scrub the series; the tooltip reports the
      // weigh-in logged that day alongside the trend value.
      pointerConfig={{
        activatePointersOnLongPress: true,
        activatePointersDelay: 150,
        pointerStripHeight: 160,
        pointerStripWidth: 1,
        pointerStripColor: theme.textSecondary,
        pointerColor: BLUE,
        radius: 5,
        pointerLabelWidth: 150,
        pointerLabelHeight: 74,
        autoAdjustPointerLabelPosition: true,
        pointerLabelComponent: (items: unknown[]) => (
          <WeightTooltip item={items?.[0] as WeightPoint | undefined} unit={unit} />
        ),
      }}
      {...(goal
        ? {
            showReferenceLine1: true,
            referenceLine1Position: goal,
            referenceLine1Config: {
              color: theme.textSecondary,
              type: 'dashed',
              dashWidth: 4,
              dashGap: 6,
              thickness: 1,
            },
          }
        : {})}
    />
  );
}

interface WeightPoint {
  value: number;
  day: string;
  raw: number;
}

/** Long-press tooltip for the weight chart: the day, its weigh-in, its trend. */
function WeightTooltip({ item, unit }: { item: WeightPoint | undefined; unit: 'lb' | 'kg' }) {
  const theme = useTheme();
  if (!item) return null;
  return (
    <View style={[styles.tooltip, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">{dayLabel(item.day)}</ThemedText>
      <ThemedText type="small">
        Logged {item.raw.toFixed(1)} {unit}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Trend {item.value.toFixed(1)} {unit}
      </ThemedText>
    </View>
  );
}

/**
 * Calories card chart (PLAN §6 card 3): daily intake bars (red when over
 * target), the target as a dashed reference line, and the 7-day rolling
 * average as a line overlay. The series is calendar-filled from `fromDay`
 * so untracked days appear as gaps at zero rather than being skipped —
 * skipping would visually compress time and make streaks look longer.
 */
function CaloriesChart({
  logged,
  fromDay,
  target,
  width,
  trackColor,
}: {
  logged: { day: string; calories: number }[];
  fromDay: string;
  target: number | null;
  width: number;
  trackColor: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  if (logged.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No food logged in this period yet.
      </ThemedText>
    );
  }

  // Fill the calendar between fromDay and today.
  const byDay = new Map(logged.map((l) => [l.day, l.calories]));
  const today = todayKey();
  const series: number[] = [];
  const seriesDays: string[] = [];
  for (let d = fromDay; d <= today; d = addDays(d, 1)) {
    series.push(Math.round(byDay.get(d) ?? 0));
    seriesDays.push(d);
  }
  const avg = rollingAverage(series);
  const sampledIdx = downsample(
    series.map((_, i) => i),
    120, // bars get unreadably thin past this; stride-sample the window
  );

  const barData = sampledIdx.map((i) => ({
    value: series[i],
    frontColor: target && series[i] > target ? RED : BLUE,
  }));
  const selectedDay = selected === null ? null : seriesDays[sampledIdx[selected]];
  const selectedValue = selected === null ? null : series[sampledIdx[selected]];
  const lineData = sampledIdx.map((i) => ({ value: Math.round(avg[i]) }));
  const maxValue = Math.max(target ?? 0, ...series, 100);
  const barSpacing = Math.max(1, Math.floor(width / Math.max(1, barData.length)) - 4);

  return (
    <>
      {/* Tapping a bar pins the day; the pin doubles as a link into that
          day's log, which is the drill-down people actually want from a
          "why was that day high?" glance. */}
      {selectedDay !== null && (
        <Pressable
          style={[styles.barDetail, { backgroundColor: theme.backgroundSelected }]}
          onPress={() =>
            router.push({ pathname: '/(tabs)/log', params: { day: selectedDay } })
          }
        >
          <View style={styles.barDetailText}>
            <ThemedText type="smallBold">
              {dayLabel(selectedDay)} · {selectedValue?.toLocaleString()} kcal
            </ThemedText>
            {target ? (
              <ThemedText type="small" themeColor="textSecondary">
                {(selectedValue ?? 0) - target >= 0 ? '+' : ''}
                {((selectedValue ?? 0) - target).toLocaleString()} vs target
              </ThemedText>
            ) : null}
          </View>
          <ThemedText type="smallBold" style={{ color: BLUE }}>
            Open log →
          </ThemedText>
        </Pressable>
      )}
      <BarChart
      data={barData}
      onPress={(_item: unknown, index: number) =>
        setSelected((prev) => (prev === index ? null : index))
      }
      width={width}
      height={160}
      adjustToWidth
      barWidth={Math.max(3, barSpacing)}
      spacing={4}
      barBorderRadius={2}
      noOfSections={4}
      maxValue={Math.ceil((maxValue * 1.1) / 100) * 100}
      yAxisColor="transparent"
      xAxisColor={trackColor}
      yAxisTextStyle={{ color: theme.textSecondary, fontSize: 11 }}
      hideRules
      disableScroll
      showLine
      lineData={lineData}
      lineConfig={{
        color: ORANGE,
        thickness: 2,
        hideDataPoints: true,
        curved: true,
        // Overlay must line up with bar centers, not the chart origin.
        shiftY: 0,
        initialSpacing: Math.max(3, barSpacing) / 2,
        spacing: Math.max(3, barSpacing) + 4,
      }}
      {...(target
        ? {
            showReferenceLine1: true,
            referenceLine1Position: target,
            referenceLine1Config: {
              color: theme.textSecondary,
              type: 'dashed',
              dashWidth: 4,
              dashGap: 6,
              thickness: 1,
            },
          }
        : {})}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.three },
  segmentRow: { flexDirection: 'row', gap: Spacing.one },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.one + 2, borderRadius: 8 },
  primaryButton: {
    backgroundColor: BLUE,
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { alignItems: 'center', paddingVertical: Spacing.one },
  activityRow: { flexDirection: 'row', justifyContent: 'space-between' },
  activityStat: { gap: 2 },
  tooltip: { borderRadius: 10, padding: Spacing.two, gap: 2 },
  barDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    padding: Spacing.two,
  },
  barDetailText: { gap: 2 },
});
