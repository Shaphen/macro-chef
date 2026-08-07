import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { GenericFoodResults } from '@/components/generic-food-results';
import { MacroSummary } from '@/components/macro-summary';
import { MealPicker } from '@/components/meal-picker';
import { OnlineFoodSearch } from '@/components/online-food-search';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getFood, searchFoods, touchFoodUsage } from '@/db/queries/foods';
import { addEntry } from '@/db/queries/log';
import {
  getRecipe,
  insertRecipe,
  itemsForRecipe,
  softDeleteRecipe,
  updateRecipe,
  type RecipeItemDraft,
} from '@/db/queries/recipes';
import type { Food, Meal } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, todayKey } from '@/lib/dates';
import { defaultMealForNow } from '@/lib/meals';
import { amountToGrams, scaleFood, sumTotals, type Amount } from '@/lib/nutrition';
import { round1 } from '@/lib/units';

/**
 * Recipe builder / editor / logger (PLAN §8, Phase 4). `id=new` creates;
 * otherwise edits. With `?log=1&day=&meal=` (the add-food flow) the screen
 * doubles as the "log N servings" picker, mirroring how food/[id] works so
 * both add paths feel identical.
 *
 * Snapshot semantics in play (PLAN §5), worth spelling out because they're
 * the easiest thing to get subtly wrong:
 *  - The builder holds ingredients as {food, amount} and shows macros
 *    computed from the food's CURRENT values — editing a recipe is
 *    "re-logging" its ingredients, so current values are correct here.
 *  - SAVING writes those computed values into recipe_items as the new item
 *    snapshots. Past LOG entries are untouched — they carry their own
 *    totals — so editing a recipe never rewrites history.
 *  - LOGGING first persists the builder state (so what you log is exactly
 *    what you see), then snapshots per-serving × servings into the entry.
 */

/** Builder-local ingredient: the food row + the amount the user picked. */
interface Ingredient {
  food: Food;
  amount: Amount;
}

/** Default amount for a newly added ingredient: its serving if it has one, else 100 g. */
function defaultAmount(food: Food): Amount {
  return food.servingQty != null || !food.perHundred
    ? { unit: 'serving', value: 1 }
    : { unit: 'g', value: 100 };
}

/** An ingredient's macro contribution, always via lib/nutrition (PLAN §5). */
function ingredientTotals(ing: Ingredient) {
  return scaleFood(ing.food, ing.amount);
}

export default function RecipeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    id: string;
    log?: string;
    day?: string;
    meal?: Meal;
  }>();

  const isNew = params.id === 'new';
  const recipeId = isNew ? null : Number(params.id);
  const existing = useMemo(() => (recipeId ? getRecipe(recipeId) : undefined), [recipeId]);
  const logging = params.log === '1';
  const day = params.day ?? todayKey();

  const [meal, setMeal] = useState<Meal>(params.meal ?? defaultMealForNow());
  const [name, setName] = useState(existing?.name ?? '');
  const [servings, setServings] = useState(existing ? String(existing.servings) : '1');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [logServings, setLogServings] = useState('1');

  // Hydrate ingredients from the stored items, re-attached to their food
  // rows. Amount is rebuilt from what the user originally picked
  // (amount/amount_unit); grams is the fallback for legacy rows. A food row
  // always exists because foods are only ever soft-deleted (PLAN §4).
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => {
    if (!recipeId) return [];
    const out: Ingredient[] = [];
    for (const item of itemsForRecipe(recipeId)) {
      const food = getFood(item.foodId);
      if (!food) continue;
      const amount: Amount =
        item.amount != null && (item.amountUnit === 'g' || item.amountUnit === 'oz' || item.amountUnit === 'serving')
          ? { unit: item.amountUnit, value: item.amount }
          : { unit: 'g', value: item.grams ?? 0 };
      out.push({ food, amount });
    }
    return out;
  });

  const [search, setSearch] = useState('');
  const results = useMemo(() => (search.trim() ? searchFoods(search, 8) : []), [search]);

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New recipe' : existing?.name ?? 'Recipe' });
  }, [navigation, isNew, existing?.name]);

  const parsedServings = parseFloat(servings);
  const servingsValid = isFinite(parsedServings) && parsedServings > 0;
  const totals = sumTotals(ingredients.map(ingredientTotals));
  const perServing = servingsValid
    ? {
        calories: totals.calories / parsedServings,
        protein: totals.protein / parsedServings,
        carbs: totals.carbs / parsedServings,
        fat: totals.fat / parsedServings,
      }
    : totals;

  const valid = name.trim().length > 0 && servingsValid && ingredients.length > 0;

  /** Builder state → item snapshot rows (the only place drafts are built). */
  const toDrafts = (): RecipeItemDraft[] =>
    ingredients.map((ing) => {
      const t = ingredientTotals(ing);
      return {
        foodId: ing.food.id,
        amount: round1(ing.amount.value),
        amountUnit: ing.amount.unit,
        grams: amountToGrams(ing.food, ing.amount),
        ...t,
      };
    });

  /** Insert or update, returning the id — shared by Save and Log. */
  const persist = (): number => {
    const data = { name: name.trim(), servings: parsedServings, notes: notes.trim() || null };
    if (recipeId && existing) {
      updateRecipe(recipeId, data, toDrafts());
      return recipeId;
    }
    return insertRecipe(data, toDrafts()).id;
  };

  const save = () => {
    persist();
    router.back();
  };

  const logIt = () => {
    const id = persist();
    const n = parseFloat(logServings) || 1;
    addEntry({
      day,
      meal,
      kind: 'recipe',
      recipeId: id,
      name: name.trim(),
      amount: round1(n),
      amountUnit: 'serving',
      grams: null,
      calories: round1(perServing.calories * n),
      protein: round1(perServing.protein * n),
      carbs: round1(perServing.carbs * n),
      fat: round1(perServing.fat * n),
    });
    // Ingredient foods count as "used" so they rank up in history search.
    for (const ing of ingredients) touchFoodUsage(ing.food.id);
    router.dismissAll();
  };

  const removeRecipe = () => {
    if (!recipeId) return;
    Alert.alert('Delete recipe', 'Past log entries keep their logged values.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          softDeleteRecipe(recipeId);
          router.back();
        },
      },
    ]);
  };

  const addIngredient = (food: Food) => {
    setIngredients((list) => [...list, { food, amount: defaultAmount(food) }]);
    setSearch('');
  };

  const setIngredientAmount = (index: number, patch: Partial<Amount>) => {
    setIngredients((list) =>
      list.map((ing, i) =>
        i === index ? { ...ing, amount: { ...ing.amount, ...patch } as Amount } : ing,
      ),
    );
  };

  const removeIngredient = (index: number) => {
    setIngredients((list) => list.filter((_, i) => i !== index));
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      // iOS: keep the focused input above the keyboard instead of behind it.
      automaticallyAdjustKeyboardInsets
    >
      <View style={styles.fieldRow}>
        <ThemedText type="small">Name</ThemedText>
        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Chili"
          placeholderTextColor={theme.textSecondary}
        />
      </View>
      <View style={styles.fieldRow}>
        <ThemedText type="small">Makes (servings)</ThemedText>
        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          value={servings}
          onChangeText={setServings}
          keyboardType="numeric"
        />
      </View>
      <View style={styles.fieldRow}>
        <ThemedText type="small">Notes</ThemedText>
        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          value={notes}
          onChangeText={setNotes}
          placeholder="—"
          placeholderTextColor={theme.textSecondary}
        />
      </View>

      <ThemedText type="smallBold" themeColor="textSecondary">
        INGREDIENTS
      </ThemedText>
      {ingredients.map((ing, i) => {
        const t = ingredientTotals(ing);
        const servingAllowed = ing.food.servingQty != null || !ing.food.perHundred;
        return (
          <View key={`${ing.food.id}-${i}`} style={[styles.ingredientCard, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.ingredientHeader}>
              <ThemedText type="small" numberOfLines={1} style={styles.ingredientName}>
                {ing.food.name}
              </ThemedText>
              <Pressable hitSlop={8} onPress={() => removeIngredient(i)}>
                <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.amountInput, { backgroundColor: theme.background, color: theme.text }]}
                value={String(ing.amount.value)}
                onChangeText={(v) => setIngredientAmount(i, { value: parseFloat(v) || 0 })}
                keyboardType="numeric"
              />
              <View style={styles.segmentRow}>
                {(['g', 'oz', 'serving'] as const).map((u) => {
                  const disabled = u === 'serving' && !servingAllowed;
                  return (
                    <Pressable
                      key={u}
                      disabled={disabled}
                      onPress={() => setIngredientAmount(i, { unit: u })}
                      style={[
                        styles.segment,
                        {
                          opacity: disabled ? 0.35 : 1,
                          backgroundColor:
                            ing.amount.unit === u ? theme.backgroundSelected : theme.background,
                        },
                      ]}
                    >
                      <ThemedText type={ing.amount.unit === u ? 'smallBold' : 'small'}>{u}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {Math.round(t.calories)} kcal · P {Math.round(t.protein)} · C {Math.round(t.carbs)} · F{' '}
              {Math.round(t.fat)}
            </ThemedText>
          </View>
        );
      })}
      {ingredients.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Search below to add ingredients — your saved foods first, then Open Food Facts / USDA.
        </ThemedText>
      )}

      <TextInput
        style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        placeholder="Add ingredient"
        placeholderTextColor={theme.textSecondary}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
      />
      {results.map((f) => (
        <Pressable
          key={f.id}
          style={[styles.resultRow, { backgroundColor: theme.backgroundElement }]}
          onPress={() => addIngredient(f)}
        >
          <View style={styles.resultText}>
            <ThemedText type="small" numberOfLines={1}>
              {f.name}
            </ThemedText>
            {!!f.brand && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {f.brand}
              </ThemedText>
            )}
          </View>
          <Ionicons name="add-circle-outline" size={20} color="#3c87f7" />
        </Pressable>
      ))}
      {search.trim().length > 0 && results.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No saved foods match — try searching online below.
        </ThemedText>
      )}

      {/* Ingredients can come from the bundled USDA generics (offline,
          as-you-type) or Open Food Facts / USDA online; picking one saves it
          as a local food first, so the recipe still references a real row
          (and it's reusable everywhere else afterwards). */}
      <GenericFoodResults query={search} onPick={addIngredient} />
      <OnlineFoodSearch query={search} onPick={addIngredient} pickIcon="add-circle-outline" />

      <View style={[styles.totalsCard, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          PER SERVING
        </ThemedText>
        <MacroSummary
          totals={perServing}
          caption={`whole recipe: ${Math.round(totals.calories)} kcal · P ${Math.round(
            totals.protein,
          )} · C ${Math.round(totals.carbs)} · F ${Math.round(totals.fat)}`}
          compact
        />
      </View>

      {logging ? (
        <View style={[styles.totalsCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            LOG TO {dayLabel(day).toUpperCase()}
          </ThemedText>
          <MealPicker value={meal} onChange={setMeal} background={theme.background} />
          <View style={styles.amountRow}>
            <TextInput
              style={[styles.amountInput, { backgroundColor: theme.background, color: theme.text }]}
              value={logServings}
              onChangeText={setLogServings}
              keyboardType="numeric"
              selectTextOnFocus
            />
            <ThemedText type="small" themeColor="textSecondary">
              serving{(parseFloat(logServings) || 1) === 1 ? '' : 's'}
            </ThemedText>
          </View>
          <MacroSummary
            totals={{
              calories: perServing.calories * (parseFloat(logServings) || 1),
              protein: perServing.protein * (parseFloat(logServings) || 1),
              carbs: perServing.carbs * (parseFloat(logServings) || 1),
              fat: perServing.fat * (parseFloat(logServings) || 1),
            }}
          />
          <Pressable
            style={[styles.primaryButton, { opacity: valid ? 1 : 0.4 }]}
            disabled={!valid}
            onPress={logIt}
          >
            <ThemedText style={styles.primaryButtonText}>Log recipe</ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[styles.primaryButton, { opacity: valid ? 1 : 0.4 }]}
          disabled={!valid}
          onPress={save}
        >
          <ThemedText style={styles.primaryButtonText}>Save recipe</ThemedText>
        </Pressable>
      )}

      {!isNew && (
        <Pressable style={styles.deleteButton} onPress={removeRecipe}>
          <ThemedText type="smallBold" style={{ color: '#e4573d' }}>
            Delete recipe
          </ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: {
    minWidth: 140,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'right',
  },
  ingredientCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  ingredientHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  ingredientName: { flex: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amountInput: {
    width: 80,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'right',
  },
  segmentRow: { flexDirection: 'row', gap: Spacing.two, flex: 1 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10 },
  search: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 16 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  resultText: { flex: 1, gap: 1 },
  totalsCard: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  primaryButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  deleteButton: { alignItems: 'center', paddingVertical: Spacing.one },
});
