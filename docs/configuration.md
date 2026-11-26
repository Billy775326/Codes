# Configuration reference

Configure the browser experience in Codes and agent execution in Codex. Use **Settings** in the sidebar to find each section. The dialog can search by English or Chinese terms.

## Settings by scope

| Section              | What it controls                                                                                                      | Where it applies                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **General**          | Theme, language, chat and code size, Enter behavior, follow-up delivery, review delivery, scrolling, and hidden files | This browser                                           |
| **Notifications**    | Which task, approval, and question events produce browser notifications                                               | This browser                                           |
| **Instructions**     | Edit Codex global instructions                                                                                        | Active Codex home                                      |
| **Execution**        | Effective project model, reasoning, speed, approvals, sandbox, and supported native features                          | Codex configuration layers for the execution directory |
| **Network & access** | Listener, allowed origins, authentication mode, sign-in lifetime, and file-backed token rotation                      | Codes server                                           |
| **Codex CLI**        | Native request deadline and display of the configured executable and data directory                                   | Codes server                                           |
| **Maintenance**      | Task admission, connection diagnostics, and session status                                                            | Running Codes server                                   |
| **Backup & restore** | SQLite snapshot download and staging of an offline restore                                                            | Codes data directory                                   |

English and dark theme are defaults. Chat and code text default to 14 px. **General → Appearance** also offers Simplified Chinese, Light, and System. Native conversation content retains the language of the conversation. [Interface design](interface-design.md)

## Startup environment

Set these values in the environment of the process that runs Codes.

| Variable                         | Default                                     | Purpose                                                                                                     |
| -------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CODES_RUNTIME`                  | `codex`                                     | Use real Codex or the `mock` simulator                                                                      |
| `CODES_DATA_DIR`                 | `~/.local/share/codes`                      | Private database, token, settings, uploads, and service lock                                                |
| `CODES_PROJECT_ROOT`             | Unset                                       | Optional initial working directory for a new draft. The native session list is independent of this setting. |
| `CODES_CODEX_BINARY`             | `codex`                                     | Name or path of the Codex executable                                                                        |
| `CODES_CODEX_REQUEST_TIMEOUT_MS` | `30000`                                     | Initial general RPC deadline, 1,000–300,000 ms                                                              |
| `CODES_HOST`                     | `127.0.0.1`                                 | Initial loopback listener                                                                                   |
| `CODES_PORT`                     | `6670`                                      | Initial port, 1–65535                                                                                       |
| `CODES_PUBLIC_ORIGIN`            | Local loopback origins on the listener port | One exact initial browser origin when specified                                                             |
| `CODES_ACCESS_TOKEN`             | A private generated token file              | Optional environment-backed workspace token                                                                 |
| `CODES_READ_DIAGNOSTICS`         | Unset                                       | Set to `1` to log successful diagnostic reads from startup                                                  |
| `CODEX_HOME`                     | The service user's `~/.codex`               | Native Codex configuration, login, and histories                                                            |

The server reads process environment variables at startup. Use shell exports or your service manager to supply values. A saved `network-settings.json` overrides the listener environment defaults. A saved `runtime-settings.json` overrides the initial RPC deadline. Listener and deadline changes apply on restart. Token rotation and future sign-in lifetime have their own controls. [Network and access](operations.md#network-and-access)

New conversations use the selected working directory. Existing conversations use the directory returned by Codex. Global instructions are edited in the effective Codex home. Codes opens a nonempty `AGENTS.override.md` when active, or `AGENTS.md` otherwise. Changes are read when a new Codex session loads instructions. [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

## Launcher

Use `npm run install:command` with a supported Node version to create `~/.local/bin/codes`. Set `CODES_BIN_DIR` at installation to choose another directory. Keep the checkout and the Node executable used at installation in place. The launcher starts in the foreground and uses the checkout's build. New installs use `$XDG_DATA_HOME/codes` or `~/.local/share/codes`. An existing checkout database under `.local` is used when `CODES_DATA_DIR` is unset. Explicit relative data, project, and executable paths are resolved from the calling directory.

Use `codes --help` for usage. An occupied data directory lock reports the owner and exits. [Process lifecycle](operations.md#process-lifecycle)
