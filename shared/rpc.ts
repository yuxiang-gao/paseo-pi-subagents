import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const lineageSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.string(),
  model: z.string(),
  startedAt: z.number(),
  available: z.boolean(),
  relation: z.enum(["original", "restart", "resume", "follow_up"]),
});
export type LineageEntry = z.infer<typeof lineageSchema>;

export const progressSchema = z.object({
  kind: z.enum(["exact", "estimate", "indeterminate"]),
  percent: z.number().min(0).max(100).optional(),
  phase: z.string(),
  source: z.enum(["workflow", "chain", "checklist", "activity"]),
  confidence: z.enum(["high", "medium", "low"]),
  detail: z.string(),
  updatedAt: z.number().optional(),
});
export type Progress = z.infer<typeof progressSchema>;

export const stepSchema = z.object({
  index: z.number(),
  agent: z.string(),
  label: z.string(),
  state: z.string(),
  model: z.string(),
  thinking: z.string(),
  tool: z.string(),
  output: z.string(),
  tokens: z.number(),
  cost: z.number().nullable(),
  runId: z.string().optional(),
  lineage: z.array(lineageSchema).default([]),
  progress: progressSchema,
});
export const runSchema = z.object({
  id: z.string(),
  mode: z.string(),
  state: z.string(),
  cwd: z.string(),
  ownerCwd: z.string(),
  parentId: z.string().optional(),
  restartOf: z.string().optional(),
  restartKind: z.enum(["restart", "resume", "follow_up"]).optional(),
  lineage: z.array(lineageSchema).default([]),
  progress: progressSchema,
  label: z.string(),
  startedAt: z.number(),
  updatedAt: z.number(),
  endedAt: z.number().nullable(),
  tokens: z.number(),
  cost: z.number().nullable(),
  controllable: z.boolean(),
  warning: z.string(),
  steps: z.array(stepSchema),
  steering: z.object({
    pending: z.number(),
    delivered: z.number(),
    failed: z.number(),
  }),
});
export type Run = z.infer<typeof runSchema>;
export type Step = z.infer<typeof stepSchema>;
export const clientDiagnostic = defineRpc({
  name: "client.diagnostic",
  input: z.object({
    platform: z.enum(["ios", "android", "web", "other"]),
    stage: z.enum(["ready", "composer", "screen", "error"]),
    message: z.string().max(1000).optional(),
  }),
  output: z.object({ ok: z.boolean() }),
});

export const listRuns = defineRpc({
  name: "runs.list",
  input: z.object({ cwd: z.string().optional() }),
  output: z.object({
    runs: z.array(runSchema),
    skipped: z.number(),
    scannedAt: z.number(),
    root: z.string(),
  }),
});
export const inspectRun = defineRpc({
  name: "runs.inspect",
  input: z.object({
    id: z.string().min(1).max(128),
    index: z.number().int().min(0).max(1000000).optional(),
  }),
  output: z.object({
    run: runSchema,
    output: z.string(),
    truncated: z.boolean(),
  }),
});
export const controlRun = defineRpc({
  name: "runs.control",
  input: z.object({
    id: z.string().min(1).max(128),
    operation: z.enum(["steer", "stop"]),
    index: z.number().int().min(0).max(1000000).optional(),
    message: z.string().trim().min(1).max(16000).optional(),
    mode: z.enum(["steer", "follow_up", "auto"]).optional(),
  }),
  output: z.object({ requestId: z.string(), message: z.string() }),
});
