# Muletto scanner (stage 1)

Deterministic scan of a photo folder. Zero dependencies, Node.js 18+.

## Usage

    node scan.js <folder> [--out scan.json] [--recurse]

- `<folder>`   folder to scan (required)
- `--out`      output JSON path (default: scan.json in current dir)
- `--recurse`  descend into subfolders

## What it does

1. Walks the folder and records path, size, mtime, extension per file.
2. Classifies each file by filename/extension heuristics:
   - `screenshot`       IMG_*.png, or name contains Screenshot/Skjermbilde
   - `chat_media`       GUID-named (8-4-4-4-12 hex) .mp4/.mov, or cm-chat-media*
   - `camera_photo`     IMG_*.heic/.jpg/.jpeg
   - `camera_video`     IMG_*.mov, or non-chat .mp4
   - `live_photo_pair`  .mov whose basename matches a .heic in the same folder
   - `junk`             0-byte files, .tmp, .ini, Thumbs.db
   - `error`            file could not be read
   - `other`            everything else
3. Detects exact duplicates: files are grouped by byte size, then by sha1 of
   the first 64 KiB, then confirmed with a full sha256. Confirmed duplicates
   share a `dupGroup` id; every file after the first in a group gets
   `duplicate: true`. All hashing is streamed.

## Output

JSON report: `{ generated, root, files: [...], summary }`. Summary contains
per-category file counts and bytes, duplicate file count, and reclaimable
duplicate bytes. A human-readable table is printed to stdout; progress goes
to stderr every 1000 files.
