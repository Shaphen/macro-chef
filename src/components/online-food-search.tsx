import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { lookupBarcode, searchProducts, type OffSearchHit } from '@/api/openfoodfacts';
import { normalizeProxyUrl, searchUsda, usdaHitToFood, type UsdaHit } from '@/api/usda';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getFoodByBarcode, getFoodBySource, insertFood } from '@/db/queries/foods';
import type { Food } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/state/settings';

/**
 * "Search online" for a food, shared by the add-food flow and the recipe
 * ingredient builder (recipes used to be limited to foods already saved
 * locally, which meant building a recipe required pre-creating every
 * ingredient by hand).
 *
 * Search order is deliberate (PLAN §8): the caller shows local/history
 * results first and this block only fires on an explicit tap, so typing
 * never issues network requests.
 *
 * Sources: Open Food Facts always; USDA generic foods only when a
 * macrochef-api proxy URL is configured. A USDA failure downgrades to a
 * one-line notice — never an error state — because local + OFF is the
 * guaranteed baseline (PLAN §2 "fully local-first").
 *
 * Picking a result saves it as a local food row (deduped by barcode / fdcId)
 * and hands that row back, so callers only ever deal with local Food rows.
 */
export function OnlineFoodSearch({
  query,
  onPick,
  pickIcon = 'download-outline',
}: {
  query: string;
  onPick: (food: Food) => void;
  pickIcon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const { settings } = useSettings();
  const usdaBase = normalizeProxyUrl(settings.usdaProxyUrl);

  const [offHits, setOffHits] = useState<OffSearchHit[] | null>(null);
  const [usdaHits, setUsdaHits] = useState<UsdaHit[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Distinct from `offHits === []`: a failed search must never be reported as
  // "no results" (see OffSearchError) — OFF throttles at 10 searches/min and
  // a retry seconds later succeeds, which reads as the search being flaky.
  const [offFailed, setOffFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const clear = useCallback(() => {
    setOffHits(null);
    setUsdaHits(null);
    setNotice(null);
    setOffFailed(false);
  }, []);

  // Results belong to the query that produced them.
  useEffect(() => {
    clear();
  }, [query, clear]);

  const trimmed = query.trim();

  const search = async () => {
    setBusy(true);
    clear();
    // OFF and USDA are independent; run both (when configured) and let each
    // fail on its own.
    const off = searchProducts(trimmed).catch(() => {
      setOffFailed(true);
      return null;
    });
    const usda = usdaBase
      ? searchUsda(usdaBase, trimmed).then(
          (hits) => hits,
          () => {
            setNotice('USDA search unavailable — showing local & Open Food Facts only.');
            return null;
          },
        )
      : Promise.resolve(null);
    const [offResult, usdaResult] = await Promise.all([off, usda]);
    setOffHits(offResult);
    setUsdaHits(usdaResult);
    setBusy(false);
  };

  const pickOff = async (hit: OffSearchHit) => {
    setBusy(true);
    try {
      // Already saved locally from a previous scan/search?
      const existing = getFoodByBarcode(hit.code);
      if (existing) return onPick(existing);
      const result = await lookupBarcode(hit.code);
      if (result.found && result.food) onPick(insertFood(result.food));
      else setNotice('That product has no nutrition data in Open Food Facts.');
    } catch {
      setNotice('Couldn’t download that product — check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const pickUsda = (hit: UsdaHit) => {
    // Same save-on-pick pattern as OFF, keyed on fdcId instead of barcode.
    const existing = getFoodBySource('usda', String(hit.fdcId));
    onPick(existing ?? insertFood(usdaHitToFood(hit)));
  };

  if (trimmed.length < 2) return null;

  const row = (key: string, name: string, sub: string | undefined, onPress: () => void) => (
    <Pressable
      key={key}
      style={[styles.row, { backgroundColor: theme.backgroundElement }]}
      onPress={onPress}
    >
      <View style={styles.rowText}>
        <ThemedText type="small" numberOfLines={1}>
          {name}
        </ThemedText>
        {!!sub && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {sub}
          </ThemedText>
        )}
      </View>
      <Ionicons name={pickIcon} size={18} color={theme.textSecondary} />
    </Pressable>
  );

  return (
    <>
      <Pressable style={styles.searchButton} onPress={search} disabled={busy}>
        <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
          Search online for “{trimmed}”{usdaBase ? ' (Open Food Facts + USDA)' : ''}
        </ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {notice && (
        <ThemedText type="small" style={{ color: '#f2a33c' }}>
          {notice}
        </ThemedText>
      )}
      {offFailed && (
        <ThemedText type="small" style={{ color: '#f2a33c' }}>
          Open Food Facts didn’t respond — it limits how often you can search. Wait a moment
          and tap search again.
        </ThemedText>
      )}
      {offHits && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            OPEN FOOD FACTS
          </ThemedText>
          {offHits.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              No results.
            </ThemedText>
          )}
          {offHits.map((h) => row(h.code, h.name, h.brand, () => pickOff(h)))}
        </>
      )}
      {usdaHits && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            USDA (GENERIC FOODS)
          </ThemedText>
          {usdaHits.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              No results.
            </ThemedText>
          )}
          {usdaHits.map((h) =>
            row(
              String(h.fdcId),
              h.name,
              `${h.brand ? `${h.brand} · ` : ''}${Math.round(h.calories)} kcal / 100 g`,
              () => pickUsda(h),
            ),
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  searchButton: { alignItems: 'center', paddingVertical: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  rowText: { flex: 1, gap: 1 },
});
