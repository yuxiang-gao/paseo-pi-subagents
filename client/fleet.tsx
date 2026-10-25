import type { PluginTheme } from "@getpaseo/plugin";
import type {
  PluginScreenProps,
  PluginSidebarItemProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Lineage } from "./lineage";
import { ProgressView } from "./progress";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  clientDiagnostic,
  controlRun,
  inspectRun,
  listRuns,
  type Run,
  type Step,
} from "../shared/rpc";

const ACTIVE = new Set([
  "running",
  "pending",
  "starting",
  "queued",
  "waiting",
  "stopping",
]);
const attention = (run: Run) =>
  ["failed", "error", "paused", "unavailable", "interrupted"].includes(
    run.state,
  ) || run.steering.failed > 0;
const duration = (start: number, end: number) => {
  const s = Math.max(0, Math.floor((end - start) / 1000));
  return s >= 3600
    ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    : s >= 60
      ? `${Math.floor(s / 60)}m ${s % 60}s`
      : `${s}s`;
};
const tokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
function color(state: string, theme: PluginTheme) {
  if (["failed", "error"].includes(state)) return theme.colors.statusDanger;
  if (["paused", "unavailable", "interrupted", "waiting"].includes(state))
    return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}
function Action({
  label,
  onPress,
  theme,
  disabled = false,
  danger = false,
}: {
  label: string;
  onPress(): void;
  theme: PluginTheme;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text
        style={{
          color: danger ? theme.colors.statusDanger : theme.colors.foreground,
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function State({ state, theme }: { state: string; theme: PluginTheme }) {
  return (
    <Text style={{ color: color(state, theme), fontSize: 12, flexShrink: 0 }}>
      {state === "complete" || state === "completed"
        ? "Completed"
        : state.charAt(0).toUpperCase() + state.slice(1)}
    </Text>
  );
}

export function Fleet({
  theme,
  compact,
  cwd,
  platform,
}: {
  theme: PluginTheme;
  compact: boolean;
  cwd?: string;
  platform: "ios" | "android" | "web";
}) {
  const reportClient = useRpc(clientDiagnostic);
  useEffect(() => {
    void reportClient({ platform, stage: "screen" }).catch(() => {});
  }, [platform, reportClient]);
  const { width } = useWindowDimensions();
  const [panelWidth, setPanelWidth] = useState(width);
  const narrow = compact || panelWidth < 720;
  const [allWorkspaces, setAllWorkspaces] = useState(!cwd);
  const [filter, setFilter] = useState("Active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{
    id: string;
    index?: number;
  } | null>(null);
  const fetchRuns = useRpc(listRuns);
  const scope = allWorkspaces ? undefined : cwd;
  const query = useQuery({
    queryKey: ["pi-fleet", scope],
    queryFn: () => fetchRuns({ cwd: scope }),
    refetchInterval: 3000,
  });
  const runs = query.data?.runs || [];
  const filtered = runs.filter(
    (r) =>
      (filter === "All" ||
        (filter === "Active" ? ACTIVE.has(r.state) : attention(r))) &&
      `${r.label} ${r.id} ${r.cwd} ${r.steps.map((s) => `${s.agent} ${s.model}`).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const active = runs.filter((r) => ACTIVE.has(r.state)).length;
  const rootIds = new Set(filtered.map((r) => r.id));
  const roster = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View
        style={{
          padding: 16,
          gap: 12,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: theme.colors.foreground,
                fontSize: 20,
                fontWeight: "600",
              }}
            >
              Pi Subagents
            </Text>
            <Text
              style={{
                color: theme.colors.foregroundMuted,
                fontSize: 12,
                marginTop: 4,
              }}
            >
              {query.isPending
                ? "Loading background runs…"
                : `${active} active · ${runs.length} retained runs`}
            </Text>
          </View>
          <Action
            label="Refresh"
            theme={theme}
            onPress={() => {
              void query.refetch();
            }}
            disabled={query.isFetching}
          />
        </View>
        {cwd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              allWorkspaces ? "Show this workspace" : "Show all workspaces"
            }
            onPress={() => {
              setAllWorkspaces((v) => !v);
              setSelected(null);
            }}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              {allWorkspaces
                ? "All workspaces · show this workspace"
                : "This workspace · show all workspaces"}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", gap: 20 }}>
          {["Active", "Attention", "All"].map((label) => (
            <Pressable
              key={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === label }}
              onPress={() => setFilter(label)}
              style={{
                minHeight: 44,
                justifyContent: "center",
                borderBottomWidth: 1,
                borderColor:
                  filter === label ? theme.colors.accent : "transparent",
              }}
            >
              <Text
                style={{
                  color:
                    filter === label
                      ? theme.colors.foreground
                      : theme.colors.foregroundMuted,
                  fontSize: 14,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Search background runs"
          placeholder="Search agents, models or runs"
          placeholderTextColor={theme.colors.foregroundMuted}
          value={search}
          onChangeText={setSearch}
          style={{
            minHeight: 44,
            paddingHorizontal: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 6,
            color: theme.colors.foreground,
            fontSize: 14,
          }}
        />
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {query.data
            ? `Updated ${new Date(query.data.scannedAt).toLocaleTimeString()} · refreshes every 3s`
            : "Reads local pi-subagents artifacts"}
        </Text>
      </View>
      {query.isError ? (
        <View style={{ padding: 16, gap: 8 }}>
          <Text style={{ color: theme.colors.statusDanger, fontSize: 14 }}>
            Could not refresh runs: {query.error.message}
          </Text>
          <Action
            theme={theme}
            label="Retry"
            onPress={() => {
              void query.refetch();
            }}
          />
        </View>
      ) : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 8, paddingBottom: 24 }}
      >
        {!query.isPending && !filtered.length ? (
          <View style={{ padding: 12, gap: 8 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>
              {search
                ? "No matching runs."
                : filter === "Active"
                  ? "No background runs are active."
                  : filter === "Attention"
                    ? "No runs need attention."
                    : "No retained background runs found."}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              Existing jobs appear automatically while pi-subagents retains
              their artifacts.
            </Text>
            {filter !== "All" ? (
              <Action
                label="Show all runs"
                theme={theme}
                onPress={() => setFilter("All")}
              />
            ) : null}
          </View>
        ) : null}
        {filtered.map((run) => (
          <Pressable
            key={run.id}
            accessibilityRole="button"
            accessibilityLabel={`Inspect ${run.label}, ${run.state}`}
            accessibilityState={{ selected: selected?.id === run.id }}
            onPress={() => setSelected({ id: run.id })}
            style={{
              padding: 12,
              gap: 7,
              borderRadius: 6,
              backgroundColor:
                selected?.id === run.id
                  ? theme.colors.surface1
                  : theme.colors.surface0,
              borderBottomWidth: 1,
              borderColor: theme.colors.border,
              marginLeft: run.parentId && rootIds.has(run.parentId) ? 12 : 0,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: theme.colors.foreground,
                  fontSize: 14,
                  fontWeight: "500",
                  flex: 1,
                }}
              >
                {run.mode === "workflow"
                  ? "Workflow"
                  : run.steps.map((s) => s.agent).join(", ") || run.mode}
              </Text>
              <State state={run.state} theme={theme} />
            </View>
            <Text
              numberOfLines={2}
              style={{
                color: theme.colors.foreground,
                fontSize: 13,
                lineHeight: 19,
              }}
            >
              {run.label}
            </Text>
            <ProgressView progress={run.progress} theme={theme} compact />
            {run.restartOf ? (
              <Text
                style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
              >
                Restarted from {run.restartOf.slice(0, 8)} ·{" "}
                {run.lineage.length} recorded attempts
              </Text>
            ) : run.lineage.length > 1 ? (
              <Text
                style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
              >
                {run.lineage.length} recorded attempts · open history
              </Text>
            ) : null}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: theme.colors.foregroundMuted,
                  fontSize: 12,
                  flex: 1,
                }}
              >
                {run.steps[0]?.tool ? `${run.steps[0].tool} · ` : ""}
                {run.steps.length}{" "}
                {run.steps.length === 1 ? "child" : "children"}
              </Text>
              <Text
                style={{
                  color: theme.colors.foregroundMuted,
                  fontSize: 12,
                  fontFamily: mono,
                }}
              >
                {duration(
                  run.startedAt,
                  run.endedAt || query.data?.scannedAt || Date.now(),
                )}{" "}
                · {tokens(run.tokens)} tokens
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
            >
              {run.ownerCwd.split("/").filter(Boolean).slice(-2).join("/")} ·{" "}
              {run.id.slice(0, 8)}
            </Text>
          </Pressable>
        ))}
        {query.data?.skipped ? (
          <Text
            style={{
              color: theme.colors.foregroundMuted,
              padding: 12,
              fontSize: 12,
            }}
          >
            {query.data.skipped} unreadable or expired artifact(s) skipped.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
  return (
    <View
      onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}
      style={{
        flex: 1,
        backgroundColor: theme.colors.surface0,
        flexDirection: narrow ? "column" : "row",
        minWidth: 0,
      }}
    >
      {!narrow || !selected ? (
        <View
          style={{
            flex: narrow ? 1 : undefined,
            width: narrow ? undefined : 340,
            borderRightWidth: narrow ? 0 : 1,
            borderColor: theme.colors.border,
          }}
        >
          {roster}
        </View>
      ) : null}
      {selected ? (
        <RunDetail
          key={`${selected.id}:${selected.index ?? "all"}`}
          theme={theme}
          id={selected.id}
          index={selected.index}
          back={() => setSelected(null)}
          choose={setSelected}
        />
      ) : !narrow ? (
        <View
          style={{
            flex: 1,
            padding: 24,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
            Select a run to inspect its children and output.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RunDetail({
  theme,
  id,
  index,
  back,
  choose,
}: {
  theme: PluginTheme;
  id: string;
  index?: number;
  back(): void;
  choose(value: { id: string; index?: number }): void;
}) {
  const fetchDetail = useRpc(inspectRun);
  const control = useRpc(controlRun);
  const cache = useQueryClient();
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"steer" | "follow_up">("steer");
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState("");
  const query = useQuery({
    queryKey: ["pi-run", id, index],
    queryFn: () => fetchDetail({ id, index }),
    refetchInterval: 2000,
  });
  const mutation = useMutation({
    mutationFn: (operation: "steer" | "stop") =>
      control({
        id,
        index: index ?? (query.data?.run.steps.length === 1 ? 0 : undefined),
        operation,
        ...(operation === "steer" ? { message, mode } : {}),
      }),
    onSuccess: (result) => {
      setReceipt(result.message);
      setMessage("");
      setConfirm(false);
      void cache.invalidateQueries({ queryKey: ["pi-run", id] });
      void cache.invalidateQueries({ queryKey: ["pi-fleet"] });
    },
  });
  const run = query.data?.run;
  const selectedStep = run?.steps[index ?? 0];
  const canControl =
    run?.controllable &&
    (index === undefined || ACTIVE.has(selectedStep?.state || ""));
  const receiptText =
    receipt.startsWith("Stop requested") && run && !ACTIVE.has(run.state)
      ? `Runner confirmed: ${run.state}.`
      : receipt;
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View
        style={{
          padding: 16,
          gap: 12,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Action label="Back to runs" onPress={back} theme={theme} />
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                color: theme.colors.foreground,
                fontSize: 16,
                fontWeight: "600",
              }}
            >
              {run
                ? index !== undefined
                  ? selectedStep?.agent || "Child"
                  : run.mode === "workflow"
                    ? "Workflow"
                    : run.steps.map((s) => s.agent).join(", ")
                : "Run details"}
            </Text>
            {run ? (
              <State
                state={
                  index !== undefined
                    ? selectedStep?.state || run.state
                    : run.state
                }
                theme={theme}
              />
            ) : null}
          </View>
        </View>
        <Text
          selectable
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 12,
            fontFamily: mono,
          }}
        >
          {id}
        </Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 18 }}
      >
        {query.isPending ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Loading run details…
          </Text>
        ) : null}
        {query.isError ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: theme.colors.statusDanger, fontSize: 14 }}>
              Could not read this run: {query.error.message}
            </Text>
            <Action
              label="Retry details"
              theme={theme}
              onPress={() => {
                void query.refetch();
              }}
            />
          </View>
        ) : null}
        {run ? (
          <>
            <View style={{ gap: 8 }}>
              <Text
                selectable
                style={{
                  color: theme.colors.foreground,
                  fontSize: 15,
                  lineHeight: 22,
                }}
              >
                {selectedStep?.label || run.label}
              </Text>
              <Text
                selectable
                style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
              >
                {run.cwd}
              </Text>
              <Text
                style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
              >
                {tokens(run.tokens)} tokens
                {run.cost !== null ? ` · $${run.cost.toFixed(4)}` : ""} ·{" "}
                {duration(run.startedAt, run.endedAt || Date.now())}
              </Text>
            </View>
            <ProgressView
              progress={selectedStep?.progress || run.progress}
              theme={theme}
            />
            {run.parentId ? (
              <Action
                label={`Parent workflow ${run.parentId.slice(0, 8)}`}
                theme={theme}
                onPress={() => choose({ id: run.parentId! })}
              />
            ) : null}
            <Lineage
              entries={run.lineage}
              currentId={id}
              theme={theme}
              choose={choose}
            />
            {run.warning ? (
              <Text
                style={{
                  color: theme.colors.statusWarning,
                  fontSize: 13,
                  lineHeight: 19,
                }}
              >
                {run.warning}
              </Text>
            ) : null}
            <View style={{ gap: 8 }}>
              <Text
                style={{
                  color: theme.colors.foreground,
                  fontSize: 14,
                  fontWeight: "600",
                }}
              >
                Children
              </Text>
              {run.steps.map((step) => (
                <View key={step.index} style={{ gap: 8 }}>
                  <Child
                    theme={theme}
                    step={step}
                    choose={() =>
                      choose(
                        step.runId && step.runId !== id
                          ? { id: step.runId }
                          : { id, index: step.index },
                      )
                    }
                  />
                  <Lineage
                    entries={step.lineage}
                    theme={theme}
                    choose={choose}
                  />
                </View>
              ))}
            </View>
            {canControl ? (
              <View
                style={{
                  gap: 10,
                  borderTopWidth: 1,
                  borderColor: theme.colors.border,
                  paddingTop: 16,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.foreground,
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  {index !== undefined || run.steps.length === 1
                    ? "Guide this child"
                    : "Guide all active children"}
                </Text>
                <TextInput
                  multiline
                  accessibilityLabel="Guidance for child agent"
                  placeholder="Send direction to the running agent…"
                  placeholderTextColor={theme.colors.foregroundMuted}
                  value={message}
                  onChangeText={setMessage}
                  maxLength={16000}
                  style={{
                    minHeight: 88,
                    textAlignVertical: "top",
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: 6,
                    borderColor: theme.colors.border,
                    color: theme.colors.foreground,
                    fontSize: 14,
                  }}
                />
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change guidance delivery mode"
                    onPress={() =>
                      setMode((v) => (v === "steer" ? "follow_up" : "steer"))
                    }
                    style={{ minHeight: 44, justifyContent: "center", flex: 1 }}
                  >
                    <Text
                      style={{
                        color: theme.colors.foregroundMuted,
                        fontSize: 13,
                      }}
                    >
                      {mode === "steer"
                        ? "Steer during work"
                        : "Follow up after turn"}{" "}
                      · change
                    </Text>
                  </Pressable>
                  <Action
                    label={mutation.isPending ? "Sending…" : "Send guidance"}
                    theme={theme}
                    onPress={() => mutation.mutate("steer")}
                    disabled={!message.trim() || mutation.isPending}
                  />
                </View>
                <Text
                  style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                >
                  {run.steering.pending} pending · {run.steering.delivered}{" "}
                  delivered · {run.steering.failed} failed
                </Text>
                {receipt ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{
                      color: theme.colors.foregroundMuted,
                      fontSize: 13,
                    }}
                  >
                    {receiptText}
                  </Text>
                ) : null}
                {mutation.isError ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{ color: theme.colors.statusDanger, fontSize: 13 }}
                  >
                    {mutation.error.message}
                  </Text>
                ) : null}
                {confirm ? (
                  <View style={{ gap: 8 }}>
                    <Text
                      style={{ color: theme.colors.foreground, fontSize: 13 }}
                    >
                      Request a graceful stop{" "}
                      {index !== undefined || run.steps.length === 1
                        ? "for this child"
                        : "for all children in this run"}
                      ?
                    </Text>
                    <View
                      style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                    >
                      <Action
                        label="Confirm stop"
                        danger
                        theme={theme}
                        disabled={mutation.isPending}
                        onPress={() => mutation.mutate("stop")}
                      />
                      <Action
                        label="Keep running"
                        theme={theme}
                        onPress={() => setConfirm(false)}
                      />
                    </View>
                  </View>
                ) : (
                  <Action
                    label={
                      index !== undefined || run.steps.length === 1
                        ? "Stop child"
                        : "Stop run"
                    }
                    danger
                    theme={theme}
                    disabled={mutation.isPending}
                    onPress={() => setConfirm(true)}
                  />
                )}
              </View>
            ) : receipt ? (
              <Text
                style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}
              >
                {receiptText}
              </Text>
            ) : null}
            <View style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.foreground,
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  Recent output
                </Text>
                <Text
                  style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                >
                  Refreshes every 2s
                </Text>
              </View>
              {query.data?.truncated ? (
                <Text
                  style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                >
                  Showing the last 32 KB.
                </Text>
              ) : null}
              <View
                style={{
                  padding: 12,
                  backgroundColor: theme.colors.surface1,
                  borderRadius: 6,
                }}
              >
                <Text
                  selectable
                  style={{
                    color: theme.colors.foreground,
                    fontFamily: mono,
                    fontSize: 12,
                    lineHeight: 19,
                  }}
                >
                  {query.data?.output || "No output recorded yet."}
                </Text>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
function Child({
  step,
  theme,
  choose,
}: {
  step: Step;
  theme: PluginTheme;
  choose(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open child ${step.agent}`}
      onPress={choose}
      style={{
        minHeight: 64,
        gap: 5,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 14, flex: 1 }}>
          {step.agent}
        </Text>
        <State state={step.state} theme={theme} />
      </View>
      <Text
        numberOfLines={2}
        selectable
        style={{
          color: theme.colors.foregroundMuted,
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        {step.model || "Model not reported yet"}
        {step.thinking ? ` · ${step.thinking}` : ""}
      </Text>
      <ProgressView progress={step.progress} theme={theme} compact />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {step.tool ? `${step.tool} · ` : ""}
        {tokens(step.tokens)} tokens
      </Text>
    </Pressable>
  );
}
export function FleetScreen(props: PluginScreenProps) {
  return (
    <Fleet
      key={props.params.cwd || "host"}
      theme={props.theme}
      compact={props.layout.compact}
      platform={props.layout.platform}
      cwd={props.params.cwd}
    />
  );
}
export function FleetPanel(props: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(props.workspaceId, (w) => ({
    directory: w.directory,
  }));
  return (
    <Fleet
      theme={props.theme}
      compact={props.layout.compact}
      platform={props.layout.platform}
      cwd={workspace?.directory}
    />
  );
}
export function FleetSidebar(props: PluginSidebarItemProps) {
  const fetchRuns = useRpc(listRuns);
  const query = useQuery({
    queryKey: ["pi-fleet-count"],
    queryFn: () => fetchRuns({}),
    refetchInterval: 5000,
  });
  const active =
    query.data?.runs.filter((r) => ACTIVE.has(r.state)).length || 0;
  return (
    <SidebarRow
      icon="GitBranch"
      label="Pi Subagents"
      active={props.currentScreen?.screenId === "fleet"}
      onPress={() => props.openScreen({ screenId: "fleet" })}
      trailing={
        active ? (
          <Text
            style={{ color: props.theme.colors.foregroundMuted, fontSize: 12 }}
          >
            {active}
          </Text>
        ) : undefined
      }
    />
  );
}
