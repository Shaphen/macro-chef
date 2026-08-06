import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MacroColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MacroTotals } from '@/lib/nutrition';
import { useSettings } from '@/state/settings';

/**
 * The core "targets visible everywhere" component (PLAN §6): calories eaten
 * vs target plus P/C/F progress bars. Rendered on the dashboard, the log
 * header, and the add-food flow.
 */
export function MacroBars({ totals, compact = false }: { totals: MacroTotals; compact?: boolean }) {
  const theme = useTheme();
  const { settings } = useSettings();

  const kcalTarget = settings.calorieTarget ?? 0;
  const remaining = kcalTarget > 0 ? Math.round(kcalTarget - totals.calories) : null;

  return (
    <View style={styles.container}>
      <View style={styles.calRow}>
        <ThemedText type={compact ? 'smallBold' : 'subtitle'}>
          {Math.round(totals.calories)}
          <ThemedText type="small" themeColor="textSecondary">
            {kcalTarget > 0 ? ` / ${kcalTarget} kcal` : ' kcal'}
          </ThemedText>
        </ThemedText>
        {remaining !== null && (
          <ThemedText type="small" themeColor="textSecondary">
            {remaining >= 0 ? `${remaining} left` : `${-remaining} over`}
          </ThemedText>
        )}
      </View>
      <Bar
        label="Protein"
        value={totals.protein}
        target={settings.proteinTargetG}
        color={MacroColors.protein}
        trackColor={theme.backgroundSelected}
        compact={compact}
      />
      <Bar
        label="Carbs"
        value={totals.carbs}
        target={settings.carbTargetG}
        color={MacroColors.carbs}
        trackColor={theme.backgroundSelected}
        compact={compact}
      />
      <Bar
        label="Fat"
        value={totals.fat}
        target={settings.fatTargetG}
        color={MacroColors.fat}
        trackColor={theme.backgroundSelected}
        compact={compact}
      />
    </View>
  );
}

function Bar({
  label,
  value,
  target,
  color,
  trackColor,
  compact,
}: {
  label: string;
  value: number;
  target: number | null;
  color: string;
  trackColor: string;
  compact: boolean;
}) {
  const pct = target && target > 0 ? Math.min(1, value / target) : 0;
  return (
    <View style={styles.barBlock}>
      <View style={styles.barLabels}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {Math.round(value)}
          {target ? ` / ${target} g` : ' g'}
        </ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: trackColor, height: compact ? 4 : 8 }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: color, width: `${pct * 100}%`, height: compact ? 4 : 8 },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  calRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  barBlock: { gap: Spacing.half },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { borderRadius: 4, overflow: 'hidden' },
  fill: { borderRadius: 4 },
});
