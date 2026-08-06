import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { MacroSummary } from '@/components/macro-summary';
import { MealPicker } from '@/components/meal-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getFood, insertFood, touchFoodUsage, updateFood } from '@/db/queries/foods';
import { addEntry } from '@/db/queries/log';
import type { Food, Meal } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, todayKey } from '@/lib/dates';
import { decodeFoodPrefill } from '@/lib/food-prefill';
import { defaultMealForNow } from '@/lib/meals';
import {
  amountToGrams,
  macrosMismatchCalories,
  scaleFood,
  type Amount,
} from '@/lib/nutrition';
import { gToOz, round1 } from '@/lib/units';

const UNITS: Amount['unit'][] = ['serving', 'g', 'oz'];

/**
 * Create/edit a food, and (when opened with ?log=1&day=&meal=) pick an
 * amount and log it. Logging snapshots totals into log_entries (PLAN §5).
 *
 * Layout rule (PLAN Part 4): when logging a food we already know, the screen
 * leads with the SERVING decision — amount, unit, resulting macros — and the
 * per-100 g/per-serving label editor collapses behind "Nutrition facts".
 * The base-values editor is only expanded up front when there's nothing to
 * log yet (a new/scanned food), because then filling it in *is* the task.
 */
export default function FoodScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    id: string;
    log?: string;
    day?: string;
    meal?: Meal;
    barcode?: string;
    /** JSON FoodPrefill from a partial barcode hit (see lib/food-prefill). */
    prefill?: string;
    /** One-line explanation of why this screen opened blank/partial. */
    notice?: string;
  }>();

  const isNew = params.id === 'new';
  const existing = useMemo(
    () => (isNew ? undefined : getFood(Number(params.id))),
    [isNew, params.id],
  );
  const prefill = useMemo(() => decodeFoodPrefill(params.prefill), [params.prefill]);
  const logging = params.log === '1';
  const day = params.day ?? todayKey();

  const [meal, setMeal] = useState<Meal>(params.meal ?? defaultMealForNow());

  // Unknown values must render BLANK, never 0 — a scanned product missing
  // its protein figure is not a zero-protein food (PLAN §7).
  const numText = (v: number | null | undefined) => (v == null ? '' : String(v));

  // --- Food fields ---
  const [name, setName] = useState(existing?.name ?? prefill.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? prefill.brand ?? '');
  const [perHundred, setPerHundred] = useState(
    (existing?.perHundred ?? prefill.perHundred ?? 1) === 1,
  );
  const [calories, setCalories] = useState(
    existing ? String(existing.calories) : numText(prefill.calories),
  );
  const [protein, setProtein] = useState(
    existing ? String(existing.protein) : numText(prefill.protein),
  );
  const [carbs, setCarbs] = useState(existing ? String(existing.carbs) : numText(prefill.carbs));
  const [fat, setFat] = useState(existing ? String(existing.fat) : numText(prefill.fat));
  const [servingQty, setServingQty] = useState(
    numText(existing?.servingQty ?? prefill.servingQty),
  );
  const [servingName, setServingName] = useState(
    existing?.servingName ?? prefill.servingName ?? '',
  );
  const [detailsOpen, setDetailsOpen] = useState(!logging || isNew);

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New food' : existing?.name ?? 'Food' });
  }, [navigation, isNew, existing?.name]);

  const parsedServingQty = parseFloat(servingQty);
  const hasServingQty = isFinite(parsedServingQty) && parsedServingQty > 0;
  const draft: Food = {
    id: existing?.id ?? 0,
    name: name.trim(),
    brand: brand.trim() || null,
    barcode: existing?.barcode ?? prefill.barcode ?? params.barcode ?? null,
    source: existing?.source ?? prefill.source ?? 'custom',
    sourceId: existing?.sourceId ?? prefill.sourceId ?? null,
    perHundred: perHundred ? 1 : 0,
    calories: parseFloat(calories) || 0,
    protein: parseFloat(protein) || 0,
    carbs: parseFloat(carbs) || 0,
    fat: parseFloat(fat) || 0,
    fiber: existing?.fiber ?? prefill.fiber ?? null,
    sugar: existing?.sugar ?? prefill.sugar ?? null,
    satFat: existing?.satFat ?? prefill.satFat ?? null,
    sodiumMg: existing?.sodiumMg ?? prefill.sodiumMg ?? null,
    servingQty: hasServingQty ? parsedServingQty : null,
    servingUnit: hasServingQty ? 'g' : null,
    servingName: servingName.trim() || null,
    useCount: existing?.useCount ?? 0,
    lastUsedAt: existing?.lastUsedAt ?? null,
    isDeleted: 0,
    createdAt: existing?.createdAt ?? 0,
  };

  const foodValid = draft.name.length > 0 && draft.calories >= 0 && calories.trim() !== '';
  const mismatch = macrosMismatchCalories(draft);

  // --- Log amount ---
  // Which units can actually be resolved for this food: 'serving' needs a
  // serving definition, g/oz need a gram-denominated base (per-100 foods
  // always have one; per-serving foods only if the serving size is known).
  const canUseServing = draft.servingQty != null || !perHundred;
  const canUseGrams = perHundred || draft.servingQty != null;
  const availableUnits = UNITS.filter((u) =>
    u === 'serving' ? canUseServing : canUseGrams,
  );

  const [amountValue, setAmountValue] = useState(canUseServing ? '1' : '100');
  const [amountUnit, setAmountUnit] = useState<Amount['unit']>(canUseServing ? 'serving' : 'g');
  // Editing the food can invalidate the selected unit (clearing the serving
  // size while 'serving' is picked) — fall back rather than showing 0 kcal.
  const unit = availableUnits.includes(amountUnit) ? amountUnit : availableUnits[0] ?? 'g';

  const amount: Amount = { unit, value: parseFloat(amountValue) || 0 };
  const totals = scaleFood(draft, amount);
  const grams = amountToGrams(draft, amount);

  /** Switching units keeps the same real quantity (1 serving → 30 g). */
  const changeUnit = (next: Amount['unit']) => {
    if (next === unit) return;
    const currentGrams = amountToGrams(draft, amount);
    if (currentGrams != null && currentGrams > 0) {
      const converted =
        next === 'g'
          ? currentGrams
          : next === 'oz'
            ? gToOz(currentGrams)
            : draft.servingQty
              ? currentGrams / draft.servingQty
              : null;
      if (converted != null) setAmountValue(String(round1(converted)));
    }
    setAmountUnit(next);
  };

  const persistFood = (): Food => {
    if (existing) {
      updateFood(existing.id, {
        name: draft.name,
        brand: draft.brand,
        perHundred: draft.perHundred,
        calories: draft.calories,
        protein: draft.protein,
        carbs: draft.carbs,
        fat: draft.fat,
        servingQty: draft.servingQty,
        servingUnit: draft.servingUnit,
        servingName: draft.servingName,
      });
      return { ...existing, ...draft, id: existing.id };
    }
    const { id: _id, createdAt: _c, ...values } = draft;
    return insertFood(values);
  };

  const save = () => {
    persistFood();
    Alert.alert('Saved', undefined, [{ text: 'OK', onPress: () => router.back() }]);
  };

  const logIt = () => {
    const saved = persistFood();
    addEntry({
      day,
      meal,
      kind: 'food',
      foodId: saved.id,
      name: saved.brand ? `${saved.name} (${saved.brand})` : saved.name,
      amount: round1(amount.value),
      amountUnit: amount.unit,
      // Storing resolved grams is what lets the entry editor later switch
      // units without re-pricing the snapshot (see log-entry/[id]).
      grams: grams != null ? round1(grams) : null,
      ...totals,
    });
    touchFoodUsage(saved.id);
    router.dismissAll();
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { numeric?: boolean; placeholder?: string } = {},
  ) => (
    <View style={styles.fieldRow}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        value={value}
        onChangeText={onChange}
        keyboardType={opts.numeric ? 'numeric' : 'default'}
        placeholder={opts.placeholder ?? '—'}
        placeholderTextColor={theme.textSecondary}
      />
    </View>
  );

  /** The label-values editor: base (per 100 g / per serving) nutrition. */
  const details = (
    <View style={styles.section}>
      {logging && !isNew ? (
        <Pressable style={styles.disclosure} onPress={() => setDetailsOpen((v) => !v)}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            NUTRITION FACTS
          </ThemedText>
          <Ionicons
            name={detailsOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.textSecondary}
          />
        </Pressable>
      ) : (
        <ThemedText type="smallBold" themeColor="textSecondary">
          NUTRITION FACTS
        </ThemedText>
      )}

      {detailsOpen && (
        <>
          {field('Name', name, setName, { placeholder: 'e.g. Greek yogurt' })}
          {field('Brand', brand, setBrand)}
          {!!draft.barcode && (
            <ThemedText type="small" themeColor="textSecondary">
              Barcode {draft.barcode}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            The label values below are per {perHundred ? '100 g' : 'serving'}.
          </ThemedText>
          <View style={styles.segmentRow}>
            {(
              [
                { label: 'per 100 g', value: true },
                { label: 'per serving', value: false },
              ] as const
            ).map((o) => (
              <Pressable
                key={o.label}
                onPress={() => setPerHundred(o.value)}
                style={[
                  styles.segment,
                  {
                    backgroundColor:
                      perHundred === o.value ? theme.backgroundSelected : theme.backgroundElement,
                  },
                ]}
              >
                <ThemedText type={perHundred === o.value ? 'smallBold' : 'small'}>
                  {o.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          {field('Calories (kcal)', calories, setCalories, { numeric: true })}
          {field('Protein (g)', protein, setProtein, { numeric: true })}
          {field('Carbs (g)', carbs, setCarbs, { numeric: true })}
          {field('Fat (g)', fat, setFat, { numeric: true })}
          {field('Serving size (g)', servingQty, setServingQty, {
            numeric: true,
            placeholder: 'e.g. 30',
          })}
          {field('Serving name', servingName, setServingName, { placeholder: 'e.g. 1 scoop' })}
          {mismatch && (
            <ThemedText type="small" style={{ color: '#f2a33c' }}>
              Heads up: macros don’t quite match the calories (4·P + 4·C + 9·F). Double-check the
              label.
            </ThemedText>
          )}
        </>
      )}
    </View>
  );

  const unitLabel = (u: Amount['unit']) =>
    u === 'serving' ? (amount.value === 1 ? 'serving' : 'servings') : u;
  const caption =
    `for ${round1(amount.value)} ${unitLabel(unit)}` +
    (unit !== 'g' && grams != null ? ` · ${Math.round(grams)} g` : '');

  const logCard = (
    <View style={[styles.logCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        LOG TO {dayLabel(day).toUpperCase()}
      </ThemedText>
      <MealPicker value={meal} onChange={setMeal} background={theme.background} />

      <View style={styles.amountRow}>
        <TextInput
          style={[styles.amountInput, { backgroundColor: theme.background, color: theme.text }]}
          value={amountValue}
          onChangeText={setAmountValue}
          keyboardType="numeric"
          selectTextOnFocus
        />
        <View style={styles.segmentRow}>
          {availableUnits.map((u) => (
            <Pressable
              key={u}
              onPress={() => changeUnit(u)}
              style={[
                styles.segment,
                {
                  backgroundColor: unit === u ? theme.backgroundSelected : theme.background,
                },
              ]}
            >
              <ThemedText type={unit === u ? 'smallBold' : 'small'}>{u}</ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      <MacroSummary totals={totals} caption={caption} />

      <Pressable
        style={[styles.primaryButton, { opacity: foodValid ? 1 : 0.4 }]}
        disabled={!foodValid}
        onPress={logIt}
      >
        <ThemedText style={styles.primaryButtonText}>Log</ThemedText>
      </Pressable>
      {!foodValid && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          Add a name and calories below to log this.
        </ThemedText>
      )}
    </View>
  );

  // Header shown when logging a known food: name + what one serving is, so
  // the per-100 g machinery stays out of the way (PLAN Part 4).
  const perServing = canUseServing ? scaleFood(draft, { unit: 'serving', value: 1 }) : null;
  const header = (
    <View style={styles.section}>
      <ThemedText type="subtitle" numberOfLines={2}>
        {draft.name}
      </ThemedText>
      {!!draft.brand && (
        <ThemedText type="small" themeColor="textSecondary">
          {draft.brand}
        </ThemedText>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        {perServing
          ? `${Math.round(perServing.calories)} kcal per serving${
              draft.servingQty ? ` (${round1(draft.servingQty)} g)` : ''
            }${draft.servingName ? ` · ${draft.servingName}` : ''}`
          : `${Math.round(draft.calories)} kcal per 100 g`}
      </ThemedText>
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      // iOS: grow the content inset by the keyboard height so the focused
      // input is scrolled above it instead of hidden behind it.
      automaticallyAdjustKeyboardInsets
    >
      {!!params.notice && (
        <ThemedText type="small" style={{ color: '#f2a33c' }}>
          {params.notice}
        </ThemedText>
      )}

      {logging && !isNew ? (
        <>
          {header}
          {logCard}
          {details}
        </>
      ) : (
        <>
          {details}
          {logging ? (
            logCard
          ) : (
            <Pressable
              style={[styles.primaryButton, { opacity: foodValid ? 1 : 0.4 }]}
              disabled={!foodValid}
              onPress={save}
            >
              <ThemedText style={styles.primaryButtonText}>Save</ThemedText>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  section: { gap: Spacing.two },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: {
    minWidth: 120,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'right',
  },
  segmentRow: { flexDirection: 'row', gap: Spacing.two, flex: 1 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: 10,
  },
  logCard: { borderRadius: 16, padding: Spacing.three, gap: Spacing.three },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amountInput: {
    width: 90,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 10,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  centerText: { textAlign: 'center' },
  primaryButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
});
