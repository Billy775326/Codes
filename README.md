# codes

A self-hosted web workspace for Codex CLI on Linux, with an IDE-inspired interface. Use a desktop browser to work with conversations and file context, and a phone to check progress and approve requests.

**Status: an initial development preview, not a released product.** The interface and recovery flows have automated simulator coverage. Real CLI metadata has a separate smoke check, and an isolated live read/write/interrupt pilot has passed. Real approval-policy variants and deployment acceptance remain open gates. See the [acceptance plan](docs/acceptance.md).

## Design philosophy

**codex no cli = codes**

Use Codex through a browser, without operating a terminal for everyday work. Conversations, approvals, planning, queues, and change review should form one clear Web workflow. Codex CLI and its App Server remain the execution engine; “no cli” describes the user experience.

Keep the interface, architecture, and implementation simple. Let layout and explicit state explain the workflow, preserve native behavior, and make operations clear to people and agents. See the [design philosophy](docs/brand.md) ([中文](docs/zh-CN/brand.md)).

## What is implemented

- Projects backed by existing directories on the host.
- Native Codex conversations, streamed assistant text, and turn-level work history with intermediate commentary and tool activity collapsed after completion, visible failure counts, and the final answer and edited-files card outside.
- Searchable, paginated conversation navigation with task/approval/question status, queue conditions, local update times, and native rename, archive, and restore controls. See [sidebar behavior](docs/conversation-sidebar.md).
- Command, file, and turn-scoped permission approvals; proactive native questions in Code and Plan, with choices, custom answers, secret inputs, and explicit skipping for optional questions.
- Quoted follow-up drafts, compact durable FIFO queue cards, immediate native steering, and conversation branches through completed turns. Edit waiting text in the composer area without replacing a separate unsent draft; editing pauses the queue until you resume it.
- Native Execution/Plan modes, model-specific reasoning effort, Fast speed control, task-plan steps, inline/separate code reviews, and session/context-token status.
- A browser workspace with persistent desktop project/conversation navigation, central chat, right-side file/change previews, larger text and controls, and dark/light/system themes.
- IDE-style model/reasoning controls, edited-file cards, questions, approvals and follow-up actions within that Web layout.
- Browser interaction preferences for Enter, queue/steer inversion, review delivery, and local slash commands.
- Read-only file browsing with selection or whole-file attachments and file-change checks.
- Per-file patch previews with line numbers, change counts, unified/side-by-side layouts, earlier loaded turns, and bounded patch windows; paginated native conversation history.
- Browser reconnection through snapshots and bounded event replay.
- Durable operation receipts that block duplicate sends after an uncertain result.
- A responsive interface, workspace access token, and host-side Codex authentication.
- An explicit simulation runtime that executes no models or commands.

The server talks to the [Codex App Server](https://learn.chatgpt.com/docs/app-server) over stdio JSONL. It does not parse the interactive terminal UI. Closing a browser does not stop an active task; stopping the codes service does interrupt its CLI process.

## Requirements

- Linux, Node.js **24.19 or newer in the 24.x line**, and npm.
- Codex CLI **0.167.0**, already installed and signed in as the server user for real tasks.
- A current browser. Mobile is intended primarily for viewing and approval.

This preview pins one CLI protocol version. It refuses other versions rather than silently guessing compatibility. Install the supported CLI with `npm install --global @openai/codex@0.167.0`, then follow the [official CLI login instructions](https://learn.chatgpt.com/docs/codex/cli). codes does not copy or expose your CLI credentials.

## Run locally

From the repository directory:

```bash
npm ci
npm run build
CODES_PROJECT_ROOT=/absolute/path/to/your/project npm start
```

Open **http://127.0.0.1:6670**. Sign in using the value in `.local/access-token` (read it on the server with `cat .local/access-token`). That file is generated on first start; keep it private. Projects can also be added through the interface.

To start with a `codes` command from any directory, install the local launcher once using Node 24.x:

```bash
npm run install:command
codes
```

The installer creates `~/.local/bin/codes`; add `~/.local/bin` to your shell's `PATH` if needed. It pins the Node executable used during installation and points to this checkout, so keep both paths in place. It refuses to replace a different existing command. Set `CODES_BIN_DIR` during installation to choose another command directory.

`codes` starts in the foreground, uses this checkout's `.local` directory by default, and keeps the default port 6670. Press Ctrl+C to stop. Existing `CODES_*` configuration still applies; relative paths supplied through the environment resolve from your calling directory. Use `codes --help` for usage. The launcher requires an existing build, does not rebuild or restart a running instance, and uses the same data-directory lock as `npm start`.

If the data directory is already in use, `codes` prints a concise message with the directory and lock owner PID instead of a JavaScript stack trace, then exits with status 1. Use the existing workspace. It leaves the running process and lock intact, including when a live unrelated process owns that lock; inspect the owner before attempting a manual restart.

For a simulation without Codex or an account:

```bash
CODES_RUNTIME=mock CODES_DATA_DIR=.local/demo CODES_PROJECT_ROOT="$PWD" npm start
```

The UI clearly labels simulation mode. Send `[approve]` or `[question]` to exercise an interaction, or `[slow]` to try stopping and reconnecting. `[hold]` keeps a simulated turn active until explicit Stop for deterministic cancellation checks. These markers have no special meaning in real Codex mode.

For development, run `npm run dev` after installing dependencies. It serves the UI and API on the same origin with Vite middleware.

## Remote access

The default listener is loopback only. For desktop access over SSH:

```bash
ssh -L 6670:127.0.0.1:6670 you@your-linux-host
```

Then open `http://127.0.0.1:6670` on your computer. Phone access requires a private HTTPS reverse proxy or private network with HTTPS. Set `CODES_PUBLIC_ORIGIN` to the exact browser origin and preserve its `Host` header when proxying. See [operations](docs/operations.md).

This is a **single-owner workspace** with that owner's host permissions. It is not a multi-user service or a sandbox for untrusted users. Start with **Read only**; choose **Ask for approval** to edit workspace files with approval for external access. **Full access** removes file/network sandbox restrictions and approval prompts on the server. The composer permission menu applies to the next task, preserves the current task and existing queues, and does not modify global CLI configuration. Use the model/reasoning popup to choose Execution or Plan and toggle Fast; the input bar shows the model and effective reasoning effort. Fast uses a supported native speed tier with higher usage, independently of reasoning effort. It defaults off; Standard is explicitly selected for new tasks instead of inheriting the host tier. Task settings are saved when sent and travel with queued messages. Model changes reset Fast and reasoning overrides. This does not change global CLI configuration or an active task. Use `/plan` to toggle native Plan mode; its visible Plan marker exits back to Code.

## Configuration

Set environment variables in the process environment; the application does not automatically load `.env` files.

| Variable               | Default                   | Purpose                                                                   |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `CODES_RUNTIME`        | `codex`                   | `codex` or `mock`                                                         |
| `CODES_HOST`           | `127.0.0.1`               | Bind address                                                              |
| `CODES_PORT`           | `6670`                    | Listener port, 1024–65535                                                 |
| `CODES_PUBLIC_ORIGIN`  | `http://127.0.0.1:<port>` | Exact allowed browser origin                                              |
| `CODES_DATA_DIR`       | `.local`                  | Private database, token, lock, and simulator data                         |
| `CODES_PROJECT_ROOT`   | unset                     | Register an existing directory at startup                                 |
| `CODES_CODEX_BINARY`   | `codex`                   | CLI executable path                                                       |
| `CODES_CODE_QUESTIONS` | `1`                       | Enable native Code-mode questions; `0` leaves them available in Plan only |
| `CODES_ACCESS_TOKEN`   | generated token file      | Optional access token, minimum 16 characters                              |

Codex inherits the server user's environment and `CODEX_HOME`. Run codes as the intended user, not as root by default. Keep the same CLI login and filesystem access you would use from the command line.

The Code question setting applies only to the child app-server process, using the pinned CLI's experimental feature. It does not edit global Codex configuration or make every prompt ask questions. Codex chooses when clarification is useful; suggested answers are sent only after you submit. Optional questions can be explicitly skipped, and required Plan questions cannot. See [conversation details](docs/conversation-details.md) for question and patch-preview behavior and limits.

## Checks

```bash
npm run format:check
npm run check
npm test
npm run test:e2e
npm run test:native
```

Install a test browser first with `npx playwright install chromium`. Alternatively, set `CODES_CHROME` to an existing Chrome executable. Browser tests use a temporary project, a test-only token, and the simulation runtime. `test:native` requires CLI 0.167.0 and uses an empty temporary `CODEX_HOME`; it sends no prompts or model requests.

The opt-in live pilot uses the server's existing login and model quota, edits only a disposable fixture, and leaves native acceptance conversations:

```bash
npm run test:live -- --allow-model-requests
```

For the read-only local IDE pilot (Plan/Code, reasoning, same-turn steering, token usage and native review):

```bash
npm run test:live:ide -- --allow-model-requests
```

Both pilots are excluded from CI and the default test command. Unexpected approvals are refused; use the manual pilot for policy-dependent approval flows.

## Documentation

- [Architecture and decisions](docs/architecture.md)
- [Interface structure and UX/DX/AX criteria](docs/interface-design.md)
- [Small-scale acceptance and current evidence](docs/acceptance.md)
- [Development milestones](docs/roadmap.md)
- [Remaining implementation and acceptance](docs/requirements.md)
- [Conversation management](docs/conversations.md)
- [Questions, queues, and branches](docs/conversation-workflow.md)
- [Clarifications and file-change previews](docs/conversation-details.md)
- [IDE interaction alignment and remaining differences](docs/ide-parity.md)
- [Operations and recovery](docs/operations.md)
- [Changelog](CHANGELOG.md)
- [中文说明](docs/README.zh-CN.md)

The project has no release tags or published packages. No license has been selected yet; public visibility alone does not grant a software license.

codes is an independent project and is not affiliated with OpenAI. Reference interfaces: [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) and [Codex IDE extension](https://learn.chatgpt.com/docs/codex/ide).
