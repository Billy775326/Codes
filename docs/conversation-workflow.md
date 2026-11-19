# Questions, message queues, and conversation branches

For the single workspace owner, these controls extend native Codex conversations in the desktop and mobile browser. They use CLI 0.167.0 and the server account. Browser closure leaves server-side execution and unpaused queues running.

## Answer Codex questions

A native structured question appears in the conversation while Codex waits for input. The card shows question headers, option descriptions, and every required answer. Choose an option; where the native request permits another answer, enter custom text. Questions without options accept free text. Secret inputs are masked and are not saved as plaintext in the codes operation journal or browser storage. The native runtime may retain answers under its own policies.

Submit is enabled only after all questions have an answer. Another signed-in browser can answer the same request; the shared callback accepts one response and expires obsolete controls. Reload retrieves the outstanding request, but unsent form answers are kept only in that page's memory. Cancel task interrupts the native turn and pauses queued work. Ordinary messages in the composer do not answer a pending structured callback.

The existing real-prompting-policy acceptance gate remains open: simulator coverage does not prove a particular host/model will emit these native requests. Resolved callbacks are not duplicated into a separate editable question transcript.

## Quote a historical message

Use Reply below the final answer and edited-files card of a completed turn. Copy/Reply/Branch share one action row per turn; intermediate progress messages and user bubbles do not reserve separate toolbar rows. Select a passage first to quote that passage, or quote the first 4,000 characters of the message. The composer receives a visible, editable blockquote followed by your existing draft. A quote that would exceed the draft limit is refused without truncating the existing draft.

Write your follow-up after the quote. This is an ordinary user prompt, preserved by the existing per-conversation draft storage. It carries no special execution or approval authority. During a task, use Queue to send it after the current task completes.

## Manage the FIFO queue

While Codex works, the composer offers Queue beside Stop. Queued messages are stored on the server with their settings and attachment references. They run in insertion order after confirmed successful completion of the current task. At most ten pending deliveries are allowed per conversation and 100 across the workspace. Once native acceptance is confirmed, a message leaves the queue and its count immediately, even while its task is running. Its user message and task status stay in the conversation. Only remaining deliveries occupy the queue; a confirmed delivery never becomes editable again. A direct send cannot bypass existing queued entries.

Use **Edit message** in the card menu or **Remove** for a waiting entry. The editor states exactly which fields stay unchanged. Sending and unconfirmed deliveries are locked. Accepted tasks are controlled from the conversation, including Stop. If dispatch starts or the entry leaves the queue while you are editing, the local edit becomes read-only and remains available to copy until you close it; it is not silently submitted or discarded. Editing retains that entry's model, permission, and attachments; remove it and compose a new entry to change those settings. Editing and removal are refused once dispatch may have started. File checksums are revalidated immediately before dispatch, so changed context pauses the queue instead of silently using stale lines. Pause queue holds waiting work while the current task continues. Resume queue explicitly releases waiting work after review.

Snapshots and live events include at most 2,000 characters per queued preview; the UI shows a shorter preview. Edit message in the queue card menu pauses the queue, fetches the full message, and uses the composer area to edit it while preserving a separate unsent draft. Save updates only queued text; Cancel restores the original draft without changing queued text. Resume queue explicitly releases waiting work after editing. Another client can still resume or dispatch it; if that happens, the editor locks and retains the local text for copying. Dispatch uses the full stored payload. The preview limit does not truncate the task. Queue payloads and references are private runtime data. Internal delivery records remain available for receipt checks and execution recovery after a message leaves the visible queue. Completed/cancelled records are pruned after 30 days; failed and unknown deliveries are held for review.

### Queue recovery

- Lost browser acknowledgement: the draft and queue request identity are retained. Use Check queue receipt to confirm that exact request. An edited draft is preserved. Restore pending draft lets you explicitly retry the original queue request with its original identity; it does not silently send another model task.
- Lost native acknowledgement: the possibly dispatched entry remains protected. Check result correlates native terminal history with its execution receipt. Unknown entries cannot be edited, removed, or bypassed.
- Stop, failure, or decline: the remaining queue pauses. A task that was already accepted stays outside the queue even if it is stopped or fails. Remove entries that failed before confirmed delivery after reviewing their cause, then resume deliberately. Stop does not immediately launch the next task.
- Service restart: queued payloads survive and queues start paused. Unconfirmed dispatches become unknown. Confirmed deliveries remain outside the queue; an unknown execution result is checked in the conversation. Check results and resume deliberately. The service does not replay uncertain tasks at startup.

If readiness cannot be confirmed or a native task outside codes is unfinished, the queue remains held. Inspect the source task before resuming. Existing bounded history reconciliation limits still apply; this change does not implement the separate R1 recovery expansion.

## Branch through a completed turn

Use Branch from here below a completed Codex reply. Confirm the dialog to create a new native conversation containing history through that reply's completed turn, inclusive. This branches at a turn boundary, so all messages/tool activity in that turn are included. An unfinished or out-of-scope turn is rejected.

The source retains its later turns and queue. The branch starts with Read only, an empty queue, and a native source link. Open source conversation navigates back, including when the parent was not in the current sidebar page. Previously undiscovered parents require a bounded native scan to verify their archive state; an inconclusive scan reports an error instead of assuming the parent can accept new work. The two conversations share the current project directory: branching does not copy, restore, or roll back files, create a Git branch/worktree, or isolate concurrent edits. Use the existing rename controls if you want a distinct branch title.

A branch operation has its own durable receipt and returned conversation ID. Retrying that exact confirmed receipt returns the same branch. An uncertain native fork is not automatically repeated; refresh the list and inspect native branches before another explicit attempt. Browser storage restrictions can prevent retaining receipt IDs across reload, so inspect the conversation list before retrying after a reload in such a browser.

## Storage and verification

Queue state, branch ancestry, and branch result IDs were introduced in schema 3. The current schema is 4, which also shares the execution lease with reviews; schemas 1–3 are backed up before migration. See [migration and rollback](conversations.md#metadata-migration-and-rollback); native histories and authentication remain in the server user's Codex home. Metadata backups alone do not preserve that native history or undo later model work.

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) defines structured question callbacks and `thread/fork` with `lastTurnId`. Fields were checked against generated schemas from CLI 0.167.0. Queue order, receipts, limits, and browser recovery are codes behavior, tested separately in the simulator. The opt-in live pilot also verifies native fork history, unchanged source files/history, and two queued model turns. Real prompting policies and HTTPS/physical-phone acceptance remain separate gates.

Queue reordering, editing and resending an existing historical user turn, permanent deletion, and file-level branch isolation are outside this implementation. Native steering is described below.

## Native IDE interaction controls

Immediate steering, queue Add now, Plan/Code, reasoning effort, native reviews, browser preferences and supported slash commands are described in the [IDE alignment audit](ide-parity.md). Steering extends the current turn using its settings; it is separate from queue dispatch. Approvals/questions still need an explicit answer or cancellation. Unknown follow-ups keep the conversation protected until native evidence resolves them.

## Understand delivery buttons

- **Send** starts a new native turn. The composer draft is editable until submission; accepted history is not edited in place.
- **Queue** waits for a later turn, preserving FIFO order. Waiting text can be edited or removed; once dispatch starts it is locked.
- **Guide now** on a queued card applies that waiting message to the current turn, using the existing atomic queue-to-steer operation. It removes the message from the queue after acceptance.
- **Add now** appends the draft to the currently running turn using its existing settings. Accepted additions cannot be edited or recalled. When an approval, question or uncertain result blocks steering, the button is disabled and the delivery hint explains the available next step.
- **Add now instead / Queue instead** applies the alternate behavior for this message without changing the saved default. Ctrl/Cmd+Shift+Enter retains the same one-message inversion.
- **Stop** requests native cancellation and pauses queued work. It does not undo file changes that already happened.
- **Reply** quotes an existing response into a new draft. **Branch from here** starts a separate conversation through a completed turn and shares the current project files. Neither control edits sent history or rolls back files.

The composer exposes the selected action's timing and edit boundary through its named controls, accessible description, and button titles. The alternate action remains directly available during active work. Queue entries also distinguish waiting/editable text from sending, running and unconfirmed/locked text. If a queued message uses different settings from the running task, Add now stays disabled with an explanation; it remains queued for its own turn.
