import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import type { LineageEntry } from "../shared/rpc";

export function Lineage({
  entries,
  currentId,
  theme,
  choose,
}: {
  entries: LineageEntry[];
  currentId?: string;
  theme: PluginTheme;
  choose(value: { id: string }): void;
}) {
  if (entries.length < 2) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          color: theme.colors.foreground,
          fontSize: 14,
          fontWeight: "600",
        }}
      >
        Attempt history
      </Text>
      {entries.map((entry, index) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          accessibilityLabel={`Open attempt ${index + 1} ${entry.id.slice(0, 8)}`}
          accessibilityState={{
            selected: entry.id === currentId,
            disabled: !entry.available,
          }}
          disabled={!entry.available}
          onPress={() => choose({ id: entry.id })}
          style={{
            minHeight: 54,
            paddingVertical: 8,
            paddingHorizontal: 10,
            borderLeftWidth: 2,
            borderColor:
              entry.id === currentId
                ? theme.colors.accent
                : theme.colors.border,
            gap: 4,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{ color: theme.colors.foreground, fontSize: 13, flex: 1 }}
            >
              {index + 1}.{" "}
              {entry.relation === "original"
                ? "Original run"
                : entry.relation === "resume"
                  ? "Resumed workflow"
                  : entry.relation === "follow_up"
                    ? "Follow up"
                    : "Restarted"}
              {entry.id === currentId ? " · viewing" : ""}
            </Text>
            <Text
              style={{
                color: ["failed", "error"].includes(entry.state)
                  ? theme.colors.statusDanger
                  : theme.colors.foregroundMuted,
                fontSize: 12,
              }}
            >
              {entry.state === "complete" ? "Completed" : entry.state}
            </Text>
          </View>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {entry.id.slice(0, 8)}
            {entry.startedAt
              ? ` · ${new Date(entry.startedAt).toLocaleString()}`
              : ""}
            {!entry.available ? " · artifacts expired" : ""}
          </Text>
          {entry.model ? (
            <Text
              numberOfLines={2}
              style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
            >
              {entry.model}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}
