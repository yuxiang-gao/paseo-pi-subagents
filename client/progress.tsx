import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { Progress } from "../shared/rpc";
import { progressEvidence, progressLabel } from "./progress-logic";
export function ProgressView({
  progress,
  theme,
  compact = false,
}: {
  progress: Progress;
  theme: PluginTheme;
  compact?: boolean;
}) {
  const percent = progress.percent ?? 0;
  return (
    <View
      accessibilityLabel={`Progress: ${progressLabel(progress)}`}
      style={{ gap: 4 }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.foreground, fontSize: 12, flex: 1 }}
        >
          {progressLabel(progress)}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {progress.kind === "indeterminate" ? "—" : `${percent}%`}
        </Text>
      </View>
      <View
        style={{
          height: compact ? 3 : 5,
          overflow: "hidden",
          backgroundColor: theme.colors.border,
          borderRadius: 3,
        }}
      >
        {progress.kind === "indeterminate" ? (
          <View
            style={{
              width: "32%",
              height: "100%",
              backgroundColor: theme.colors.foregroundMuted,
              borderRadius: 3,
            }}
          />
        ) : (
          <View
            style={{
              width: `${percent}%`,
              height: "100%",
              backgroundColor:
                progress.kind === "exact"
                  ? theme.colors.statusSuccess
                  : theme.colors.accent,
              borderRadius: 3,
            }}
          />
        )}
      </View>
      {!compact ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {progressEvidence(progress)}
          {progress.updatedAt
            ? ` · updated ${new Date(progress.updatedAt).toLocaleTimeString()}`
            : ""}
        </Text>
      ) : null}
    </View>
  );
}
