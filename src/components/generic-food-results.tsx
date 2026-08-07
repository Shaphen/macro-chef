import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getFoodBySource, insertFood } from '@/db/queries/foods';
import { searchSeedFoods } from '@/db/queries/seed-foods';
import type { Food, SeedFood } from '@/db/schema';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';
import { seedFoodToNewFood } from '@/lib/seed-foods';

/**
 * As-you-type results from the bundled offline generic-food database (PLAN
 * Part 5) — the everyday "chicken breast" case answered instantly with no
 * network, sitting between the user's own foods and the explicit
 * "Search online" button. Purely local, so unlike OnlineFoodSearch it's
 * fine to run on every keystroke.
 *
 * Picking a result copies it into `foods` (same source 'usda' + fdcId
 * dedupe as the USDA proxy path) and hands back the local row. Seed hits
 * already saved locally are hidden — they're in the caller's MY FOODS
 * section; showing them twice would just be noise.
 */
export function GenericFoodResults({
  query,
  onPick,
  pickIcon = 'add-circle-outline',
}: {
  query: string;
  onPick: (food: Food) => void;
  pickIcon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const trimmed = query.trim();

  const { data } = useDbData(
    () =>
      trimmed.length < 2
        ? []
        : searchSeedFoods(trimmed).filter((s) => !getFoodBySource('usda', String(s.fdcId))),
    [trimmed],
  );

  if (data.length === 0) return null;

  const pick = (seed: SeedFood) => {
    // Re-check at tap time — the focus-scoped query above can be stale.
    const existing = getFoodBySource('usda', String(seed.fdcId));
    onPick(existing ?? insertFood(seedFoodToNewFood(seed)));
  };

  return (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary">
        GENERIC FOODS (USDA)
      </ThemedText>
      {data.map((s) => (
        <Pressable
          key={s.fdcId}
          style={[styles.row, { backgroundColor: theme.backgroundElement }]}
          onPress={() => pick(s)}
        >
          <View style={styles.rowText}>
            <ThemedText type="small" numberOfLines={1}>
              {s.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {Math.round(s.calories)} kcal / 100 g
              {s.servingName ? ` · ${s.servingName} = ${Math.round(s.servingQty ?? 0)} g` : ''}
            </ThemedText>
          </View>
          <Ionicons name={pickIcon} size={18} color={theme.textSecondary} />
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  rowText: { flex: 1, gap: 1 },
});
