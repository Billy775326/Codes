# Workspace interface design

The workspace has three areas with separate tasks. Navigation selects a project and conversation. The conversation owns reading and delivery. The context panel shows Files or Changes without replacing the draft.

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

Use the shared palette for dark and light themes, including portaled dialogs. Chat and code default to 14 px. The browser can choose 12–24 px for chat and 10–20 px for code. Theme and language preferences stay in the current browser. [Settings by scope](configuration.md#settings-by-scope)

Desktop sidebars resize by dragging the inner divider or using the arrow keys when it has focus. Double-click restores the default width. On narrower layouts, drawers restore focus to their opener. Dialogs make the background inert, trap Tab, handle Escape, and return focus on close.

## UX, DX, and AX acceptance

| Surface                        | Contract                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                        | One token field, clear pending and error states, accessible visibility and submit controls                                                      |
| Navigation                     | Recognizable project cards and named conversation actions, with current selection and focused archive confirmation                              |
| Composer                       | Attachment, model, and permissions near the input. Delivery and Stop remain adjacent. Hover or focus explains icon actions and their shortcuts. |
| Files and Changes              | Distinct whole-file, line-range, and reference actions. Keep file names, line numbers where applicable, and meaningful error states.            |
| Settings                       | Group related controls and keep saved versus active values visible when a restart is required                                                   |
| Questions, approvals, recovery | Keep consequential controls explicit, including retry, status checks, and uncertain receipt recovery                                            |

Prefer short names and familiar icons where their role is clear. Preserve visible labels when a choice or decision needs context. Keep an accessible name on every control and expose keyboard shortcuts in the appropriate action. Delete repeated helper text when the UI or an actionable error already gives the necessary information.

A single three-dot indicator describes current conversational activity. Connected running work animates. Approval, question, reconnecting, and unknown states remain distinct. Completed work history collapses around visible question cards.

## Model, reasoning, mode and speed

The model and reasoning trigger shows the effective selection. It retains an accessible description when the visible name is clipped. Plan and Execution are explicit modes. Fast is available when the selected model advertises the supported tier. Review the effective configuration in [Execution](conversation-settings.md) when a project override changes what the composer shows.

## Validation boundaries

Validate relevant desktop and phone widths, both themes, keyboard and pointer paths, loading, errors, and focus restoration. Browser regressions use simulated service behavior. Physical-phone access, real model behavior, and hosting require their own [acceptance checks](acceptance.md).
