# Workspace interface design

Navigation selects a native conversation. The conversation owns reading and delivery. The context panel shows Files or Changes alongside the conversation.

## Structure and ownership

| Area                                              | Source                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Shared palette, typography, focus, and inputs     | [foundation.css](../src/web/foundation.css)                                                             |
| Responsive panels and keyboard-resizable dividers | [workspace.css](../src/web/workspace.css) and [useWorkspaceLayout.ts](../src/web/useWorkspaceLayout.ts) |
| Conversation header and workspace actions         | [WorkspaceHeader.tsx](../src/web/WorkspaceHeader.tsx)                                                   |
| Composer configuration                            | [ComposerControls.tsx](../src/web/ComposerControls.tsx)                                                 |
| Navigation and summary actions                    | [Conversations.tsx](../src/web/Conversations.tsx) and [sidebar state](conversation-sidebar.md)          |
| File and document previews                        | [FilesPanel.tsx](../src/web/FilesPanel.tsx) and [files-panel.css](../src/web/files-panel.css)           |
| Modal keyboard behavior                           | [InteractionDialog.tsx](../src/web/InteractionDialog.tsx)                                               |

Use the shared palette for dark and light themes, including portaled dialogs. Light mode uses neutral gray surfaces, brighter fields and dialogs, and blue-gray selection highlights. Chat and code default to 14 px. The browser can choose 12–24 px for chat and 10–20 px for code. Theme and language preferences stay in the current browser. [Settings by function](configuration.md#settings-by-function)

Desktop sidebars resize by dragging the inner divider or using the arrow keys when it has focus. Double-click restores the default width. On desktop, the right panel docks when its preferred width and the navigation leave at least 560 px for the conversation. In smaller layouts or when the dock would leave too little room, it opens as a drawer. Drawers restore focus to their opener. Dialogs make the background inert, trap Tab, handle Escape, and return focus on close.

## UX, DX, and AX acceptance

| Surface                        | Contract                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                        | One token field, clear pending and error states, accessible visibility and submit controls                                                                     |
| Navigation                     | Native conversation rows across working directories, archive filter, current selection, and focused archive confirmation                                       |
| Composer                       | Attachment, model, and permissions near the input. Delivery and Stop remain adjacent. Hover or focus explains icon actions and their shortcuts.                |
| Files and Changes              | Distinct whole-file, line-range, and reference actions. Keep file names, line numbers where applicable, and meaningful error states.                           |
| Settings                       | Group editable settings by purpose. Keep runtime paths in a disclosure under maintenance diagnostics. Show saved and active values when a restart is required. |
| Questions, approvals, recovery | Keep consequential controls explicit, including retry, status checks, and uncertain receipt recovery                                                           |

Prefer short names and familiar icons where their role is clear. Preserve visible labels when a choice or decision needs context. Keep an accessible name on every control and expose keyboard shortcuts in the appropriate action. Delete repeated helper text when the UI or an actionable error already gives the necessary information.

Rename edits the title in place. When the title has limited space, the editor temporarily uses the directory and status area. The main toolbar keeps its position. Saving or canceling returns focus to the rename button.

Settings navigation groups panels under Preferences, Codex, Server, and Data. The desktop detail pane shows the selected page title above its sections, and the mobile category control shows the title on narrow screens. Sections stay visible in order with dividers between them. Backup and restore groups file transfers by content. Browser settings apply immediately, Codex settings edit native configuration or instructions, and server and maintenance controls use their applicable save or confirmation flow. Rows put labels and necessary context on the left and controls on the right. On narrow panels, dropdowns and numeric inputs move below their labels. Switches remain alongside their labels, and the detail pane scrolls independently from the footer.

A single three-dot indicator describes current conversational activity. Connected running work animates. Approval, question, reconnecting, and unknown states remain distinct. Completed work history collapses around visible question cards.

## Model, reasoning, mode and speed

The model and reasoning trigger shows the effective selection. It retains an accessible description when the visible name is clipped. Plan and Execution are explicit modes. Fast is available when the selected model advertises the supported tier. Review the effective configuration in [Execution](conversation-settings.md) when a project override changes what the composer shows.

## Validation boundaries

Validate relevant desktop and phone widths, both themes, keyboard and pointer paths, loading, errors, and focus restoration. Browser regressions use simulated service behavior. Physical-phone access, real model behavior, and hosting require their own [acceptance checks](acceptance.md).
