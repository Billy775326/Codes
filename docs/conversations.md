# Conversation management

For the single workspace owner, the sidebar provides native Codex conversation discovery and management for the selected project. It uses the server account and Codex CLI 0.167.0. No additional Codex account or transcript database is created.

## Browse and continue work

- **New conversation** starts an unsent draft. The native conversation is created when its first message is sent.
- Select a conversation to open its native history. Switching preserves unsent text per conversation in that browser, within the existing 20-draft retention limit. Attachments are not retained when switching.
- **Active** shows conversations that are not archived; it includes completed conversations. **Archived** shows the native archive separately. Date groups use the browser's local calendar.
- Search matches conversation titles without case sensitivity. It does not search message bodies, files, or other projects.
- Pages contain up to 30 results from a native page. Sparse search scans at most four native pages, with a 20-second request deadline; an empty portion can still have a **Next** page. Continue until there is no next page to finish searching. This is not a global result count.
- Use Previous/Next for older conversations and Refresh to return to the first page. New activity can change native ordering; refresh if another client changes the list while paging. Discovery is independent of the 200-entry local summary snapshot.

## Rename, archive, and restore

Open the row's actions button. **Rename** accepts a trimmed title of 1–80 characters and writes it through `thread/name/set`. A rename does not cancel an active task or clear its execution receipt. Escape cancels editing.

**Archive** asks for confirmation, then calls native `thread/archive`. History and project files are retained. Codex may also archive conversations spawned by that conversation; the confirmation explains this native behavior. Running tasks, pending approvals/questions, and unresolved execution receipts block archiving. A cheap native turn-metadata check also rejects unfinished turns that codes did not dispatch.

An archived conversation can be read, including after reload. Sending is disabled until **Restore** or **Restore conversation** calls native `thread/unarchive`. Restoring does not resend a previous task. This preview does not offer permanent deletion.

Codes clients receive metadata changes through existing summary/state events. Refresh the list to discover changes made outside this app-server process. Empty native conversations are materialized lazily and may disappear if the CLI restarts before their first user message.

## Uncertain management results

Rename and archive requests have operation IDs recorded separately from task execution. The server never automatically resends a mutation after a lost acknowledgement.

An uncertain archive keeps the conversation protected against sending or another metadata change. **Check status** performs a bounded scan of both native archive states. Positive native evidence of the requested state releases the protection. Seeing the opposite state while the same CLI process is still running is insufficient: the original request could still finish. If that CLI process has ended, a confirmed opposite state marks the old request failed. A scan that cannot find the conversation leaves it protected; refresh and search both views or inspect the native CLI. There is no force-unlock action.

An uncertain rename asks for a list refresh to inspect the native title. It does not release or alter any pending task receipt. Inspect the result before choosing another title.

## Metadata migration and rollback

On the first startup with schema 1, codes writes a consistent SQLite snapshot named `codes.schema-v1-<timestamp>-<uuid>.sqlite` in `CODES_DATA_DIR`, with owner-only permissions, before adding the archive column and recording schema 2. Existing project registrations, settings, and operation receipts are preserved. If backup or migration fails, startup fails; it does not reset the database. Fresh installations start at schema 2. Unsupported versions are rejected.

The backup covers codes metadata only. Native histories, archive locations, and authentication remain in the server account's Codex home. Back up both locations with the service stopped before upgrading. Retain backups privately until the upgrade is accepted.

Older code cannot open schema 2. To roll back, stop the service and preserve the current metadata and Codex home first. Restore a matched pre-upgrade metadata/Codex-home backup under the intended account, preserving permissions, then start the older code. Do not mix a restored database with WAL/SHM files from another database. The automatic schema 1 snapshot alone does not undo native archive changes or preserve work created after the snapshot. Full deployment backup/restore acceptance remains a separate gate.

## Reference decisions

The sidebar follows the IDE extension's project/conversation workflow and Covro's searchable conversation navigation, rename actions, and archive/restore separation. These are interaction references; codes retains its own React UI and uses native app-server methods rather than parsing a terminal screen.

Protocol fields were checked against the generated schemas of installed CLI 0.167.0, alongside the [official app-server documentation](https://learn.chatgpt.com/docs/app-server). See the [official IDE extension documentation](https://learn.chatgpt.com/docs/ide) and [Covro](https://github.com/yuzheng14/covro) 0.10.0 (installed package README/frontend) for the interaction references. No Covro user data or authentication was copied.

Validation methods are recorded in [small-scale acceptance](acceptance.md). Simulator evidence, real CLI execution, and deployment acceptance are reported separately.
