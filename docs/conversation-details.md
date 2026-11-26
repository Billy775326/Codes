# Files, history, and changes

Open **Files and changes** in the toolbar. The browser remembers the last tab. Use **Files** to see the current project or an explicit server path. Use **Changes** to inspect patches recorded by Codex in a conversation turn.

## Manage project files

Open **Upload or create** in Files to upload a file or create a folder in the current directory. The row actions include **Download**, **Copy path**, and **Reference in conversation**. Use **Load more files** to page through large folders. **Show hidden files** follows the current browser preference.

Each upload streams to a temporary file in the destination directory and publishes the completed file without overwriting an existing name. The limit is 64 MiB per file and two concurrent project uploads. Codes checks available disk space before accepting uploads. File management writes stay in the registered project and protect Git, Codex, and Codes private storage.

A file reference attaches its relative path and version. Add a message when sending a file reference on its own. Codes checks the version at dispatch, and Codex reads the file with its effective permissions. [Composer attachments](image-attachments.md)

## Preview documents, images and HTML

In a narrow panel, select a file to open its preview and choose **Back to files** to return to the list. The preview scrolls within the panel.

| Format               | Preview                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| UTF-8 source or text | Line-numbered, selectable source up to 256 KiB                              |
| PNG, JPEG, WebP      | Inline raster image up to 8 MiB and 24 megapixels                           |
| DOC, DOCX            | Read-only Word body text up to 80,000 characters, from an input up to 8 MiB |
| PDF                  | Browser PDF viewer, up to 32 MiB, with **Open PDF** for a separate tab      |
| HTML and HTM         | Sandboxed visual preview and the original source                            |

Word parsing starts on demand, runs one at a time, and has a five-second parser timeout. Use the original file for layout, tables, or content outside the text preview. Files that exceed the preview limits can still be downloaded or referenced where file management is available.

Recent folders and small text previews can appear while Codes checks for changes. The shared 2 MiB cache budget applies to those reads. Images and PDFs load on demand, and decoded image memory depends on pixel dimensions.

Absolute Markdown file links and simple HTML anchors in Codex replies open local previews. Relative document and HTML links use the conversation's project. Current project files open in Files. A linked file outside that context opens a read-only dialog and leaves the draft in place. External web links open in a new tab.

For an explicit host path, use **Open server path**. Paths outside the usual project scope show a warning and are read-only. Opening files requires a signed-in browser and filesystem access under the service account. The embedded raster media endpoint restricts access to its preview scope.

HTML files and local visualization links open directly in the HTML preview. Use **Preview HTML** to expand an HTML code block. The sandbox displays static markup, inline CSS, and embedded raster images. Applications that require JavaScript can still be inspected as source.

## Read a turn's work history

Completed turns group commentary and tool activity in a work-history disclosure. Successful and failed tool activity stays collapsed by default. The summary shows failure counts. Questions, pending approvals, final replies, and edited-files cards stay directly accessible.

The reply action row can show completion state, time, native token totals, and average output tokens per second when usage is available. That average uses elapsed time, including tools and waiting. The pinned **Turn message** fits on one line. Expand it to read the prompt below the bar, or jump to the original message using the adjacent button.

## Scroll through conversation history

Scroll up to load earlier history and down to return to newer pages. Use **Back to latest** to jump to the live end. The reading position stays anchored as pages change, and recent replies continue to arrive while you read older turns. Returning to a conversation in the same tab restores the last reading position when its turn is still available.

Codes keeps a bounded history window. Evicted sections are accessible using native cursors. Closing a preview or switching conversations cancels stale reads. Retry a failed history page explicitly when the interface offers it. [Resource budgets](architecture.md#rendering-and-resource-limits)

## Context compaction

**Compacting context…** reflects a native Codex compaction item. When it completes, work history records **Context compacted.** The task and its execution receipt continue until the native turn ends. Queued messages wait for that turn's outcome.

## When Codex asks a question

Answer the card in its original turn. Code-mode availability follows effective native settings. Optional requests can be explicitly skipped. Required requests stay pending until answered or the task ends. [Question and recovery controls](conversation-workflow.md#answer-codex-questions)

## Inspect a patch

Choose **Changes** or use **View changes** on an **Edited files** card to inspect a patch. The viewer can also show proposed changes for native approvals. To start a new Codex review, choose **Review code** in the **Changes** tab.

- Changes use a **Unified** layout by default. When the panel has room, choose **Side by side**. Expand a changed file to see up to 200 rows per page, with before and after line numbers.
- Choose among change-bearing turns in the loaded history. The current turn can use its native aggregate diff. Historical repeated edits retain their native order.
- Use **Mark viewed** for the displayed revision. A changed patch resets the marker.
- Use **Open file** to see the current file contents. The patch records the edit at the time of the turn.

Truncation notices mark incomplete patches or output. Use the project or native history to inspect the full content. The viewer displays the patch and leaves Git staging and workspace files unchanged.
