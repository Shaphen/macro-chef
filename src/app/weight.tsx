import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { deleteWeight, recentWeightsDesc, upsertWeight } from '@/db/queries/weight';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, todayKey } from '@/lib/dates';
import { formatWeight, kgToLb, lbToKg } from '@/lib/units';
import { useSettings } from '@/state/settings';

export default function WeightScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useSettings();
  const unit = settings.unitWeight;

  const { data: entries, refresh } = useDbData(() => recentWeightsDesc());
  const last = entries[0];

  const [value, setValue] = useState(
    last ? (unit === 'lb' ? kgToLb(last.weightKg) : last.weightKg).toFixed(1) : '',
  );

  const save = () => {
    const v = parseFloat(value);
    if (!isFinite(v) || v <= 0) return;
    upsertWeight(todayKey(), unit === 'lb' ? lbToKg(v) : v);
    router.back();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.entryRow}>
        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          placeholder="0.0"
          placeholderTextColor={theme.textSecondary}
          autoFocus
        />
        <ThemedText type="subtitle" themeColor="textSecondary">
          {unit}
        </ThemedText>
      </View>
      <Pressable style={styles.saveButton} onPress={save}>
        <ThemedText style={styles.saveText}>Save today’s weigh-in</ThemedText>
      </Pressable>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.historyTitle}>
        HISTORY
      </ThemedText>
      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary">
            No weigh-ins yet.
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, { backgroundColor: theme.backgroundElement }]}
            onLongPress={() =>
              Alert.alert('Delete weigh-in', `Delete ${dayLabel(item.day)}?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    deleteWeight(item.id);
                    refresh();
                  },
                },
              ])
            }
          >
            <View style={styles.rowLeft}>
              <ThemedText type="small">{dayLabel(item.day)}</ThemedText>
              {/* Showing the origin makes a chart that disagrees with the
                  Health app self-explanatory rather than a mystery. */}
              {item.source !== 'manual' && (
                <ThemedText type="small" themeColor="textSecondary">
                  Apple Health
                </ThemedText>
              )}
            </View>
            <ThemedText type="smallBold">{formatWeight(item.weightKg, unit)}</ThemedText>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.three },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 40,
    fontWeight: '600',
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '700' },
  historyTitle: { marginTop: Spacing.two },
  list: { gap: Spacing.two, paddingBottom: Spacing.five },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.three,
  },
  rowLeft: { gap: 2 },
});
