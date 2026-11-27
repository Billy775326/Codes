# Contributing to Codes

[简体中文](docs/zh-CN/contributing.md)

Codes is a self-hosted web interface for Codex CLI. Start with a simulated workspace, then use the map below to find the feature you want to change and its tests.

## Start a development workspace

Run these commands from the repository root on Linux with Node.js 24.19.0 or later in the 24.x line and npm. The simulator runs locally without a Codex login or model requests. [Runtime requirements](package.json)

```bash
npm ci
codes_dev_data=$(mktemp -d)
CODES_RUNTIME=mock CODES_DATA_DIR="$codes_dev_data" CODES_HOST=127.0.0.1 CODES_PORT=6671 npm run dev
```

Open [http://127.0.0.1:6671](http://127.0.0.1:6671) and enter the token from the file shown in the terminal. Use another free port if 6671 is occupied. Send `[question]` to try a structured question or `[hold]` to keep a turn running while you test the queue or Stop. Press Ctrl+C in the terminal when finished. [Simulator and real CLI checks](docs/development.md)

## Find the code and tests

The browser sends HTTP requests to the Node.js service and receives updates over Server-Sent Events (SSE). The service communicates with Codex App Server over JSONL on standard input and output. Codex owns native conversations, working directories, execution, and effective Codex configuration. Codes owns web access, drafts, queues, and delivery receipts. [Architecture](docs/architecture.md) · [Execution invariants](docs/spec-coding.md)

| Feature                                  | Start here                                                                                                                                                                                    | Regression tests                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Conversation list and navigation         | [Conversations.tsx](src/web/Conversations.tsx), [native conversation routes](src/server/routes/native-conversations.ts)                                                                       | [conversations.spec.ts](tests/browser/conversations.spec.ts)                                                           |
| Send, queue, and add to the current turn | [useMessageDelivery.ts](src/web/useMessageDelivery.ts), [service.ts](src/server/service.ts), [message-queue.ts](src/server/message-queue.ts)                                                  | [delivery.spec.ts](tests/browser/delivery.spec.ts), [service.test.ts](tests/service.test.ts)                           |
| History, reconnect, and live updates     | [useConversationTimeline.ts](src/web/useConversationTimeline.ts), [conversation-snapshot.ts](src/web/conversation-snapshot.ts), [conversation-history.ts](src/server/conversation-history.ts) | [history.spec.ts](tests/browser/history.spec.ts), [conversation-snapshot.test.ts](tests/conversation-snapshot.test.ts) |
| Files and Changes                        | [FilesPanel.tsx](src/web/FilesPanel.tsx), [file routes](src/server/routes/files.ts), [DiffView.tsx](src/web/DiffView.tsx)                                                                     | [files.spec.ts](tests/browser/files.spec.ts), [details.spec.ts](tests/browser/details.spec.ts)                         |
| Codex protocol and configuration         | [protocol.ts](src/codex/protocol.ts), [driver.ts](src/codex/driver.ts), [native-configuration.ts](src/server/native-configuration.ts)                                                         | [driver.test.ts](tests/driver.test.ts), [native-configuration.test.ts](tests/native-configuration.test.ts)             |
| Launcher and installer                   | [codes.mjs](bin/codes.mjs), [install.sh](scripts/install.sh)                                                                                                                                  | [installer smoke](scripts/smoke-install.sh), [command.spec.ts](tests/browser/command.spec.ts)                          |

Use native turn events and history to confirm execution outcomes. A lost acknowledgement leaves the result uncertain, so retry behavior must reconcile the original operation before sending again. For changes to layout or controls, verify keyboard interactions, supported themes, and narrow screens. [Interface design](docs/interface-design.md)

## Verify and submit a change

Start on a focused branch from `main`. Reproduce the issue or describe the expected behavior, and pick the closest test from the map above. For example, after changing the Changes panel, run its browser tests.

```bash
npm run check
npx playwright install chromium
npm run test:e2e -- tests/browser/details.spec.ts
```

Before submitting implementation changes, run `npm run format:check`, `npm run check`, `npm test`, and `npm run test:e2e`. For changes to the App Server adapter, also use `npm run test:native` with a compatible installed CLI. It inspects metadata using a temporary Codex home. The development guide explains when to use the real-account tests. [Development checks](docs/development.md#checks) · [CI workflow](.github/workflows/checks.yml)

Use English conventional commits such as `fix(changes): restore the latest recorded patch`. Add user-visible changes under [Unreleased](CHANGELOG.md#unreleased). In a pull request, describe the affected flow, list the checks you ran and their results, and include screenshots for visible changes when helpful. Use synthetic data in reproductions and keep tokens, local configuration, and runtime transcripts out of commits. [Project conventions](AGENTS.md)
