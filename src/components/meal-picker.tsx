import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Meal } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { MEALS } from '@/lib/meals';

/**
 * Meal chooser shared by every screen that can log or move an entry (add
 * flow, food + recipe serving pickers, entry editor). Every logging path is
 * meal-aware (PLAN §8), so the meal must be visible and changeable at the
 * moment of logging — not just inherited from wherever the flow started.
 */
export function MealPicker({
  value,
  onChange,
  background,
}: {
  value: Meal;
  onChange: (meal: Meal) => void;
  /** Colour of unselected chips; defaults to the screen element colour. */
  background?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {MEALS.map((m) => {
        const selected = value === m.key;
        return (
          <Pressable
            key={m.key}
            onPress={() => onChange(m.key)}
            style={[
              styles.chip,
              {
                backgroundColor: selected
                  ? theme.backgroundSelected
                  : background ?? theme.backgroundElement,
              },
            ]}
          >
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              themeColor={selected ? 'text' : 'textSecondary'}
            >
              {m.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.one + 2 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10 },
});
