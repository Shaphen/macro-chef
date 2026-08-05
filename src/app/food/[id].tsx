import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getFood, insertFood, touchFoodUsage, updateFood } from '@/db/queries/foods';
import { addEntry } from '@/db/queries/log';
import type { Food, Meal } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/dates';
import {
  macrosMismatchCalories,
  scaleFood,
  type Amount,
} from '@/lib/nutrition';
import { round1 } from '@/lib/units';

/**
 * Create/edit a food, and (when opened with ?log=1&day=&meal=) pick an
 * amount and log it. Logging snapshots totals into log_entries (PLAN §5).
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
  }>();

  const isNew = params.id === 'new';
  const existing = useMemo(
    () => (isNew ? undefined : getFood(Number(params.id))),
    [isNew, params.id],
  );
  const logging = params.log === '1';
  const day = params.day ?? todayKey();
  const meal: Meal = params.meal ?? 'snack';

  // --- Food fields ---
  const [name, setName] = useState(existing?.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [perHundred, setPerHundred] = useState((existing?.perHundred ?? 1) === 1);
  const [calories, setCalories] = useState(existing ? String(existing.calories) : '');
  const [protein, setProtein] = useState(existing ? String(existing.protein) : '');
  const [carbs, setCarbs] = useState(existing ? String(existing.carbs) : '');
  const [fat, setFat] = useState(existing ? String(existing.fat) : '');
  const [servingQty, setServingQty] = useState(existing?.servingQty ? String(existing.servingQty) : '');
  const [servingName, setServingName] = useState(existing?.servingName ?? '');

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New food' : existing?.name ?? 'Food' });
  }, [navigation, isNew, existing?.name]);

  const parsedServingQty = parseFloat(servingQty);
  const draft: Food = {
    id: existing?.id ?? 0,
    name: name.trim(),
    brand: brand.trim() || null,
    barcode: existing?.barcode ?? params.barcode ?? null,
    source: existing?.source ?? 'custom',
    sourceId: existing?.sourceId ?? null,
    perHundred: perHundred ? 1 : 0,
    calories: parseFloat(calories) || 0,
    protein: parseFloat(protein) || 0,
    carbs: parseFloat(carbs) || 0,
    fat: parseFloat(fat) || 0,
    fiber: existing?.fiber ?? null,
    sugar: existing?.sugar ?? null,
    satFat: existing?.satFat ?? null,
    sodiumMg: existing?.sodiumMg ?? null,
    servingQty: isFinite(parsedServingQty) && parsedServingQty > 0 ? parsedServingQty : null,
    servingUnit: isFinite(parsedServingQty) && parsedServingQty > 0 ? 'g' : null,
    servingName: servingName.trim() || null,
    useCount: existing?.useCount ?? 0,
    lastUsedAt: existing?.lastUsedAt ?? null,
    isDeleted: 0,
    createdAt: existing?.createdAt ?? 0,
  };

  const foodValid = draft.name.length > 0 && draft.calories >= 0 && calories.trim() !== '';
  const mismatch = macrosMismatchCalories(draft);

  // --- Log amount ---
  const canUseServing = draft.servingQty != null || !perHundred;
  const [amountValue, setAmountValue] = useState(canUseServing ? '1' : '100');
  const [amountUnit, setAmountUnit] = useState<Amount['unit']>(canUseServing ? 'serving' : 'g');

  const amount: Amount = { unit: amountUnit, value: parseFloat(amountValue) || 0 };
  const totals = scaleFood(draft, amount);

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
      grams: null,
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

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {field('Name', name, setName, { placeholder: 'e.g. Greek yogurt' })}
      {field('Brand', brand, setBrand)}
      {!!draft.barcode && (
        <ThemedText type="small" themeColor="textSecondary">
          Barcode {draft.barcode}
        </ThemedText>
      )}

      <ThemedText type="smallBold" themeColor="textSecondary">
        NUTRITION {perHundred ? 'PER 100 G' : 'PER SERVING'}
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
            <ThemedText type={perHundred === o.value ? 'smallBold' : 'small'}>{o.label}</ThemedText>
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
          Heads up: macros don’t quite match the calories (4·P + 4·C + 9·F). Double-check the label.
        </ThemedText>
      )}

      {logging ? (
        <View style={[styles.logCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            LOG TO {meal.toUpperCase()} · {day}
          </ThemedText>
          <View style={styles.amountRow}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.background, color: theme.text }]}
              value={amountValue}
              onChangeText={setAmountValue}
              keyboardType="numeric"
            />
            <View style={styles.segmentRow}>
              {(['g', 'oz', 'serving'] as const).map((u) => {
                const disabled = u === 'serving' && !canUseServing;
                return (
                  <Pressable
                    key={u}
                    disabled={disabled}
                    onPress={() => setAmountUnit(u)}
                    style={[
                      styles.segment,
                      {
                        opacity: disabled ? 0.35 : 1,
                        backgroundColor:
                          amountUnit === u ? theme.backgroundSelected : theme.background,
                      },
                    ]}
                  >
                    <ThemedText type={amountUnit === u ? 'smallBold' : 'small'}>{u}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {Math.round(totals.calories)} kcal · P {Math.round(totals.protein)} · C{' '}
            {Math.round(totals.carbs)} · F {Math.round(totals.fat)}
          </ThemedText>
          <Pressable
            style={[styles.primaryButton, { opacity: foodValid ? 1 : 0.4 }]}
            disabled={!foodValid}
            onPress={logIt}
          >
            <ThemedText style={styles.primaryButtonText}>Log</ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[styles.primaryButton, { opacity: foodValid ? 1 : 0.4 }]}
          disabled={!foodValid}
          onPress={save}
        >
          <ThemedText style={styles.primaryButtonText}>Save</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
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
  primaryButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
});
