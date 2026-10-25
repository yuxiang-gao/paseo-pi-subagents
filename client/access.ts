import type {
  PluginClientContext,
  PluginButtonRegistration,
} from "@getpaseo/plugin/client";

type Agent = {
  id: string;
  provider: string;
  workspaceId?: string | null;
  cwd?: string;
};

/** Composer buttons are visible where mobile users already read their Pi chat. */
export function registerFleetAccess(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  let release: (() => void) | undefined;
  const remove = (id: string) => {
    pills.get(id)?.remove();
    pills.delete(id);
  };
  const register = (agent: Agent) => {
    if (stopped) return;
    remove(agent.id);
    if (!agent.workspaceId || !/^pi(?:[/:]|$)/i.test(agent.provider)) return;
    pills.set(
      agent.id,
      client.addComposerPill({
        id: "pi-fleet",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: "Open Pi Subagents",
          label: "Pi Subagents",
          icon: "GitBranch",
          behavior: {
            kind: "action",
            onPress() {
              client.openScreen({
                screenId: "fleet",
                ...(agent.cwd ? { params: { cwd: agent.cwd } } : {}),
              });
            },
          },
        },
      }),
    );
  };
  const removeAll = () => {
    for (const id of pills.keys()) remove(id);
  };
  void client.paseo.agents
    .list({ subscribe: {} })
    .then(({ entries, subscription }) => {
      if (stopped) {
        subscription.release();
        return;
      }
      release = () => subscription.release();
      for (const { agent } of entries) register(agent);
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") register(update.agent);
          else remove(update.agentId);
        },
      });
    })
    .catch((error) => {
      if (!stopped)
        console.error("Pi Subagents composer registration failed", error);
    });
  return () => {
    stopped = true;
    release?.();
    removeAll();
  };
}
