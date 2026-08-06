import '@/db/client'; // side-effect: opens SQLite + runs migrations before anything renders

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
// Swipeable rows (Log screen) need a gesture-handler root above them.
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* iOS defaults the back label to the previous ROUTE name, which for
          anything pushed from a tab reads "(tabs)". A plain "Back" is set
          once here so every pushed screen inherits it. */}
      <Stack screenOptions={{ headerBackTitle: 'Back' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="add-food" options={{ presentation: 'modal', title: 'Add food' }} />
        <Stack.Screen name="scan" options={{ presentation: 'modal', title: 'Scan barcode' }} />
        <Stack.Screen name="weight" options={{ presentation: 'modal', title: 'Weigh in' }} />
        <Stack.Screen name="food/[id]" options={{ title: 'Food' }} />
        <Stack.Screen name="recipe/[id]" options={{ title: 'Recipe' }} />
        <Stack.Screen name="log-entry/[id]" options={{ title: 'Edit entry' }} />
        <Stack.Screen name="health" options={{ title: 'Activity' }} />
      </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
