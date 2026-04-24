import { Tabs } from 'expo-router';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import CustomNavBar from '@/components/CustomNavBar';

export default function TabLayout() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Tabs
        tabBar={(props) => <CustomNavBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}>
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="scan" options={{ title: "Scan" }} />
        <Tabs.Screen name="library" options={{ title: "Library" }} />
        <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      </Tabs>
    </SafeAreaView>
  );
}
