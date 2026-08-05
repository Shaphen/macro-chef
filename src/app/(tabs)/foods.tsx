import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { recentFoods, searchFoods } from '@/db/queries/foods';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';

export default function FoodsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const { data: foods } = useDbData(
    () => (query.trim() ? searchFoods(query) : recentFoods(50)),
    [query],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.topRow}>
        <TextInput
          style={[
            styles.search,
            { backgroundColor: theme.backgroundElement, color: theme.text },
          ]}
          placeholder="Search my foods"
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        <Pressable
          hitSlop={8}
          onPress={() => router.push({ pathname: '/food/[id]', params: { id: 'new' } })}
        >
          <Ionicons name="add-circle" size={32} color="#3c87f7" />
        </Pressable>
      </View>

      <FlatList
        data={foods}
        keyExtractor={(f) => String(f.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {query.trim()
              ? 'No matches. Create it with the + button.'
              : 'No foods yet — scan a barcode or create one with the + button.'}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, { backgroundColor: theme.backgroundElement }]}
            onPress={() => router.push({ pathname: '/food/[id]', params: { id: String(item.id) } })}
          >
            <View style={styles.rowText}>
              <ThemedText type="small" numberOfLines={1}>
                {item.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {item.brand ? `${item.brand} · ` : ''}
                {item.perHundred ? 'per 100 g' : item.servingName || 'per serving'}
              </ThemedText>
            </View>
            <ThemedText type="smallBold">{Math.round(item.calories)} kcal</ThemedText>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  search: { flex: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 16 },
  list: { gap: Spacing.two, paddingBottom: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  rowText: { flex: 1, gap: 1 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
