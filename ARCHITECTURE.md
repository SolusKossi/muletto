# Architecture

## What exists

Three things, and only the first is deployed:

```
apps/web/           the site and the in-browser explorer. No build step,
                    no framework, no dependencies, no third-party script.
                    This is the product.

packages/curator/   a Node CLI: scan -> rule -> plan -> review -> execute,
                    with undo. Not wired to the web app; it shares the
                    approach rather than the code.

api/                three endpoints: an analytics beacon, the stats it
                    feeds, and their store. Nothing here ever sees an
                    export.
```

Everything that opens, parses, merges, repairs and writes out an export runs
in the browser, in `apps/web`. There is no server in that path and no upload.

### apps/web

| File | Does |
|---|---|
| `zip.js` | The archive reader. Central directory, zip64, WinZip AES-256 and ZipCrypto |
| `parsers.js` | Every provider's export into one normalised library |
| `insights.js` | Record tables into charts, totals and profiles |
| `catalog.js` | What each service can send, so an absence can be named |
| `explorer.js` | The explorer shell and its views |
| `diagnose.js` | Accounts for every entry in an archive |
| `exif.js` `heif.js` `video.js` `mbox.js` `applehealth.js` | Format readers |
| `caption.js` `credits.js` `plan.js` | The opt-in AI features, and the only code that can send anything |

The parsers are ordinary functions over entry lists. They can be run outside a
browser, which is what the harnesses in `tools/` do: `check-export.js` loads
the shipped `zip.js` and `parsers.js` unmodified and runs a real export
through them under Node.

### Planned

A **desktop app** for Windows and macOS, same engine, fully offline, for
libraries too large to be comfortable in a tab. It does not exist. Nothing in
the product should imply it does.

## Handling very large exports

A photo export is routinely tens or hundreds of gigabytes. Two constraints
shape the whole client design.

**Never load an archive into memory.** Browsers refuse to allocate an
ArrayBuffer of even 2 GB; the allocation throws outright. So the zip reader
never holds the archive: it reads the end-of-directory record, then the
central directory, then one entry at a time, through `File.slice()`. Peak
memory is the largest single file being read, not the archive. A 500 GB export
costs the same memory as a 5 MB one, and reading the directory of a 23 GB
archive takes milliseconds because only its tail is touched.

**Assume the run will be interrupted.** Writing a large library to disk takes a
long time, and a reboot, a closed tab or a crash must not throw that work
away. Every save is a job recorded in IndexedDB: the source files, the
destination folder handle, and what has already been written. `File` and
`FileSystemDirectoryHandle` are both structured-cloneable, so the browser hands
them back after a restart and the user does not have to find anything again.
Progress is flushed in batches. On the next visit the app offers to continue,
skips what is already written, and needs one click to re-grant write
permission.

A desktop build would need both properties anyway, so the engine stays shared.

## Where a backend becomes necessary

Everything above is client-side and costs nothing per use. A server is needed
for exactly two things:

1. **Hosted AI inference**, the only per-use cost in the product, and the
   credit accounting with it.
2. **Billing**, through the payment provider's own integration.

There is deliberately no licence check for anything else: every local feature
is free, so there is no entitlement to look up and no account to require,
which removes most of what a server would otherwise exist to do.

Guides, parsing, dedup, metadata repair, merging and saving never touch it.
That boundary is what keeps the privacy claim true, and it means an outage
degrades the AI features rather than taking the product down.

## What is kept on the device, and why

"Runs locally" and "keeps nothing" are different promises, and only the first
is made.

Reading a large export takes real time and analysing photos takes longer.
Redoing that every visit would be a poor trade for no privacy gain, because
the alternative is not "kept nowhere" but "kept on a server". So results are
kept in the browser's own storage, on the user's disk:

- **`store.js`** keeps the opened library: what is in each archive, the dates
  and places read out of it, and a `File` reference per archive. A `File` in
  IndexedDB points at the file already on disk, so this costs metadata and
  not gigabytes. It also means the library can go stale, so a byte is read
  from each archive on the way back in and anything missing is reported.
- **`derived.js`** keeps analysis, filed by content.

One button in the app clears both, as does clearing site data.

## Filing analysis by content

What analysis is filed under decides whether it survives. Key it to an export
and next year's export from the same provider looks entirely new. Key it to a
path and every cross-provider duplicate is re-analysed, and a rename loses
everything. So it is filed under the contents of the file, with a split:

- **Identity is a SHA-256** of the bytes, and nothing weaker is ever recorded
  against. A wrong match means one of the user's photos wearing another's
  results, and once analysis costs money it also means paying for the wrong
  answer.
- **The index is the CRC and length** the archive already lists for every
  entry. Reading it costs nothing, no decompression at all, so it answers
  "have I done this file already?" before deciding whether to open it. A
  32-bit checksum collides within a large library, so the index only ever
  *suggests* a record.

One place decides what to do with a suggestion, not each caller. Free local
results are taken on the suggestion, because being wrong costs an odd
near-duplicate grouping and nothing more. Anything that spends money, or
writes results back into the user's files, calls `verify()` and confirms the
digest first.

### The work file

Browser storage is the browser's to evict and it does not travel, so anything
that cost money must not depend on a cache. The same records can be written to
a file the user keeps and read back on another machine, another browser, or
after clearing site data. It carries results and the content index only: no
photos, no messages, and no file names, since a name adds nothing and is
exactly the sort of thing that should not sit in a file people back up.

Because the records are filed by content, feeding that file back alongside a
fresh export a year later recognises everything that carried over.

## Tech notes

- **Web:** static HTML, CSS and JS. No framework and no build step, so what is
  served is what is in the repository. A framework could come later behind the
  same static-first, client-side constraint.
- **Curator:** Node.js, no runtime dependencies, Windows-first but portable.
  Dry-run by default; "delete" moves to `.muletto/trash/<runstamp>/`; every run
  writes a manifest under `.muletto/runs/` and `undo` restores from it. See
  `packages/curator/README.md` and `packages/curator/docs/rules.md`.
- **Guides:** plain JSON, validated by `apps/web/guides/guides.schema.json`.
  A `verified` flag gates whether steps are shown as confirmed.
- **Checks:** `node tools/build-site.js` then `node tools/check.js` before
  committing.
