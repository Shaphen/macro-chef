import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { barcodeCandidates, lookupBarcode } from '@/api/openfoodfacts';
import { getFoodByBarcode, insertFood } from '@/db/queries/foods';
import type { Meal } from '@/db/schema';
import { todayKey } from '@/lib/dates';

type Status = 'scanning' | 'looking-up' | 'not-found' | 'error';

export default function ScanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string; meal?: Meal }>();
  const day = params.day ?? todayKey();
  const meal: Meal = params.meal ?? 'snack';

  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<Status>('scanning');
  const [torch, setTorch] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const handling = useRef(false); // debounce: CameraView fires repeatedly per frame

  const openFood = (id: number, extra: Record<string, string> = {}) =>
    router.replace({
      pathname: '/food/[id]',
      params: { id: String(id), log: '1', day, meal, ...extra },
    });

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
        const saved = insertFood(result.food);
        return openFood(saved.id);
      }
      setStatus('not-found');
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
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
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
          {status === 'not-found' && (
            <>
              <ThemedText type="smallBold" style={styles.centerText}>
                Not in Open Food Facts.
              </ThemedText>
              <Pressable
                style={styles.button}
                onPress={() =>
                  router.replace({
                    pathname: '/food/[id]',
                    params: { id: 'new', barcode: lastCode ?? '', log: '1', day, meal },
                  })
                }
              >
                <ThemedText style={styles.buttonText}>Create food manually</ThemedText>
              </Pressable>
              <Pressable onPress={retry}>
                <ThemedText type="smallBold" style={styles.link}>
                  Scan again
                </ThemedText>
              </Pressable>
            </>
          )}
          {status === 'error' && (
            <>
              <ThemedText type="smallBold" style={styles.centerText}>
                Lookup failed — check your connection.
              </ThemedText>
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
