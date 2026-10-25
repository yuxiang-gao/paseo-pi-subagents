import type { PluginClientContext } from "@getpaseo/plugin/client";
import { FleetPanel, FleetScreen, FleetSidebar } from "./client/fleet";
import { registerFleetAccess } from "./client/access";

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "fleet",
    title: "Pi Subagents",
    Component: FleetScreen,
  });
  client.addSidebarHeaderItem({
    id: "fleet",
    title: "Pi Subagents",
    Component: FleetSidebar,
  });
  client.addWorkspacePanel({
    id: "fleet",
    title: "Pi Subagents",
    icon: "GitBranch",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: FleetPanel,
  });
  client.addCommandCenterItem({
    id: "open-fleet",
    title: "Open Pi Subagents",
    icon: "GitBranch",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("fleet", { location: "explorer" });
    },
  });
  client.addSlashCommand({
    name: "pi-fleet",
    argumentHint: "",
    description: "Open Pi background agents in the side panel",
    context: "workspace",
    onSubmit({ openScreen, workspace }) {
      openScreen({ screenId: "fleet", params: { cwd: workspace.directory } });
    },
  });
  return registerFleetAccess(client);
}
