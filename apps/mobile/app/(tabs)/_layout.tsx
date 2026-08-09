import { Tabs } from "expo-router";
import { Text } from "react-native";

import { colors } from "@/lib/theme";

/** Bottom navigation per brief §68: Home, Markets, Screener, Trades,
 *  Portfolio. Text glyphs for icons in Phase 1 (no icon lib dependency). */
function Glyph({ symbol, color }: { symbol: string; color: string }) {
  return <Text style={{ color, fontSize: 17, fontWeight: "700" }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <Glyph symbol="◆" color={color} /> }} />
      <Tabs.Screen name="markets" options={{ title: "Markets", tabBarIcon: ({ color }) => <Glyph symbol="◈" color={color} /> }} />
      <Tabs.Screen name="screener" options={{ title: "Screener", tabBarIcon: ({ color }) => <Glyph symbol="≡" color={color} /> }} />
      <Tabs.Screen name="trades" options={{ title: "Trades", tabBarIcon: ({ color }) => <Glyph symbol="⇅" color={color} /> }} />
      <Tabs.Screen name="portfolio" options={{ title: "Portfolio", tabBarIcon: ({ color }) => <Glyph symbol="◐" color={color} /> }} />
    </Tabs>
  );
}
