import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exportBackup, pickAndRestoreBackup } from '@/lib/backup';
import { healthAvailability } from '@/lib/health';
import { kgToLb, lbToKg } from '@/lib/units';
import { useSettings } from '@/state/settings';

/**
 * Settings (PLAN §8): goals editor, units, USDA proxy config (§11), Apple
 * Health status (Part 2.2), export/import (§8), and the OFF attribution the
 * ODbL license requires (§8 "about/licenses").
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, update, reload } = useSettings();

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
  const [usdaUrl, setUsdaUrl] = useState(settings.usdaProxyUrl ?? '');
  const [busy, setBusy] = useState(false);

  const health = healthAvailability();

  // The target-weight field displays in the selected unit, so switching the
  // unit must convert the typed value — otherwise "175" entered as lb would
  // be saved as 175 kg after a toggle.
  const switchUnit = (u: 'lb' | 'kg') => {
    if (u === unitWeight) return;
    const tw = parseFloat(targetWeight);
    if (isFinite(tw)) {
      setTargetWeight((u === 'lb' ? kgToLb(tw) : lbToKg(tw)).toFixed(1));
    }
    setUnitWeight(u);
  };

  const save = () => {
    const tw = parseFloat(targetWeight);
    update({
      unitWeight,
      targetWeightKg: isFinite(tw) ? (unitWeight === 'lb' ? lbToKg(tw) : tw) : null,
      calorieTarget: parseInt(calories, 10) || null,
      proteinTargetG: parseInt(protein, 10) || null,
      carbTargetG: parseInt(carbs, 10) || null,
      fatTargetG: parseInt(fat, 10) || null,
      // Stored raw; normalization to a fetchable URL happens at use time
      // (src/api/usda.ts) so whatever the user pasted stays visible here.
      usdaProxyUrl: usdaUrl.trim() || null,
      onboarded: 1,
    });
    Alert.alert('Saved', 'Your settings are updated.');
  };

  const doExport = async () => {
    setBusy(true);
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    // Replace-all is destructive — the confirm happens BEFORE the picker so
    // nobody ends up deep in a file browser without knowing the stakes.
    Alert.alert(
      'Import backup',
      'This replaces ALL current data (foods, log, recipes, weights, settings) with the backup. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace everything',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const restored = await pickAndRestoreBackup();
              if (restored) {
                reload();
                Alert.alert('Imported', 'Backup restored.');
              }
            } catch (e) {
              Alert.alert('Import failed', e instanceof Error ? e.message : 'Unknown error');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
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
            onPress={() => switchUnit(u)}
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

      <ThemedText type="smallBold" themeColor="textSecondary">
        USDA SEARCH (OPTIONAL)
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Paste your deployed macrochef-api URL to add USDA generic-food search. See
        macrochef-api/README.md in the repo for the one-time Vercel setup. Leave empty to
        stay local + Open Food Facts only.
      </ThemedText>
      <TextInput
        style={[styles.urlInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        value={usdaUrl}
        onChangeText={setUsdaUrl}
        placeholder="https://macrochef-api.vercel.app"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Pressable style={styles.saveButton} onPress={save}>
        <ThemedText style={styles.saveText}>Save</ThemedText>
      </Pressable>

      <ThemedText type="smallBold" themeColor="textSecondary">
        APPLE HEALTH
      </ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small">{health.reason}</ThemedText>
        {health.available && (
          // Wiring exists (lib/health.ts + weight source column); the button
          // only appears once a dev build makes HealthKit loadable.
          <ThemedText type="small" themeColor="textSecondary">
            Connect from here once available.
          </ThemedText>
        )}
      </View>

      <ThemedText type="smallBold" themeColor="textSecondary">
        DATA
      </ThemedText>
      <Pressable
        style={[styles.rowButton, { backgroundColor: theme.backgroundElement, opacity: busy ? 0.5 : 1 }]}
        disabled={busy}
        onPress={doExport}
      >
        <ThemedText type="smallBold">Export data (JSON)</ThemedText>
      </Pressable>
      <Pressable
        style={[styles.rowButton, { backgroundColor: theme.backgroundElement, opacity: busy ? 0.5 : 1 }]}
        disabled={busy}
        onPress={doImport}
      >
        <ThemedText type="smallBold" style={{ color: '#e4573d' }}>
          Import data (replaces everything)
        </ThemedText>
      </Pressable>

      <ThemedText type="smallBold" themeColor="textSecondary">
        ABOUT
      </ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small">
          Food data from Open Food Facts, available under the Open Database License (ODbL).
        </ThemedText>
        <Pressable onPress={() => Linking.openURL('https://world.openfoodfacts.org')}>
          <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
            openfoodfacts.org
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          Generic-food data (when enabled) from USDA FoodData Central. All your data stays
          on this device.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
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
  urlInput: {
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 15,
  },
  saveButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  saveText: { color: '#fff', fontWeight: '700' },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  rowButton: { borderRadius: 12, padding: Spacing.three, alignItems: 'center' },
});
