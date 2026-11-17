# codes

A self-hosted web workspace for Codex CLI on Linux, with an IDE-inspired interface. Use a desktop browser to work with conversations and file context, and a phone to check progress and approve requests.

**Status: an initial development preview, not a released product.** The interface and recovery flows have automated simulator coverage. Real CLI metadata has a separate smoke check, and an isolated live read/write/interrupt pilot has passed. Real approval-policy variants and deployment acceptance remain open gates. See the [acceptance plan](docs/acceptance.md).

## What is implemented

- Projects backed by existing directories on the host.
- Native Codex conversations, streamed assistant text, and command/file activity.
- Command, file, and turn-scoped permission approvals; structured user questions.
- Read-only file browsing and line-range attachments with file-change checks.
- Read-only current-turn diffs and paginated native conversation history.
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

For a simulation without Codex or an account:

```bash
CODES_RUNTIME=mock CODES_DATA_DIR=.local/demo CODES_PROJECT_ROOT="$PWD" npm start
```

The UI clearly labels simulation mode. Send `[approve]` or `[question]` to exercise an interaction, or `[slow]` to try stopping and reconnecting. These markers have no special meaning in real Codex mode.

For development, run `npm run dev` after installing dependencies. It serves the UI and API on the same origin with Vite middleware.

## Remote access

The default listener is loopback only. For desktop access over SSH:

```bash
ssh -L 6670:127.0.0.1:6670 you@your-linux-host
```

Then open `http://127.0.0.1:6670` on your computer. Phone access requires a private HTTPS reverse proxy or private network with HTTPS. Set `CODES_PUBLIC_ORIGIN` to the exact browser origin and preserve its `Host` header when proxying. See [operations](docs/operations.md).

This is a **single-owner workspace** with that owner's host permissions. It is not a multi-user service or a sandbox for untrusted users. Start with **Read only**; choose **Workspace write** explicitly when a task should edit files.

## Configuration

Set environment variables in the process environment; the application does not automatically load `.env` files.

| Variable              | Default                   | Purpose                                           |
| --------------------- | ------------------------- | ------------------------------------------------- |
| `CODES_RUNTIME`       | `codex`                   | `codex` or `mock`                                 |
| `CODES_HOST`          | `127.0.0.1`               | Bind address                                      |
| `CODES_PORT`          | `6670`                    | Listener port, 1024–65535                         |
| `CODES_PUBLIC_ORIGIN` | `http://127.0.0.1:<port>` | Exact allowed browser origin                      |
| `CODES_DATA_DIR`      | `.local`                  | Private database, token, lock, and simulator data |
| `CODES_PROJECT_ROOT`  | unset                     | Register an existing directory at startup         |
| `CODES_CODEX_BINARY`  | `codex`                   | CLI executable path                               |
| `CODES_ACCESS_TOKEN`  | generated token file      | Optional access token, minimum 16 characters      |

Codex inherits the server user's environment and `CODEX_HOME`. Run codes as the intended user, not as root by default. Keep the same CLI login and filesystem access you would use from the command line.

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

It is excluded from CI and the default test command. Unexpected approvals are refused; use the manual pilot for policy-dependent approval flows.

## Documentation

- [Architecture and decisions](docs/architecture.md)
- [Small-scale acceptance and current evidence](docs/acceptance.md)
- [Development milestones](docs/roadmap.md)
- [Operations and recovery](docs/operations.md)
- [Changelog](CHANGELOG.md)
- [中文说明](docs/README.zh-CN.md)

The project has no release tags or published packages. No license has been selected yet; public visibility alone does not grant a software license.

codes is an independent project and is not affiliated with OpenAI. Reference interfaces: [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) and [Codex IDE extension](https://learn.chatgpt.com/docs/codex/ide).
