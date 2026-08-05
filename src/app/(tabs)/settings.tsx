import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { kgToLb, lbToKg } from '@/lib/units';
import { useSettings } from '@/state/settings';

export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, update } = useSettings();

  const [unitWeight, setUnitWeight] = useState<'lb' | 'kg'>(settings.unitWeight);
  const [targetWeight, setTargetWeight] = useState(
    settings.targetWeightKg
      ? (settings.unitWeight === 'lb'
          ? kgToLb(settings.targetWeightKg)
          : settings.targetWeightKg
        ).toFixed(1)
      : '',
  );
  const [calories, setCalories] = useState(settings.calorieTarget?.toString() ?? '');
  const [protein, setProtein] = useState(settings.proteinTargetG?.toString() ?? '');
  const [carbs, setCarbs] = useState(settings.carbTargetG?.toString() ?? '');
  const [fat, setFat] = useState(settings.fatTargetG?.toString() ?? '');

  const save = () => {
    const tw = parseFloat(targetWeight);
    update({
      unitWeight,
      targetWeightKg: isFinite(tw) ? (unitWeight === 'lb' ? lbToKg(tw) : tw) : null,
      calorieTarget: parseInt(calories, 10) || null,
      proteinTargetG: parseInt(protein, 10) || null,
      carbTargetG: parseInt(carbs, 10) || null,
      fatTargetG: parseInt(fat, 10) || null,
      onboarded: 1,
    });
    Alert.alert('Saved', 'Your goals are updated.');
  };

  const field = (
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
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        UNITS
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

      <ThemedText type="smallBold" themeColor="textSecondary">
        GOALS
      </ThemedText>
      {field('Target weight', targetWeight, setTargetWeight, unitWeight)}
      {field('Calories', calories, setCalories, 'kcal/day')}
      {field('Protein', protein, setProtein, 'g/day')}
      {field('Carbs', carbs, setCarbs, 'g/day')}
      {field('Fat', fat, setFat, 'g/day')}

      <Pressable style={styles.saveButton} onPress={save}>
        <ThemedText style={styles.saveText}>Save</ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  segmentRow: { flexDirection: 'row', gap: Spacing.two },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: 10,
  },
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
  saveButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  saveText: { color: '#fff', fontWeight: '700' },
});
