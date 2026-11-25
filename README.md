# codes

A self-hosted web workspace for Codex CLI on Linux, with an IDE-inspired interface. Use a desktop browser to work with conversations and file context, and a phone to check progress and approve requests.

**Status: an initial development preview, not a released product.** The interface and recovery flows have automated simulator coverage. Real CLI metadata has a separate smoke check, and an isolated live read/write/interrupt pilot has passed. Real approval-policy variants and deployment acceptance remain open gates. See the [acceptance plan](docs/acceptance.md).

## Design philosophy

**codex no cli = codes**

Use Codex through a browser, without operating a terminal for everyday work. Conversations, approvals, planning, queues, and change review should form one clear Web workflow. Codex CLI and its App Server remain the execution engine; “no cli” describes the user experience.

Keep the interface, architecture, and implementation simple. Let layout and explicit state explain the workflow, preserve native behavior, and make operations clear to people and agents. See the [design philosophy](docs/brand.md) ([中文](docs/zh-CN/brand.md)).

## Identity

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/codes-lockup-dark.svg">
  <img alt="Codes V3 identity" src="public/brand/codes-lockup-light.svg" width="280" height="96">
</picture>

The owner-provided V3 SVG identity is active in navigation, sign-in, and the favicon. The outlined wordmark follows the interface foreground color. See [identity assets and attribution](docs/brand.md#identity-assets).

## What is implemented

- Projects backed by existing server directories, with lightweight single/multiple-project navigation, per-project last-conversation views, and server-verified conversation/file ownership. Missing directories retain history and offer explicit recovery. See [project and conversation navigation](docs/session-navigation-proposal.md).
- Native Codex conversations, streamed assistant text, and turn-level work history with intermediate commentary and tool activity collapsed after completion, visible failure counts, and the final answer and edited-files card outside.
- Searchable, paginated conversation navigation with task/approval/question status, queue conditions, local update times, and native rename, archive, and restore controls. See [sidebar behavior](docs/conversation-sidebar.md).
- Native **Approve for me** permissions with workspace sandboxing, separate from Full access; live reviewer outcomes and rationale when supplied by Codex.
- Context-compaction progress, completion, and interruption within the existing task lifecycle.
- Command, file, and turn-scoped permission approvals; proactive native questions in Code and Plan, with choices, custom answers, secret inputs, and explicit skipping for optional questions.
- Quoted follow-up drafts, compact durable FIFO queue cards, immediate native steering, and conversation branches through completed turns. Confirmed deliveries leave the queue immediately while task status stays in the conversation. Edit waiting text in the composer area without replacing a separate unsent draft; editing pauses the queue until you resume it.
- Effective Codex execution settings with a revision-checked user configuration editor. The composer shows the project settings and selects Plan or Execution. See [settings behavior](docs/conversation-settings.md).
- Edit Codex global instructions under Settings → Projects. Codes opens the active `AGENTS.override.md` or `AGENTS.md` in the server account’s Codex home. Reload the file if it changes on disk while editing.
- Native Execution/Plan modes, model-specific reasoning effort, Fast speed control, task-plan steps, inline/separate code reviews, and session/context-token status.
- A browser workspace with persistent desktop project/conversation navigation, central chat, right-side file/change previews, larger text and controls, and dark/light/system themes.
- IDE-style model/reasoning controls, edited-file cards, questions, approvals and follow-up actions within that Web layout.
- Browser interaction preferences for Enter, queue/steer inversion, review delivery, and local slash commands.
- English and Simplified Chinese interface languages in Settings → General → Appearance. English is the default. The language choice is saved in the browser and applies to app controls, not conversation content.
- Read-only file browsing with project-scoped attachments and file-change checks. Use **Open server path** to preview readable files and directories by absolute path. Paths outside the usual project file scope show a warning.
- Use the composer plus menu to upload local text files or images and to browse project files. Paste images directly and preview or remove attachments before sending, queueing, or adding to a turn. See [composer attachments and limits](docs/image-attachments.md).
- Per-file patch previews with line numbers, change counts, unified/side-by-side layouts, earlier loaded turns, and bounded patch windows; paginated native conversation history.
- Browser reconnection through snapshots and bounded event replay.
- Durable operation receipts that block duplicate sends after an uncertain result.
- A responsive interface, workspace access token, and host-side Codex authentication.
- An explicit simulation runtime that executes no models or commands.

The server talks to the [Codex App Server](https://learn.chatgpt.com/docs/app-server) over stdio JSONL. It does not parse the interactive terminal UI. Closing a browser does not stop an active task; stopping the codes service does interrupt its CLI process.

## Requirements

- Linux, Node.js **24.19 or newer in the 24.x line**, and npm.
- Codex CLI with a compatible App Server, already installed and signed in as the server user for real tasks.
- A current browser. Mobile is intended primarily for viewing and approval.

Codes checks the installed CLI’s generated App Server protocol. CLI 0.166.0, 0.167.0, 0.168.0, and 0.172.0 have metadata smoke coverage. Install Codex with `npm install --global @openai/codex`, then follow the [official CLI login instructions](https://learn.chatgpt.com/docs/codex/cli). codes does not copy or expose your CLI credentials.

## Run locally

From the repository directory:

```bash
npm ci
npm run build
CODES_PROJECT_ROOT=/absolute/path/to/your/project npm start
```

Open **http://127.0.0.1:6670**. Sign in using the value in `.local/access-token` (read it on the server with `cat .local/access-token`). Codes prints the path when it first generates the file. Keep its contents private. Projects can also be added through the interface.

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

Then open `http://127.0.0.1:6670` on your computer. Phone access requires a private HTTPS reverse proxy or private network with HTTPS. Add the exact browser origin in **Settings → Network & access** and preserve its `Host` header when proxying. See [operations](docs/operations.md#network-and-access).

This is a **single-owner workspace**. Codex resolves execution permissions for each registered project. **Settings → Codex configuration** displays the effective values and edits the native user configuration. The composer summarizes those values and lets you choose Execution or Plan for the next task. Use `/plan` to switch modes.

## Configuration

Set environment variables in the process environment; the application does not automatically load `.env` files.

| Variable              | Default                            | Purpose                                                       |
| --------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `CODES_RUNTIME`       | `codex`                            | `codex` or `mock`                                             |
| `CODES_HOST`          | `127.0.0.1`                        | Loopback address used before saving network settings          |
| `CODES_PORT`          | `6670`                             | Initial listener port, 1–65535                                |
| `CODES_PUBLIC_ORIGIN` | Local origins on the listener port | Exact initial browser origin when specified                   |
| `CODES_DATA_DIR`      | `.local`                           | Private database, token, lock, and simulator data             |
| `CODES_PROJECT_ROOT`  | unset                              | Register a directory at startup and prefill it in Add project |
| `CODES_CODEX_BINARY`  | `codex`                            | CLI executable path                                           |
| `CODES_ACCESS_TOKEN`  | generated token file               | Optional access token, minimum 16 characters                  |

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

Install a test browser first with `npx playwright install chromium`. Alternatively, set `CODES_CHROME` to an existing Chrome executable. Browser tests use a temporary project, a test-only token, and the simulation runtime. `test:native` uses the installed compatible CLI (or `CODES_CODEX_BINARY`) and an isolated temporary `CODEX_HOME`; it sends no prompts or model requests.

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

- [Spec Coding: Codex execution configuration](docs/spec-coding.md)
- [Architecture and decisions](docs/architecture.md)
- [Project and conversation navigation](docs/session-navigation-proposal.md)
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
