import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { deleteEntry, getEntry, updateEntry } from '@/db/queries/log';
import type { Meal } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel } from '@/lib/dates';
import { round1 } from '@/lib/units';

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Edit a logged entry (PLAN §3 route list / §8 "row tap → edit entry").
 *
 * Snapshot-preserving edit model (the important design decision): when the
 * user changes the AMOUNT, new totals are the entry's own stored snapshot
 * scaled proportionally (snapshot × newAmount / oldAmount) — we deliberately
 * do NOT re-read the current `foods`/`recipes` rows. §5's rule is that
 * history never changes because a food was edited later; an amount edit is
 * a correction of *this historical entry* ("I actually ate 150 g, not
 * 100 g"), so it must stay priced in the food's values as they were at log
 * time. Re-pricing at current values is what re-logging (delete + add) is
 * for, and that path already exists.
 *
 * Consequences kept deliberately simple for v1:
 *  - The amount UNIT is fixed; proportional scaling is only meaningful
 *    within the unit the entry was logged in. Switching 100 g → 2 servings
 *    is a re-log, not an edit.
 *  - Quick entries (no amount) expose their four macro fields directly —
 *    they ARE their snapshot, so editing the numbers is editing the entry.
 *  - Meal and name changes never touch the macro snapshot at all.
 */
export default function LogEntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id: string }>();

  const entry = useMemo(() => getEntry(Number(params.id)), [params.id]);

  const [name, setName] = useState(entry?.name ?? '');
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? 'snack');
  const [amountValue, setAmountValue] = useState(entry?.amount != null ? String(entry.amount) : '');
  // Quick-entry macro fields (only rendered when kind === 'quick').
  const [calories, setCalories] = useState(entry ? String(entry.calories) : '');
  const [protein, setProtein] = useState(entry ? String(entry.protein) : '');
  const [carbs, setCarbs] = useState(entry ? String(entry.carbs) : '');
  const [fat, setFat] = useState(entry ? String(entry.fat) : '');

  useEffect(() => {
    navigation.setOptions({ title: 'Edit entry' });
  }, [navigation]);

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

  // Proportional rescale factor for amount edits (1 when untouched/invalid).
  const parsedAmount = parseFloat(amountValue);
  const factor =
    hasAmount && isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount / entry.amount! : 1;

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
    (!hasAmount || (isFinite(parsedAmount) && parsedAmount > 0)) &&
    (!isQuick || (isFinite(parseFloat(calories)) && parseFloat(calories) >= 0));

  const save = () => {
    updateEntry(entry.id, {
      name: name.trim(),
      meal,
      ...(hasAmount ? { amount: round1(parsedAmount), grams: entry.grams != null ? round1(entry.grams * factor) : null } : {}),
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

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="small" themeColor="textSecondary">
        {dayLabel(entry.day)} · logged as {entry.kind}
      </ThemedText>

      {field('Name', name, setName, false)}

      <ThemedText type="smallBold" themeColor="textSecondary">
        MEAL
      </ThemedText>
      <View style={styles.segmentRow}>
        {MEALS.map((m) => (
          <Pressable
            key={m}
            onPress={() => setMeal(m)}
            style={[
              styles.segment,
              {
                backgroundColor: meal === m ? theme.backgroundSelected : theme.backgroundElement,
              },
            ]}
          >
            <ThemedText type={meal === m ? 'smallBold' : 'small'}>{m}</ThemedText>
          </Pressable>
        ))}
      </View>

      {hasAmount &&
        field(`Amount (${entry.amountUnit ?? 'units'})`, amountValue, setAmountValue)}

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

      <ThemedText type="small" themeColor="textSecondary">
        {Math.round(preview.calories)} kcal · P {Math.round(preview.protein)} · C{' '}
        {Math.round(preview.carbs)} · F {Math.round(preview.fat)}
      </ThemedText>

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
  segmentRow: { flexDirection: 'row', gap: Spacing.two },
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
