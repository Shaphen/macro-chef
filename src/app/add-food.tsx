import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  getFoodByBarcode,
  insertFood,
  recentFoods,
  searchFoods,
} from '@/db/queries/foods';
import { addEntry } from '@/db/queries/log';
import type { Meal } from '@/db/schema';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/dates';
import { lookupBarcode, searchProducts, type OffSearchHit } from '@/api/openfoodfacts';
import { round1 } from '@/lib/units';

export default function AddFoodScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string; meal?: Meal }>();
  const day = params.day ?? todayKey();
  const meal: Meal = params.meal ?? 'snack';

  const [query, setQuery] = useState('');
  const [showQuick, setShowQuick] = useState(false);
  const [offHits, setOffHits] = useState<OffSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: localFoods } = useDbData(
    () => (query.trim() ? searchFoods(query) : recentFoods(20)),
    [query],
  );

  const openFood = (id: number) =>
    router.push({
      pathname: '/food/[id]',
      params: { id: String(id), log: '1', day, meal },
    });

  const searchOnline = async () => {
    setBusy(true);
    setOffHits(null);
    try {
      setOffHits(await searchProducts(query.trim()));
    } catch {
      setOffHits([]);
    } finally {
      setBusy(false);
    }
  };

  const pickOffHit = async (hit: OffSearchHit) => {
    setBusy(true);
    try {
      // Already saved locally from a previous scan/search?
      const existing = getFoodByBarcode(hit.code);
      if (existing) return openFood(existing.id);
      const result = await lookupBarcode(hit.code);
      if (result.found && result.food) {
        const saved = insertFood(result.food);
        openFood(saved.id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="small" themeColor="textSecondary">
        Adding to {meal} · {day}
      </ThemedText>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.action, { backgroundColor: theme.backgroundElement }]}
          onPress={() => router.push({ pathname: '/scan', params: { day, meal } })}
        >
          <Ionicons name="barcode-outline" size={22} color={theme.text} />
          <ThemedText type="smallBold">Scan</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.action, { backgroundColor: theme.backgroundElement }]}
          onPress={() => setShowQuick((v) => !v)}
        >
          <Ionicons name="flash-outline" size={22} color={theme.text} />
          <ThemedText type="smallBold">Quick add</ThemedText>
        </Pressable>
      </View>

      {showQuick && <QuickAdd day={day} meal={meal} onDone={() => router.back()} />}

      <TextInput
        style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        placeholder="Search foods"
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          setOffHits(null);
        }}
        autoCorrect={false}
      />

      <ThemedText type="smallBold" themeColor="textSecondary">
        {query.trim() ? 'MY FOODS' : 'HISTORY'}
      </ThemedText>
      {localFoods.map((f) => (
        <Pressable
          key={f.id}
          style={[styles.row, { backgroundColor: theme.backgroundElement }]}
          onPress={() => openFood(f.id)}
        >
          <View style={styles.rowText}>
            <ThemedText type="small" numberOfLines={1}>
              {f.name}
            </ThemedText>
            {!!f.brand && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {f.brand}
              </ThemedText>
            )}
          </View>
          <ThemedText type="smallBold">{Math.round(f.calories)} kcal</ThemedText>
        </Pressable>
      ))}
      {localFoods.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing saved yet.
        </ThemedText>
      )}

      {query.trim().length > 1 && (
        <Pressable style={styles.onlineButton} onPress={searchOnline} disabled={busy}>
          <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
            Search Open Food Facts for “{query.trim()}”
          </ThemedText>
        </Pressable>
      )}
      {busy && <ActivityIndicator />}
      {offHits && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            ONLINE RESULTS
          </ThemedText>
          {offHits.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              No results.
            </ThemedText>
          )}
          {offHits.map((h) => (
            <Pressable
              key={h.code}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}
              onPress={() => pickOffHit(h)}
            >
              <View style={styles.rowText}>
                <ThemedText type="small" numberOfLines={1}>
                  {h.name}
                </ThemedText>
                {!!h.brand && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {h.brand}
                  </ThemedText>
                )}
              </View>
              <Ionicons name="download-outline" size={18} color={theme.textSecondary} />
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function QuickAdd({ day, meal, onDone }: { day: string; meal: Meal; onDone: () => void }) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const kcal = parseFloat(calories);
  const valid = isFinite(kcal) && kcal >= 0;

  const log = () => {
    addEntry({
      day,
      meal,
      kind: 'quick',
      name: name.trim() || 'Quick add',
      calories: round1(kcal),
      protein: round1(parseFloat(protein) || 0),
      carbs: round1(parseFloat(carbs) || 0),
      fat: round1(parseFloat(fat) || 0),
    });
    onDone();
  };

  const input = (
    placeholder: string,
    value: string,
    onChange: (v: string) => void,
    numeric = true,
  ) => (
    <TextInput
      style={[styles.quickInput, { backgroundColor: theme.background, color: theme.text }]}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      value={value}
      onChangeText={onChange}
      keyboardType={numeric ? 'numeric' : 'default'}
    />
  );

  return (
    <View style={[styles.quickCard, { backgroundColor: theme.backgroundElement }]}>
      {input('Name (optional)', name, setName, false)}
      <View style={styles.quickRow}>
        {input('kcal', calories, setCalories)}
        {input('P g', protein, setProtein)}
        {input('C g', carbs, setCarbs)}
        {input('F g', fat, setFat)}
      </View>
      <Pressable
        style={[styles.logButton, { opacity: valid ? 1 : 0.4 }]}
        disabled={!valid}
        onPress={log}
      >
        <ThemedText style={styles.logButtonText}>Log</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  action: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: Spacing.three,
  },
  search: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  rowText: { flex: 1, gap: 1 },
  onlineButton: { alignItems: 'center', paddingVertical: Spacing.one },
  quickCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  quickRow: { flexDirection: 'row', gap: Spacing.two },
  quickInput: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 15,
  },
  logButton: {
    backgroundColor: '#3c87f7',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  logButtonText: { color: '#fff', fontWeight: '700' },
});
