import type { PluginServerContext } from "@getpaseo/plugin/server";
import { RunStore } from "./server/runs";
import {
  clientDiagnostic,
  listRuns,
  inspectRun,
  controlRun,
} from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  const store = new RunStore();
  server.handle(clientDiagnostic, ({ platform, stage, message }) => {
    console.info(
      `[client:${platform}] ${stage}${message ? `: ${message}` : ""}`,
    );
    return { ok: true };
  });
  server.handle(listRuns, ({ cwd }) => store.list(cwd));
  server.handle(inspectRun, ({ id, index }) => store.detail(id, index));
  server.handle(controlRun, (input) => store.control(input));
  return () => {};
}
