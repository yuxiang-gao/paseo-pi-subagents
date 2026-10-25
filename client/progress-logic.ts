import type { Progress } from "../shared/rpc";

export function progressLabel(progress: Progress) {
  return progress.kind === "indeterminate"
    ? `${progress.phase} · ${progress.detail}`
    : `${progress.percent}% · ${progress.detail}`;
}
export function progressEvidence(progress: Progress) {
  if (progress.kind === "indeterminate")
    return `No reliable estimate · ${progress.source}`;
  if (progress.kind === "exact") return `Exact · ${progress.source}`;
  return `Estimated · ${progress.confidence} confidence · ${progress.source}`;
}
