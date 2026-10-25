# Pi Subagents for Paseo

A friendly Paseo plugin for seeing and managing [pi-subagents](https://github.com/nicolo-ribaudo/pi-subagents) background work.

Pi Subagents adds a small fleet view to Paseo so you can answer questions like:

- Which background agents are still running?
- What is each child working on?
- Which model and tools are being used?
- How much output and token usage has been recorded?
- Did a child restart or resume from an earlier attempt?
- Can I send guidance or request a graceful stop without opening a terminal?

It is designed for both desktop and narrow/mobile layouts. On narrow screens, the run roster and run details become a simple two-step flow: choose a run, inspect it, then use **Back to runs** to return.

> **Status:** working local Paseo plugin
>
> The repository currently targets Paseo `0.12.x` and requires Paseo `0.12.0` or newer.

## What it provides

### Fleet view

- A **Pi Subagents** entry in the Paseo sidebar.
- A workspace Explorer panel scoped to the current workspace by default.
- A full-screen fleet view that can switch between the current workspace and all retained runs on the selected host.
- Active, Attention, and All filters.
- Search across run labels, IDs, child agents, models, and working directories.
- Automatic refresh of the roster every three seconds.
- Bounded recent output refresh every two seconds while inspecting a run.

### Child inspection

Each run can expose its child agents with:

- Agent name and task label.
- Provider/model and thinking level when recorded.
- Current or most recent tool.
- Token usage and cost when available.
- Recent bounded output.
- Current lifecycle state.
- Steering delivery counts: pending, delivered, and failed.

### Estimated progress

Progress is deliberately honest about what it knows:

1. **Exact workflow progress** — a workflow reports how many children have finished, such as `1 of 3 children finished`.
2. **Exact chain position** — a chain reports its current position, such as `Step 2 of 4`.
3. **Checklist estimate** — when a safe local `progress.md` contains Markdown checklist items, the plugin reports the completed-item percentage and current activity phase.
4. **Indeterminate activity** — ordinary work without a reliable denominator shows a phase such as `Exploring`, `Implementing`, or `Validating` with an indeterminate bar.

Every non-exact estimate includes its source and confidence. Token count and elapsed time are shown as useful context, but are never treated as completion percentage.

### Restart and resume lineage

When pi-subagents records a restart or resume, the plugin links the attempts together using the run metadata it already writes, including:

- `revivedFrom`.
- `resumeOrigin`.
- `workflow-revival.json` and `workflow-revival-origin.json`.
- Follow-up metadata when present.

The detail view shows the original attempt, later attempts, their status and model, expired/missing artifacts, and the parent workflow when one is known. Workflow children keep their own history as well.

### Guidance and stop controls

- Send guidance to a selected active child.
- Choose the steering mode exposed by the panel.
- See whether guidance is queued, delivered, or failed.
- Request a graceful stop.
- Confirm a stop with a second tap to avoid accidental termination.

Controls write portable request files into the pi-subagents runner inbox. The plugin does not signal arbitrary processes and does not rewrite canonical `status.json` files.

### Mobile entry point

Pi sessions receive a **Pi Subagents** composer button. This gives mobile users a direct route to the full fleet screen even when the plugin sidebar is hidden or difficult to reach.

## Requirements and scope

- Paseo `0.12.0` or newer.
- pi-subagents running on the same daemon machine as Paseo.
- The standard pi-subagents temporary run directory must be available to the Paseo plugin process.
- The user must have permission to read the run artifacts and write to the runner control inbox.

This plugin currently reads local artifacts. It does not aggregate runs from a remote machine, inspect foreground-only work that has no retained async artifact, or replace the pi-subagents runner's own lifecycle authority.

## Installation

### Install from this repository

After cloning the repository:

```bash
git clone https://github.com/yuxiang-gao/paseo-pi-subagents.git
cd paseo-pi-subagents
npm install
npm run typecheck
npm test
paseo plugin install . --id pi-subagents
paseo plugin reload pi-subagents --json
```

If your Paseo CLI uses the directory path as the plugin identity, this equivalent form is also supported:

```bash
paseo plugin install /path/to/paseo-pi-subagents
```

Check that it is enabled and running:

```bash
paseo plugin ls pi-subagents --json
```

### Local development

The plugin is compiled and loaded by Paseo. The local package provides the typecheck and test commands:

```bash
npm install
npm run typecheck
npm test
paseo plugin reload pi-subagents --json
paseo plugin logs pi-subagents --json
```

After changing client or server code, reload the plugin rather than restarting the Paseo daemon. A daemon restart can interrupt the agent that is currently doing the development work.

## How to use it

1. Open Paseo and choose **Pi Subagents** from the sidebar.
2. In a workspace, use the Explorer panel or the **Open Pi Subagents** command-center action.
3. From a Pi workspace, run `/pi-fleet`.
4. On a narrow/mobile layout, use the Pi Subagents composer button beside the Pi session.
5. Choose a run to inspect children, progress, lineage, and recent output.
6. Select a child before sending guidance or requesting a stop.

The workspace panel starts scoped to the current workspace. Use **show all workspaces** when you want to inspect every retained run on the selected host.

## Architecture

The plugin is intentionally split across Paseo's client/server boundary:

```text
Paseo client
  ├─ Sidebar, Explorer panel, full-screen view
  ├─ Composer entry for Pi sessions
  ├─ React Native primitives for desktop and mobile
  └─ RPC calls through Paseo's plugin bridge

Paseo plugin server
  ├─ Discovers async-subagent-runs artifacts
  ├─ Projects bounded run/child data for the client
  ├─ Computes progress and restart lineage
  ├─ Tails bounded output safely
  └─ Writes atomic steer/stop requests to runner control inboxes
```

Important implementation boundaries:

- Client code uses React Native primitives rather than DOM APIs.
- Server code validates run IDs, rejects symlinked run directories and artifacts, bounds file sizes, and limits output tails.
- Workflow roots are not directly controllable; controls target their active child runs.
- A stale active status from a dead runner is displayed as unavailable rather than running.
- RPC input and output contracts are defined in `shared/rpc.ts` and validated with Zod.

## Project layout

```text
client/
  access.ts             Mobile/desktop composer entry and lifecycle
  fleet.tsx             Fleet roster, detail view, controls, and panels
  lineage.tsx           Restart/resume attempt history
  progress.tsx          Progress bar and evidence display
  progress-logic.ts     Testable progress labels and evidence text
server/
  runs.ts               Artifact discovery, projection, progress, lineage, controls
  runs.test.ts          RunStore and security/control tests
shared/
  rpc.ts                Zod RPC contracts and public run schemas
index.client.tsx        Paseo client contributions
index.server.ts         Paseo daemon-side RPC handlers
paseo-plugin.json       Paseo plugin metadata and compatibility requirement
```

## Safety and privacy notes

The plugin reads local run metadata and bounded output. It may display task labels, paths, model names, tool names, output, token usage, and costs already present in those artifacts. Treat the Paseo host and its logs as trusted local surfaces.

The plugin deliberately:

- Does not follow symlinked run directories, status files, output files, or progress files.
- Rejects paths that escape the configured async-run root.
- Limits status artifacts, metadata files, and output tails.
- Uses atomic temporary-file writes for control requests.
- Requires an explicit second tap before requesting a stop.
- Does not expose revival capability tokens or other control secrets in the UI.

## Testing and verification

The test suite covers:

- Run discovery without a Paseo tool result.
- Workspace ownership and filtering.
- Corrupt, missing, stale, and symlinked artifacts.
- Workflow child hydration and expired child artifacts.
- Restart, resume, follow-up, and workflow revival lineage.
- Portable steering and stop requests.
- Checklist, workflow, chain, and indeterminate progress states.
- Mobile composer registration and cleanup.
- Progress labels and evidence text.

Run the checks locally:

```bash
npm run typecheck
npm test
```

The current verification run passes TypeScript and all plugin tests.

## Troubleshooting

### The sidebar entry is missing

- Confirm the plugin is enabled in Paseo Settings → Plugins.
- Run `paseo plugin ls pi-subagents --json`.
- Inspect `paseo plugin logs pi-subagents --json`.
- Confirm the client app meets the plugin's Paseo compatibility requirement.
- On mobile or narrow layouts, use the Pi session composer button or `/pi-fleet` instead of relying on the sidebar.

### No runs are listed

- Confirm pi-subagents has retained the run artifacts.
- Confirm Paseo and pi-subagents are using the same daemon machine and user scope.
- Use **show all workspaces**.
- Check that the run directory contains a valid `status.json`.
- Remember that completed runs disappear after pi-subagents retention removes their artifacts.

### Progress says “No reliable estimate”

That is expected for an ordinary task without a known denominator. The plugin intentionally avoids converting tokens, duration, or model activity into a misleading percentage. To provide a stronger signal for a task, enable pi-subagents progress behavior or maintain a Markdown checklist in `progress.md` in the run's working directory.

### Guidance or stop is unavailable

The selected run may be completed, stale, a workflow root, or have a closed control inbox. Select the active child run instead. The panel will show a warning when the runner process is no longer available.

## Contributing

Small, focused changes are welcome. Before opening a pull request:

```bash
npm install
npm run typecheck
npm test
```

Please include a test for new behavior, keep client code within the React Native plugin boundary, and avoid adding unbounded artifact reads to the server.

## License

No license has been selected for this repository yet. Until one is added, all rights are reserved by the repository owner.
