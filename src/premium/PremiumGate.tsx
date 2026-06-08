import React from "react";
import { View, Text } from "react-native";
import { usePremiumStatus } from "./usePremium";

export default function PremiumGate({ children }: { children: React.ReactNode }) {
  const isPremium = usePremiumStatus();

  if (!isPremium) {
    return (
      <View>
        <Text>Upgrade to unlock this feature.</Text>
      </View>
    );
  }

  return <>{children}</>;
}
