import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { lbToKg } from '@/lib/units';
import { useSettings } from '@/state/settings';

/**
 * First-launch onboarding (PLAN §8): units → targets, as one route with two
 * internal steps rather than separate routes (§8's third "done" screen is
 * folded into Finish — a confirmation step with nothing to confirm). The
 * research note in PLAN §1 calls out MacroFactor's "dense onboarding" as a
 * criticism to avoid, so every field here is optional and the whole thing
 * is skippable; Settings edits the same values later.
 *
 * The %-split helper implements §8's "macros with a %-split helper that
 * converts to grams": the user gives protein/carb/fat percentages of the
 * calorie target and we derive grams via the 4/4/9 kcal-per-gram factors.
 * Grams stay editable afterwards — the helper fills the fields, it doesn't
 * own them.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { update } = useSettings();

  const [step, setStep] = useState(0);
  const [unitWeight, setUnitWeight] = useState<'lb' | 'kg'>('lb');
  const [targetWeight, setTargetWeight] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  // %-split fields; 30/35/35 is a sane middle-of-road default split.
  const [pctP, setPctP] = useState('30');
  const [pctC, setPctC] = useState('35');
  const [pctF, setPctF] = useState('35');

  const applySplit = () => {
    const kcal = parseInt(calories, 10);
    if (!isFinite(kcal) || kcal <= 0) return;
    const p = parseFloat(pctP) || 0;
    const c = parseFloat(pctC) || 0;
    const f = parseFloat(pctF) || 0;
    setProtein(String(Math.round((kcal * p) / 100 / 4)));
    setCarbs(String(Math.round((kcal * c) / 100 / 4)));
    setFat(String(Math.round((kcal * f) / 100 / 9)));
  };

  const pctTotal = (parseFloat(pctP) || 0) + (parseFloat(pctC) || 0) + (parseFloat(pctF) || 0);

  /**
   * Persist whatever was entered and mark onboarded — used by both Finish
   * and Skip so a skipped onboarding never shows again (onboarded=1 is the
   * gate the tabs layout redirects on).
   */
  const finish = () => {
    const tw = parseFloat(targetWeight);
    update({
      unitWeight,
      targetWeightKg: isFinite(tw) && tw > 0 ? (unitWeight === 'lb' ? lbToKg(tw) : tw) : null,
      calorieTarget: parseInt(calories, 10) || null,
      proteinTargetG: parseInt(protein, 10) || null,
      carbTargetG: parseInt(carbs, 10) || null,
      fatTargetG: parseInt(fat, 10) || null,
      onboarded: 1,
    });
    router.replace('/(tabs)');
  };

  const numField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    suffix: string,
  ) => (
    <View style={styles.fieldRow}>
      <ThemedText type="small">{label}</ThemedText>
      <View style={styles.fieldRight}>
        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholder="—"
          placeholderTextColor={theme.textSecondary}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.suffix}>
          {suffix}
        </ThemedText>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="subtitle">Welcome to MacroChef</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Step {step + 1} of 2 — everything here can be changed later in Settings.
      </ThemedText>

      {step === 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            HOW DO YOU WEIGH YOURSELF?
          </ThemedText>
          <View style={styles.segmentRow}>
            {(['lb', 'kg'] as const).map((u) => (
              <Pressable
                key={u}
                onPress={() => setUnitWeight(u)}
                style={[
                  styles.segment,
                  {
                    backgroundColor:
                      unitWeight === u ? theme.backgroundSelected : theme.backgroundElement,
                  },
                ]}
              >
                <ThemedText type={unitWeight === u ? 'smallBold' : 'small'}>{u}</ThemedText>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.primaryButton} onPress={() => setStep(1)}>
            <ThemedText style={styles.primaryButtonText}>Next</ThemedText>
          </Pressable>
        </>
      )}

      {step === 1 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            GOALS (ALL OPTIONAL)
          </ThemedText>
          {numField('Target weight', targetWeight, setTargetWeight, unitWeight)}
          {numField('Calories', calories, setCalories, 'kcal/day')}

          <ThemedText type="smallBold" themeColor="textSecondary">
            MACRO SPLIT HELPER
          </ThemedText>
          <View style={styles.splitRow}>
            {(
              [
                { label: 'P %', value: pctP, set: setPctP },
                { label: 'C %', value: pctC, set: setPctC },
                { label: 'F %', value: pctF, set: setPctF },
              ] as const
            ).map((f) => (
              <TextInput
                key={f.label}
                style={[styles.splitInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                value={f.value}
                onChangeText={f.set}
                keyboardType="numeric"
                placeholder={f.label}
                placeholderTextColor={theme.textSecondary}
              />
            ))}
            <Pressable
              style={[styles.applyButton, { opacity: calories ? 1 : 0.4 }]}
              disabled={!calories}
              onPress={applySplit}
            >
              <ThemedText type="smallBold" style={{ color: '#fff' }}>
                Apply
              </ThemedText>
            </Pressable>
          </View>
          {pctTotal !== 100 && (
            <ThemedText type="small" themeColor="textSecondary">
              Split adds to {pctTotal}% (100% recommended).
            </ThemedText>
          )}

          {numField('Protein', protein, setProtein, 'g/day')}
          {numField('Carbs', carbs, setCarbs, 'g/day')}
          {numField('Fat', fat, setFat, 'g/day')}

          <Pressable style={styles.primaryButton} onPress={finish}>
            <ThemedText style={styles.primaryButtonText}>Finish</ThemedText>
          </Pressable>
        </>
      )}

      <Pressable style={styles.skipButton} onPress={finish}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Skip for now
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.three, paddingTop: Spacing.six },
  segmentRow: { flexDirection: 'row', gap: Spacing.two },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two + 2, borderRadius: 10 },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    width: 96,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'right',
  },
  suffix: { width: 64 },
  splitRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  splitInput: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'center',
  },
  applyButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  primaryButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  skipButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
