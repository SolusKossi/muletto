# Architecture

## One core, two delivery modes

The product is not "a website" and "a desktop app" - it's **one engine** exposed
two ways:

```
  SHARED CORE
  +-----------------------------------------------+
  |  adapters (parse)   Apple/Google/Samsung/     |
  |       |             Snapchat/... -> items      |
  |       v                                        |
  |  normalize + index  unified item model         |
  |       |                                        |
  |       v                                        |
  |  curator engine     scan -> rule -> plan ->    |
  |                     review -> execute (+undo)  |
  |       |                                        |
  |       v                                        |
  |  AI layer (opt-in)  caption/search/cluster;    |
  |                     hosted credits OR local    |
  +-----------------------------------------------+
       |                                  |
       v                                  v
  WEB (apps/web)                     LOCAL APP (packaged)
  in-browser, zero upload            same core, offline,
                                     for huge libraries
```

**Why this shape:** big exports are tens-hundreds of GB, so uploading is a
non-starter for cost, privacy, and UX. Processing happens where the file already
is - the user's machine - in both modes. The web mode does it client-side; the
local app does it natively. Neither requires us to hold the data.

## Repos

- **muletto** (this repo) - the product monorepo.
  - `apps/web` - the public site: guides + in-browser opener.
  - `packages/curator` - the processing engine, Node CLI, safe by
    default (dry-run, trash not delete, per-run manifest, `undo`).

## Components

### Adapters (`packages/`, planned)
One parser per provider export. Input: the provider's zip. Output: normalized
items `{ type, path, timestamp, meta, provider }`. Snapchat has an early adapter;
Apple and Google are planned. Adapters are pure and testable against sample exports.

### Curator engine (`packages/curator`, working)
The scan -> rule -> plan -> review -> execute pipeline. Plain-language rules compile
to matchers (category, age, size, glob, duplicates). Execution is dry-run by
default; "delete" moves to `.muletto/trash/<runstamp>/...`; every run writes a
manifest under `.muletto/runs/`; `undo` restores from a manifest. See
`packages/curator/README.md` and `packages/curator/docs/rules.md`.

### Web explorer (`apps/web`, working)
Renders guides from JSON and reads a dropped zip **entirely in-browser**. Ships a
dependency-free ZIP central-directory reader to list entries and prove no upload
happens. Next: swap in real adapter parsing (compiled to wasm where heavy) and
zip64 support for large archives.

### AI layer (paid, planned)
Opt-in. Captioning, semantic search, face/duplicate clustering. Two backends:
hosted (metered by the included credit pool, top-ups at cost) or a local model
(bring-your-own, free, nothing leaves the device). This is the only component
that can transmit data off-device, and only on explicit user action.

## Trust model

- **Default = local.** Web mode uploads nothing; the local app is fully offline.
- **Auditable.** Source is public; the trust claim is verifiable, not a slogan.
- **Explicit egress.** Only the opt-in hosted AI can send data out, only when
  invoked; a local-model path removes even that.

## Tech notes

- Curator: Node.js (no runtime deps), Windows-first but portable; e2e test in
  PowerShell.
- Web: static HTML/CSS/JS today (no framework, no build). A framework can come
  later behind the same static-first, client-side constraint.
- Guides: plain JSON validated by `apps/web/guides/guides.schema.json`; a
  `verified` flag gates whether steps are shown as confirmed fact.

## Handling very large exports

A photo export is routinely tens or hundreds of gigabytes. Two constraints
shape the whole client design.

**Never load an archive into memory.** Browsers refuse to allocate an
ArrayBuffer of even 2 GB - the allocation throws outright. So the zip reader
never holds the archive: it reads the end-of-directory record, then the central
directory, then one entry at a time, through File.slice(). Peak memory is the
size of the single largest file being read, not the size of the archive. A
500 GB export costs the same memory as a 5 MB one, and reading the directory of
a large archive takes milliseconds because only its tail is touched.

**Assume the run will be interrupted.** Writing a large library to disk takes a
long time, and a reboot, a closed tab or a crash must not throw that work away.
Every save is a job recorded in IndexedDB on the user's own machine: the source
files, the destination folder handle, and the list of files already written.
File objects and FileSystemDirectoryHandle are both structured-cloneable, so the
browser hands them back after a restart - the user does not have to find
anything again. Progress is flushed in batches, so the bookkeeping does not
dominate the run. On the next visit the app offers to continue, skips what is
already written, and only needs one click to re-grant write permission (a
browser security rule, and the right one).

The same two properties are what a desktop build would need anyway, so the
engine stays shared rather than diverging per platform.

## Where a backend becomes necessary

Everything described above is client-side and costs nothing per use, which is
why it is all free. A server is needed for exactly two things:

1. **Hosted AI inference** - the only per-use cost in the product - and the
   credit accounting that goes with it.
2. **Billing** - the payment provider's own integration, for credits and later
   for desktop licences.

There is deliberately no licence check for anything else. Since every local
feature is free, there is nothing to verify, no entitlement to look up and no
account to require - which removes most of what a server would otherwise have
existed to do.

Guides, parsing, dedup, metadata repair, merging and saving never touch it. That
boundary keeps the privacy claim true, and means an outage degrades the AI
features rather than taking the product down.


## What is kept on the device, and why

"Runs locally" and "keeps nothing" are different promises, and only the first
one is made.

Reading a large export takes real time, and analysing photos takes longer.
Redoing that on every visit would be a poor trade for no privacy gain, since
the alternative is not "kept nowhere" but "kept on a server". So results are
kept in the browser's own storage, on the user's disk:

- **`store.js`** keeps the opened library: what is inside each archive, the
  dates and places read out of it, and a `File` reference per archive. A `File`
  in IndexedDB is a pointer to the file already on disk, not a second copy, so
  this costs metadata rather than gigabytes. It also means the library can go
  stale, so a byte is read from each archive on the way back in and anything
  missing is reported.
- **`derived.js`** keeps analysis, filed by content.

Both are cleared by one button in the app, and by clearing site data.

## Filing analysis by content

What analysis is filed under decides whether it survives. Keying it to an
export makes next year's export from the same provider look entirely new.
Keying it to a path re-analyses every cross-provider duplicate and loses
everything on a rename. So it is filed under the contents of the file, with a
deliberate split:

- **Identity is a SHA-256** of the bytes. Nothing is ever recorded under
  anything weaker. A wrong match means one of the user's photos wearing another
  of their photos' results, and once analysis costs money it also means paying
  for the wrong answer.
- **The index is the CRC and length** the archive already lists for every
  entry. It costs nothing to read - no decompression at all - so it is what
  makes "have I already done this file?" answerable before deciding whether to
  open it. A 32-bit checksum collides within a large library, so the index only
  ever *suggests* a record.

The rule for acting on a suggestion lives in one place rather than in each
caller: free local results are taken on the suggestion, because being wrong
costs an odd near-duplicate grouping and nothing more. Anything that spends
money, or writes results back into the user's files, calls `verify()` and
confirms the digest first.

### The work file

Browser storage is the browser's to evict, and it does not travel. Anything
that cost money must not depend on a cache, so the same records can be written
out to a file the user keeps and read back on another machine, another browser,
or after clearing site data. It carries results and the content index only - no
photos, no messages, and no file names, since a name adds nothing and is
exactly the sort of thing that should not sit in a file people back up.

Because the records are filed by content, feeding that file back alongside a
fresh export a year later recognises every file that carried over.
