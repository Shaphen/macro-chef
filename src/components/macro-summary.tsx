import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MacroColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MacroTotals } from '@/lib/nutrition';

/**
 * "What am I actually logging?" — the headline macro readout shown under the
 * amount inputs on every logging/editing screen.
 *
 * It replaced a single line of 14 pt secondary text that was the most
 * important number on those screens and the least visible: calories get
 * display size, each macro gets its own colour-keyed column (same colours as
 * MacroBars), and everything stays on one row so it fits above the keyboard.
 */
export function MacroSummary({
  totals,
  caption,
  compact = false,
}: {
  totals: MacroTotals;
  /** Optional line under the numbers, e.g. "for 1 serving (30 g)". */
  caption?: string;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <View style={styles.calorieRow}>
        <ThemedText style={[styles.calories, compact && styles.caloriesCompact]}>
          {Math.round(totals.calories).toLocaleString()}
        </ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">
          kcal
        </ThemedText>
      </View>
      <View style={styles.macroRow}>
        <Macro label="Protein" grams={totals.protein} color={MacroColors.protein} />
        <Macro label="Carbs" grams={totals.carbs} color={MacroColors.carbs} />
        <Macro label="Fat" grams={totals.fat} color={MacroColors.fat} />
      </View>
      {!!caption && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
          {caption}
        </ThemedText>
      )}
      <View style={[styles.hairline, { backgroundColor: theme.backgroundSelected }]} />
    </View>
  );
}

function Macro({ label, grams, color }: { label: string; grams: number; color: string }) {
  return (
    <View style={styles.macro}>
      <View style={[styles.macroBar, { backgroundColor: color }]} />
      <ThemedText style={styles.macroValue}>{Math.round(grams)} g</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  calorieRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one + 2 },
  calories: { fontSize: 36, lineHeight: 42, fontWeight: '700' },
  caloriesCompact: { fontSize: 28, lineHeight: 34 },
  macroRow: { flexDirection: 'row', gap: Spacing.two },
  macro: { flex: 1, gap: 2 },
  macroBar: { height: 3, borderRadius: 2, marginBottom: 2 },
  macroValue: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  caption: { marginTop: 2 },
  hairline: { height: StyleSheet.hairlineWidth, marginTop: Spacing.one },
});
