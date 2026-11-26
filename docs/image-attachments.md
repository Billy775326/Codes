# Composer attachments

Open the composer **+** menu and choose **Upload from device**. Small UTF-8 text files are added as text context. PNG, JPEG, and WebP images can be sent as native image inputs. Paste an image directly into **Message Codex** or open its thumbnail in an authenticated tab.

PDFs, Word documents, spreadsheets, archives, and other files that exceed the inline limits or use other formats are saved in the current project's `codes-attachments/` directory. Codes adds a reference to the original file. Include a message asking Codex how to use it. Codex reads the local file using its effective tool permissions and available document tools. Codes assigns a different name on a collision. Removing the reference from a draft leaves the original in the project.

Use **Browse project files** to attach existing text, selected lines, or a file reference. See [project file management](conversation-details.md#manage-project-files) for directory and disk requirements.

Uploads are separate from task dispatch. Send, Queue, and Add now wait until uploads finish; Stop remains available. Attach text files as context for a message. An image can be sent with or without a caption. Uploads are cancelled when the project, conversation, or signed-in state changes, so a late response cannot attach a file to another conversation. Unsent attachments clear when switching conversations or reloading; browser text drafts retain their existing persistence behavior.

Waiting messages retain their image references and preview. Editing a waiting message changes only its text, preserving attachments and task settings; image-only messages can keep an empty caption. Removing an image from the composer does not remove it from already submitted tasks or history. Unconfirmed task receipts still require checking before another submission; an upload failure does not mean a task was sent.

## Supported inputs and limits

| Constraint                                      | Limit                |
| ----------------------------------------------- | -------------------- |
| Image formats                                   | PNG, JPEG, WebP      |
| Combined file and image attachments per message | 4                    |
| Encoded bytes per image                         | 8 MiB                |
| Image dimensions                                | 24 megapixels        |
| Concurrent text/image uploads per server        | 4                    |
| Stored images across all projects               | 512 files or 128 MiB |
| UTF-8 text included as context                  | 64 KiB per file      |
| Original file saved and attached by reference   | 64 MiB per file      |
| Concurrent original-file uploads per server     | 2                    |
| Stored text uploads across all projects         | 512 files            |
| Prompt and combined text context                | 100,000 bytes        |

The server checks binary signatures, image header dimensions, and declared MIME type before admission. This is header validation, not a full pixel decode. Browsers and the native runtime can still reject malformed compressed pixel data. SVG and GIF are available as file references. The image-input API rejects arbitrary remote URLs and base64 image fields in task JSON.

The selected model must advertise image input through native model metadata. An unsupported model produces a recoverable error before native task dispatch; the unsent draft and its attachments remain available for correction. The model, reasoning effort, permissions, and mode otherwise follow the existing task settings.

## Storage, protocol, and compatibility

Text uploads are stored by content digest in the project's private SQLite data. Send, Queue, and Add now pass a project-scoped reference and expand the text when the task is dispatched. Existing text selections are checked against their saved digest on dispatch. Original-file uploads use the same version checks as references from the Files sidebar. Queued uploads remain available after restart; retain the database backup for older entries. Codes adds the upload table to schema 4 on startup.

The server stores bytes under `images/<project-id>/<sha256>.<extension>` inside `CODES_DATA_DIR`, using private project directories and files. Identical uploads within one project share a file. Admission and writes are serialized, temporary files are replaced atomically, and capacity is bounded. The authenticated, project-scoped preview endpoint streams bytes with `Cache-Control: private,no-store` and backpressure. Image buffers and data URLs are not included in conversation snapshots or replay events.

Task JSON stores a small `{ kind: "image", id, name }` reference. Before dispatch, the server validates the referenced file and digest, then sends a native `localImage` input to Codex App Server. Send, queued dispatch, and `turn/steer` share this conversion. The original 256 KiB task JSON request limit remains in place. See the [official App Server input protocol](https://learn.chatgpt.com/docs/app-server).

Only native local paths belonging to this project's private image store become browser preview references. Imported images elsewhere on disk or native inline images receive an unavailable-preview marker; codes does not expose arbitrary host paths or copy inline bytes into snapshots.

No database schema migration is required: schema 4 stores additive attachment metadata in existing JSON payloads. Older file attachments without a `kind` field remain readable. Back up the `images` directory together with the database and native conversation state. Keep its permissions private.

Images have no automatic expiry, because queued tasks and native history can continue to reference them. Removing a draft attachment can therefore leave an unreferenced upload. At the storage limit, new distinct uploads stop with an explicit error; existing references and text messages remain usable. There is no automatic cleanup interface yet. Do not delete referenced images to reclaim space: doing so breaks their previews and later queued dispatch. An older build can still read the database, but cannot send new image references; retain image bytes during a rollback.

## Verification boundary

Regression coverage uses synthetic images and the isolated simulator to check uploads, permissions, image-only dispatch, queue/steer payloads, history references, clipboard interaction, failure recovery, and responsive layout. The separate native smoke check reads image-input model metadata without sending a model prompt. These checks do not establish that a live model interpreted an image correctly; that requires a separately authorized model request.

Conversation snapshots can include the registered project directory as ordinary workspace metadata. Private image-storage paths, image bytes and data URLs remain excluded; browser image references stay project-scoped after conversation navigation.
