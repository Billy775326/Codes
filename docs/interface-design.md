# Workspace interface design

codes uses a task-focused browser layout: navigation, conversation, and an optional file/change preview. The interface uses React, semantic HTML, and ordinary CSS. It adds no UI framework or second task-state model.

## Structure and ownership

| Source                          | Responsibility                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/web/foundation.css`        | Shared dark/light palette, fonts, form controls, buttons, focus indicators, and modal surfaces                             |
| `src/web/workspace.css`         | Navigation, conversation, preview geometry, and responsive drawers                                                         |
| `src/web/WorkspaceHeader.tsx`   | Conversation title and named workspace actions                                                                             |
| `src/web/ComposerControls.tsx`  | Model/effort summary, reasoning, native Fast, Execution/Plan, and permission controls; popup focus for local commands      |
| `src/web/InteractionDialog.tsx` | Shared modal keyboard handling and opener restoration; settings, review, status, project, branch, and confirmation content |
| `src/web/Login.tsx`             | Workspace-token sign-in, pending/error states, and optional token-location help                                            |
| `src/web/main.tsx`              | Existing workspace state, subscriptions, drafts, dispatch, receipts, and recovery                                          |

Feature styles remain with their feature. New changes should edit the owning rule or component instead of introducing another general override stylesheet. Shared colors are defined once on the document root, so login and portaled confirmation dialogs inherit the selected theme. Chat text offers 12–24px and code text offers 10–20px, both in 1px steps; Default continues to use the application defaults. The picker and persisted-value reader share one list per field. Existing browser font and interaction preferences remain compatible.

The modal state takes priority over drawers: background navigation, conversation, and preview become inert while a workspace modal is open. The shared dialog captures its opener before auto-focused fields mount, traps Tab, handles Escape, and restores focus when the opener remains available. Project creation uses this same container and retains backdrop dismissal.

## UX, DX, and AX acceptance

Each design decision must improve the task flow, reduce maintenance ambiguity, and expose a clear semantic operation. Less text alone is not a sufficient improvement.

| Decision                                   | UX                                                                                      | DX                                                                              | AX / verification                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| One sign-in form                           | The token field and sign-in action are immediately visible                              | Remove the promotional layout and its separate responsive styling               | Named input, pending state, token visibility, error recovery, and keyboard submission remain testable        |
| One project picker in navigation           | Project context and Add project are grouped                                             | Remove duplicate project-selection markup and focus paths                       | One named Project control; drawer and dialog keyboard paths are covered                                      |
| One conversation heading                   | The current conversation remains visible without a welcome pitch                        | Header actions have one presentation component                                  | A single level-one heading and named main landmark identify the workspace                                    |
| Separate composer controls from task state | Model and permissions retain their behavior and location                                | Popup focus stays in one component; dispatch and receipts stay in the workspace | `/model`, `/reasoning`, and `/approve` operate named controls without sending tasks                          |
| Controls explain the action                | Send, Queue, Add now, and Stop remain explicit without permanent explanatory paragraphs | Reuse the existing delivery-scope calculation                                   | Detailed scope remains an accessible description and button title; shortcuts have explicit keyboard metadata |
| Shared theme and dialog behavior           | Dialogs stay readable and keyboard focus stays predictable                              | One palette and one dialog interaction implementation                           | Inert background, focus trapping/restoration, and portal/login theme coverage                                |
| Secondary actions in menus                 | The main conversation starts without distracting suggestions                            | Reuse the existing action menu                                                  | Starter drafts, review, and session status remain named and reachable                                        |

Keep approval questions, permission boundaries, task errors, unknown outcomes, archive state, and explicit recovery actions visible when they affect the next operation. Do not replace those states with decorative success labels or silently resend a task.

## Validation boundaries

Browser regressions cover desktop and narrow layouts, both themes, keyboard navigation, project/conversation switching, drafts, popup hit targets, approval/question flows, queues, stopping, reconnection, and paginated history. The design-specific suite checks the shared modal, local-command focus, retained starter actions, and theme inheritance.

The existing unit/integration suite continues to cover task and storage contracts. Real preview acceptance checks the actual port 6670 service and existing conversations without submitting model prompts. Resized desktop browsers do not establish physical-phone or every assistive-technology acceptance, and passing tests is not a guarantee against every possible defect.

## Model, reasoning, mode and speed

The composer trigger shows the selected/resolved model and reasoning effort. With no override it displays the catalog default; if metadata is unavailable it says Default rather than inventing an effort. The model name may ellipsize in a narrow layout while the effort remains visible; the accessible description and tooltip retain the full selection.

The same popup contains Model, Reasoning effort, Execution / Plan, and a Fast switch. The switch includes the necessary higher-usage indication. Fast is independent of reasoning and is enabled only for models advertising the native tier. A persisted unavailable Fast setting can still be turned off. Model changes reset effort and Fast overrides. Existing Plan shortcut/exit and permission controls retain their behavior.

`Settings.fast` is optional for schema-4 compatibility and defaults to false. New ordinary turns send native `serviceTierForTurn: "priority"` (the native Fast tier) or `"default"`; reviews apply the corresponding thread-local tier before `review/start`. The app-server receives a process-local `features.fast_mode=true` override, without writing global CLI configuration. Queue entries retain their settings, and a different-speed entry cannot be steered into an existing turn. No settings click dispatches work; saved conversation settings change when a task is sent.

References: [native App Server turn parameters](https://learn.chatgpt.com/docs/app-server) and [Fast speed and usage](https://learn.chatgpt.com/docs/agent-configuration/speed), checked against generated CLI 0.167.0 types. Simulator tests establish protocol mapping and UI behavior; native metadata-only checks do not establish account-specific access, billed usage, or a measured speed improvement.
