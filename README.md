# Muletto

**A GDPR data export viewer that runs in your browser.**

Open the export zip that Apple, Google, Samsung, Snapchat, Reddit, Facebook or
Instagram sends you, and actually read what is inside it. Nothing is uploaded,
there is no account, and there is nothing to install.

## [Open muletto.app](https://muletto.app)

Drop the archive in and it opens. If you would rather not use your own data
yet, six sample exports are one click away on the same page.

### What it does

- **Opens the archive without unpacking it.** A 38 GB Takeout or an 18-part
  Apple export is read where it sits.
- **Merges several exports into one library.** Your photographs from Google,
  Apple and Snapchat in one place, with the ones that appear in more than one
  found automatically.
- **Puts the dates and locations back.** Google keeps a photograph's capture
  date in a JSON file beside it, and every other tool throws that away.
- **Reads the parts nobody else does** - messages across services, health
  records, location history, sign-in logs, saved web pages, Siri recordings.
- **Writes it back out as ordinary folders**, with the real dates written into
  the files themselves, so nothing afterwards depends on this site.

### Which exports it reads

| Service | Status |
|---|---|
| Google (Takeout) | Photos, videos, location history, messages, mail, activity |
| Apple | Notes, contacts, calendar, audio, purchases, device records |
| Samsung | Health, account and service records - including encrypted archives |
| Snapchat | Memories, chat history, split captions merged back on |
| Reddit | Posts, comments, votes, saved items, private messages |
| Instagram and Facebook | Messages, posts, account records |
| Anything else | Opened, listed, and read where the shape is recognisable |

[PROVIDERS.md](PROVIDERS.md) says exactly what is read from each, what is not,
and which claims have been measured against a real export rather than inferred
from documentation.

### Guides

Thirty hand-written guides for [requesting and opening a GDPR
export](https://muletto.app/guides.html) from each service - what actually
arrives, how long it takes, and the part people get wrong.

The whole application is in this repository, so anyone curious about how it
works can see exactly what it does.

---

Every large service is obliged to hand over a copy of your data, and most of
them do it in a format that is technically compliant and practically unreadable.
Google Takeout keeps each photograph's date in a separate JSON file beside it.
Samsung encrypts every archive and emails the password separately. Apple splits
one request across eighteen zip files, several of which contain further zip
files.

Muletto reads those archives, merges several exports into one library, finds
duplicates across them, and can write the real capture dates and locations back
into the files.

## How you can tell nothing is uploaded

Muletto keeps everything on your machine. That is easy to say, so here are three
ways to see it for yourself, from the quickest to the most thorough.

**Turn off your internet, then open an export.** Everything still works. A
service worker caches the application itself, so even a reload succeeds with no
connection.

**Read the Content-Security-Policy** in `apps/web/_headers`. `connect-src` names
every host the browser will permit this page to contact. If a future change
tried to send an archive somewhere, the browser would refuse it rather than let
it happen quietly.

**Read the code that touches the network.** There are six files, and no others:

```
apps/web/app.js         fetches the sample archives on the home page
apps/web/sw.js          the offline cache
apps/web/credits.js     the credit balance for AI descriptions
apps/web/caption.js     the AI description request itself
apps/web/captionui.js   the interface around it
apps/web/plan.js        the sort-by-instruction request
```

Everything else in the application works on data already in memory. To confirm
that list rather than believing it:

```
grep -rn "fetch(\|XMLHttpRequest\|WebSocket" apps/web/
```

The only feature that deliberately sends anything is AI image description, which
is optional, off by default, and can be pointed at a model running on your own
machine instead.

## Running it

No build step is required to use it. Serve the directory:

```
cd apps/web && python -m http.server 5173
```

To regenerate the guide pages, sitemap and asset stamps after editing:

```
node tools/build-site.js
node tools/check.js
```

`check.js` enforces the house rules: plain ASCII throughout, no inline scripts,
no broken internal links, and generated pages matching their source. Run it
before committing.

## Layout

```
apps/web/           the site and the in-browser explorer
  zip.js            archive reader, including WinZip AES and ZipCrypto
  parsers.js        per-service exports into one normalised library
  insights.js       record tables into charts, totals and profiles
  catalog.js        what each service can send, so absences can be named
  explorer.js       the explorer shell and its views
  diagnose.js       accounts for every entry in an archive
  exif.js heif.js video.js mbox.js   format readers
packages/curator/   the sorting engine: scan, rule, plan, review, execute
tools/              site builder, checks, sample-data generator
```

## What is and is not tested

`TESTPLAN.md` lists everything that has to work and marks how far each item has
actually been proved: against generated data, against an archive rebuilt from a
real person's structure report, or against a real export.

It is candid on purpose. Safari and Firefox have never been run. Several
services are read partially or not at all. If you are deciding whether to trust
this with your own export, that file is the honest answer.

`GUIDE-STATUS.md` records which request guides have been walked by hand, which
is a stricter bar than being written from documentation.

## Contributing

The most useful contribution is a service this does not read properly yet.

You do not need to send anyone your data, and please do not. Open your export,
go to **What is in here**, and download the structure report: folder names, file
types, column headers and row counts, with no values, and file names reduced to
their shape. Read it in full before deciding to share it.

Open an issue with that attached and it is usually enough to reproduce the
problem, because `tools/rebuild-from-report.js` turns one back into a working
archive with invented contents. Pull requests are welcome too, particularly for
parsers. See `CONTRIBUTING.md`.

## Licence

Source available, not open source. You may read, run, modify and self-host it
for any non-commercial purpose. You may not sell it or charge for it. See
`LICENSE` for the terms, which are the PolyForm Noncommercial License 1.0.0.

Muletto is free and stays free. The source is here so nobody has to take the
privacy claim on trust, and the licence exists to keep it free rather than to
fence anything off. Use it, read it, change it, run your own copy. The one
thing it asks is that nobody turns it into something people have to pay for.
