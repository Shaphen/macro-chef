import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { barcodeCandidates, lookupBarcode, type OffLookupResult } from '@/api/openfoodfacts';
import { getFoodByBarcode, insertFood } from '@/db/queries/foods';
import type { Meal } from '@/db/schema';
import { todayKey } from '@/lib/dates';
import { encodeFoodPrefill, type FoodPrefill } from '@/lib/food-prefill';
import { defaultMealForNow } from '@/lib/meals';

type Status = 'scanning' | 'looking-up' | 'error';

const MACRO_LABELS: Record<string, string> = {
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fat: 'fat',
};

/**
 * Barcode scanner (PLAN §7). A scan never dead-ends: whatever Open Food
 * Facts knows is carried into the food editor and everything it doesn't know
 * is left BLANK for the user to type in (name + calories are required to
 * save). Products OFF has never heard of — supplements and protein powders
 * especially — used to strand you on a "not found" screen; now they open a
 * pre-barcoded editor, and saving them means the next scan of that tub is an
 * instant local hit.
 *
 * A partially-known product is deliberately NOT auto-saved: the DB columns
 * are NOT NULL, so an absent protein figure would be persisted as 0 and
 * become indistinguishable from a measured zero once it's in the log.
 */
export default function ScanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string; meal?: Meal }>();
  const day = params.day ?? todayKey();
  const meal: Meal = params.meal ?? defaultMealForNow();

  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<Status>('scanning');
  const [torch, setTorch] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const handling = useRef(false); // debounce: CameraView fires repeatedly per frame

  const openFood = (id: number) =>
    router.replace({
      pathname: '/food/[id]',
      params: { id: String(id), log: '1', day, meal },
    });

  /** Open the editor on a new food, seeded with whatever we know. */
  const openEditor = (prefill: FoodPrefill, notice: string) =>
    router.replace({
      pathname: '/food/[id]',
      params: {
        id: 'new',
        log: '1',
        day,
        meal,
        prefill: encodeFoodPrefill(prefill),
        notice,
      },
    });

  /** Drop the fields OFF had no value for so they render blank, not as 0. */
  const prefillFromLookup = (result: OffLookupResult): FoodPrefill => {
    if (!result.food) return {};
    const prefill: FoodPrefill = { ...result.food };
    for (const key of result.missing ?? []) delete prefill[key];
    return prefill;
  };

  const onScanned = async ({ data }: { data: string }) => {
    if (handling.current) return;
    handling.current = true;
    setLastCode(data);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Fast path: previously saved food with this barcode (either code form).
    for (const code of barcodeCandidates(data)) {
      const existing = getFoodByBarcode(code);
      if (existing) return openFood(existing.id);
    }

    setStatus('looking-up');
    try {
      const result = await lookupBarcode(data);
      if (result.found && result.food) {
        const missing = result.missing ?? [];
        if (missing.length === 0) return openFood(insertFood(result.food).id);
        const list = missing.map((m) => MACRO_LABELS[m] ?? m).join(', ');
        return openEditor(
          prefillFromLookup(result),
          `Open Food Facts has no ${list} for this product — fill those in from the label.`,
        );
      }
      return openEditor(
        { barcode: data },
        `Barcode ${data} isn’t in Open Food Facts. Enter the label details and it’ll be saved for next time.`,
      );
    } catch {
      setStatus('error');
    }
  };

  const retry = () => {
    handling.current = false;
    setStatus('scanning');
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center]}>
        <ThemedText type="small" style={styles.centerText}>
          MacroChef needs camera access to scan food barcodes.
        </ThemedText>
        <Pressable style={styles.button} onPress={requestPermission}>
          <ThemedText style={styles.buttonText}>Allow camera</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        // iOS reports UPC-A as a 13-digit EAN (§7), so `ean13` is what
        // actually catches US grocery codes; code128/itf14 are here because
        // supplement tubs and multipacks often carry those instead.
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'itf14'],
        }}
        onBarcodeScanned={status === 'scanning' ? onScanned : undefined}
      />

      <View style={styles.overlay}>
        <View style={styles.frame} />
        <View style={styles.bottom}>
          {status === 'scanning' && (
            <ThemedText type="smallBold" style={styles.centerText}>
              Point at a barcode
            </ThemedText>
          )}
          {status === 'looking-up' && (
            <>
              <ActivityIndicator color="#fff" />
              <ThemedText type="smallBold" style={styles.centerText}>
                Looking up {lastCode}…
              </ThemedText>
            </>
          )}
          {status === 'error' && (
            <>
              <ThemedText type="smallBold" style={styles.centerText}>
                Couldn’t reach Open Food Facts — check your connection.
              </ThemedText>
              {/* The lookup failing is no reason to lose the scan: the code
                  is still good enough to create the food by hand. */}
              <Pressable
                style={styles.button}
                onPress={() =>
                  openEditor(
                    { barcode: lastCode ?? undefined },
                    'Couldn’t look this barcode up — enter the label details and it’ll be saved for next time.',
                  )
                }
              >
                <ThemedText style={styles.buttonText}>Enter details manually</ThemedText>
              </Pressable>
              <Pressable onPress={retry}>
                <ThemedText type="smallBold" style={styles.link}>
                  Try again
                </ThemedText>
              </Pressable>
            </>
          )}
          <Pressable onPress={() => setTorch((t) => !t)} hitSlop={12}>
            <ThemedText type="smallBold" style={styles.link}>
              {torch ? 'Torch off' : 'Torch on'}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { justifyContent: 'center', alignItems: 'center', gap: Spacing.three, padding: Spacing.four },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: Spacing.four },
  frame: {
    marginTop: 120,
    width: 260,
    height: 160,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  bottom: { alignItems: 'center', gap: Spacing.three, paddingBottom: Spacing.five },
  centerText: { color: '#fff', textAlign: 'center' },
  link: { color: '#8ab8fb' },
  button: {
    backgroundColor: '#3c87f7',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700' },
});
