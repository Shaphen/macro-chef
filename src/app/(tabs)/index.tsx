import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
const PURPLE = '#8b5cf6';

/** Hold time before the weight chart's scrub pointer takes over the touch. */
const ACTIVATE_DELAY = 150;

/**
 * Weight-chart tooltip geometry. Both constants are load-bearing and must be
 * changed together.
 *
 * gifted-charts' `autoAdjustPointerLabelPosition` centres the label at
 * `-pointerLabelWidth / 2 + 5` from the pointer, but only flips it to the
 * LEFT of the pointer once `pointerX > totalWidth + 10 - pointerLabelWidth / 2`.
 * Solving those so the flip always happens before the label's right edge
 * crosses the plot edge gives `pointerLabelWidth >= width + 15`.
 *
 * Two consequences: the tooltip needs a FIXED width (otherwise the boundary
 * is computed against a width the label doesn't actually have — an
 * auto-sized label overflowed on the newest points, which are the ones you
 * scrub most), and pointerLabelWidth is a positioning input only, NOT the
 * rendered width, so it is deliberately larger than the tooltip itself.
 */
const TOOLTIP_WIDTH = 150;
const TOOLTIP_POINTER_WIDTH = TOOLTIP_WIDTH + 20;

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
  // Scrubbing the weight chart and scrolling the dashboard are the same
  // gesture (a finger dragging), so the page has to hold still while the
  // chart owns the touch — otherwise reading a data point scrolls it off
  // screen. The chart flips this once its long-press activates.
  const [scrubbing, setScrubbing] = useState(false);

  // The scrub tooltip persists after you lift your finger (PLAN Part 4.1),
  // so it needs an explicit way out: a touch anywhere OUTSIDE the chart
  // dismisses it. gifted-charts exposes no imperative "clear pointer" (its
  // LineChart isn't a forwardRef), so the chart is remounted by key — which
  // is invisible here because `isAnimated` defaults to false, making the
  // redraw instant rather than a replayed line-draw.
  const [chartKey, setChartKey] = useState(0);
  // Only remount when a tooltip is actually on screen; otherwise every page
  // scroll would rebuild the chart for nothing.
  const [pointerVisible, setPointerVisible] = useState(false);
  // Touch events bubble target→root, so the chart's own handler runs first
  // and marks the touch as "started inside the chart" before the page-level
  // handler decides whether to dismiss. Without this, beginning a new
  // long-press would tear down the chart mid-gesture.
  const touchedChart = useRef(false);

  const handleScrub = (active: boolean) => {
    setScrubbing(active);
    // Not cleared on release — that is the whole point of persistPointer.
    if (active) setPointerVisible(true);
  };

  const handleTouchStart = () => {
    if (!touchedChart.current && pointerVisible) {
      setChartKey((k) => k + 1);
      setPointerVisible(false);
    }
    touchedChart.current = false;
  };

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
      scrollEnabled={!scrubbing}
      // Safety net: touch events bubble, so any lifted finger re-enables
      // scrolling even if the chart's own end-handler is missed. A page you
      // can't scroll is a much worse failure than an early unlock.
      onTouchEnd={() => setScrubbing(false)}
      onTouchCancel={() => setScrubbing(false)}
      // Same bubbling: this sees every touch on the page, and dismisses the
      // persistent chart tooltip unless the touch began on the chart itself.
      onTouchStart={handleTouchStart}
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
        {/* Marks touches that START on the chart so the page-level handler
            leaves them alone — a new long-press must not dismiss/remount the
            chart out from under the gesture that is creating the tooltip. */}
        <View
          onTouchStart={() => {
            touchedChart.current = true;
          }}
        >
          <WeightChart
            key={chartKey}
            points={trendVisible}
            width={chartWidth}
            onScrub={handleScrub}
          />
        </View>
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
 *
 * Sized to match the other Dashboard cards rather than sitting under them as
 * a caption: four display-size metrics in a 2×2 grid, accent-coloured to the
 * same families the Activity screen uses (steps blue, energy/exercise
 * orange, sleep purple), with the resting/total burn line underneath when
 * Health has it. The whole card is still one tap through to the charts.
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
        <View style={styles.cardHeader}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            ACTIVITY
          </ThemedText>
          {enabled && (
            <ThemedText type="smallBold" style={{ color: BLUE }}>
              Details →
            </ThemedText>
          )}
        </View>
        {!enabled ? (
          <ThemedText type="smallBold" style={{ color: BLUE }}>
            Connect Apple Health →
          </ThemedText>
        ) : (
          <>
            <View style={styles.activityGrid}>
              <ActivityStat
                label="Steps"
                value={row?.steps != null ? formatSteps(row.steps) : '—'}
                color={BLUE}
              />
              <ActivityStat
                label="Active energy"
                value={row?.activeEnergyKcal != null ? formatKcal(row.activeEnergyKcal) : '—'}
                color={ORANGE}
              />
              <ActivityStat
                label="Exercise"
                value={row?.exerciseMinutes != null ? formatDuration(row.exerciseMinutes) : '—'}
                color={ORANGE}
              />
              <ActivityStat
                label="Sleep last night"
                value={row?.sleepMinutes != null ? formatDuration(row.sleepMinutes) : '—'}
                color={PURPLE}
              />
            </View>
            {row?.basalEnergyKcal != null && (
              <ThemedText type="small" themeColor="textSecondary">
                Resting {formatKcal(row.basalEnergyKcal)} · total burn{' '}
                {formatKcal(row.basalEnergyKcal + (row.activeEnergyKcal ?? 0))}
              </ThemedText>
            )}
          </>
        )}
      </Pressable>
    </Link>
  );
}

function ActivityStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.activityStat}>
      <ThemedText style={[styles.activityStatValue, { color }]}>{value}</ThemedText>
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
function WeightChart({
  points,
  width,
  onScrub,
}: {
  points: TrendPoint[];
  width: number;
  /** Told when the long-press scrub owns the touch, so the page can freeze. */
  onScrub: (active: boolean) => void;
}) {
  const theme = useTheme();
  const { settings } = useSettings();

  // The library activates its pointer after ACTIVATE_DELAY of holding, and
  // gives us no callback at that moment — so mirror its rule with our own
  // timer and lock the parent scroll at the same instant. Locking on touch
  // *start* instead would make a plain flick across the chart un-scrollable.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => onScrub(true), ACTIVATE_DELAY);
  };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    onScrub(false);
  };
  // Never leave the page frozen if the touch is torn down with the screen.
  useEffect(() => endHold, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <>
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
      // weigh-in logged that day alongside the trend value, and persists
      // after you lift your finger so the reading survives moving your hand
      // out of the way.
      pointerConfig={{
        activatePointersOnLongPress: true,
        activatePointersDelay: ACTIVATE_DELAY,
        persistPointer: true,
        onTouchStart: beginHold,
        onTouchEnd: endHold,
        onResponderEnd: endHold,
        pointerStripHeight: 160,
        pointerStripWidth: 1,
        pointerStripColor: theme.textSecondary,
        pointerColor: BLUE,
        radius: 5,
        pointerLabelWidth: TOOLTIP_POINTER_WIDTH,
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
    <ThemedText type="small" themeColor="textSecondary" style={styles.chartHint}>
      Press and hold the chart to read a day · tap anywhere else to dismiss.
    </ThemedText>
    </>
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activityGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.three },
  activityStat: { width: '50%', gap: 2 },
  activityStatValue: { fontSize: 20, fontWeight: '700' },
  // Fixed width — see TOOLTIP_WIDTH: the edge-flip boundary is computed from
  // pointerLabelWidth, so an auto-sized label makes it wrong.
  tooltip: { width: TOOLTIP_WIDTH, borderRadius: 10, padding: Spacing.two, gap: 2 },
  chartHint: { textAlign: 'center' },
  barDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    padding: Spacing.two,
  },
  barDetailText: { gap: 2 },
});
