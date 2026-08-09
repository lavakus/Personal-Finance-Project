import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/lib/theme";

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

export function Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {label ? <Text style={styles.cardLabel}>{label}</Text> : null}
      {children}
    </View>
  );
}

export function DemoBadge() {
  return (
    <View style={styles.demoBadge}>
      <Text style={styles.demoText}>DEMO DATA</Text>
    </View>
  );
}

export function Row({ left, right, rightColor }: { left: string; right: string; rightColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLeft}>{left}</Text>
      <Text style={[styles.rowRight, rightColor ? { color: rightColor } : null]}>{right}</Text>
    </View>
  );
}

export function Placeholder({ phase, what }: { phase: number; what: string }) {
  return (
    <Card>
      <Text style={styles.placeholder}>
        {what} lands in Phase {phase}. This screen is part of the Phase 1
        navigation skeleton.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16, paddingTop: 64, gap: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: 4 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  cardLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  demoBadge: {
    alignSelf: "flex-start",
    borderColor: colors.demo,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  demoText: { color: colors.demo, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLeft: { color: colors.text, fontSize: 14 },
  rowRight: { color: colors.textDim, fontSize: 14, fontVariant: ["tabular-nums"] },
  placeholder: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
});
