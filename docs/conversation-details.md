# Clarifications and file-change previews

codes follows the published Codex IDE interaction contracts for native clarifications and local patch inspection. Use a desktop to review changes and a phone to answer a pending question. This is an independent Web implementation; it does not include VS Code editor integration or Git stage/revert actions.

## Preview images and HTML

External web links in chat open in a new tab. Links within the Codes workspace use the current tab.

Files previews project PNG, JPEG, and WebP images in place. In the conversation, local image links open a preview dialog and Markdown images display inline. Absolute paths refer to files on the Codes server, regardless of the selected project. Relative paths use the conversation's project root. Preview links require workspace sign-in. The Codes data directory allows direct raster exports and files in its `images` and `screenshots` folders. Other runtime subdirectories and the Codex home remain private. Images load on demand, are validated from a header of at most 512 KiB, and are limited to 8 MiB and 24 megapixels.

Use **Preview HTML** below an HTML code block, standalone HTML answer, or inside an open `.html` / `.htm` file. Opening a preview closes the previous one. The isolated preview supports static markup, inline CSS and embedded raster images. Scripts, navigation, form submissions and external asset requests are disabled. Source stays visible in the conversation or Files.

## Read a turn's work history

Each native turn has one work-history disclosure. Intermediate assistant commentary, command activity, integration/search summaries, and review progress belong inside it. The final answer, one edited-files card, and one Copy/Reply/Branch row stay outside. Multiple native edits in the turn share the card; repeated edits preserve their recorded order rather than claiming a net Git diff. Follow-up user messages remain visible above their turn's work history. Pending approvals and questions remain directly available outside the disclosure. Consecutive terminal and tool activities form collapsed groups inside work history, so opening the turn reveals the commentary without listing every command.

Completed history defaults to collapsed. Running work opens automatically and collapses after completion unless you explicitly opened or closed it. New records, status updates and reconnect snapshots preserve that choice while the turn remains mounted. Reloading or switching conversations resets to the default. Expand the history to inspect intermediate messages and tools, then expand an individual command for its captured output. Closed history does not mount those rows or output text. Failures, stopped tools and unavailable tool statuses remain visible on the header; a failed command does not become a successful summary.

The header uses native turn duration or native start/end timestamps when provided. Active elapsed time updates only when a native start timestamp is known. Legacy history without timing says **Work history**, never an invented zero duration. Native `commentary`, `partial_answer` and `final_answer` phases identify progress and answers. For older providers without phases, only the last assistant message after completion is treated as the final answer; explicitly marked commentary is never promoted to one. Native reasoning records are omitted. Integration summaries do not expose raw arguments or results.

Grouping changes presentation only; it does not change native history, task dispatch or approval handling. The same loaded-history and preview limits apply.

Workspace text, line spacing and controls use larger fixed defaults. Older saved display-size values are ignored; existing theme and interaction preferences remain compatible. Dark mode uses layered dark gray surfaces and subdued light text; light and system themes remain available. Narrow composers use two control rows to keep send/stop available with larger text.

The first user message shows the native turn's start time below its bubble; the final reply's action row shows the native finish time. Dates use the browser's local timezone. Hover for the full date, seconds and timezone; the HTML timestamp also retains its UTC instant. These are turn timestamps, not invented per-item send times. Intermediate activity and same-turn follow-ups have no independent timestamp unless the protocol supplies one. Missing native times leave no placeholder or reserved row.

When native usage is recorded, the final reply’s action row shows the turn outcome, average output tokens per second, total tokens and completion time in place of the standalone timestamp. The rate includes tool and waiting time. Codes retains usage for the latest 1,000 recorded turns per conversation, so a new task or a restart does not move that summary. Replies without recorded usage retain their existing timestamp. The latest task still has a status below the transcript when it has no inline summary. The sidebar displays the conversation’s latest task status, including required and optional questions, approvals, simultaneous requests, responses awaiting confirmation, context compaction and expired questions.

## Scroll through conversation history

The conversation is one continuous timeline. Scrolling near the top loads an older native page; scrolling near the bottom fetches newer pages when they have left the display cache. The visible turn stays anchored while pages are inserted or removed. Mouse wheels, touch scrolling, keyboard scrolling and scrollbar dragging share the same pagination path. **Load earlier messages** and the newer-page fallback remain available for explicit loading or retry; **Back to latest** is an optional jump, rather than a required mode switch.

The browser retains three whole native pages and a separate bounded live cache. Each history page still has the existing 240-message/2 MiB server budget. Pages evicted at the opposite edge remain reachable with native cursors. Overlapping anchor records are deduplicated and refreshed. Live messages join the timeline when the page reaches a contiguous overlap with the live cache; the browser fetches the intervening pages when there is a gap. Reading older records does not stop live event handling or native approval/question controls.

New activity does not force the reader to the bottom. At the live end, replies follow automatically; the optional jump also returns there while retaining the draft. Sending a new message returns to the live view. Reconnect preserves the reading window. Switching conversations/projects or jumping to latest cancels pending history reads, and late responses cannot enter another conversation. Failed page reads show an explicit retry instead of a retry loop.

## Context compaction

Codes follows the native `contextCompaction` item lifecycle. During `item/started`, the selected conversation displays **Compacting context…**. `item/completed` removes that live indicator and records **Context compacted.** in work history. The turn and its receipt remain running until the native turn completes; pending messages do not dispatch merely because compaction finished. Stop interrupts the actual native turn.

Browser reload/reconnection reads the existing snapshot, including current compaction progress. Terminal turn events and runtime loss clear the live indicator. Duplicate events are idempotent; late events from another turn cannot alter the current progress. Historical item timestamps establish started/completed state when supplied. Timestamp-free historical records show **Context compaction**, without inventing success or an ongoing spinner. Runtime loss retains existing uncertain-outcome protection.

This is progress display, not browser-side context summarization, transcript deletion, or a `/compact` command. Native token notifications remain the source of usage; Codes does not estimate recovered tokens. See the [official App Server lifecycle](https://learn.chatgpt.com/docs/app-server).

## When Codex asks a question

The native agent decides whether to call `request_user_input`. codes does not manufacture a question for every prompt or treat ordinary assistant prose as a structured request. Code-mode availability is enabled by default for the codes child process with the pinned CLI's `features.default_mode_request_user_input` setting. Set `CODES_CODE_QUESTIONS=0` before starting to retain Plan-only availability. Global Codex configuration is unchanged.

Question cards appear inside the turn that requested input. Codes joins renumbered legacy history items to the matching live request using the full question group and choice labels. When multiple live requests match or separate matching items appear together in one history page, Codes keeps the entries separate. Confirmed replies to asynchronous questions stay on the original card and remain visible after refresh. If delivery is uncertain, **Check answer status** appears on that card. A historical answer without a matching source card remains visible in its stored turn.

Native blocking requests show the confirmed state and any non-secret answers while the turn remains in the live cache. If the runtime stops with that request open, Codes marks the question expired and offers **Check result** for the original task.

In Plan, questions are required. In Code, the native request can be optional. The UI follows the request's `isBlocking` field; requests without that field are conservatively treated as required. **Skip question** is available only for an optional request and sends an empty native answer map. No timer automatically chooses or submits an answer.

1. Use **Answer questions** above the composer to focus the pending card.
2. Review the question, suggested first choice, and option descriptions. Arrow keys move through native radio choices. A suggested choice has not been submitted.
3. Choose an option or type a custom answer when the request permits it. Secret inputs stay masked. Every required answer must be present before submission.
4. Select **Submit answer**, or explicitly skip an optional request. **Cancel task** interrupts the actual turn.

Responses belong to that native request and turn. When another signed-in device resolves a request, the original question card updates. Expired requests cannot be answered again. HTTP or runtime uncertainty never triggers an automatic resend. Secret answers are excluded from the Codes operation journal and browser drafts. The native CLI may retain them in its own history.

## Inspect a patch

Open **Review changes**, or select **Review** in an **Edited files** card in the conversation. File approvals include the proposed patch when the CLI provides one. The list shows changed paths, add/delete/rename information, and addition/deletion counts for the available patch.

- **Unified** displays the original and resulting line numbers beside each patch row. **Side by side** aligns removed and added blocks; narrow screens can scroll the patch horizontally.
- Expand a file to inspect it. **Open file** uses the read-only project file viewer with project scope, size and UTF-8 checks. Turn on **Show hidden files** in Files to read hidden paths. Deleted files have no Open action.
- **Mark viewed** records that displayed file revision in the mounted preview. Changed patch content resets the marker. Markers are not saved across a page reload.
- **Change scope** defaults to the last native turn. Earlier turns that contain changes in the loaded history can be selected. This is not an aggregate Git working-tree diff or a complete search of unloaded history.

When a historical turn contains several edits to the same file, the preview preserves their native sequence and labels it explicitly. Each patch is relative to the preceding edit; counts are not a reconstructed net diff. The current turn uses the native aggregate diff when available. Large historical sequences share the same preview budget; the turn card and Review viewer use bounded previews, and native history retains the individual recorded patches.

Only an expanded file renders patch rows. Each file shows at most 200 rows at a time, with Previous/Next navigation. Parsing is capped at 128 Ki characters, 8,000 rows and 100 files per patch. A native file-change item shares one 128 Ki-character patch budget across its files. Existing history and transport limits still apply. Truncation notices mean the preview and counts cover only the available portion; inspect the workspace/native history for the full result.

Native patches are displayed as text. codes does not apply patch text, execute paths embedded in it, stage changes, or revert workspace files. A patch is a record of the native edit, while **Open file** reads the current filesystem contents; a subsequent edit can make those differ.

See the [IDE alignment audit](ide-parity.md) for the published package and pinned source references, and [acceptance](acceptance.md) for verification boundaries.
