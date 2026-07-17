import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TrustReceipt as TrustReceiptModel } from "../trust/TrustReceiptEngine";

interface Props {
  receipt: TrustReceiptModel;
  initiallyExpanded?: boolean;
}

export default function TrustReceipt({ receipt, initiallyExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const tone = useMemo(
    () => (receipt.severity === "sensitive" ? styles.sensitiveBorder : styles.informationalBorder),
    [receipt.severity]
  );

  return (
    <View style={[styles.shell, tone]} accessibilityRole="summary">
      <View style={styles.headerRow}>
        <View style={styles.trustDot} />
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Trust receipt</Text>
          <Text style={styles.title}>{receipt.title}</Text>
        </View>
      </View>

      <Text style={styles.summary}>{receipt.summary}</Text>

      {expanded && (
        <View style={styles.detailRegion}>
          <Text style={styles.sectionLabel}>Shared</Text>
          {receipt.shared.map((item) => (
            <Text key={`shared-${item}`} style={styles.sharedItem}>• {item}</Text>
          ))}

          <Text style={[styles.sectionLabel, styles.sectionSpacing]}>Still private</Text>
          {receipt.hidden.map((item) => (
            <Text key={`hidden-${item}`} style={styles.hiddenItem}>• {item}</Text>
          ))}

          <View style={styles.rule} />
          <Text style={styles.visibility}>{receipt.visibility}</Text>
          <Text style={styles.expiry}>{receipt.expiry}</Text>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide trust receipt details" : "Show trust receipt details"}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
      >
        <Text style={styles.toggleText}>{expanded ? "Hide details" : "See exactly what happened"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 15,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
  },
  sensitiveBorder: {
    borderColor: "rgba(56, 189, 248, 0.34)",
  },
  informationalBorder: {
    borderColor: "rgba(52, 211, 153, 0.3)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  trustDot: {
    marginTop: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#38BDF8",
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: "#7DD3FC",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 3,
    color: "#F8FAFC",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  summary: {
    marginTop: 10,
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 19,
  },
  detailRegion: {
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(148, 163, 184, 0.25)",
  },
  sectionLabel: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  sectionSpacing: {
    marginTop: 12,
  },
  sharedItem: {
    marginTop: 5,
    color: "#D1FAE5",
    fontSize: 12,
    lineHeight: 17,
  },
  hiddenItem: {
    marginTop: 5,
    color: "#E2E8F0",
    fontSize: 12,
    lineHeight: 17,
  },
  rule: {
    marginVertical: 12,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(148, 163, 184, 0.22)",
  },
  visibility: {
    color: "#BAE6FD",
    fontSize: 12,
    lineHeight: 18,
  },
  expiry: {
    marginTop: 5,
    color: "#94A3B8",
    fontSize: 11,
    lineHeight: 16,
  },
  toggle: {
    marginTop: 13,
    alignSelf: "flex-start",
    paddingVertical: 5,
  },
  togglePressed: {
    opacity: 0.7,
  },
  toggleText: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "700",
  },
});
