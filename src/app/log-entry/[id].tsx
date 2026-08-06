import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { MacroSummary } from '@/components/macro-summary';
import { MealPicker } from '@/components/meal-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getFood } from '@/db/queries/foods';
import { deleteEntry, getEntry, updateEntry } from '@/db/queries/log';
import type { Meal } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel } from '@/lib/dates';
import type { Amount } from '@/lib/nutrition';
import { G_PER_OZ, round1 } from '@/lib/units';

const UNITS: Amount['unit'][] = ['serving', 'g', 'oz'];

/**
 * Edit a logged entry (PLAN §3 route list / §8 "row tap → edit entry").
 *
 * Snapshot-preserving edit model (the important design decision): when the
 * user changes the AMOUNT, new totals are the entry's own stored snapshot
 * scaled proportionally (snapshot × newGrams / oldGrams) — we deliberately
 * do NOT re-read the current `foods`/`recipes` rows. §5's rule is that
 * history never changes because a food was edited later; an amount edit is
 * a correction of *this historical entry* ("I actually ate 150 g, not
 * 100 g"), so it must stay priced in the food's values as they were at log
 * time. Re-pricing at current values is what re-logging (delete + add) is
 * for, and that path already exists.
 *
 * Changing the UNIT (g ↔ oz ↔ serving) is allowed and stays snapshot-safe:
 * the only thing read off the current food row is its serving SIZE in grams
 * — metadata used to translate the amount, never a macro value. The entry is
 * still priced entirely from its own snapshot. It needs resolvable grams on
 * both sides, so:
 *  - g ↔ oz always works;
 *  - 'serving' needs the food to define a gram serving size;
 *  - entries logged before grams were stored fall back to same-unit editing.
 *  - Quick entries (no amount) expose their four macro fields directly —
 *    they ARE their snapshot, so editing the numbers is editing the entry.
 *  - Recipe entries are counted in servings only, so their unit is fixed.
 *  - Meal and name changes never touch the macro snapshot at all.
 */
export default function LogEntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id: string }>();

  const entry = useMemo(() => getEntry(Number(params.id)), [params.id]);
  // Serving-size metadata for unit conversion only (never macro values).
  const food = useMemo(
    () => (entry?.foodId != null ? getFood(entry.foodId) : undefined),
    [entry?.foodId],
  );

  const [name, setName] = useState(entry?.name ?? '');
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? 'snack');
  const [amountValue, setAmountValue] = useState(entry?.amount != null ? String(entry.amount) : '');
  const [unit, setUnit] = useState<Amount['unit']>(
    (UNITS as string[]).includes(entry?.amountUnit ?? '')
      ? (entry!.amountUnit as Amount['unit'])
      : 'g',
  );
  // Quick-entry macro fields (only rendered when kind === 'quick').
  const [calories, setCalories] = useState(entry ? String(entry.calories) : '');
  const [protein, setProtein] = useState(entry ? String(entry.protein) : '');
  const [carbs, setCarbs] = useState(entry ? String(entry.carbs) : '');
  const [fat, setFat] = useState(entry ? String(entry.fat) : '');

  useEffect(() => {
    navigation.setOptions({ title: 'Edit entry' });
  }, [navigation]);

  /** Grams one unit represents for this entry's food, or null if unknown. */
  const gramsPerUnit = (u: Amount['unit']): number | null => {
    if (u === 'g') return 1;
    if (u === 'oz') return G_PER_OZ;
    return food?.servingQty && (food.servingUnit === 'g' || food.servingUnit === 'ml')
      ? food.servingQty
      : null;
  };

  if (!entry) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <ThemedText type="small" themeColor="textSecondary">
          This entry no longer exists.
        </ThemedText>
      </View>
    );
  }

  const isQuick = entry.kind === 'quick';
  const hasAmount = !isQuick && entry.amount != null && entry.amount > 0;

  const originalUnit = (UNITS as string[]).includes(entry.amountUnit ?? '')
    ? (entry.amountUnit as Amount['unit'])
    : null;
  const originalGrams =
    entry.grams ??
    (originalUnit && entry.amount != null
      ? (gramsPerUnit(originalUnit) ?? 0) * entry.amount || null
      : null);
  // Unit switching needs a gram anchor on the original side and a food row
  // to translate servings; recipes are servings-only by construction.
  const convertible = hasAmount && entry.kind === 'food' && !!originalGrams && originalGrams > 0;
  const availableUnits = convertible
    ? UNITS.filter((u) => gramsPerUnit(u) != null)
    : originalUnit
      ? [originalUnit]
      : [];
  const activeUnit = availableUnits.includes(unit) ? unit : originalUnit ?? unit;

  // Proportional rescale factor for amount/unit edits (1 when untouched).
  const parsedAmount = parseFloat(amountValue);
  const amountOk = isFinite(parsedAmount) && parsedAmount > 0;
  const gpu = gramsPerUnit(activeUnit);
  const newGrams = convertible && gpu != null && amountOk ? parsedAmount * gpu : null;
  const factor = !hasAmount
    ? 1
    : !amountOk
      ? 1
      : newGrams != null && originalGrams
        ? newGrams / originalGrams
        : parsedAmount / entry.amount!;

  const preview = isQuick
    ? {
        calories: parseFloat(calories) || 0,
        protein: parseFloat(protein) || 0,
        carbs: parseFloat(carbs) || 0,
        fat: parseFloat(fat) || 0,
      }
    : {
        calories: round1(entry.calories * factor),
        protein: round1(entry.protein * factor),
        carbs: round1(entry.carbs * factor),
        fat: round1(entry.fat * factor),
      };

  const valid =
    name.trim().length > 0 &&
    (!hasAmount || amountOk) &&
    (!isQuick || (isFinite(parseFloat(calories)) && parseFloat(calories) >= 0));

  /** Switching units keeps the same real quantity (1 serving → 30 g). */
  const changeUnit = (next: Amount['unit']) => {
    if (next === activeUnit) return;
    const from = gramsPerUnit(activeUnit);
    const to = gramsPerUnit(next);
    if (amountOk && from != null && to != null) {
      setAmountValue(String(round1((parsedAmount * from) / to)));
    }
    setUnit(next);
  };

  const save = () => {
    updateEntry(entry.id, {
      name: name.trim(),
      meal,
      ...(hasAmount
        ? {
            amount: round1(parsedAmount),
            amountUnit: activeUnit,
            grams:
              newGrams != null
                ? round1(newGrams)
                : entry.grams != null
                  ? round1(entry.grams * factor)
                  : null,
          }
        : {}),
      ...preview,
    });
    router.back();
  };

  const remove = () => {
    Alert.alert('Delete entry', `Remove "${entry.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteEntry(entry.id);
          router.back();
        },
      },
    ]);
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    numeric = true,
  ) => (
    <View style={styles.fieldRow}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
      />
    </View>
  );

  const gramsCaption =
    newGrams != null && activeUnit !== 'g'
      ? `${round1(parsedAmount)} ${activeUnit} · ${Math.round(newGrams)} g`
      : undefined;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <ThemedText type="small" themeColor="textSecondary">
        {dayLabel(entry.day)} · logged as {entry.kind}
      </ThemedText>

      {field('Name', name, setName, false)}

      <ThemedText type="smallBold" themeColor="textSecondary">
        MEAL
      </ThemedText>
      <MealPicker value={meal} onChange={setMeal} />

      {hasAmount && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            AMOUNT
          </ThemedText>
          <View style={styles.amountRow}>
            <TextInput
              style={[styles.amountInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
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
                      backgroundColor:
                        activeUnit === u ? theme.backgroundSelected : theme.backgroundElement,
                    },
                  ]}
                >
                  <ThemedText type={activeUnit === u ? 'smallBold' : 'small'}>{u}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
          {!convertible && originalUnit && (
            <ThemedText type="small" themeColor="textSecondary">
              {entry.kind === 'recipe'
                ? 'Recipes are logged in servings.'
                : 'This entry has no gram equivalent stored, so it stays in ' +
                  `${originalUnit}. Re-log it to change units.`}
            </ThemedText>
          )}
        </>
      )}

      {isQuick && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            MACROS
          </ThemedText>
          {field('Calories (kcal)', calories, setCalories)}
          {field('Protein (g)', protein, setProtein)}
          {field('Carbs (g)', carbs, setCarbs)}
          {field('Fat (g)', fat, setFat)}
        </>
      )}

      <MacroSummary totals={preview} caption={gramsCaption} />

      <Pressable
        style={[styles.primaryButton, { opacity: valid ? 1 : 0.4 }]}
        disabled={!valid}
        onPress={save}
      >
        <ThemedText style={styles.primaryButtonText}>Save changes</ThemedText>
      </Pressable>
      <Pressable style={styles.deleteButton} onPress={remove}>
        <ThemedText type="smallBold" style={{ color: '#e4573d' }}>
          Delete entry
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: {
    minWidth: 120,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'right',
  },
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
  segmentRow: { flexDirection: 'row', gap: Spacing.two, flex: 1 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10 },
  primaryButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  deleteButton: { alignItems: 'center', paddingVertical: Spacing.one },
});
