import React, { useEffect, useRef } from "react";
import { View, Animated } from "react-native";

interface Props {
  tensionScore: number;
  urgencyLevel: "calm" | "active" | "elevated" | "surge";
}

export default function TensionBar({ tensionScore, urgencyLevel }: Props) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: tensionScore,
      duration: 400,
      useNativeDriver: false
    }).start();

    if (urgencyLevel === "surge") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: false
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: false
          })
        ])
      ).start();
    } else {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
    }

  }, [tensionScore, urgencyLevel]);

  const color =
    urgencyLevel === "calm"
      ? "#1E3A8A"
      : urgencyLevel === "active"
      ? "#2563EB"
      : urgencyLevel === "elevated"
      ? "#F59E0B"
      : "#EF4444";

  return (
    <View style={{ height: 4, backgroundColor: "#111" }}>
      <Animated.View
        style={{
          height: 4,
          width: widthAnim.interpolate({
            inputRange: [0, 100],
            outputRange: ["0%", "100%"]
          }),
          backgroundColor: color,
          opacity: glowAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.7]
          })
        }}
      />
    </View>
  );
}
