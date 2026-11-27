# Work with Codex in a conversation

Use the composer to start new work, queue a later turn, or add a follow-up to the current turn. Codex App Server owns the native turn, including approvals, questions, and cancellation.

## Understand delivery buttons

| Action                          | Effect                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Send**                        | Starts a new native turn from the draft                                 |
| **Queue**                       | Stores a message for a later turn                                       |
| **Add now** in the composer     | Adds the draft to the active native turn with that turn's configuration |
| **Add now** on a queued message | Promotes that waiting entry into the active turn when compatible        |
| **Stop**                        | Requests native cancellation and pauses remaining queued work           |

On desktop, Enter normally sends. Tab starts at the message field, visits the composer controls, then continues through the rest of the workspace. During a steerable turn, Enter adds to that turn by default, and Tab from the message field queues a ready draft. With an empty composer or **Tab to queue** turned off, Tab moves focus. Set the send key or Tab behavior in **Settings → General → Keyboard**. Choose queue-first delivery in **General → Interaction**. **Add now instead**, **Queue instead**, and Ctrl/Cmd+Shift+Enter select the other delivery for one message. On phones, use the on-screen actions.

When a pending approval, question, or unknown result blocks immediate follow-ups, the composer shows the available actions. An accepted message becomes part of the conversation history. Stop leaves changes already made to project files in place. [Execution configuration](conversation-settings.md)

## Answer Codex questions

Open the native card in the turn that requested input. **Answer questions** jumps to a pending card when available. Review the choices, enter custom text when supported, and submit after completing required fields. Secret inputs remain masked. Selecting a suggested option still requires submission.

Use **Skip question** when Codex marks a question optional. For an asynchronous question, the confirmed answer stays with the original card and can be submitted after the turn ends. **Check answer status** appears if delivery is uncertain. Another signed-in browser can resolve the same pending request, and obsolete controls update accordingly. If a runtime restart expires a blocking request, use **Check result** on its task.

## Manage the FIFO queue

After a successful current turn, waiting entries dispatch in order if the queue is ready. Codes admits up to ten pending deliveries in a conversation and 100 across the workspace. Accepted entries leave the queue, with task status and receipts retained separately.

Use **Edit message** to pause the queue and open the waiting text in the composer editor. Saving changes only the queued text. Model and permission choices associated with the entry, attachment references, and position are preserved. Cancel restores the separate draft. Use **Remove** for a waiting entry, and **Resume queue** once the remaining work is ready.

Entries already being dispatched or awaiting confirmation stay locked. To use **Add now** on a waiting entry, its execution configuration must be compatible with the active turn. [Queue and Codex settings](conversation-settings.md#execution-and-recovery)

### Queue recovery

| Condition                                                        | Recovery                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Browser did not confirm queue submission                         | Use **Check queue receipt** for the original request. Restore the pending draft if Codes offers that action. |
| Native dispatch result is uncertain                              | Use **Check result** and wait for native evidence. The protected entry cannot be bypassed.                   |
| A task stops, fails, is declined, or loses its project directory | Review the reason and explicitly resume when ready. A prior failure alone does not pause future messages.    |
| A referenced local file changes                                  | Review the queued message. Remove stale references or submit the updated selection before resuming.          |
| Service restarts                                                 | Waiting entries survive and start paused. Possibly dispatched work is marked unknown pending reconciliation. |

## Quote a historical message

Use Up and Down at the composer boundaries to recall recent user messages and return to the unsent draft.

Select text in a final answer and choose **Reply** from its action row. With no selection, Codes quotes up to the first 4,000 characters. Add your question after the quote and choose a delivery action. The quote is part of the editable draft.

## Branch through a completed turn

Choose **Branch from here** beneath a completed reply and confirm. Codes uses native fork through that turn, inclusive. The source keeps its later history and queue. The branch has its own conversation and queue, shares the project files, and uses the effective Codex configuration.

If the result is uncertain, inspect the original branch receipt before trying again. Branching copies conversation history through a turn. It leaves the current working files as they are.

## Storage and verification

Codes owns queue order, delivery receipts, and browser draft recovery. Native history and fork identity belong to Codex. See [backup and migration](conversations.md#metadata-migration-and-rollback) and [acceptance](acceptance.md) for test coverage.

## Native IDE interaction controls

For Plan, reasoning, native reviews, and the local slash command list, see [IDE interaction alignment](ide-parity.md#implemented-local-contracts).
