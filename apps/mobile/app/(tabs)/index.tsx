import { ScrollView, Text, View } from "react-native";

import { Card, DemoBadge, Row, Screen } from "@/components/ui";
import { demo } from "@/lib/demo";
import { isDemoMode } from "@/lib/env";
import { colors } from "@/lib/theme";

/** Mobile home per brief §101 — portfolio, market snapshot, regime, top
 *  sectors/setups, counters. Demo data until each phase wires live rows. */
export default function Home() {
  return (
    <Screen title="Good morning">
      <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
        {isDemoMode ? <DemoBadge /> : null}

        <Card label="Portfolio">
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800" }}>
            {demo.portfolio.value}
          </Text>
          <Text style={{ color: colors.gain, fontSize: 14, fontWeight: "600" }}>
            {demo.portfolio.changePct}
          </Text>
        </Card>

        <Card label="Market">
          {demo.markets.map((m) => (
            <Row key={m.label} left={m.label} right={m.change}
                 rightColor={m.up ? colors.gain : colors.loss} />
          ))}
          <Row left="Regime" right={`● ${demo.regime}`} rightColor={colors.gain} />
        </Card>

        <Card label="Top sectors">
          {demo.topSectors.map((s, i) => (
            <Row key={s} left={`#${i + 1}  ${s}`} right="" />
          ))}
        </Card>

        <Card label="Top setups">
          {demo.topSetups.map((s) => (
            <Row key={s.symbol} left={s.symbol} right={`${s.score} · ${s.setup}`}
                 rightColor={colors.accent} />
          ))}
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>
            NO TRADE days are normal — the scanner never forces a pick.
          </Text>
        </Card>

        <Card>
          <Row left="Important news" right={String(demo.importantNews)} />
          <Row left="Events today" right={String(demo.events)} />
          <Row left="Active trades" right={String(demo.activeTrades)} />
          <Row left="Bot P&L" right={demo.botPnl} />
        </Card>

        <View style={{ height: 24 }} />
      </ScrollView>
    </Screen>
  );
}
