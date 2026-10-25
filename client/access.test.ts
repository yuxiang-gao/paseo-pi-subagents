import { describe, expect, it, vi } from "vitest";
import { registerFleetAccess } from "./access";

it("adds a chat composer entry for existing Pi sessions and opens the full screen", async () => {
  const openScreen = vi.fn();
  const remove = vi.fn();
  const addComposerPill = vi.fn((_input: any) => ({ remove, update: vi.fn() }));
  const observers: any[] = [];
  const release = vi.fn();
  const client: any = {
    openScreen,
    addComposerPill,
    paseo: {
      agents: {
        list: vi.fn(async () => ({
          entries: [
            {
              agent: {
                id: "pi-1",
                provider: "pi",
                workspaceId: "ws-1",
                cwd: "/work",
              },
            },
            { agent: { id: "other", provider: "codex", workspaceId: "ws-1" } },
          ],
          subscription: {
            subscribe: (o: any) => {
              observers.push(o);
              return () => {};
            },
            release,
          },
        })),
      },
    },
  };
  const cleanup = registerFleetAccess(client);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(addComposerPill).toHaveBeenCalledOnce();
  const pill = addComposerPill.mock.calls[0][0];
  expect(pill).toMatchObject({
    agentId: "pi-1",
    workspaceId: "ws-1",
    button: { label: "Pi Subagents" },
  });
  pill.button.behavior.onPress();
  expect(openScreen).toHaveBeenCalledWith({
    screenId: "fleet",
    params: { cwd: "/work" },
  });
  observers[0].update({
    type: "agent_update",
    payload: { kind: "remove", agentId: "pi-1" },
  });
  expect(remove).toHaveBeenCalledOnce();
  cleanup();
  expect(release).toHaveBeenCalledOnce();
});

describe("composer lifecycle", () => {
  it("does not register late results after plugin cleanup", async () => {
    let finish: any;
    const release = vi.fn();
    const addComposerPill = vi.fn();
    const client: any = {
      addComposerPill,
      paseo: {
        agents: {
          list: () =>
            new Promise((r) => {
              finish = r;
            }),
        },
      },
    };
    const cleanup = registerFleetAccess(client);
    cleanup();
    finish({
      entries: [{ agent: { id: "a", provider: "pi", workspaceId: "w" } }],
      subscription: { release, subscribe: vi.fn() },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(addComposerPill).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
