import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { recentFoods, searchFoods } from '@/db/queries/foods';
import { listRecipes, recipeTotals } from '@/db/queries/recipes';
import { useDbData } from '@/hooks/use-db-data';
import { useTheme } from '@/hooks/use-theme';

/**
 * Library tab (PLAN §8): "My Foods + Recipes lists, search/filter, create
 * buttons". One screen with a segmented toggle instead of two tabs — the
 * two lists share the search box and the + button, and a 5th bottom tab
 * would crowd the bar for what is conceptually one library.
 */
export default function FoodsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<'foods' | 'recipes'>('foods');

  const { data } = useDbData(
    () => ({
      foods:
        section === 'foods' ? (query.trim() ? searchFoods(query) : recentFoods(50)) : [],
      // Recipes list is small (personal library) — fetch rows and compute
      // each card's per-recipe kcal from its item snapshots on render.
      recipes:
        section === 'recipes'
          ? listRecipes(query).map((r) => ({ recipe: r, totals: recipeTotals(r.id) }))
          : [],
    }),
    [query, section],
  );

  const createNew = () =>
    section === 'foods'
      ? router.push({ pathname: '/food/[id]', params: { id: 'new' } })
      : router.push({ pathname: '/recipe/[id]', params: { id: 'new' } });

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.segmentRow}>
        {(
          [
            { key: 'foods', label: 'My Foods' },
            { key: 'recipes', label: 'Recipes' },
          ] as const
        ).map((s) => (
          <Pressable
            key={s.key}
            onPress={() => setSection(s.key)}
            style={[
              styles.segment,
              {
                backgroundColor:
                  section === s.key ? theme.backgroundSelected : theme.backgroundElement,
              },
            ]}
          >
            <ThemedText type={section === s.key ? 'smallBold' : 'small'}>{s.label}</ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.topRow}>
        <TextInput
          style={[
            styles.search,
            { backgroundColor: theme.backgroundElement, color: theme.text },
          ]}
          placeholder={section === 'foods' ? 'Search my foods' : 'Search recipes'}
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        <Pressable hitSlop={8} onPress={createNew}>
          <Ionicons name="add-circle" size={32} color="#3c87f7" />
        </Pressable>
      </View>

      {section === 'foods' ? (
        <FlatList
          data={data.foods}
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
              onPress={() =>
                router.push({ pathname: '/food/[id]', params: { id: String(item.id) } })
              }
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
      ) : (
        <FlatList
          data={data.recipes}
          keyExtractor={(r) => String(r.recipe.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {query.trim()
                ? 'No matching recipes.'
                : 'No recipes yet — combine your foods with the + button.'}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}
              onPress={() =>
                router.push({ pathname: '/recipe/[id]', params: { id: String(item.recipe.id) } })
              }
            >
              <View style={styles.rowText}>
                <ThemedText type="small" numberOfLines={1}>
                  {item.recipe.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {item.recipe.servings} serving{item.recipe.servings === 1 ? '' : 's'} ·{' '}
                  {Math.round(item.totals.calories / (item.recipe.servings || 1))} kcal each
                </ThemedText>
              </View>
              <ThemedText type="smallBold">{Math.round(item.totals.calories)} kcal</ThemedText>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  segmentRow: { flexDirection: 'row', gap: Spacing.two },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10 },
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
