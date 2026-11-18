# Clarifications and file-change previews

codes follows the published Codex IDE interaction contracts for native clarifications and local patch inspection. Use a desktop to review changes and a phone to answer a pending question. This is an independent Web implementation; it does not include VS Code editor integration or Git stage/revert actions.

## When Codex asks a question

The native agent decides whether to call `request_user_input`. codes does not manufacture a question for every prompt or treat ordinary assistant prose as a structured request. Code-mode availability is enabled by default for the codes child process with the pinned CLI's `features.default_mode_request_user_input` setting. Set `CODES_CODE_QUESTIONS=0` before starting to retain Plan-only availability. Global Codex configuration is unchanged.

In Plan, questions are required. In Code, the native request can be optional. The UI follows the request's `isBlocking` field; requests without that field are conservatively treated as required. **Skip question** is available only for an optional request and sends an empty native answer map. No timer automatically chooses or submits an answer.

1. Use **Answer questions** above the composer to focus the pending card.
2. Review the question, suggested first choice, and option descriptions. Arrow keys move through native radio choices. A suggested choice has not been submitted.
3. Choose an option or type a custom answer when the request permits it. Secret inputs stay masked. Every required answer must be present before submission.
4. Select **Submit answer**, or explicitly skip an optional request. **Cancel task** interrupts the actual turn.

Responses belong to that native request and turn. Another signed-in device can resolve it; the card disappears when the CLI reports resolution. Expired requests cannot be answered again. HTTP or runtime uncertainty never triggers an automatic resend. Secret answers are not stored as plaintext in the codes operation journal or browser draft storage; the native CLI may retain them in its own history.

## Inspect a patch

Open **Review changes**, or expand a **File changes** item in the conversation. File approvals include the proposed patch when the CLI provides one. The list shows changed paths, add/delete/rename information, and addition/deletion counts for the available patch.

- **Unified** displays the original and resulting line numbers beside each patch row. **Side by side** aligns removed and added blocks; narrow screens can scroll the patch horizontally.
- Expand a file to inspect it. **Open file** uses the existing read-only project file viewer, including its traversal, hidden-file, symlink, size and UTF-8 checks. Deleted files have no Open action. A path outside the project is rejected rather than opened outside the registered workspace.
- **Mark viewed** records that displayed file revision in the mounted preview. Changed patch content resets the marker. Markers are not saved across a page reload.
- **Change scope** defaults to the last native turn. Earlier turns that contain changes in the loaded history can be selected. This is not an aggregate Git working-tree diff or a complete search of unloaded history.

When a historical turn contains several edits to the same file, the preview preserves their native sequence and labels it explicitly. Each patch is relative to the preceding edit; counts are not a reconstructed net diff. The current turn uses the native aggregate diff when available. Large historical sequences share the same preview budget; individual conversation items can be expanded separately to inspect their own recorded patches.

Only an expanded file renders patch rows. Each file shows at most 200 rows at a time, with Previous/Next navigation. Parsing is capped at 128 Ki characters, 8,000 rows and 100 files per patch. A native file-change item shares one 128 Ki-character patch budget across its files. Existing history and transport limits still apply. Truncation notices mean the preview and counts cover only the available portion; inspect the workspace/native history for the full result.

Native patches are displayed as text. codes does not apply patch text, execute paths embedded in it, stage changes, or revert workspace files. A patch is a record of the native edit, while **Open file** reads the current filesystem contents; a subsequent edit can make those differ.

See the [IDE alignment audit](ide-parity.md) for the published package and pinned source references, and [acceptance](acceptance.md) for verification boundaries.
