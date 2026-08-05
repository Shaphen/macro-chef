import '@/db/client'; // side-effect: opens SQLite + runs migrations before anything renders

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-food" options={{ presentation: 'modal', title: 'Add food' }} />
        <Stack.Screen name="scan" options={{ presentation: 'modal', title: 'Scan barcode' }} />
        <Stack.Screen name="weight" options={{ presentation: 'modal', title: 'Weigh in' }} />
        <Stack.Screen name="food/[id]" options={{ title: 'Food' }} />
      </Stack>
    </ThemeProvider>
  );
}
