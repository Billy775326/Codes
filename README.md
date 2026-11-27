# Codes

A self-hosted web UI for Codex CLI on Linux. Resume and manage Codex conversations, approve actions, preview files, and review code changes from your browser.

[简体中文](docs/README.zh-CN.md) · [Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

<a id="identity"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/codes-lockup-dark.svg">
  <img alt="Codes" src="public/brand/codes-lockup-light.svg" width="280" height="96">
</picture>

Codes is an independent, single-owner development preview. Codex App Server runs on your Linux host under your existing Codex account. The browser handles conversation navigation, file browsing, and review. Closing a tab leaves active work running on the host.

<a id="requirements"></a>
<a id="one-command-install"></a>

## Quick start

Use a glibc-based Linux host (x86-64 or ARM64). Install Codex CLI as the Linux user who will run Codes. [Codex CLI setup](https://learn.chatgpt.com/docs/codex/cli)

### Install Codes

```bash
curl -fsSL https://raw.githubusercontent.com/Billy775326/Codes/v0.2.1/scripts/install.sh | bash
```

Choose the interface language and listener port in the terminal. The installer prints the workspace URL and a newly generated access token. The release includes Node.js and installs the `codes` launcher in `~/.local/bin`. [Install and upgrade](docs/operations.md#install-or-upgrade-a-release)

### Start the workspace

```bash
~/.local/bin/codes start
```

Open the URL printed by the installer, which defaults to [http://127.0.0.1:6670](http://127.0.0.1:6670), and enter the workspace token. If Codex needs an account, use **Sign in to Codex** in the workspace for device-code sign-in on compatible CLI versions. Continue a native Codex conversation from the sidebar or start a new one. [Working directories](docs/conversations.md#working-directories)

<a id="remote-access"></a>

For access from another machine, use SSH forwarding or configure a dedicated HTTPS origin. [Network and access](docs/operations.md#network-and-access)

<a id="run-locally"></a>

## Run from source

Use Node.js 24.19 or later in the 24.x line and npm. Run these commands from the repository checkout.

```bash
npm ci
npm run build
npm start
```

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

## Features

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

## Acknowledgments

Thanks to the maintainers and contributors of the projects that shaped Codes.

- **Codex CLI** provides native sessions and task execution through App Server. [openai/codex](https://github.com/openai/codex)
- **Covro** served as a reference for the self-hosted Codex workspace and settings. [yuzheng14/covro](https://github.com/yuzheng14/covro)
- **1Panel** served as a reference for settings organization and the quick-start installation flow. [1Panel-dev/1Panel](https://github.com/1Panel-dev/1Panel)

[Third-party components and licenses](LICENSES/THIRD-PARTY.md) · [Brand and attribution](docs/brand.md)

## License

The Codes application source is available under the [MIT License](LICENSE).
