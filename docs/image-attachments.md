# Composer attachments

Open the `+` menu and select **Upload from device**. Use **Browse project files** for an existing file, selected lines, or a path reference. The composer shows attached files and image thumbnails before delivery.

## Choose an attachment

| Input                                                                | What the conversation gets                                                           | Per-file limit          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| Small UTF-8 text                                                     | Inline text context                                                                  | 64 KiB                  |
| PNG, JPEG, or WebP within the image budget                           | Native image input                                                                   | 8 MiB and 24 megapixels |
| PDF, Word, spreadsheet, archive, or a file beyond the inline budgets | A path reference to the original file saved under the project's `codes-attachments/` | 64 MiB                  |

Paste supported images directly into the composer. Small text and images travel through their dedicated inputs. Larger and other local formats can be preserved as original files. File preview support is separate from upload support. [Preview formats](conversation-details.md#preview-documents-images-and-html)

Add a short request when sending a document reference. Codex reads the original file using its effective permissions and available tools. A same-name upload receives a different name. Removing the draft reference leaves the saved file in the project.

## Supported inputs and limits

A message can carry four attachments total. Send, Queue, and Add now wait for pending uploads. Switching conversations or projects clears unsent attachments and cancels pending uploads. Saved text drafts remain available under their own browser rules.

An image-only message can be sent if the selected model advertises image input. Codes checks the image's declared type, signature, and dimensions before native dispatch. PNG, JPEG, and WebP are the native raster inputs. GIF and SVG can be sent by reference.

The combined prompt and inline text context budget is 100,000 bytes. Codes admits up to four concurrent text or image uploads and two concurrent project-file uploads. Storage is capped at 512 text uploads, and 512 images or 128 MiB of images across the workspace.

## Storage, protocol, and compatibility

Text uploads are deduplicated by content in SQLite. Images are stored privately under `images/<project-id>/` in the Codes data directory. Task payloads carry references. Images resolve to native `localImage` inputs, and text resolves into the prompt. Snapshots carry image metadata while the browser fetches image bytes from an authenticated endpoint.

Existing text selections are checked against their content digest. Original project file references use a file version check. Inspect a stale attachment before replacing it or resuming a waiting queue. Unconfirmed uploads and uncertain task dispatches have separate recovery messages. [Queue recovery](conversation-workflow.md#queue-recovery)

Image storage has no automatic expiration while native history or waiting work can still reference it. Back up that directory with the database and Codex history. Back up project files, including their `codes-attachments/` directories, separately. [Persistent state](operations.md#persistent-state)

## Verification boundary

Simulator tests exercise local text, images, document references, queue and steering payloads, and failure recovery. Native metadata smoke verifies advertised image-input capabilities. See [acceptance](acceptance.md) for the distinction between simulator checks and model behavior.
