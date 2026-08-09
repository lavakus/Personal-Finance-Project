import { Placeholder, Screen } from "@/components/ui";

export default function Screener() {
  return (
    <Screen title="Screener">
      <Placeholder phase={5} what="Daily scan results with explainable scores and trade plans" />
    </Screen>
  );
}
