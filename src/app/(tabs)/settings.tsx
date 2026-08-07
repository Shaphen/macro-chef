import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHealthSync } from '@/hooks/use-health-sync';
import { useTheme } from '@/hooks/use-theme';
import { exportBackup, pickAndRestoreBackup } from '@/lib/backup';
import { kgToLb, lbToKg } from '@/lib/units';
import { useSettings } from '@/state/settings';

/**
 * Settings (PLAN §8): goals editor, units, the Apple Health connection
 * (Part 3), export/import (§8), and the OFF attribution the ODbL license
 * requires (§8 "about/licenses").
 *
 * The USDA proxy (`settings.usda_proxy_url`, §11) deliberately has NO UI: it
 * is a developer integration — you must deploy macrochef-api yourself — not
 * something an app user can act on, and generic-food search now works
 * offline out of the box from the bundled USDA database (Part 5). The column
 * and the client still exist; set it directly in the DB when developing.
 * `save()` must therefore leave that field alone rather than writing null.
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
  const [busy, setBusy] = useState(false);

  const health = useHealthSync();

  const confirmDisconnectHealth = () => {
    Alert.alert(
      'Disconnect Apple Health',
      'MacroChef stops syncing and forgets the cached steps, energy, sleep and workouts. Weigh-ins already imported into your weight history are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: health.disconnect },
      ],
    );
  };

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
      // usdaProxyUrl is intentionally absent — see the header comment. Listing
      // it here would clear a developer-configured proxy on every save.
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

      <Pressable style={styles.saveButton} onPress={save}>
        <ThemedText style={styles.saveText}>Save</ThemedText>
      </Pressable>

      <ThemedText type="smallBold" themeColor="textSecondary">
        APPLE HEALTH
      </ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small">{health.availability.reason}</ThemedText>
        {health.availability.available &&
          (health.enabled ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {health.syncing
                  ? 'Syncing…'
                  : health.lastSyncAt
                    ? `Last synced ${new Date(health.lastSyncAt).toLocaleString()}`
                    : 'Not synced yet'}
              </ThemedText>
              <Link href="/health" asChild>
                <Pressable>
                  <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
                    Open Activity →
                  </ThemedText>
                </Pressable>
              </Link>
              <Pressable onPress={confirmDisconnectHealth}>
                <ThemedText type="smallBold" style={{ color: '#e4573d' }}>
                  Disconnect Apple Health
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.saveButton, { opacity: health.syncing ? 0.5 : 1 }]}
              disabled={health.syncing}
              onPress={() => health.connect()}
            >
              <ThemedText style={styles.saveText}>Connect Apple Health</ThemedText>
            </Pressable>
          ))}
        {health.error && (
          <ThemedText type="small" style={{ color: '#e4573d' }}>
            {health.error}
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
          Generic foods from USDA FoodData Central (SR Legacy, public domain), bundled with
          the app and searchable offline. All your data stays on this device.
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
