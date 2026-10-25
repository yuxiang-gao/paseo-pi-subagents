import {
  lstat,
  readdir,
  readFile,
  open,
  realpath,
  mkdir,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Progress, Run, LineageEntry } from "../shared/rpc";

type RecordValue = Record<string, any>;
const ACTIVE = new Set([
  "running",
  "pending",
  "starting",
  "queued",
  "waiting",
  "stopping",
]);
const text = (v: unknown, cap = 1000) =>
  typeof v === "string" ? v.slice(0, cap) : "";
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const money = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const clean = (v: string) => v.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const FINISHED = new Set([
  "complete",
  "completed",
  "done",
  "success",
  "succeeded",
]);
const roundPercent = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));
function activityPhase(raw: RecordValue) {
  const source = [
    raw.label,
    raw.currentTool,
    ...(Array.isArray(raw.recentOutput)
      ? raw.recentOutput
      : [raw.recentOutput]),
    ...(Array.isArray(raw.steps)
      ? raw.steps.flatMap((step: RecordValue) => [
          step.label,
          step.currentTool,
          ...(Array.isArray(step.recentOutput)
            ? step.recentOutput
            : [step.recentOutput]),
        ])
      : []),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/validat|test|check|verify/.test(source)) return "Validating";
  if (/implement|edit|write|code|fix|build/.test(source)) return "Implementing";
  if (/research|read|inspect|explor|search/.test(source)) return "Exploring";
  if (/plan|design/.test(source)) return "Planning";
  return "Working";
}
function statusProgress(status: unknown): Progress {
  const value = typeof status === "string" ? status.toLowerCase() : "";
  if (FINISHED.has(value))
    return {
      kind: "exact",
      percent: 100,
      phase: "Completed",
      source: "workflow",
      confidence: "high",
      detail: "Completed",
    };
  if (["pending", "queued", "starting"].includes(value))
    return {
      kind: "exact",
      percent: 0,
      phase: "Queued",
      source: "workflow",
      confidence: "high",
      detail: "Not started",
    };
  return {
    kind: "indeterminate",
    phase: "Working",
    source: "activity",
    confidence: "low",
    detail: "No reliable denominator",
  };
}
export const defaultRoot = () =>
  join(
    tmpdir(),
    `pi-subagents-${process.getuid ? `uid-${process.getuid()}` : process.env.USERNAME || "default"}`,
    "async-subagent-runs",
  );

async function tail(file: string, bytes = 32768) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Artifact is not a regular file.");
  const handle = await open(file, "r");
  try {
    const size = Math.min(stat.size, bytes);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, Math.max(0, stat.size - size));
    return {
      output: clean(buffer.toString("utf8")).slice(-bytes),
      truncated: stat.size > bytes,
    };
  } finally {
    await handle.close();
  }
}
async function head(file: string) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return JSON.parse(
      buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0],
    );
  } finally {
    await handle.close();
  }
}
function alive(pid: unknown) {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class RunStore {
  private owners = new Map<string, string>();
  constructor(readonly root = defaultRoot()) {}
  private async directory(id: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))
      throw new Error("Invalid run ID.");
    const dir = join(this.root, id);
    const stat = await lstat(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      dirname(await realpath(dir)) !== (await realpath(this.root))
    )
      throw new Error("Invalid run directory.");
    return dir;
  }
  private async read(id: string): Promise<{ raw: RecordValue; dir: string }> {
    const dir = await this.directory(id);
    const file = join(dir, "status.json");
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
      throw new Error("Invalid status artifact.");
    const raw = JSON.parse(await readFile(file, "utf8"));
    if (raw.runId !== id || !Array.isArray(raw.steps))
      throw new Error("Invalid run status.");
    return { raw, dir };
  }
  private async ownerCwd(raw: RecordValue) {
    const session = text(raw.sessionId, 4096);
    if (!session) return text(raw.cwd, 4096);
    if (this.owners.has(session)) return this.owners.get(session)!;
    try {
      const header = await head(session);
      if (header.type === "session" && typeof header.cwd === "string") {
        if (this.owners.size > 500) this.owners.clear();
        this.owners.set(session, header.cwd);
        return header.cwd;
      }
    } catch {
      /* Old owner sessions may have been removed. */
    }
    return text(raw.cwd, 4096);
  }
  private async metadata(
    id: string,
    file: string,
  ): Promise<RecordValue | undefined> {
    try {
      const dir = await this.directory(id);
      const filename = join(dir, file);
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return;
      const value = JSON.parse(await readFile(filename, "utf8"));
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  }
  private async progressFile(cwd: string) {
    if (!cwd || cwd.length > 4096) return;
    try {
      const filename = join(cwd, "progress.md");
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024)
        return;
      const text = await readFile(filename, "utf8");
      const items = [...text.matchAll(/^\s*[-*]\s*\[([ xX])\]\s+(.+)$/gm)];
      if (!items.length) return;
      const complete = items.filter(
        (item) => item[1].toLowerCase() === "x",
      ).length;
      return { complete, total: items.length, updatedAt: stat.mtimeMs };
    } catch {
      return;
    }
  }
  private async progress(raw: RecordValue): Promise<Progress> {
    const steps = Array.isArray(raw.steps) ? raw.steps : [];
    if (raw.mode === "workflow" && steps.length) {
      const complete = steps.filter((step: RecordValue) =>
        FINISHED.has(text(step.status, 40).toLowerCase()),
      ).length;
      return {
        kind: "exact",
        percent: roundPercent((complete / steps.length) * 100),
        phase: complete === steps.length ? "Completed" : "Working",
        source: "workflow",
        confidence: "high",
        detail: `${complete} of ${steps.length} children finished`,
        updatedAt: number(raw.lastUpdate),
      };
    }
    const chainCount = number(raw.chainStepCount);
    const currentStep = raw.currentStep;
    if (
      raw.mode === "chain" &&
      chainCount > 0 &&
      Number.isInteger(currentStep) &&
      Number(currentStep) >= 0
    ) {
      const position = Math.min(chainCount, Number(currentStep) + 1);
      const current = steps[Number(currentStep)];
      return {
        kind: "exact",
        percent: roundPercent((Number(currentStep) / chainCount) * 100),
        phase: text(current?.label, 120) || "Working",
        source: "chain",
        confidence: "high",
        detail: `Step ${position} of ${chainCount}`,
        updatedAt: number(raw.lastUpdate),
      };
    }
    const checklist = await this.progressFile(text(raw.cwd, 4096));
    if (checklist) {
      return {
        kind: "estimate",
        percent: roundPercent((checklist.complete / checklist.total) * 100),
        phase: activityPhase(raw),
        source: "checklist",
        confidence: "medium",
        detail: `${checklist.complete} of ${checklist.total} checklist items complete`,
        updatedAt: checklist.updatedAt,
      };
    }
    return {
      kind: "indeterminate",
      phase: activityPhase(raw),
      source: "activity",
      confidence: "low",
      detail: "No reliable denominator",
      updatedAt: number(raw.lastUpdate),
    };
  }
  private stepProgress(
    step: RecordValue,
    raw: RecordValue,
    overall: Progress,
  ): Progress {
    if (
      step.progress &&
      typeof step.progress === "object" &&
      typeof step.progress.percent === "number"
    ) {
      const percent = roundPercent(step.progress.percent);
      return {
        kind: "estimate",
        percent,
        phase: text(step.progress.phase, 120) || activityPhase(raw),
        source: "activity",
        confidence: "medium",
        detail: text(step.progress.detail, 240) || `${percent}% estimated`,
      };
    }
    if (
      raw.mode === "workflow" ||
      FINISHED.has(text(step.status, 40).toLowerCase()) ||
      ["pending", "queued", "starting"].includes(
        text(step.status, 40).toLowerCase(),
      )
    )
      return statusProgress(step.status);
    return raw.steps.length === 1
      ? overall
      : {
          kind: "indeterminate",
          phase: activityPhase(raw),
          source: "activity",
          confidence: "low",
          detail: "No reliable denominator",
        };
  }
  private async project(raw: RecordValue): Promise<Run> {
    const validId = (id: unknown): id is string =>
      typeof id === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id) &&
      id !== raw.runId;
    const origin = await this.metadata(
      raw.runId,
      "workflow-revival-origin.json",
    );
    const recordedOrigin =
      origin?.version === 1 &&
      origin.revivedRunId === raw.runId &&
      validId(origin.sourceRunId)
        ? origin
        : undefined;
    const resumedFrom =
      raw.workflow?.resumeOrigin?.sourceRunId ?? raw.resumeOrigin?.sourceRunId;
    const source = validId(raw.revivedFrom)
      ? raw.revivedFrom
      : validId(resumedFrom)
        ? resumedFrom
        : validId(raw.externalJobFollowUp?.sourceRunId)
          ? raw.externalJobFollowUp.sourceRunId
          : recordedOrigin?.sourceRunId;
    const kind = validId(resumedFrom)
      ? ("resume" as const)
      : validId(raw.externalJobFollowUp?.sourceRunId)
        ? ("follow_up" as const)
        : ("restart" as const);
    const parent = validId(raw.parentWorkflowRunId)
      ? raw.parentWorkflowRunId
      : recordedOrigin?.workflowRunId;
    const active = ACTIVE.has(raw.state);
    const dead = active && !alive(raw.pid);
    const progress = await this.progress(raw);
    const workflow = raw.mode === "workflow";
    const steps = raw.steps
      .slice(0, 200)
      .map((s: RecordValue, index: number) => ({
        index,
        agent: text(s.agent, 120) || "agent",
        label: text(s.label || s.sessionName || s.agent, 500),
        state:
          dead && ACTIVE.has(s.status)
            ? "unavailable"
            : text(s.status, 60) || "pending",
        model: text(
          s.resolvedModel
            ? `${s.resolvedModel.provider}/${s.resolvedModel.model}`
            : s.model || s.launchModel || s.requestedModel,
          300,
        ),
        thinking: text(s.thinking, 40),
        tool: text(s.currentTool || s.recentTools?.at(-1)?.tool, 200),
        output: clean(
          Array.isArray(s.recentOutput)
            ? s.recentOutput
                .slice(-4)
                .map((x: unknown) => text(x, 800))
                .join("\n")
            : text(s.recentOutput, 3200),
        ),
        tokens: number(
          typeof s.tokens === "object" ? s.tokens?.total : s.tokens,
        ),
        cost: money(s.cost),
        ...(typeof s.runId === "string" ? { runId: s.runId } : {}),
        lineage: [],
        progress: this.stepProgress(s, raw, progress),
      }));
    return {
      id: raw.runId,
      mode: text(raw.mode, 60),
      state: dead ? "unavailable" : text(raw.state, 60),
      cwd: text(raw.cwd, 4096),
      ownerCwd: await this.ownerCwd(raw),
      ...(validId(parent) ? { parentId: parent } : {}),
      ...(source ? { restartOf: source, restartKind: kind } : {}),
      lineage: [],
      progress,
      label: text(
        raw.workflow?.label || raw.label || steps[0]?.label || raw.mode,
        500,
      ),
      startedAt: number(raw.startedAt),
      updatedAt: number(raw.lastUpdate || raw.lastActivityAt),
      endedAt: number(raw.endedAt) || null,
      tokens:
        number(raw.totalTokens?.total) ||
        steps.reduce((n: number, s: { tokens: number }) => n + s.tokens, 0),
      cost: money(raw.totalCost),
      controllable: active && !dead && !workflow,
      warning: dead
        ? "Runner is no longer available; this is the last saved status."
        : workflow && active
          ? "Select a child run to send guidance or stop it."
          : "",
      steps,
      steering: {
        pending: number(raw.steering?.pending),
        delivered: number(raw.steering?.delivered),
        failed: number(raw.steering?.failed),
      },
    };
  }
  private connectLineage(runs: Run[]) {
    const byId = new Map(runs.map((run) => [run.id, run]));
    const children = new Map<string, Run[]>();
    for (const run of runs)
      if (run.restartOf) {
        const group = children.get(run.restartOf) || [];
        group.push(run);
        children.set(run.restartOf, group);
      }
    const entry = (
      id: string,
      relation: LineageEntry["relation"],
    ): LineageEntry => {
      const run = byId.get(id);
      return {
        id,
        label: run?.label || "Earlier attempt",
        state: run?.state || "unavailable",
        model: run?.steps[0]?.model || "",
        startedAt: run?.startedAt || 0,
        available: !!run,
        relation,
      };
    };
    for (const run of runs) {
      let root = run.id;
      const ancestors = new Set([root]);
      let current: Run | undefined = run;
      while (
        current?.restartOf &&
        !ancestors.has(current.restartOf) &&
        ancestors.size < 64
      ) {
        root = current.restartOf;
        ancestors.add(root);
        current = byId.get(root);
        if (!run.parentId && current?.parentId) run.parentId = current.parentId;
      }
      if (ancestors.size === 1 && !children.has(run.id)) continue;
      const lineage: LineageEntry[] = [];
      const seen = new Set<string>();
      const visit = (id: string, relation: LineageEntry["relation"]) => {
        if (seen.has(id) || seen.size >= 64) return;
        seen.add(id);
        lineage.push(entry(id, relation));
        for (const child of (children.get(id) || []).sort(
          (a, b) => a.startedAt - b.startedAt,
        ))
          visit(child.id, child.restartKind || "restart");
      };
      visit(root, "original");
      run.lineage = lineage;
    }
  }
  async list(cwd?: string) {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { runs: [], skipped: 0, scannedAt: Date.now(), root: this.root };
      throw error;
    }
    let skipped = 0;
    const runs: Run[] = [];
    // Bound concurrency and isolate partially written or expired artifacts.
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith("."),
    );
    for (let offset = 0; offset < dirs.length; offset += 16) {
      await Promise.all(
        dirs.slice(offset, offset + 16).map(async (entry) => {
          try {
            const { raw } = await this.read(entry.name);
            const run = await this.project(raw);
            runs.push(run);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") skipped++;
          }
        }),
      );
    }
    this.connectLineage(runs);
    const scoped = cwd
      ? runs.filter(
          (run) =>
            resolve(run.ownerCwd) === resolve(cwd) ||
            resolve(run.cwd) === resolve(cwd),
        )
      : runs;
    scoped.sort(
      (a, b) =>
        Number(ACTIVE.has(b.state)) - Number(ACTIVE.has(a.state)) ||
        b.startedAt - a.startedAt,
    );
    return {
      runs: scoped.slice(0, 300),
      skipped,
      scannedAt: Date.now(),
      root: this.root,
    };
  }
  async detail(id: string, index?: number) {
    const { raw, dir } = await this.read(id);
    if (
      index !== undefined &&
      (!Number.isInteger(index) || index < 0 || index >= raw.steps.length)
    )
      throw new Error("Child no longer exists.");
    const snapshot = await this.list();
    const run =
      snapshot.runs.find((run) => run.id === id) || (await this.project(raw));
    // Workflow roots retain the graph; each detached child owns richer live data.
    if (raw.mode === "workflow") {
      await Promise.all(
        run.steps.map(async (step, position) => {
          if (!step.runId || step.runId === id) return;
          try {
            const child = await this.read(step.runId);
            const live = (await this.project(child.raw)).steps[0];
            if (live)
              run.steps[position] = {
                ...live,
                index: step.index,
                label: step.label,
                runId: step.runId,
                lineage:
                  snapshot.runs.find((run) => run.id === step.runId)?.lineage ||
                  [],
              };
          } catch {
            /* Retention may remove child detail before the graph receipt. */
          }
        }),
      );
    }
    let output = run.steps[index ?? 0]?.output || "No output recorded yet.";
    let truncated = false;
    try {
      ({ output, truncated } = await tail(
        join(dir, `output-${index ?? 0}.log`),
      ));
    } catch {
      /* Workflow roots may only have child outputs. */
    }
    return { run, output, truncated };
  }
  private async safeInbox(dir: string, name: string) {
    const control = join(dir, "control");
    for (const folder of [control, join(control, name)]) {
      await mkdir(folder, { recursive: true });
      const stat = await lstat(folder);
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        dirname(await realpath(folder)) !== (await realpath(dirname(folder)))
      )
        throw new Error("Invalid control directory.");
    }
    return join(control, name);
  }
  async control(input: {
    id: string;
    operation: "steer" | "stop";
    message?: string;
    index?: number;
    mode?: "steer" | "follow_up" | "auto";
  }) {
    const { raw, dir } = await this.read(input.id);
    const run = await this.project(raw);
    if (raw.mode === "workflow")
      throw new Error(
        "Workflow roots have no file control runner. Select a child run.",
      );
    if (!run.controllable)
      throw new Error("This run is no longer active with a live runner.");
    if (
      input.index !== undefined &&
      (!Number.isInteger(input.index) ||
        !raw.steps[input.index] ||
        !ACTIVE.has(raw.steps[input.index].status))
    )
      throw new Error("This child is no longer active.");
    const operation = input.operation;
    if (!["steer", "stop"].includes(operation))
      throw new Error("Unsupported operation.");
    const message = input.message?.trim();
    if (
      operation === "steer" &&
      (!message || Buffer.byteLength(message) > 64000)
    )
      throw new Error("Enter a message of at most 64000 bytes.");
    if (input.mode && !["steer", "follow_up", "auto"].includes(input.mode))
      throw new Error("Invalid steering mode.");
    const inbox = await this.safeInbox(
      dir,
      operation === "steer" ? "steer-requests" : "stop-requests",
    );
    const closed = join(dir, "control", `${operation}-inbox-closed.json`);
    const isClosed = async () => {
      try {
        await lstat(closed);
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw e;
      }
    };
    if (await isClosed()) throw new Error("Runner control inbox is closed.");
    const requestId = randomUUID();
    const ts = Date.now();
    const request = {
      type: operation,
      id: requestId,
      ts,
      source: "paseo-pi-subagents",
      ...(input.index !== undefined ? { targetIndex: input.index } : {}),
      ...(operation === "steer"
        ? { message, mode: input.mode || "steer" }
        : {}),
    };
    const file = join(
      inbox,
      `${ts}-${operation === "steer" ? Buffer.from(requestId).toString("base64url") : requestId}.json`,
    );
    const temp = join(inbox, `.${basename(file)}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(request));
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, file);
      if (await isClosed()) {
        await unlink(file).catch(() => {});
        throw new Error("Runner control inbox closed before submission.");
      }
    } finally {
      await unlink(temp).catch(() => {});
    }
    return {
      requestId,
      message:
        operation === "steer"
          ? "Queued guidance for the runner. Delivery is shown in the run status."
          : "Stop requested. Waiting for the runner to confirm.",
    };
  }
}
