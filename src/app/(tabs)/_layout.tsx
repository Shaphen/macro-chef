import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';

import { useSettings } from '@/state/settings';

export default function TabsLayout() {
  // First launch → onboarding (PLAN §8). Gate lives here rather than in the
  // root layout so modal routes (scan/weight) stay reachable regardless, and
  // finishing/skipping onboarding sets onboarded=1 which re-renders this.
  const onboarded = useSettings((s) => s.settings.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#3c87f7' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ color, size }) => <Ionicons name="restaurant" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="foods"
        options={{
          title: 'Foods',
          tabBarIcon: ({ color, size }) => <Ionicons name="nutrition" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
