# Conversations

Codes lists conversations through the running Codex App Server. Use the same Linux account and Codex home as the CLI to see its interactive history.

## Browse and continue work

1. Choose **Active** or **Archived** to browse conversations across all working directories.
2. Search by title, sort by update or creation time, or use the native pagination controls.
3. Select a conversation to open its history. A new conversation starts as a draft and receives a native thread ID on first send.

Switching conversations restores unsent text and leaves live work running. See the [sidebar design](conversation-sidebar.md) for summary and status behavior.

## Working directories

A new draft uses the current working directory when available. Change it with the folder control in the draft header or choose one when starting without a directory. The server checks that it is an accessible, existing Linux directory before creating the native thread.

An existing conversation uses the working directory returned by Codex for effective configuration, execution, files, and review. A missing directory preserves history and blocks directory operations. Restore the directory or permissions and use **Retry directory**. If Codex reports a different directory while older work or file references are pending, resolve the receipt or remove the affected queue entries before continuing.

## Rename, archive, and restore

| Action  | Where to find it               | Result                                                               |
| ------- | ------------------------------ | -------------------------------------------------------------------- |
| Rename  | Next to the conversation title | Updates the native title                                             |
| Archive | Archive icon on the row        | Runs the native archive operation and keeps the conversation history |
| Restore | Restore icon in **Archived**   | Runs native unarchive and returns the conversation to **Active**     |

Codex may also archive conversations started from the selected thread. Active work, pending interactions, unknown receipts, or waiting deliveries can block archiving. Restore an archived conversation before sending new work. [Queue controls](conversation-workflow.md#manage-the-fifo-queue)

## Uncertain management results

Use **Check status** on an uncertain archive operation. Codes checks both native archive states by ID when supported and uses a bounded directory-scoped scan with older versions. Matching native evidence resolves the operation. If the original CLI is still running, seeing the opposite state alone does not resolve an in-flight request.

For an uncertain rename, refresh the conversation list and inspect the native title before changing it again. Management receipts and task execution receipts are independent.

## Metadata migration and rollback

Current Codes uses database schema 6, including new installations. On the first startup from a supported earlier schema, Codes creates a private SQLite snapshot named `codes.schema-v<version>-<timestamp>-<uuid>.sqlite` in the data directory before migrating. Upgrades keep legacy workspace metadata, receipts, and queued data. Schema 6 preserves legacy execution metadata and holds affected queues for permission review. A failed backup, migration, or unsupported schema stops startup.

The SQLite snapshot covers Codes metadata. Codex history and credentials stay in the service account's Codex home. Preserve the current database, project files, and native Codex home before a rollback. A build that cannot read the current schema needs a matching pre-upgrade backup. Restore the database together with its corresponding data, keeping unrelated WAL and SHM files out of the restore. [Backup and restore](operations.md#download-a-database-backup)

## Reference decisions

Native management follows the [Codex App Server](https://learn.chatgpt.com/docs/app-server) contracts. Workflow references and validation are recorded in the [IDE audit](ide-parity.md) and [acceptance guide](acceptance.md).
