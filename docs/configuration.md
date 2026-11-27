# Configuration reference

Configure the browser experience in Codes and agent execution in Codex. Use **Settings** in the sidebar to find each section. The dialog can search by English or Chinese terms.

Browser preferences save as you change them. Execution, instructions, network, sign-in validity, and CLI settings use the footer to save and report unsaved edits, saved changes, and any required restart. Ctrl/Cmd+S saves the form you are editing. The network section shows separate save buttons when both the listener or browser access settings and the sign-in validity have drafts. Access-token rotation uses its own confirmation form.

The dialog marks sections with drafts and lets you review them before closing. If instructions or CLI settings change outside the dialog, reload the latest version to keep your draft and save again. For instructions, the saved text appears alongside the draft for comparison.

<a id="settings-by-scope"></a>

## Settings by function

| Section              | What it controls                                                                                                                     | Where it applies                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **General**          | Appearance, keyboard, follow-up delivery, new conversation directory selection, review delivery, scrolling, hidden files, and layout | This browser                                           |
| **Notifications**    | Which task, approval, and question events produce browser notifications                                                              | This browser                                           |
| **Instructions**     | Edit Codex global instructions                                                                                                       | Active Codex home                                      |
| **Execution**        | Effective project model, reasoning, speed, approvals, sandbox, and supported native features                                         | Codex configuration layers for the execution directory |
| **Network & access** | Listener, allowed origins, authentication mode, sign-in lifetime, and file-backed token rotation                                     | Codes server                                           |
| **Codex CLI**        | Native request deadline                                                                                                              | Codes server                                           |
| **Maintenance**      | Task admission and connection diagnostics. Expand **Runtime paths** for the CLI version, launcher, and Codes data directory.         | Running Codes server                                   |
| **Backup & restore** | SQLite backup and offline restore preparation, network configuration files, and browser preference files                             | Workspace data, server configuration, or this browser  |

English and dark theme are defaults. Chat and code text default to 14 px. **General → Appearance** also offers Simplified Chinese, Light, and System. Native conversation content retains the language of the conversation. [Interface design](interface-design.md)

In **General → Interaction**, choose whether a new conversation uses the current directory or asks each time. **General → Keyboard** contains the send shortcut, the **Tab to queue** switch, and a shortcut reference. Opening an archived conversation still uses its directory from Codex. [Delivery controls](conversation-workflow.md#understand-delivery-buttons)

Use **General → Layout** to restore both sidebar widths. Use **General → Defaults** to reset browser settings.

Use **Data → Backup & restore** for all settings imports and exports and for database backup and restore. **Workspace database** downloads a SQLite snapshot or prepares an offline restore. **Network configuration** exports the saved listener and access settings, or opens an imported JSON file as a draft for review in **Network & access**. **Browser preferences** exports appearance, interaction, notification, file visibility, and sidebar widths as versioned JSON. Choose a browser preferences file of up to 16 KiB and review its changes before applying it. Sign-in credentials and drafts use their own storage. [Persistent state](operations.md#persistent-state)

## Startup environment

Set these values in the environment of the process that runs Codes.

| Variable                         | Default                                     | Purpose                                                                                                  |
| -------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CODES_RUNTIME`                  | `codex`                                     | Use real Codex or the `mock` simulator                                                                   |
| `CODES_DATA_DIR`                 | `~/.local/share/codes`                      | Private database, token, settings, uploads, and service lock                                             |
| `CODES_PROJECT_ROOT`             | Directory where Codes was started           | Overrides the initial working directory for a new draft. The native session list covers all directories. |
| `CODES_CODEX_BINARY`             | `codex`                                     | Name or path of the Codex executable                                                                     |
| `CODES_CODEX_REQUEST_TIMEOUT_MS` | `30000`                                     | Initial general RPC deadline, 1,000–300,000 ms                                                           |
| `CODES_HOST`                     | `127.0.0.1`                                 | Initial loopback listener                                                                                |
| `CODES_PORT`                     | `6670`                                      | Initial port, 1–65535                                                                                    |
| `CODES_PUBLIC_ORIGIN`            | Local loopback origins on the listener port | One exact initial browser origin when specified                                                          |
| `CODES_ACCESS_TOKEN`             | A private generated token file              | Optional environment-backed workspace token                                                              |
| `CODES_READ_DIAGNOSTICS`         | Unset                                       | Set to `1` to log successful diagnostic reads from startup                                               |
| `CODEX_HOME`                     | The service user's `~/.codex`               | Native Codex configuration, login, and histories                                                         |

The server reads process environment variables at startup. Use shell exports or your service manager to supply values. A saved `network-settings.json` overrides the listener environment defaults. A saved `runtime-settings.json` overrides the initial RPC deadline. Listener and deadline changes apply on restart. Token rotation and future sign-in lifetime have their own controls. [Network and access](operations.md#network-and-access)

New conversations use the selected working directory. Existing conversations use the directory returned by Codex. Global instructions are edited in the effective Codex home. Codes opens a nonempty `AGENTS.override.md` when active, or `AGENTS.md` otherwise. Changes are read when a new Codex session loads instructions. [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

## Launcher

Use `npm run install:command` with a supported Node version to create `~/.local/bin/codes`. Set `CODES_BIN_DIR` at installation to choose another directory. Keep the checkout and the Node executable used at installation in place. `codes` runs the checkout's build in the foreground. `codes start` runs it in the background. New installs use `$XDG_DATA_HOME/codes` or `~/.local/share/codes`. An existing checkout database under `.local` is used when `CODES_DATA_DIR` is unset. Explicit relative data, project, and executable paths are resolved from the calling directory.

Use `codes help`, `codes -h`, or `codes --help` for usage. Set `CODES_DATA_DIR` when managing, diagnosing, or viewing logs for a particular instance. Use the same directory as at startup. [Process lifecycle](operations.md#process-lifecycle)
