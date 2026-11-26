# Codes

A self-hosted web UI for Codex CLI on Linux. Manage projects and chats, approve actions, preview files, and review code changes from your browser.

[简体中文](docs/README.zh-CN.md) · [Documentation](docs/README.md) · [Changelog](CHANGELOG.md)

<a id="identity"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/codes-lockup-dark.svg">
  <img alt="Codes" src="public/brand/codes-lockup-light.svg" width="280" height="96">
</picture>

Codes is an independent, single-owner development preview. Codex App Server runs on your Linux host under your existing Codex account. The browser handles conversations, project navigation, and review. Closing a tab leaves active work running on the host.

<a id="requirements"></a>

## Run locally

You need Linux, Node.js 24.19 or newer in the 24.x line, npm, and a current browser. Install Codex CLI and sign in as the Linux user who will run Codes. [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)

Run these commands from the repository checkout with an existing project directory.

```bash
npm ci
npm run build
CODES_PROJECT_ROOT=/absolute/path/to/project npm start
```

Open [http://127.0.0.1:6670](http://127.0.0.1:6670) and enter the workspace token stored on the host in `.local/access-token`. Use **Add project** to register more directories. The Codes token signs in to the browser workspace. Codex authentication belongs to the Linux account.

<a id="remote-access"></a>

For access from another machine, use SSH forwarding or configure a dedicated HTTPS origin. [Network and access](docs/operations.md#network-and-access)

### Install the launcher

```bash
npm run install:command
```

Add `~/.local/bin` to your PATH, then run `codes` from any directory. It starts the same checkout in the foreground. [Launcher, data directory, and environment](docs/configuration.md)

### Try the workspace without a Codex login

```bash
CODES_RUNTIME=mock CODES_DATA_DIR=.local/demo CODES_PROJECT_ROOT="$PWD" npm start
```

Simulation marks the workspace and uses synthetic turns. Try `[approve]`, `[question]`, or `[hold]` to exercise approvals, questions, and Stop. Use a free listener port if another instance is running. [Development and checks](docs/development.md)

## What is implemented

- Organize existing Linux directories and native Codex chats as project cards. Search, rename, archive, restore, and resume conversations. [Projects and chats](docs/conversations.md)
- Send or queue a message, add it to a running turn, answer native questions, and branch through a completed turn. [Working with Codex](docs/conversation-workflow.md)
- Set effective Codex execution options and choose Plan or Execution. [Execution configuration](docs/conversation-settings.md)
- Upload files from the composer or Files. Preview source, images, HTML, Word text, and PDF pages, and inspect the changes recorded in a Codex turn. [Files and changes](docs/conversation-details.md)
- Use the desktop or phone layout with English or Simplified Chinese, themes, optional browser notifications, and saved preferences. [Workspace settings](docs/configuration.md)

<a id="configuration"></a>

## Documentation

| Goal                                    | Guide                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Run, back up, or recover a workspace    | [Operations](docs/operations.md)                                            |
| Configure Codes and Codex               | [Configuration](docs/configuration.md)                                      |
| Build or test a change                  | [Development](docs/development.md)                                          |
| Understand the implementation           | [Architecture](docs/architecture.md) and [Spec Coding](docs/spec-coding.md) |
| See current coverage and remaining work | [Acceptance](docs/acceptance.md) and [Roadmap](docs/roadmap.md)             |

## Checks

Use the documented [development checks](docs/development.md) for format, types, build, simulator coverage, and the native App Server metadata smoke. The [CI workflow](.github/workflows/checks.yml) lists the tested CLI versions.

<a id="design-philosophy"></a>

See [brand and attribution](docs/brand.md) for the identity assets and their font license. The application source has no selected software license.
