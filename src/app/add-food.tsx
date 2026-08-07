import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { GenericFoodResults } from '@/components/generic-food-results';
import { MealPicker } from '@/components/meal-picker';
import { OnlineFoodSearch } from '@/components/online-food-search';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { recentFoods, searchFoods } from '@/db/queries/foods';
import { addEntry } from '@/db/queries/log';
import { listRecipes } from '@/db/queries/recipes';
import type { Meal } from '@/db/schema';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, todayKey } from '@/lib/dates';
import { defaultMealForNow } from '@/lib/meals';
import { round1 } from '@/lib/units';

/**
 * The meal-aware add flow (PLAN §8): Search | Scan | Quick | Recipes.
 * Search order is deliberate — History (recency + frequency), then local
 * matches, then online sources behind explicit buttons so typing never
 * fires network requests on its own (see OnlineFoodSearch).
 *
 * The meal is chosen HERE and threaded into every path (scan, quick add,
 * food and recipe serving pickers). Entering from the Dashboard used to mean
 * "snack" whether you liked it or not; now the clock picks the starting meal
 * and the picker is always on screen.
 */
export default function AddFoodScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string; meal?: Meal }>();
  const day = params.day ?? todayKey();

  const [meal, setMeal] = useState<Meal>(params.meal ?? defaultMealForNow());
  const [query, setQuery] = useState('');
  const [showQuick, setShowQuick] = useState(false);
  const [showRecipes, setShowRecipes] = useState(false);

  const { data } = useDbData(
    () => ({
      localFoods: query.trim() ? searchFoods(query) : recentFoods(20),
      recipes: showRecipes ? listRecipes() : [],
    }),
    [query, showRecipes],
  );

  const openFood = (id: number) =>
    router.push({
      pathname: '/food/[id]',
      params: { id: String(id), log: '1', day, meal },
    });

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <ThemedText type="small" themeColor="textSecondary">
        Adding to {dayLabel(day)}
      </ThemedText>
      <MealPicker value={meal} onChange={setMeal} />

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.action, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push({ pathname: '/scan', params: { day, meal } })}
        >
          <Ionicons name="barcode-outline" size={22} color={theme.text} />
          <ThemedText type="smallBold">Scan</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.action, { backgroundColor: theme.backgroundElement }]}
          onPress={() => {
            setShowQuick((v) => !v);
            setShowRecipes(false);
          }}
        >
          <Ionicons name="flash-outline" size={22} color={theme.text} />
          <ThemedText type="smallBold">Quick</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.action, { backgroundColor: theme.backgroundElement }]}
          onPress={() => {
            setShowRecipes((v) => !v);
            setShowQuick(false);
          }}
        >
          <Ionicons name="book-outline" size={22} color={theme.text} />
          <ThemedText type="smallBold">Recipes</ThemedText>
        </Pressable>
      </View>

      {showQuick && <QuickAdd day={day} meal={meal} onDone={() => router.back()} />}

      {showRecipes && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            MY RECIPES
          </ThemedText>
          {data.recipes.map((r) => (
            <Pressable
              key={r.id}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}
              onPress={() =>
                router.push({
                  pathname: '/recipe/[id]',
                  params: { id: String(r.id), log: '1', day, meal },
                })
              }
            >
              <View style={styles.rowText}>
                <ThemedText type="small" numberOfLines={1}>
                  {r.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {r.servings} serving{r.servings === 1 ? '' : 's'}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>
          ))}
          {data.recipes.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              No recipes yet — build one from the Foods tab.
            </ThemedText>
          )}
        </>
      )}

      <TextInput
        style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        placeholder="Search foods"
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />

      <ThemedText type="smallBold" themeColor="textSecondary">
        {query.trim() ? 'MY FOODS' : 'HISTORY'}
      </ThemedText>
      {data.localFoods.map((f) => (
        <Pressable
          key={f.id}
          style={[styles.row, { backgroundColor: theme.backgroundElement }]}
          onPress={() => openFood(f.id)}
        >
          <View style={styles.rowText}>
            <ThemedText type="small" numberOfLines={1}>
              {f.name}
            </ThemedText>
            {!!f.brand && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {f.brand}
              </ThemedText>
            )}
          </View>
          <ThemedText type="smallBold">{Math.round(f.calories)} kcal</ThemedText>
        </Pressable>
      ))}
      {data.localFoods.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing saved yet.
        </ThemedText>
      )}

      {/* Bundled USDA generics answer as you type (offline); the online
          sources below stay behind their explicit tap. */}
      <GenericFoodResults query={query} onPick={(food) => openFood(food.id)} />

      <OnlineFoodSearch query={query} onPick={(food) => openFood(food.id)} />
    </ScrollView>
  );
}

function QuickAdd({ day, meal, onDone }: { day: string; meal: Meal; onDone: () => void }) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const kcal = parseFloat(calories);
  const valid = isFinite(kcal) && kcal >= 0;

  const log = () => {
    addEntry({
      day,
      meal,
      kind: 'quick',
      name: name.trim() || 'Quick add',
      calories: round1(kcal),
      protein: round1(parseFloat(protein) || 0),
      carbs: round1(parseFloat(carbs) || 0),
      fat: round1(parseFloat(fat) || 0),
    });
    onDone();
  };

  const input = (
    placeholder: string,
    value: string,
    onChange: (v: string) => void,
    numeric = true,
  ) => (
    <TextInput
      style={[styles.quickInput, { backgroundColor: theme.background, color: theme.text }]}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      value={value}
      onChangeText={onChange}
      keyboardType={numeric ? 'numeric' : 'default'}
    />
  );

  return (
    <View style={[styles.quickCard, { backgroundColor: theme.backgroundElement }]}>
      {input('Name (optional)', name, setName, false)}
      <View style={styles.quickRow}>
        {input('kcal', calories, setCalories)}
        {input('P g', protein, setProtein)}
        {input('C g', carbs, setCarbs)}
        {input('F g', fat, setFat)}
      </View>
      <Pressable
        style={[styles.logButton, { opacity: valid ? 1 : 0.4 }]}
        disabled={!valid}
        onPress={log}
      >
        <ThemedText style={styles.logButtonText}>Log</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  action: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one + 2,
    borderRadius: 12,
    paddingVertical: Spacing.three,
  },
  search: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  rowText: { flex: 1, gap: 1 },
  quickCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  quickRow: { flexDirection: 'row', gap: Spacing.two },
  quickInput: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 15,
  },
  logButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  logButtonText: { color: '#fff', fontWeight: '700' },
});
