import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "./runs";

let root: string;
let store: RunStore;
const id = "11111111-1111-4111-8111-111111111111";
async function fixture(patch: Record<string, unknown> = {}, runId = id) {
  const dir = join(root, runId);
  await mkdir(join(dir, "control"), { recursive: true });
  await writeFile(
    join(dir, "status.json"),
    JSON.stringify({
      runId,
      cwd: "/work/child",
      mode: "single",
      state: "running",
      pid: process.pid,
      startedAt: Date.now() - 1000,
      lastUpdate: Date.now(),
      steps: [
        {
          agent: "worker",
          status: "running",
          model: "provider/model",
          recentOutput: ["Working"],
          tokens: { total: 12 },
        },
      ],
      ...patch,
    }),
  );
  return dir;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "paseo-pi-test-"));
  store = new RunStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("live background runs", () => {
  it("discovers runs without a Paseo tool result and preserves model and child progress", async () => {
    await fixture();
    const result = await store.list();
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      id,
      state: "running",
      controllable: true,
      steps: [{ agent: "worker", model: "provider/model", tokens: 12 }],
    });
  });
  it("estimates workflow progress from finished child steps", async () => {
    await fixture({
      mode: "workflow",
      steps: [
        { agent: "one", status: "completed" },
        { agent: "two", status: "running" },
        { agent: "three", status: "pending" },
      ],
    });
    expect((await store.list()).runs[0].progress).toMatchObject({
      kind: "exact",
      percent: 33,
      source: "workflow",
      detail: "1 of 3 children finished",
    });
  });
  it("estimates checklist progress with a detected work phase", async () => {
    await fixture({ cwd: root, recentOutput: ["Implementing the parser"] });
    await writeFile(
      join(root, "progress.md"),
      "# Progress\n- [x] Explore\n- [ ] Implement\n",
    );
    expect((await store.list()).runs[0].progress).toMatchObject({
      kind: "estimate",
      percent: 50,
      source: "checklist",
      phase: "Implementing",
      confidence: "medium",
    });
  });
  it("uses chain position and marks ordinary work indeterminate", async () => {
    await fixture({
      mode: "chain",
      currentStep: 1,
      chainStepCount: 4,
      steps: [{ agent: "worker", status: "running" }],
    });
    expect((await store.list()).runs[0].progress).toMatchObject({
      kind: "exact",
      percent: 25,
      source: "chain",
      detail: "Step 2 of 4",
    });
    await fixture({ mode: "single" });
    expect(
      (await store.list()).runs.find((run) => run.id === id)?.progress,
    ).toMatchObject({
      kind: "indeterminate",
      source: "activity",
      confidence: "low",
    });
  });
  it("does not read a symlinked progress file", async () => {
    await fixture({ cwd: root });
    await writeFile(join(root, "outside-progress.md"), "- [x] Secret\n");
    const { symlink } = await import("node:fs/promises");
    await symlink(join(root, "outside-progress.md"), join(root, "progress.md"));
    expect((await store.list()).runs[0].progress).toMatchObject({
      kind: "indeterminate",
      source: "activity",
    });
  });
  it("uses the owner session cwd when a child executes in a different workspace", async () => {
    const sessionId = join(root, "owner.jsonl");
    await writeFile(
      sessionId,
      JSON.stringify({ type: "session", cwd: "/work/parent" }) + "\n",
    );
    await fixture({ sessionId });
    expect((await store.list("/work/parent")).runs).toHaveLength(1);
    expect((await store.list("/work/unrelated")).runs).toHaveLength(0);
  });
  it("isolates corrupt artifacts and never labels a dead runner as running", async () => {
    await fixture({ pid: 2147483647 });
    await mkdir(join(root, "broken"));
    await writeFile(join(root, "broken", "status.json"), "{");
    const result = await store.list();
    expect(result.runs[0]).toMatchObject({
      state: "unavailable",
      controllable: false,
    });
    expect(result.skipped).toBe(1);
  });
  it("writes steering to the runner inbox, targeting exactly the selected child", async () => {
    const dir = await fixture();
    const receipt = await store.control({
      id,
      operation: "steer",
      message: "Check the failing test",
      index: 0,
      mode: "follow_up",
    });
    const files = await readdir(join(dir, "control", "steer-requests"));
    const request = JSON.parse(
      await readFile(join(dir, "control", "steer-requests", files[0]), "utf8"),
    );
    expect(request).toMatchObject({
      type: "steer",
      id: receipt.requestId,
      message: "Check the failing test",
      targetIndex: 0,
      mode: "follow_up",
    });
    expect(receipt.message).toContain("Queued");
  });
  it("uses portable stop requests without changing canonical status", async () => {
    const dir = await fixture();
    const before = await readFile(join(dir, "status.json"), "utf8");
    await store.control({ id, operation: "stop", index: 0 });
    const files = await readdir(join(dir, "control", "stop-requests"));
    expect(
      JSON.parse(
        await readFile(join(dir, "control", "stop-requests", files[0]), "utf8"),
      ),
    ).toMatchObject({ type: "stop", targetIndex: 0 });
    expect(await readFile(join(dir, "status.json"), "utf8")).toBe(before);
  });
  it("rejects foreign paths, terminal runs, workflow roots and closed inboxes", async () => {
    await expect(store.detail("../../etc")).rejects.toThrow();
    await fixture({ state: "complete" });
    await expect(store.control({ id, operation: "stop" })).rejects.toThrow(
      /live|active/i,
    );
    await fixture({ mode: "workflow" });
    await expect(store.control({ id, operation: "stop" })).rejects.toThrow(
      /workflow|runner/i,
    );
    const dir = await fixture();
    await writeFile(join(dir, "control", "steer-inbox-closed.json"), "{}");
    await expect(
      store.control({ id, operation: "steer", message: "Hi" }),
    ).rejects.toThrow(/closed/i);
  });
  it("bounds output tails and never follows artifact-provided paths", async () => {
    const dir = await fixture({ outputFile: "/etc/passwd" });
    await writeFile(
      join(dir, "output-0.log"),
      "x".repeat(100000) + "\nFINAL OUTPUT",
    );
    const detail = await store.detail(id, 0);
    expect(detail.output).toContain("FINAL OUTPUT");
    expect(detail.output.length).toBeLessThanOrEqual(32768);
    expect(detail.truncated).toBe(true);
  });
  it("fills workflow child details from the child's own live artifacts", async () => {
    const childId = "22222222-2222-4222-8222-222222222222";
    await fixture({}, childId);
    await fixture({
      mode: "workflow",
      steps: [
        {
          agent: "worker",
          label: "Implement controls",
          status: "running",
          runId: childId,
        },
      ],
    });
    const detail = await store.detail(id);
    expect(detail.run.steps[0]).toMatchObject({
      label: "Implement controls",
      model: "provider/model",
      tokens: 12,
    });
  });
  it("keeps a workflow child visible after its detailed artifacts expire", async () => {
    await fixture({
      mode: "workflow",
      steps: [
        {
          agent: "worker",
          label: "Implement controls",
          status: "completed",
          runId: "missing-child",
        },
      ],
    });
    const detail = await store.detail(id);
    expect(detail.run.steps[0]).toMatchObject({
      label: "Implement controls",
      state: "completed",
    });
  });
  it("shows the complete restart chain from any attempt, including forward links", async () => {
    const second = "22222222-2222-4222-8222-222222222222";
    const third = "33333333-3333-4333-8333-333333333333";
    await fixture({ state: "failed", startedAt: 1000 });
    await fixture(
      { state: "failed", revivedFrom: id, startedAt: 2000 },
      second,
    );
    await fixture({ revivedFrom: second, startedAt: 3000 }, third);
    const latest = await store.detail(third);
    expect(latest.run.lineage.map((x) => x.id)).toEqual([id, second, third]);
    expect(latest.run.restartOf).toBe(second);
    const original = await store.detail(id);
    expect(original.run.lineage.map((x) => x.id)).toEqual([id, second, third]);
    expect(original.run.lineage[2]).toMatchObject({
      state: "running",
      relation: "restart",
      available: true,
    });
    expect(
      (await store.list()).runs.find((r) => r.id === third)?.restartOf,
    ).toBe(second);
  });
  it("retains a missing ancestor and stops cyclic lineage", async () => {
    const missing = "22222222-2222-4222-8222-222222222222";
    await fixture({ revivedFrom: missing });
    expect((await store.detail(id)).run.lineage[0]).toMatchObject({
      id: missing,
      available: false,
    });
    await fixture({ revivedFrom: id }, missing);
    const detail = await store.detail(id);
    expect(new Set(detail.run.lineage.map((x) => x.id)).size).toBe(
      detail.run.lineage.length,
    );
    expect(detail.run.lineage.length).toBeLessThanOrEqual(2);
  });
  it("reads recorded workflow revival links and includes restarted children", async () => {
    const child = "22222222-2222-4222-8222-222222222222";
    const revived = "33333333-3333-4333-8333-333333333333";
    await fixture({
      mode: "workflow",
      steps: [
        { agent: "worker", label: "Build", status: "failed", runId: child },
      ],
    });
    const childDir = await fixture(
      { state: "failed", parentWorkflowRunId: id, workflowKey: "build" },
      child,
    );
    const revivedDir = await fixture({ revivedFrom: child }, revived);
    const link = {
      version: 1,
      workflowRunId: id,
      workflowKey: "build",
      sourceRunId: child,
      revivedRunId: revived,
      depth: 1,
    };
    await writeFile(
      join(childDir, "workflow-revival.json"),
      JSON.stringify(link),
    );
    await writeFile(
      join(revivedDir, "workflow-revival-origin.json"),
      JSON.stringify(link),
    );
    expect((await store.detail(revived)).run.parentId).toBe(id);
    expect(
      (await store.detail(id)).run.steps[0].lineage.map((x) => x.id),
    ).toEqual([child, revived]);
  });
  it("links workflow resume origins while keeping new task names unrelated", async () => {
    const resumed = "22222222-2222-4222-8222-222222222222";
    await fixture({ mode: "workflow", state: "failed" });
    await fixture(
      { mode: "workflow", resumeOrigin: { sourceRunId: id, attempt: 2 } },
      resumed,
    );
    const detail = await store.detail(resumed);
    expect(detail.run.lineage[1]).toMatchObject({
      id: resumed,
      relation: "resume",
    });
  });
  it("refuses a symlinked run directory", async () => {
    const { symlink } = await import("node:fs/promises");
    const outside = await mkdtemp(join(tmpdir(), "paseo-pi-outside-"));
    try {
      await symlink(outside, join(root, id));
      await expect(store.detail(id)).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
