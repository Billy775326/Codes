# Codes

A self-hosted web UI for Codex CLI on Linux. Resume and manage Codex conversations, approve actions, preview files, and review code changes from your browser.

[简体中文](docs/README.zh-CN.md) · [Documentation](docs/README.md) · [Changelog](CHANGELOG.md)

<a id="identity"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/codes-lockup-dark.svg">
  <img alt="Codes" src="public/brand/codes-lockup-light.svg" width="280" height="96">
</picture>

Codes is an independent, single-owner development preview. Codex App Server runs on your Linux host under your existing Codex account. The browser handles conversation navigation, file browsing, and review. Closing a tab leaves active work running on the host.

<a id="requirements"></a>

## One-command install

This command installs the release on glibc-based Linux (x86-64 or ARM64).

```bash
curl -fsSL https://raw.githubusercontent.com/Billy775326/Codes/v0.1.0/scripts/install.sh | bash
```

The release includes Node.js. Install Codex CLI and sign in as the Linux account that will run Codes. Then run `~/.local/bin/codes start` and open [http://127.0.0.1:6670](http://127.0.0.1:6670). Initial startup prints the path to the workspace token. [Install, upgrade, and recover](docs/operations.md#install-or-upgrade-a-release)

## Run locally

You need Linux, Node.js 24.19 or newer in the 24.x line, npm, and a current browser. Install Codex CLI and sign in as the Linux user who will run Codes. [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)

Run these commands from the repository checkout.

```bash
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:6670](http://127.0.0.1:6670) and enter the workspace token from the path printed at initial startup. Existing native conversations appear automatically. Choose a working directory to start a new conversation. The Codes token signs in to the browser workspace. Codex authentication belongs to the Linux account.

<a id="remote-access"></a>

For access from another machine, use SSH forwarding or configure a dedicated HTTPS origin. [Network and access](docs/operations.md#network-and-access)

### Install the launcher

```bash
npm run install:command
```

Add `~/.local/bin` to your PATH. Run `codes` from any directory to start in the foreground, or `codes start` to start in the background. Use `codes help` for commands, `codes doctor` for diagnostics, and `codes logs -f` to follow background output. [Launcher, data directory, and environment](docs/configuration.md)

### Try the workspace without a Codex login

```bash
CODES_RUNTIME=mock CODES_DATA_DIR=.local/demo CODES_PROJECT_ROOT="$PWD" npm start
```

Simulation marks the workspace and uses synthetic turns. Try `[approve]`, `[question]`, or `[hold]` to exercise approvals, questions, and Stop. Use a free listener port if another instance is running. [Development and checks](docs/development.md)

## What is implemented

- Browse native Codex conversations across working directories. Search, rename, archive, restore, and resume conversations. [Conversations](docs/conversations.md)
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
