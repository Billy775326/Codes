# Image attachments

Paste an image into **Message Codex**, or use **Attach image** to choose files. The composer shows a thumbnail with an action to remove it. Clicking a thumbnail opens the original in an authenticated browser tab. Ordinary text paste continues to work.

Images upload separately from task dispatch. Pasting never sends a task. Send, Queue, and Add now wait until uploads finish; Stop remains available. A message can contain only images, or text and images together. Uploads are cancelled when the project, conversation, or signed-in state changes; a late response cannot attach an image to another conversation. As with existing file attachments, unsent attachments clear when switching conversations or reloading; browser text drafts retain their existing persistence behavior.

Waiting messages retain their image references and preview. Editing a waiting message changes only its text, preserving attachments and task settings; image-only messages can keep an empty caption. Removing an image from the composer does not remove it from already submitted tasks or history. Unconfirmed task receipts still require checking before another submission; an upload failure does not mean a task was sent.

## Supported inputs and limits

| Constraint                                      | Limit                |
| ----------------------------------------------- | -------------------- |
| Image formats                                   | PNG, JPEG, WebP      |
| Combined file and image attachments per message | 4                    |
| Encoded bytes per image                         | 8 MiB                |
| Image dimensions                                | 24 megapixels        |
| Uploads in flight per server                    | 4                    |
| Stored images across all projects               | 512 files or 128 MiB |

The server checks binary signatures, image header dimensions, and declared MIME type before admission. This is header validation, not a full pixel decode. Browsers and the native runtime can still reject malformed compressed pixel data. SVG, GIF, arbitrary remote URLs, and base64 image fields in task JSON are not accepted.

The selected model must advertise image input through native model metadata. An unsupported model produces a recoverable error before native task dispatch; the unsent draft and its attachments remain available for correction. The model, reasoning effort, permissions, and mode otherwise follow the existing task settings.

## Storage, protocol, and compatibility

The server stores bytes under `images/<project-id>/<sha256>.<extension>` inside `CODES_DATA_DIR`, using private project directories and files. Identical uploads within one project share a file. Admission and writes are serialized, temporary files are replaced atomically, and capacity is bounded. The authenticated, project-scoped preview endpoint streams bytes with `Cache-Control: private,no-store` and backpressure. Image buffers and data URLs are not included in conversation snapshots or replay events.

Task JSON stores a small `{ kind: "image", id, name }` reference. Before dispatch, the server validates the referenced file and digest, then sends a native `localImage` input to Codex App Server. Send, queued dispatch, and `turn/steer` share this conversion. The original 256 KiB task JSON request limit remains in place. See the [official App Server input protocol](https://learn.chatgpt.com/docs/app-server).

Only native local paths belonging to this project's private image store become browser preview references. Imported images elsewhere on disk or native inline images receive an unavailable-preview marker; codes does not expose arbitrary host paths or copy inline bytes into snapshots.

No database schema migration is required: schema 4 stores additive attachment metadata in existing JSON payloads. Older file attachments without a `kind` field remain readable. Back up the `images` directory together with the database and native conversation state. Keep its permissions private.

Images have no automatic expiry, because queued tasks and native history can continue to reference them. Removing a draft attachment can therefore leave an unreferenced upload. At the storage limit, new distinct uploads stop with an explicit error; existing references and text messages remain usable. There is no automatic cleanup interface yet. Do not delete referenced images to reclaim space: doing so breaks their previews and later queued dispatch. An older build can still read the database, but cannot send new image references; retain image bytes during a rollback.

## Verification boundary

Regression coverage uses synthetic images and the isolated simulator to check uploads, permissions, image-only dispatch, queue/steer payloads, history references, clipboard interaction, failure recovery, and responsive layout. The separate native smoke check reads image-input model metadata without sending a model prompt. These checks do not establish that a live model interpreted an image correctly; that requires a separately authorized model request.

Conversation snapshots can include the registered project directory as ordinary workspace metadata. Private image-storage paths, image bytes and data URLs remain excluded; browser image references stay project-scoped after conversation navigation.
