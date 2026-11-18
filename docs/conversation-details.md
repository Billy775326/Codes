# Clarifications and file-change previews

codes follows the published Codex IDE interaction contracts for native clarifications and local patch inspection. Use a desktop to review changes and a phone to answer a pending question. This is an independent Web implementation; it does not include VS Code editor integration or Git stage/revert actions.

## Read a turn's work history

Each native turn has one work-history disclosure. Intermediate assistant commentary, command activity, integration/search summaries, and review progress belong inside it. The final answer, one edited-files card, and one Copy/Reply/Branch row stay outside. Multiple native edits in the turn share the card; repeated edits preserve their recorded order rather than claiming a net Git diff. Follow-up user messages remain visible above their turn's work history. Pending approvals and questions remain directly available outside the disclosure.

Completed history defaults to collapsed. Running work opens automatically and collapses after completion unless you explicitly opened or closed it. New records, status updates and reconnect snapshots preserve that choice while the turn remains mounted. Reloading or switching conversations resets to the default. Expand the history to inspect intermediate messages and tools, then expand an individual command for its captured output. Closed history does not mount those rows or output text. Failures, stopped tools and unavailable tool statuses remain visible on the header; a failed command does not become a successful summary.

The header uses native turn duration or native start/end timestamps when provided. Active elapsed time updates only when a native start timestamp is known. Legacy history without timing says **Work history**, never an invented zero duration. Native `commentary`, `partial_answer` and `final_answer` phases identify progress and answers. For older providers without phases, only the last assistant message after completion is treated as the final answer; explicitly marked commentary is never promoted to one. Native reasoning records are omitted. Integration summaries do not expose raw arguments or results.

Grouping changes presentation only; it does not change native history, task dispatch or approval handling. The same loaded-history and preview limits apply.

Workspace text, line spacing and controls use larger fixed defaults. Older saved display-size values are ignored; existing theme and interaction preferences remain compatible. Dark mode uses layered dark gray surfaces and subdued light text; light and system themes remain available. Narrow composers use two control rows to keep send/stop available with larger text.

The first user message shows the native turn's start time below its bubble; the final reply's action row shows the native finish time. Dates use the browser's local timezone. Hover for the full date, seconds and timezone; the HTML timestamp also retains its UTC instant. These are turn timestamps, not invented per-item send times. Intermediate activity and same-turn follow-ups have no independent timestamp unless the protocol supplies one. Missing native times leave no placeholder or reserved row.

## Browse earlier messages and return to live replies

**Load earlier messages** opens a separate reading window. The latest 240 live messages continue receiving event updates in the background; loading history cannot evict them. Each historical window also holds at most 240 messages and avoids cutting a turn at its newer edge. Continue loading earlier pages even when that window reaches its limit.

A **Back to latest** button remains above the composer while browsing history or scrolling away from the bottom. **New activity** signals that the live conversation changed while you were reading. Returning to latest uses the live cache immediately, scrolls to the bottom, and preserves your draft. Sending a new message also returns to the live view. The composer and native approval/question handling continue to use the current live task, rather than a historical task's state.

Reconnect updates the live cache while retaining the historical reading window. Switching conversations, changing projects, returning to latest or starting a send cancels an in-flight history request; a late response cannot populate another conversation. History and live caches have separate bounded windows, rather than retaining the whole conversation in the browser.

## When Codex asks a question

The native agent decides whether to call `request_user_input`. codes does not manufacture a question for every prompt or treat ordinary assistant prose as a structured request. Code-mode availability is enabled by default for the codes child process with the pinned CLI's `features.default_mode_request_user_input` setting. Set `CODES_CODE_QUESTIONS=0` before starting to retain Plan-only availability. Global Codex configuration is unchanged.

In Plan, questions are required. In Code, the native request can be optional. The UI follows the request's `isBlocking` field; requests without that field are conservatively treated as required. **Skip question** is available only for an optional request and sends an empty native answer map. No timer automatically chooses or submits an answer.

1. Use **Answer questions** above the composer to focus the pending card.
2. Review the question, suggested first choice, and option descriptions. Arrow keys move through native radio choices. A suggested choice has not been submitted.
3. Choose an option or type a custom answer when the request permits it. Secret inputs stay masked. Every required answer must be present before submission.
4. Select **Submit answer**, or explicitly skip an optional request. **Cancel task** interrupts the actual turn.

Responses belong to that native request and turn. Another signed-in device can resolve it; the card disappears when the CLI reports resolution. Expired requests cannot be answered again. HTTP or runtime uncertainty never triggers an automatic resend. Secret answers are not stored as plaintext in the codes operation journal or browser draft storage; the native CLI may retain them in its own history.

## Inspect a patch

Open **Review changes**, or select **Review** in an **Edited files** card in the conversation. File approvals include the proposed patch when the CLI provides one. The list shows changed paths, add/delete/rename information, and addition/deletion counts for the available patch.

- **Unified** displays the original and resulting line numbers beside each patch row. **Side by side** aligns removed and added blocks; narrow screens can scroll the patch horizontally.
- Expand a file to inspect it. **Open file** uses the existing read-only project file viewer, including its traversal, hidden-file, symlink, size and UTF-8 checks. Deleted files have no Open action. A path outside the project is rejected rather than opened outside the registered workspace.
- **Mark viewed** records that displayed file revision in the mounted preview. Changed patch content resets the marker. Markers are not saved across a page reload.
- **Change scope** defaults to the last native turn. Earlier turns that contain changes in the loaded history can be selected. This is not an aggregate Git working-tree diff or a complete search of unloaded history.

When a historical turn contains several edits to the same file, the preview preserves their native sequence and labels it explicitly. Each patch is relative to the preceding edit; counts are not a reconstructed net diff. The current turn uses the native aggregate diff when available. Large historical sequences share the same preview budget; the turn card and Review viewer use bounded previews, and native history retains the individual recorded patches.

Only an expanded file renders patch rows. Each file shows at most 200 rows at a time, with Previous/Next navigation. Parsing is capped at 128 Ki characters, 8,000 rows and 100 files per patch. A native file-change item shares one 128 Ki-character patch budget across its files. Existing history and transport limits still apply. Truncation notices mean the preview and counts cover only the available portion; inspect the workspace/native history for the full result.

Native patches are displayed as text. codes does not apply patch text, execute paths embedded in it, stage changes, or revert workspace files. A patch is a record of the native edit, while **Open file** reads the current filesystem contents; a subsequent edit can make those differ.

See the [IDE alignment audit](ide-parity.md) for the published package and pinned source references, and [acceptance](acceptance.md) for verification boundaries.
