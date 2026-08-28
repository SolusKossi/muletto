# Muletto

**A GDPR data export viewer that runs in your browser.**

Every large service is obliged to hand over a copy of your data, and most of
them do it in a format that is technically compliant and unreadable in
practice. Google Takeout keeps each photograph's date in a separate JSON file
beside it. Samsung encrypts every archive and emails the password separately.
Apple splits one request across eighteen zip files, several of which contain
further zip files.

Muletto opens those archives and reads what is in them. Nothing is uploaded,
there is no account, and there is nothing to install.

## [Open muletto.app](https://muletto.app)

Drop the archive in and it opens. Six sample exports are one click away on the
same page if you would rather not use your own yet.

### What it does

- **Opens the archive without unpacking it.** A 38 GB Takeout or an 18-part
  Apple export is read where it sits.
- **Merges several exports into one library.** Photographs from Google, Apple
  and Snapchat in one place, with the ones that appear in more than one found
  automatically.
- **Puts the dates and locations back.** Google keeps a photograph's capture
  date in a JSON file beside it rather than in the photograph; Snapchat strips
  it out and leaves it in the filename. Both are read, and written back into
  the file.
- **Reads more than the photographs** - messages across services, health
  records, location history, sign-in logs, saved web pages, Siri recordings.
- **Writes it back out as ordinary folders**, with the real dates written into
  the files themselves, so nothing afterwards depends on this site.

### Which exports it reads

Eighteen services have a reader written for them, and the split below matters
more than the total.

**Opened from a real export, and the results checked:**

| Service | What is read |
|---|---|
| Google (Takeout) | Photos, videos, location history, messages, mail, activity |
| Apple | Notes, contacts, calendar, audio, purchases, device records |
| Apple Health | 383,000 records across sixteen types, streamed rather than parsed whole |
| Samsung | Health, account and service records, including encrypted archives |
| Snapchat | Memories, chat history, split captions merged back on |
| Instagram and Facebook | Messages, posts, account records, mangled accents repaired |

**Written from what the service documents, and never yet opened from a real
export:**

| Service | What is read |
|---|---|
| Reddit | Posts, comments, votes, saved items, private messages |
| Spotify | Both streaming histories, plays separated from skips |
| X (Twitter) | Posts, direct messages, likes, media |
| Discord | Messages, from both the old CSV and the newer JSON |
| Strava | Activities on the timeline, GPX tracks on the map |
| TikTok | Watch history, likes, searches, messages |
| WhatsApp | Chat transcripts, in all three formats the phones write |
| Fitbit and Google Health | Daily figures, dated from inside each record |
| LinkedIn | Connections, posts, and messages rebuilt into conversations |
| Microsoft | Searches, browsing, locations, app use |
| Amazon | Orders across however many archives the request fanned out into |
| Anything else | Opened, listed, and read where the shape is recognisable |

Six measured against a real export, eleven not. That second group is written
from each service's own documentation and exercised against a fixture built to
it, which proves the reader does what was intended and nothing about whether a
real export matches the documentation.

[PROVIDERS.md](PROVIDERS.md) says exactly what is read from each, what is not,
and which of those claims have been measured.

### Guides

[Thirty-nine guides](https://muletto.app/guides.html): how to request an
export from each of eighteen services and what actually arrives, what to do
when one goes wrong, and where to put the files afterwards. Each leads with
the specific thing that catches people out, not with generic steps.

## How you can tell nothing is uploaded

**Turn off your internet, then open an export.** Everything still works. A
service worker caches the application itself, so even a reload succeeds with
no connection.

**Read the Content-Security-Policy** in `apps/web/_headers`. `connect-src`
names every host the browser will permit this page to contact. If a later
change tried to send an archive somewhere, the browser would refuse it rather
than let it happen quietly.

**Read the code that touches the network.** Four files do, and every one of
them talks to this origin and nowhere else:

```
apps/web/app.js         fetches the sample archives and the guide index
apps/web/sw.js          the offline cache
apps/web/analytics.js   one beacon: path, referrer, phone or not. Not loaded
                        on app.html, so the page holding your export makes no
                        requests at all
apps/web/admin.js       the operator's own usage page, behind a password
```

Everything else works on data already in memory. To confirm that list rather
than believing it:

```
grep -rln -e "fetch(" -e XMLHttpRequest -e WebSocket -e sendBeacon apps/web/
```

And the policy that enforces it, in `apps/web/_headers`, is now
`connect-src 'self'` and nothing else. There is no host to add an exception
for, so a change that tried to post your archive anywhere would be refused by
the browser rather than succeeding quietly.

## Running it

No build step is needed to use it. Serve the directory:

```
python -m http.server 5173 --bind 127.0.0.1 --directory apps/web
```

After editing, regenerate the guide pages, sitemap and asset stamps:

```
node tools/build-site.js
node tools/check.js
```

`check.js` enforces the house rules: plain ASCII throughout, no inline
scripts, no broken internal links, and generated pages matching their source.
Run it before committing.

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

`TESTPLAN.md` lists everything that has to work and marks how far each item
has been proved: against generated data, against an archive rebuilt from a
real person's structure report, or against a real export. It also lists what
has not been proved. Safari and Firefox have never been run, and eleven of the
eighteen readers have never met a real export.

`GUIDE-STATUS.md` records which request guides have been walked by hand, which
is a stricter bar than being written from documentation.

## Contributing

The most useful contribution is a service this does not read properly yet.

You do not need to send anyone your data, and please do not. Open your export,
go to **What is in here**, and download the structure report: folder names,
file types, column headers and row counts, with no values, and file names
reduced to their shape. Read it in full before deciding to share it.

Open an issue with that attached and it is usually enough to reproduce the
problem, because `tools/rebuild-from-report.js` turns one back into a working
archive with invented contents. Pull requests are welcome too, particularly
for parsers. See `CONTRIBUTING.md`.

## Licence

Source available, not open source. You may read, run, modify and self-host it
for any non-commercial purpose. You may not sell it or charge for it. The
terms are the PolyForm Noncommercial License 1.0.0, in `LICENSE`.

The source is here so the privacy claim can be checked against the code that
actually runs.
