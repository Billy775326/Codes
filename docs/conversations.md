# Projects and chats

A project is an existing directory on the Codes host. A conversation is a native Codex thread associated with one project. Chats in the same project share its current files.

## Browse and continue work

1. Select **Add project** and register an existing directory. The default path is configurable in **Settings → Projects**.
2. Expand the project card, choose a conversation, or use its new conversation button. A new draft gets a native thread on first send.
3. Search project and chat titles from the sidebar. Use **Next** when the current native search window returns few results. Codes reads up to 30 entries from a native page and scans up to four native pages per search request.

A browser remembers the last conversation or explicit new draft for each project. Switching restores saved text, closes file previews, and clears unsent attachment selections. Live work remains on the server. For project card and state behavior, see [sidebar design](conversation-sidebar.md).

To discover existing Codex conversations, register their original working directory on the same Linux account. Both ordinary and archived native history can be opened. [Directory ownership and recovery](session-navigation-proposal.md#ownership-and-directory-health)

## Rename, archive, and restore

| Action               | Where to find it                     | Result                                                                           |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Rename conversation  | Next to the conversation title       | Saves a trimmed title of 1–80 characters through Codex                           |
| Archive conversation | Archive icon on its sidebar row      | Moves the chat to the archive and keeps its history and project files            |
| Archive project      | Project card actions                 | Moves the project card to the archive without changing each chat's archive state |
| Restore              | The archived conversation or project | Returns the item to its active list                                              |

The confirmation dialog names the item. Native conversation archiving can also archive spawned threads. Running work, questions, approvals, unknown receipts, or waiting deliveries can block conversation archiving. Restore an archived conversation before sending new work. [Queue controls](conversation-workflow.md#manage-the-fifo-queue)

## Uncertain management results

Use **Check status** on an uncertain archive operation. Codes scans both native archive states with a bounded lookup. Matching native evidence resolves the operation. If the original CLI is still running, seeing the opposite state alone does not resolve an in-flight request.

For an uncertain rename, refresh the conversation list and inspect the native title before changing it again. Management receipts and task execution receipts are independent.

## Metadata migration and rollback

Current Codes uses database schema 6, including new installations. On the first startup from a supported earlier schema, Codes creates a private SQLite snapshot named `codes.schema-v<version>-<timestamp>-<uuid>.sqlite` in the data directory before migrating. Upgrades keep project registrations, receipts, and queued data. Schema 6 preserves legacy execution metadata and holds affected queues for permission review. A failed backup, migration, or unsupported schema stops startup.

The SQLite snapshot covers Codes metadata. Codex history and credentials stay in the service account's Codex home. Preserve the current database, project files, and native Codex home before a rollback. A build that cannot read the current schema needs a matching pre-upgrade backup. Restore the database together with its corresponding data, keeping unrelated WAL and SHM files out of the restore. [Backup and restore](operations.md#download-a-database-backup)

## Reference decisions

Native management follows the [Codex App Server](https://learn.chatgpt.com/docs/app-server) contracts. Workflow references and validation are recorded in the [IDE audit](ide-parity.md) and [acceptance guide](acceptance.md).
